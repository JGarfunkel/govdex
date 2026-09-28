// t01c — the ~37 BOCES (Boards of Cooperative Educational Services)
// regional jurisdictions. type_concepts already has 'educational_region'
// seeded (packages/shared/src/conf/ny.yaml: local_name 'BOCES', ~37
// expected — see AGENTS.md) but nothing populated it until now.
//
// Roster (id + canonical name) from NYSED's own GIS layer:
// NYS_Schools/MapServer layer 17 ("BOCES Districts") — 38 rows, one of
// which ("3090 - Not a BOCES") is excluded, leaving 37. That layer has no
// website field, so websites here are a hand-verified mapping against
// boces.org's own https://www.boces.org/regional-boces-directory/ (the
// member association's directory) — matched by county-name components, not
// scraped automatically, since a handful of BOCES go by a brand name
// unrelated to their county list (CiTi = Oswego, Questar III =
// Rensselaer-Columbia-Greene, CVES = Clinton-Essex-Warren-Washington).
import "dotenv/config";
import { getPool } from "@govdex/db";
import { getConceptIds, getProfileId } from "../lib/identifiers";
import { upsertJurisdictionByIdentifier } from "../lib/upsert";
import { arcgisFetchAll } from "../lib/arcgis";

const LAYER_URL = "https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Schools/MapServer/17";
const DIRECTORY_URL = "https://www.boces.org/regional-boces-directory/";

interface BocesRow {
  SEDDIR_BOCES_ID: string;
  SEDDIR_BOCES_NAME: string;
}

// SEDDIR_BOCES_ID -> website, hand-matched against boces.org's directory —
// see the file header for why this isn't auto-scraped.
const WEBSITES: Record<string, string> = {
  "0190": "http://www.capitalregionboces.org/",
  "0390": "https://www.btboces.org/",
  "0490": "https://www.caboces.org/",
  "0590": "http://www.cayboces.org/",
  "0990": "http://www.cves.org/",
  "1290": "http://www.dcmoboces.com/",
  "1390": "http://www.dcboces.org/",
  "1491": "http://www.e1b.org/",
  "1492": "http://www.e2ccb.org/",
  "1690": "http://www.fehb.org/",
  "1990": "http://www.oncboces.org/",
  "2090": "http://www.hfmboces.org/",
  "2190": "https://www.herkimer-boces.org/",
  "2290": "http://www.boces.com/",
  "2490": "http://www.gvboces.org/",
  "2590": "https://www.moboces.org/",
  "2691": "http://www.monroe.edu/",
  "2692": "http://www.monroe2boces.org/",
  "2890": "https://www.nassauboces.org/",
  "4190": "https://www.oneida-boces.org/",
  "4290": "http://www.ocmboces.org/",
  "4390": "http://www.wflboces.org/",
  "4490": "http://www.ouboces.org/",
  "4590": "http://www.onboces.org/",
  "4690": "https://www.citiboces.org/",
  "4890": "https://www.pnwboces.org/",
  "4990": "https://www.questar.org/",
  "5090": "http://www.rocklandboces.org/",
  "5190": "http://www.sllboces.org/",
  "5590": "http://www.gstboces.org/",
  "5891": "https://www.esboces.org/",
  "5893": "http://www.wsboces.org/",
  "5990": "https://www.scboces.org/",
  "6190": "http://tstboces.org/",
  "6290": "http://www.ulsterboces.org/",
  "6490": "https://www.wswheboces.org/",
  "6690": "http://www.swboces.org/",
};

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main() {
  const pool = getPool();
  const conceptIds = await getConceptIds(pool);
  const profileId = await getProfileId(pool, "US-NY");

  console.log("Fetching BOCES roster (NYS_Schools/MapServer layer 17)...");
  const rows = await arcgisFetchAll<BocesRow>(`${LAYER_URL}/query`, ["SEDDIR_BOCES_ID", "SEDDIR_BOCES_NAME"]);
  console.log(`  fetched ${rows.length} rows`);

  let loaded = 0;
  let missingWebsite = 0;
  for (const row of rows) {
    if (row.SEDDIR_BOCES_NAME.includes("Not a BOCES")) continue;
    const website = WEBSITES[row.SEDDIR_BOCES_ID] ?? null;
    if (!website) missingWebsite++;
    await upsertJurisdictionByIdentifier(pool, {
      scheme: "boces_code",
      value: row.SEDDIR_BOCES_ID,
      name: titleCase(row.SEDDIR_BOCES_NAME),
      profileId,
      conceptId: conceptIds["educational_region"],
      website,
      sourceUrl: website ? DIRECTORY_URL : LAYER_URL,
    });
    loaded++;
  }
  console.log(`  upserted ${loaded} BOCES jurisdictions${missingWebsite ? ` (${missingWebsite} without a matched website)` : ""}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
