// t02 — clean `within` relations derived from the t01 hierarchy dataset:
// county -> state, city/town -> county (matched on county_fips, never on
// name), village -> town (using the dataset's own town_name column on
// village rows — no inference needed). Legislative overlaps are NOT derived
// here per the doc: that needs geometry (t03) and is deliberately left alone.
import "dotenv/config";
import { getPool } from "@govdex/db";
import { sodaFetchAll } from "../lib/soda";
import { upsertRelation } from "../lib/upsert";

const LOCALITIES_URL = "https://data.ny.gov/resource/55k6-h6qq.json";

interface LocalityRow {
  swis_code: string;
  type_code: string;
  county_fips: string;
  town_name?: string;
  municipality?: string;
}

async function jurisdictionIdBySwis(pool: ReturnType<typeof getPool>, swis: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `select jurisdiction_id as id from jurisdiction_identifiers where scheme = 'swis' and value = $1`,
    [swis],
  );
  return rows[0]?.id ?? null;
}

async function jurisdictionIdByCountyFips(pool: ReturnType<typeof getPool>, countyFips: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `select j.id from jurisdictions j join type_concepts tc on tc.id = j.concept_id
      where tc.code = 'county' and j.attributes->>'county_fips' = $1
      limit 1`,
    [countyFips],
  );
  return rows[0]?.id ?? null;
}

async function jurisdictionIdByCountyFipsAndName(
  pool: ReturnType<typeof getPool>,
  conceptCodes: string[],
  countyFips: string,
  name: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `select j.id from jurisdictions j
       join type_concepts tc on tc.id = j.concept_id
      where tc.code = any($1) and j.attributes->>'county_fips' = $2 and lower(j.name) = lower($3)
      limit 1`,
    [conceptCodes, countyFips, name],
  );
  return rows[0]?.id ?? null;
}

async function main() {
  const pool = getPool();

  const { rows: stateRow } = await pool.query<{ id: string }>(
    `select id from jurisdictions where id in (select jurisdiction_id from jurisdiction_identifiers where scheme='usps_state' and value='NY')`,
  );
  const stateId = stateRow[0]?.id;
  if (!stateId) throw new Error("NY state jurisdiction not found — run t01 first.");

  console.log("Fetching NY State Locality Hierarchy (55k6-h6qq) for relation derivation...");
  const rows = await sodaFetchAll<LocalityRow>(LOCALITIES_URL);

  let countyWithinState = 0;
  let cityTownWithinCounty = 0;
  let villageWithinTown = 0;
  let skipped = 0;

  for (const row of rows) {
    const jId = await jurisdictionIdBySwis(pool, row.swis_code);
    if (!jId) {
      skipped++;
      continue;
    }

    if (row.type_code === "1") {
      // county (including NYC boroughs-as-county) -> state
      await upsertRelation(pool, jId, stateId, "within");
      countyWithinState++;
      continue;
    }

    // city/town -> the county sharing this row's county_fips (one county per fips code)
    if (row.type_code === "2" || row.type_code === "3") {
      const countyId = await jurisdictionIdByCountyFips(pool, row.county_fips);
      if (countyId) {
        await upsertRelation(pool, jId, countyId, "within");
        cityTownWithinCounty++;
      }
    }

    if (row.type_code === "4" && row.town_name) {
      const townId = await jurisdictionIdByCountyFipsAndName(pool, ["town"], row.county_fips, row.town_name);
      if (townId) {
        await upsertRelation(pool, jId, townId, "within");
        villageWithinTown++;
      } else {
        console.warn(`  no town "${row.town_name}" found in county_fips ${row.county_fips} for village ${row.municipality}`);
      }
    }
  }

  console.log(`  county -> state: ${countyWithinState}`);
  console.log(`  city/town -> county: ${cityTownWithinCounty}`);
  console.log(`  village -> town: ${villageWithinTown}`);
  if (skipped > 0) console.warn(`  skipped ${skipped} rows with no matching jurisdiction (run t01 first)`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
