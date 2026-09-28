import { Router } from "express";
import { getPool } from "../db";
import { authMiddleware } from "../auth";

export const jurisdictionsRouter = Router();

// GET /jurisdictions?q=<name>&level=<type_concepts.level> — name search used
// by the scribe UI to match a spider-found special district (candidate_links
// link_type='district') against an existing jurisdiction (e.g. one
// ingestion/t01b-school-districts already imported) before falling back to
// creating a new one. Distinct route from /jurisdictions/:id below — no path
// collision since this one never has an id segment.
jurisdictionsRouter.get("/jurisdictions", authMiddleware, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const level = typeof req.query.level === "string" ? req.query.level : null;
  if (q.length < 2) {
    res.json({ jurisdictions: [] });
    return;
  }
  const { rows } = await getPool().query(
    `select j.id, j.name, tc.code as concept_code, tc.level
       from jurisdictions j
       join type_concepts tc on tc.id = j.concept_id
      where j.name ilike '%' || $1 || '%'
        and ($2::text is null or tc.level = $2)
      order by j.name
      limit 20`,
    [q, level],
  );
  res.json({ jurisdictions: rows });
});

jurisdictionsRouter.get("/jurisdictions/:id", async (req, res) => {
  const pool = getPool();
  const { rows } = await pool.query(
    `select j.id, j.name, j.website, j.attributes, j.verification, j.origin,
            tc.code as concept, p.code as profile, cp.local_name, cp.local_abbrev
       from jurisdictions j
       join type_concepts tc on tc.id = j.concept_id
       join profiles p on p.id = j.profile_id
       left join concept_profiles cp on cp.profile_id = j.profile_id and cp.concept_id = j.concept_id
      where j.id = $1`,
    [req.params.id],
  );
  const jurisdiction = rows[0];
  if (!jurisdiction) {
    res.status(404).json({ message: "Jurisdiction not found" });
    return;
  }

  const { rows: identifiers } = await pool.query(
    "select scheme, value from jurisdiction_identifiers where jurisdiction_id = $1",
    [jurisdiction.id],
  );
  const { rows: within } = await pool.query(
    `select r.to_id as jurisdiction_id, j.name, tc.code as concept
       from jurisdiction_relations r
       join jurisdictions j on j.id = r.to_id
       join type_concepts tc on tc.id = j.concept_id
      where r.from_id = $1 and r.relation = 'within'`,
    [jurisdiction.id],
  );
  const { rows: children } = await pool.query(
    `select r.from_id as jurisdiction_id, j.name, tc.code as concept
       from jurisdiction_relations r
       join jurisdictions j on j.id = r.from_id
       join type_concepts tc on tc.id = j.concept_id
      where r.to_id = $1 and r.relation = 'within'`,
    [jurisdiction.id],
  );
  const { rows: overlaps } = await pool.query(
    `select case when r.from_id = $1 then r.to_id else r.from_id end as jurisdiction_id,
            j.name, tc.code as concept, r.relation, r.coverage
       from jurisdiction_relations r
       join jurisdictions j on j.id = (case when r.from_id = $1 then r.to_id else r.from_id end)
       join type_concepts tc on tc.id = j.concept_id
      where (r.from_id = $1 or r.to_id = $1) and r.relation in ('overlaps', 'coextensive')`,
    [jurisdiction.id],
  );
  const { rows: bodies } = await pool.query(
    `select b.id, b.name, bc.code as category, b.is_governmental
       from bodies b
       join body_categories bc on bc.id = b.category_id
      where b.jurisdiction_id = $1
      order by b.name`,
    [jurisdiction.id],
  );

  res.json({ ...jurisdiction, identifiers, within, children, overlaps, bodies });
});
