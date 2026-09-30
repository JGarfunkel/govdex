import type { Pool } from "pg";
import { loadStateProfile } from "@govdex/shared/src/conf/profile";

// Upsert a state's `profiles` + `concept_profiles` rows from its
// packages/shared/src/conf/<state>.yaml locale pack. Shared by the
// ingestion/tools/seed-profile.ts CLI and the generic loader
// (ingestion/load-state/run.ts), which seeds before loading. Idempotent.
export async function seedProfile(pool: Pool, stateCode: string): Promise<{ profileId: number; code: string; updated: number; skipped: number }> {
  const { profile, concepts } = loadStateProfile(stateCode);

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
      [profileId, conceptCode, c.local_name, c.local_abbrev ?? null, c.parent_org_name ?? null, c.has_active_government, c.default_body_name ?? null],
    );
    if (rowCount) {
      updated++;
    } else {
      skipped++;
      console.warn(`  no type_concepts row for code=${conceptCode} — skipped (check packages/db/seed/concepts.sql)`);
    }
  }

  return { profileId, code: profile.code, updated, skipped };
}
