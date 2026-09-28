// t03 — boundaries (PostGIS). NOT RUN in this pass: requires ogr2ogr (GDAL)
// on PATH, which isn't installed in this environment. Written so it's ready
// to run once GDAL is installed — this script only checks for the binary and
// prints the manual steps; it does not fabricate results.
//
// Once GDAL is available:
//   1. `create extension postgis;` and uncomment the geometry section at the
//      bottom of packages/db/schema.sql (the infra/docker-compose.yml image
//      is already postgis/postgis, so the extension itself is available).
//   2. Pull Census TIGER/Line for NY (FIPS 36) at your target year: counties,
//      cousub, place, sldl, sldu, congressional districts, unsd/elsd/scsd.
//   3. For each shapefile:
//      ogr2ogr -f PostgreSQL PG:"$DATABASE_URL" tl_2023_36_cousub.shp \
//        -nln tiger_cousub -t_srs EPSG:4326
//   4. Join tiger_* to jurisdiction_identifiers on the Census GEOID and
//      populate jurisdictions.geometry.
//   5. Re-derive t02's overlaps with ST_Intersects/ST_Overlaps now that
//      geometry exists (a split municipality should show two Assembly districts).
import { execSync } from "child_process";

function hasOgr2ogr(): boolean {
  try {
    execSync("ogr2ogr --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!hasOgr2ogr()) {
    console.error(
      "t03 requires ogr2ogr (GDAL) on PATH, which is not installed here.\n" +
        "Install GDAL (`brew install gdal` / `apt install gdal-bin` / OSGeo4W on Windows), " +
        "then re-run this script — see the comment at the top of this file for the full sequence.",
    );
    process.exit(1);
  }
  console.error(
    "ogr2ogr was found, but this script does not yet download/import TIGER/Line shapefiles " +
      "for you — that's the next thing to build here. See the steps in this file's header comment.",
  );
  process.exit(1);
}

main();
