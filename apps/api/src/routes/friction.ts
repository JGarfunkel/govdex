import { Router } from "express";
import { createFrictionSchema } from "@govdex/shared";
import { getPool } from "../db";
import { authMiddleware } from "../auth";
import { withUser } from "../withUser";
import { canEditField } from "../permissions";

export const frictionRouter = Router();

// GET /frictions?jurisdiction=… — full triage queue (every status), for
// the scribe view on EntityPage. The public-facing list (open findings only)
// is served as part of GET /geo/* — see apps/api/src/lib/geoPayload.ts.
frictionRouter.get("/frictions", authMiddleware, async (req, res) => {
  const jurisdictionId = typeof req.query.jurisdiction === "string" ? req.query.jurisdiction : null;
  const pool = getPool();
  const { rows } = await pool.query(
    `select * from frictions
      where $1::uuid is null or jurisdiction_id = $1
      order by detected_at desc`,
    [jurisdictionId],
  );
  res.json({ frictions: rows });
});

// POST /frictions — a scribe files a friction the spider can't judge
// on its own (see MANUAL_FRICTION_TYPES). Starts 'confirmed': a human
// already made the call, so there's nothing left to triage.
frictionRouter.post("/frictions", authMiddleware, async (req, res) => {
  const parsed = createFrictionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid request body", issues: parsed.error.issues });
    return;
  }
  const input = parsed.data;
  const user = req.govdexUser!;

  const allowed = await canEditField(user.id, "frictions", null, input.jurisdictionId);
  if (!allowed) {
    res.status(403).json({ message: "Not permitted to file a friction here" });
    return;
  }

  const { rows } = await getPool().query<{ id: string }>(
    `insert into frictions
       (jurisdiction_id, body_id, pattern_type, status, page_url, summary, detail, source_url,
        created_by, reviewed_by, reviewed_at)
     values ($1, $2, $3, 'confirmed', $4, $5, $6, $7, $8, $8, now())
     on conflict (jurisdiction_id, pattern_type, page_url) do nothing
     returning id`,
    [
      input.jurisdictionId,
      input.bodyId ?? null,
      input.patternType,
      input.pageUrl,
      input.summary,
      input.detail ?? null,
      input.sourceUrl ?? null,
      user.id,
    ],
  );
  if (!rows[0]) {
    res.status(409).json({ message: "This friction is already recorded for this page" });
    return;
  }
  res.status(201).json({ id: rows[0].id });
});

// POST /frictions/:id/:action — scribe triage on a spider-found row
// ('confirm'/'dismiss', only valid from status='new') or on any open row
// ('resolve', once the underlying issue is actually fixed).
const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  confirm: { from: ["new"], to: "confirmed" },
  dismiss: { from: ["new"], to: "dismissed" },
  resolve: { from: ["new", "confirmed"], to: "resolved" },
};

frictionRouter.post("/frictions/:id/:action", authMiddleware, async (req, res) => {
  const transition = TRANSITIONS[String(req.params.action)];
  if (!transition) {
    res.status(404).json({ message: `Unknown action ${req.params.action}` });
    return;
  }
  const user = req.govdexUser!;

  try {
    const result = await withUser(user.id, async (client) => {
      const { rows } = await client.query("select * from frictions where id = $1 for update", [req.params.id]);
      const friction = rows[0];
      if (!friction) throw Object.assign(new Error("Friction not found"), { status: 404 });
      if (!transition.from.includes(friction.status)) {
        throw Object.assign(new Error(`Cannot ${req.params.action} a friction that is ${friction.status}`), { status: 409 });
      }
      const allowed = await canEditField(user.id, "frictions", null, friction.jurisdiction_id);
      if (!allowed) throw Object.assign(new Error("Not permitted to review frictions here"), { status: 403 });

      await client.query(
        `update frictions
            set status = $1,
                reviewed_by = $2, reviewed_at = now(),
                resolved_at = case when $1 = 'resolved' then now() else resolved_at end
          where id = $3`,
        [transition.to, user.id, friction.id],
      );
      return { id: friction.id, status: transition.to };
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.status ?? 500).json({ message: err.message ?? "Failed to update friction" });
  }
});
