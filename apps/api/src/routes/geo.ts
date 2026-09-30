import { Router } from "express";
import { getPool } from "../db";
import { findChildJurisdictionBySlug, findStateJurisdictionBySlug, loadEntityPayload } from "../lib/geoPayload";

// Slug-based hierarchy resolution: /geo/:state[/:subdivision[/:subentity]]
// mirrors the /:state[/:subdivision[/:subentity]] page paths. Each
// segment is resolved as a `within`-child of the previous one — never a
// global slug lookup — so "westchester" only has to be unique among the
// state's own children, and "rye-town" only among Westchester's.
export const geoRouter = Router();

// Which states are live: a state jurisdiction exists AND t06 has given it a
// slug. This is what the home map reads, so loading a state + running t06 is
// the whole "go live" step — no code change per state.
geoRouter.get("/geo", async (_req, res) => {
  const { rows } = await getPool().query<{ code: string; name: string; slug: string }>(
    `select p.code, j.name, j.attributes->>'slug' as slug
       from jurisdictions j
       join type_concepts tc on tc.id = j.concept_id
       join profiles p on p.id = j.profile_id
      where tc.code = 'state' and j.attributes->>'slug' is not null
      order by j.name`,
  );
  res.json({ states: rows.map((r) => ({ code: r.code.replace(/^US-/, ""), name: r.name, slug: r.slug })) });
});

geoRouter.get("/geo/:state", async (req, res) => {
  const pool = getPool();
  const stateId = await findStateJurisdictionBySlug(pool, req.params.state);
  if (!stateId) {
    res.status(404).json({ message: "State not found" });
    return;
  }
  res.json(await loadEntityPayload(pool, stateId));
});

geoRouter.get("/geo/:state/:subdivision", async (req, res) => {
  const pool = getPool();
  const stateId = await findStateJurisdictionBySlug(pool, req.params.state);
  if (!stateId) {
    res.status(404).json({ message: "State not found" });
    return;
  }
  const subdivisionId = await findChildJurisdictionBySlug(pool, stateId, req.params.subdivision);
  if (!subdivisionId) {
    res.status(404).json({ message: "Subdivision not found" });
    return;
  }
  res.json(await loadEntityPayload(pool, subdivisionId));
});

geoRouter.get("/geo/:state/:subdivision/:subentity", async (req, res) => {
  const pool = getPool();
  const stateId = await findStateJurisdictionBySlug(pool, req.params.state);
  if (!stateId) {
    res.status(404).json({ message: "State not found" });
    return;
  }
  const subdivisionId = await findChildJurisdictionBySlug(pool, stateId, req.params.subdivision);
  if (!subdivisionId) {
    res.status(404).json({ message: "Subdivision not found" });
    return;
  }
  const subentityId = await findChildJurisdictionBySlug(pool, subdivisionId, req.params.subentity);
  if (!subentityId) {
    res.status(404).json({ message: "Sub-entity not found" });
    return;
  }
  res.json(await loadEntityPayload(pool, subentityId));
});
