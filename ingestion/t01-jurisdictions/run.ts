// t01 — jurisdictions with websites (counties, cities, towns, villages), plus
// the state jurisdiction and the numbered legislative/congressional/judicial
// jurisdictions. Source for counties/cities/towns/villages: the NY State
// Locality Hierarchy with Websites dataset (Socrata resource 55k6-h6qq),
// confirmed live at build time: 1605 rows (57 counties + 5 NYC boroughs coded
// as counties + 932 towns + 62 cities + 549 villages).
//
// Every row here gets attributes.county_fips (counties/cities/towns/villages)
// or attributes.district_number (AD/SD/CD/JD) stashed specifically so
// apps/api's pre-PostGIS /resolve has something exact to join on.
import "dotenv/config";
import type { Pool } from "pg";
import { getPool } from "@govdex/db";
import { sodaFetchAll } from "../lib/soda";
import { getConceptIds, getProfileId } from "../lib/identifiers";
import { upsertJurisdictionByIdentifier, addIdentifier } from "../lib/upsert";

const LOCALITIES_URL = "https://data.ny.gov/resource/55k6-h6qq.json";

interface LocalityRow {
  swis_code: string;
  type_code: string;
  type: string;
  county: string;
  municipality?: string;
  gnis_id?: string;
  state_fips: string;
  county_code: string;
  county_fips: string;
  website?: { url?: string };
}

const TYPE_CODE_TO_CONCEPT: Record<string, string> = {
  "1": "county", // includes "Borough/County" rows for the 5 NYC boroughs
  "2": "city",
  "3": "town",
  "4": "village",
};

// NY's current apportionment (confirmed live, August 2026): 150 Assembly
// districts, 63 Senate districts, 26 congressional districts. Judicial
// district count (13) comes from the US-NY profile config seeded at t00.
async function createNumberedJurisdictions(client: Pool, profileId: number, conceptIds: Record<string, number>) {
  const series: { concept: string; scheme: string; count: number }[] = [
    { concept: "state_house_district", scheme: "ny_ad", count: 150 },
    { concept: "state_senate_district", scheme: "ny_sd", count: 63 },
    { concept: "us_house_district", scheme: "ny_cd", count: 26 },
    { concept: "judicial_region", scheme: "ny_jd", count: 13 },
  ];
  const labels: Record<string, string> = {
    state_house_district: "Assembly District",
    state_senate_district: "Senate District",
    us_house_district: "Congressional District",
    judicial_region: "Judicial District",
  };

  for (const s of series) {
    for (let n = 1; n <= s.count; n++) {
      await upsertJurisdictionByIdentifier(client, {
        scheme: s.scheme,
        value: String(n),
        name: `${labels[s.concept]} ${n}`,
        profileId,
        conceptId: conceptIds[s.concept],
        attributes: { district_number: n },
      });
    }
    console.log(`  ${s.count} ${s.concept} jurisdictions upserted`);
  }
}

async function main() {
  const pool = getPool();
  const conceptIds = await getConceptIds(pool);
  const profileId = await getProfileId(pool, "US-NY");

  console.log("Creating the state jurisdiction...");
  await upsertJurisdictionByIdentifier(pool, {
    scheme: "usps_state",
    value: "NY",
    name: "New York State",
    profileId,
    conceptId: conceptIds["state"],
  });

  console.log("Fetching NY State Locality Hierarchy (55k6-h6qq)...");
  const rows = await sodaFetchAll<LocalityRow>(LOCALITIES_URL);
  console.log(`  fetched ${rows.length} rows`);

  let loaded = 0;
  for (const row of rows) {
    const conceptCode = TYPE_CODE_TO_CONCEPT[row.type_code];
    if (!conceptCode) {
      console.warn(`  skipping unknown type_code ${row.type_code} (swis ${row.swis_code})`);
      continue;
    }
    // municipality is null for plain "County" rows (only NYC's Borough/County
    // rows populate it); fall back to the county field in that case.
    const name = row.municipality || row.county;
    const id = await upsertJurisdictionByIdentifier(pool, {
      scheme: "swis",
      value: row.swis_code,
      name,
      profileId,
      conceptId: conceptIds[conceptCode],
      website: row.website?.url ?? null,
      attributes: {
        county_fips: row.county_fips,
        county_code: row.county_code,
        state_fips: row.state_fips,
      },
      sourceUrl: LOCALITIES_URL,
    });
    if (row.gnis_id) {
      await addIdentifier(pool, id, "gnis", row.gnis_id, LOCALITIES_URL);
    }
    loaded++;
  }
  console.log(`  upserted ${loaded} county/city/town/village jurisdictions`);

  console.log("Creating numbered AD/SD/CD/JD jurisdictions...");
  await createNumberedJurisdictions(pool, profileId, conceptIds);

  console.log(
    "NOTE: school districts (SEDREF/BEDS) are NOT loaded by this script — no live, " +
      "confirmed SEDREF source URL was verified for this pass. Add a loader once one is confirmed.",
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
