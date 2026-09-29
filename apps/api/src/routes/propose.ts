import { Router } from "express";
import type { PoolClient } from "pg";
import { proposeSchema } from "@govdex/shared";
import { authMiddleware } from "../auth";
import { withUser } from "../withUser";
import { getPool } from "../db";
import { canEditField, requiredTier } from "../permissions";

export const proposeRouter = Router();

// Walk a row to its owning jurisdiction, mirroring row_jurisdiction() in
// schema.sql, for tables the app needs to check pre-write (before the row
// necessarily exists yet, so the DB-side JSONB version doesn't apply for inserts).
async function rowJurisdiction(client: PoolClient, tableName: string, diff: Record<string, unknown>): Promise<string | null> {
  switch (tableName) {
    case "jurisdictions":
      return null; // the row IS the jurisdiction; can_edit_field treats jurisdiction-anchored tables via jurisdiction id itself when needed
    case "jurisdiction_identifiers":
    case "bodies":
      return (diff.jurisdiction_id as string) ?? null;
    case "adoptions":
      return (diff.jurisdiction_id as string) ?? null;
    case "seats":
    case "channels": {
      const bodyId = diff.body_id as string | undefined;
      if (!bodyId) return null;
      const { rows } = await client.query("select jurisdiction_id from bodies where id = $1", [bodyId]);
      return rows[0]?.jurisdiction_id ?? null;
    }
    case "roles": {
      const seatId = diff.seat_id as string | undefined;
      if (!seatId) return null;
      const { rows } = await client.query(
        "select b.jurisdiction_id from seats s join bodies b on b.id = s.body_id where s.id = $1",
        [seatId],
      );
      return rows[0]?.jurisdiction_id ?? null;
    }
    default:
      return null; // jurisdiction_relations, products, officials: not anchored to one jurisdiction
  }
}

// POST /propose — a scribe edit. Always writes a revisions row as 'proposed'.
// For low-risk fields (required_tier === 'scribe' for every changed column)
// it's also applied directly in the same transaction, once can_edit_field
// confirms the user is in scope; anything requiring a higher tier stays
// queued for a lead/editor to accept.
proposeRouter.post("/propose", authMiddleware, async (req, res) => {
  const parsed = proposeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request body", issues: parsed.error.issues });
    return;
  }
  const { tableName, recordId, op, diff, sourceUrl } = parsed.data;
  const user = req.govdexUser!;

  try {
    const result = await withUser(user.id, async (client) => {
      const jurisdictionId = tableName === "jurisdictions" ? recordId : await rowJurisdiction(client, tableName, diff);

      for (const column of Object.keys(diff)) {
        const allowed = await canEditField(user.id, tableName, column, jurisdictionId);
        if (!allowed) {
          throw Object.assign(new Error(`Not permitted to edit ${tableName}.${column}`), { status: 403 });
        }
      }

      const { rows: revisionRows } = await client.query(
        `insert into revisions (table_name, record_id, op, diff, source_url, status, changed_by)
         values ($1, $2, $3, $4, $5, 'proposed', $6)
         returning id`,
        [tableName, recordId, op, JSON.stringify(diff), sourceUrl ?? null, user.id],
      );
      const revisionId = revisionRows[0].id;

      const tiers = await Promise.all(Object.keys(diff).map((col) => requiredTier(tableName, col)));
      const isLowRisk = tiers.every((t) => t === "scribe");
      let applied = false;

      if (isLowRisk && op !== "delete") {
        const columns = Object.keys(diff);
        const values = Object.values(diff);
        if (op === "insert") {
          const placeholders = columns.map((_, i) => `$${i + 2}`).join(", ");
          await client.query(
            `insert into ${tableName} (id, ${columns.join(", ")}) values ($1, ${placeholders})`,
            [recordId, ...values],
          );
        } else {
          const setClause = columns.map((c, i) => `${c} = $${i + 2}`).join(", ");
          await client.query(`update ${tableName} set ${setClause} where id = $1`, [recordId, ...values]);
        }
        await client.query(
          "update revisions set status = 'accepted', reviewed_by = $1, reviewed_at = now() where id = $2",
          [user.id, revisionId],
        );
        applied = true;
      }

      return { revisionId, applied, jurisdictionId };
    });

    // A website that actually took effect is a seed worth crawling in the
    // background for related info (channels, boards, emails, calendars,
    // SaaS vendors) — see crawl_jobs in schema.sql and
    // ingestion/spider/worker.ts, which drains this queue in a separate
    // process. Best-effort: a failure to enqueue shouldn't fail the edit
    // that already succeeded.
    if (result.applied && typeof diff.website === "string" && diff.website && (tableName === "bodies" || tableName === "jurisdictions")) {
      const bodyId = tableName === "bodies" ? recordId : null;
      await getPool()
        .query(
          `insert into crawl_jobs (jurisdiction_id, body_id, seed_url, queued_by) values ($1, $2, $3, $4)`,
          [result.jurisdictionId, bodyId, diff.website, user.id],
        )
        .catch((err) => console.error("failed to enqueue crawl job", err));
    }

    // Same best-effort auto-crawl as website above, for the "legislative
    // districts & seats" section's own seed page — set (usually) before any
    // district/seat/committee rows exist, specifically so the spider can go
    // find them.
    if (result.applied && tableName === "jurisdictions" && typeof diff.legislative_districts_url === "string" && diff.legislative_districts_url) {
      await getPool()
        .query(
          `insert into crawl_jobs (jurisdiction_id, body_id, seed_url, queued_by) values ($1, $2, $3, $4)`,
          [result.jurisdictionId, null, diff.legislative_districts_url, user.id],
        )
        .catch((err) => console.error("failed to enqueue crawl job", err));
    }

    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status ?? 500).json({ message: err.message ?? "Failed to propose edit" });
  }
});
