// t01b — NY public school districts, sourced from NYSED's own authoritative
// GIS layer: NYS_Schools/MapServer, layer 18 ("School Districts"), confirmed
// live at build time — 936 features. This is NOT the SEDREF public reports
// system (that sits behind an authenticated COGNOS/OAM gateway, not a plain
// fetchable endpoint) or NYSED's bulk enrollment files (those ship as
// Access .mdb/.accdb archives, not worth parsing just for a district
// roster). The GIS layer's INST_ID field is the same 12-digit BEDS-style
// code NYSED's own data.nysed.gov site uses (e.g. instid=800000038068),
// confirmed by sampling real rows before writing this loader.
//
// Tabular roster only, same scope t01 has for towns — the layer does carry
// polygon geometry, but this loader ignores it (returnGeometry=false).
// Boundaries, and therefore jurisdiction_relations to the municipalities
// each district overlaps (districts routinely cross town lines), wait for
// t03's PostGIS import, per the existing AGENTS.md note on /resolve.
import "dotenv/config";
import { getPool } from "@govdex/db";
import { arcgisFetchAll } from "../lib/arcgis";
import { getConceptIds, getProfileId } from "../lib/identifiers";
import { upsertJurisdictionByIdentifier } from "../lib/upsert";

const LAYER_URL = "https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Schools/MapServer/18";

interface SchoolDistrictRow {
  INST_ID: string; // 12-digit BEDS code, e.g. "800000054990"
  POPULAR_NA: string; // display name, e.g. "LONG BEACH CITY SD"
  SDLCODE: string; // 6-digit SED district code
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

async function main() {
  const pool = getPool();
  const conceptIds = await getConceptIds(pool);
  const profileId = await getProfileId(pool, "US-NY");

  console.log("Fetching NYS school district roster (NYS_Schools/MapServer layer 18)...");
  const rows = await arcgisFetchAll<SchoolDistrictRow>(`${LAYER_URL}/query`, ["INST_ID", "POPULAR_NA", "SDLCODE"]);
  console.log(`  fetched ${rows.length} rows`);

  let loaded = 0;
  for (const row of rows) {
    if (!row.INST_ID || !row.POPULAR_NA) {
      console.warn(`  skipping row with missing INST_ID/POPULAR_NA: ${JSON.stringify(row)}`);
      continue;
    }
    await upsertJurisdictionByIdentifier(pool, {
      scheme: "beds",
      value: row.INST_ID,
      name: titleCase(row.POPULAR_NA),
      profileId,
      conceptId: conceptIds["school_district"],
      attributes: { sed_district_code: row.SDLCODE },
      sourceUrl: LAYER_URL,
    });
    loaded++;
  }
  console.log(`  upserted ${loaded} school district jurisdictions`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
