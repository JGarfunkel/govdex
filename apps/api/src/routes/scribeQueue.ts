import { Router } from "express";
import { getPool } from "../db";
import { authMiddleware } from "../auth";

export const scribeQueueRouter = Router();

// GET /scribe/queue — the acting scribe's editable jurisdictions
// (scribe_editable_jurisdictions) and the bodies within them needing
// attention (unverified, or a channel whose status is still 'unknown').
scribeQueueRouter.get("/scribe/queue", authMiddleware, async (req, res) => {
  const user = req.govdexUser!;
  const pool = getPool();

  const { rows: jurisdictions } = await pool.query(
    `select e.jurisdiction_id, e.grant_reason, j.name, tc.code as concept
       from scribe_editable_jurisdictions($1) e
       join jurisdictions j on j.id = e.jurisdiction_id
       join type_concepts tc on tc.id = j.concept_id
      order by j.name`,
    [user.id],
  );

  const jurisdictionIds = jurisdictions.map((j) => j.jurisdiction_id);
  let needsAttention: any[] = [];
  if (jurisdictionIds.length > 0) {
    const { rows } = await pool.query(
      `select b.id as body_id, b.name as body_name, b.jurisdiction_id,
              b.verification = 'unverified' as body_unverified,
              exists (select 1 from channels c where c.body_id = b.id and c.status = 'unknown') as has_unknown_channel
         from bodies b
        where b.jurisdiction_id = any($1)
          and (b.verification = 'unverified'
               or exists (select 1 from channels c where c.body_id = b.id and c.status = 'unknown'))
        order by b.name`,
      [jurisdictionIds],
    );
    needsAttention = rows;
  }

  res.json({ jurisdictions, needsAttention });
});
