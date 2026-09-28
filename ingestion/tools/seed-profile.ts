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
import { loadStateProfile } from "@govdex/shared/src/conf/profile";

async function main() {
  const stateCode = process.argv[2];
  if (!stateCode) {
    console.error("Usage: npx tsx ingestion/tools/seed-profile.ts <state-code>");
    process.exit(1);
  }

  const { profile, concepts } = loadStateProfile(stateCode);
  const pool = getPool();

  const {
    rows: [{ id: profileId }],
  } = await pool.query<{ id: number }>(
    `insert into profiles (code, name, config) values ($1, $2, $3)
     on conflict (code) do update set name = excluded.name, config = excluded.config
     returning id`,
    [profile.code, profile.name, JSON.stringify(profile.config)],
  );

  let updated = 0;
  let skipped = 0;
  for (const [conceptCode, c] of Object.entries(concepts)) {
    const { rowCount } = await pool.query(
      `insert into concept_profiles
         (profile_id, concept_id, local_name, local_abbrev, parent_org_name, has_active_government, default_body_name)
       select $1, tc.id, $3, $4, $5, $6, $7
       from type_concepts tc where tc.code = $2
       on conflict (profile_id, concept_id) do update set
         local_name = excluded.local_name,
         local_abbrev = excluded.local_abbrev,
         parent_org_name = excluded.parent_org_name,
         has_active_government = excluded.has_active_government,
         default_body_name = excluded.default_body_name`,
      [
        profileId,
        conceptCode,
        c.local_name,
        c.local_abbrev ?? null,
        c.parent_org_name ?? null,
        c.has_active_government,
        c.default_body_name ?? null,
      ],
    );
    if (rowCount) {
      updated++;
    } else {
      skipped++;
      console.warn(`  no type_concepts row for code=${conceptCode} — skipped (check packages/db/seed/concepts.sql)`);
    }
  }

  console.log(`${profile.code}: profile upserted, ${updated} concept_profiles upserted, ${skipped} skipped`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
