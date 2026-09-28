// t01d — synthesizes a single "New York City" jurisdiction. t01 loads NYC's
// 5 boroughs as 5 disjoint `county` rows (per the source dataset's own
// "Borough/County" coding) and t02 points each of them `within` the state
// directly, so today there is no jurisdiction row a /ny/new-york-city
// page could resolve to, and boroughs have no common parent. This script:
//   1. creates that jurisdiction (reusing the existing `city` concept — NYC
//      isn't modeled as a new portable concept; nothing downstream lists
//      "all cities statewide" in a way that would double-count it),
//   2. re-parents the 5 boroughs under it (removing their direct
//      borough -> state edges so they show up as NYC's sub-entities, not
//      also as top-level state subdivisions),
//   3. parents NYC itself under the state, and
//   4. gives NYC an explicit "City Council" governing body (real-world
//      name; the generic `city` profile's default_body_name of "Common
//      Council" is right for e.g. the City of Rye, not for NYC).
import "dotenv/config";
import { getPool } from "@govdex/db";
import { getConceptIds, getProfileId, getBodyCategoryId } from "../lib/identifiers";
import { upsertJurisdictionByIdentifier, upsertRelation, upsertBodyByName } from "../lib/upsert";

// The source dataset (55k6-h6qq) surfaces these under the common borough
// name, not the underlying county's legal name (Kings/New York/Richmond) —
// confirmed against the live t01 data, which loaded "Brooklyn", "Manhattan",
// "Staten Island" rather than the legal county names.
const BOROUGH_NAMES = ["Bronx", "Brooklyn", "Manhattan", "Queens", "Staten Island"];

async function main() {
  const pool = getPool();
  const conceptIds = await getConceptIds(pool);
  const profileId = await getProfileId(pool, "US-NY");
  const categoryId = await getBodyCategoryId(pool, "official_elected");

  const { rows: stateRows } = await pool.query<{ id: string }>(
    `select jurisdiction_id as id from jurisdiction_identifiers where scheme = 'usps_state' and value = 'NY'`,
  );
  const stateId = stateRows[0]?.id;
  if (!stateId) throw new Error("NY state jurisdiction not found — run govdex:t01 first.");

  console.log("Creating the New York City jurisdiction...");
  const nycId = await upsertJurisdictionByIdentifier(pool, {
    scheme: "synthetic",
    value: "nyc",
    name: "New York City",
    profileId,
    conceptId: conceptIds["city"],
    website: "https://www.nyc.gov",
  });

  const { rows: boroughs } = await pool.query<{ id: string; name: string }>(
    `select j.id, j.name
       from jurisdictions j
       join type_concepts tc on tc.id = j.concept_id
      where tc.code = 'county' and j.profile_id = $1 and j.name = any($2)`,
    [profileId, BOROUGH_NAMES],
  );
  if (boroughs.length !== BOROUGH_NAMES.length) {
    console.warn(`  expected ${BOROUGH_NAMES.length} boroughs, found ${boroughs.length} — run govdex:t01 first?`);
  }

  for (const borough of boroughs) {
    await pool.query(
      `delete from jurisdiction_relations where from_id = $1 and to_id = $2 and relation = 'within'`,
      [borough.id, stateId],
    );
    await upsertRelation(pool, borough.id, nycId, "within");
    console.log(`  reparented ${borough.name} -> New York City`);
  }

  await upsertRelation(pool, nycId, stateId, "within");

  await upsertBodyByName(pool, {
    jurisdictionId: nycId,
    categoryId,
    name: "City Council",
    isGovernmental: true,
    website: "https://council.nyc.gov",
  });

  console.log("Done. Run govdex:t06:slugs next so NYC and its boroughs get slugs.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
