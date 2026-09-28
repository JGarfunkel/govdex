import { Router } from "express";
import { revisionAcceptSchema, PROPOSABLE_TABLES } from "@govdex/shared";
import { getPool } from "../db";
import { authMiddleware } from "../auth";
import { withUser } from "../withUser";
import { canEditField } from "../permissions";

export const revisionsRouter = Router();

// GET /revisions?status=proposed — the accept queue. Not in the doc's own API
// list verbatim, but implied by "a lead or editor applies a proposed diff" —
// there has to be a way to see what's pending.
revisionsRouter.get("/revisions", authMiddleware, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "proposed";
  const { rows } = await getPool().query(
    `select id, table_name, record_id, op, diff, source_url, status, changed_by, changed_at
       from revisions
      where status = $1
      order by changed_at desc
      limit 200`,
    [status],
  );
  res.json({ revisions: rows });
});

// POST /revisions/:id/accept — a lead or editor applies a proposed diff. The
// accept runs as the accepting user (withUser), so the applied write clears
// the permission check under that user's own tier and stamps verification.
revisionsRouter.post("/revisions/:id/accept", authMiddleware, async (req, res) => {
  const parsed = revisionAcceptSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request body", issues: parsed.error.issues });
    return;
  }
  const user = req.govdexUser!;

  try {
    const result = await withUser(user.id, async (client) => {
      const { rows } = await client.query("select * from revisions where id = $1 for update", [req.params.id]);
      const revision = rows[0];
      if (!revision) throw Object.assign(new Error("Revision not found"), { status: 404 });
      if (revision.status !== "proposed") {
        throw Object.assign(new Error(`Revision is already ${revision.status}`), { status: 409 });
      }
      if (!(PROPOSABLE_TABLES as readonly string[]).includes(revision.table_name)) {
        throw Object.assign(new Error("Revision targets a non-proposable table"), { status: 400 });
      }

      const diff = revision.diff as Record<string, unknown>;
      for (const column of Object.keys(diff)) {
        const allowed = await canEditField(user.id, revision.table_name, column, null);
        if (!allowed) {
          throw Object.assign(new Error(`Not permitted to accept ${revision.table_name}.${column}`), { status: 403 });
        }
      }

      const columns = Object.keys(diff);
      const values = Object.values(diff);
      if (revision.op === "insert") {
        const placeholders = columns.map((_, i) => `$${i + 2}`).join(", ");
        await client.query(
          `insert into ${revision.table_name} (id, ${columns.join(", ")}) values ($1, ${placeholders})
           on conflict (id) do update set ${columns.map((c, i) => `${c} = $${i + 2}`).join(", ")}`,
          [revision.record_id, ...values],
        );
      } else if (revision.op === "update") {
        const setClause = columns.map((c, i) => `${c} = $${i + 2}`).join(", ");
        await client.query(`update ${revision.table_name} set ${setClause} where id = $1`, [revision.record_id, ...values]);
      } else {
        await client.query(`delete from ${revision.table_name} where id = $1`, [revision.record_id]);
      }

      await client.query(
        "update revisions set status = 'accepted', reviewed_by = $1, reviewed_at = now() where id = $2",
        [user.id, revision.id],
      );
      return { revisionId: revision.id, status: "accepted" };
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.status ?? 500).json({ message: err.message ?? "Failed to accept revision" });
  }
});
