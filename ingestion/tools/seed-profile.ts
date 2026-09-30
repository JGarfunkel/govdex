// seed-profile — upsert a state's `profiles` + `concept_profiles` DB rows
// from its packages/shared/src/conf/<state>.yaml locale pack. Replaces the
// old hand-maintained packages/db/seed/profiles/us-ny.sql: the yaml file is
// now the single authoritative source, and this script writes it straight
// to the DB — same "edit the file, run the tsx script" pattern as every
// other ingestion/tools/*.ts, rather than a raw `psql -f` seed. There is no
// intermediate SQL file generated or checked in.
//
// Usage:
//   npx tsx ingestion/tools/seed-profile.ts <state-code>
//
// Example:
//   npx tsx ingestion/tools/seed-profile.ts ny
import "dotenv/config";
import { getPool } from "@govdex/db";
import { seedProfile } from "../lib/seedProfile";

async function main() {
  const stateCode = process.argv[2];
  if (!stateCode) {
    console.error("Usage: npx tsx ingestion/tools/seed-profile.ts <state-code>");
    process.exit(1);
  }

  const pool = getPool();
  const { code, updated, skipped } = await seedProfile(pool, stateCode);
  console.log(`${code}: profile upserted, ${updated} concept_profiles upserted, ${skipped} skipped`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
