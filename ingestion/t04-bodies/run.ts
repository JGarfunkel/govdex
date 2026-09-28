// t04 — bodies, derived from the profile, never hardcoded. For every
// jurisdiction whose jurisdiction_profile_view.has_active_government is
// true, create one body named default_body_name, category official_elected.
import "dotenv/config";
import { getPool } from "@govdex/db";
import { getBodyCategoryId } from "../lib/identifiers";
import { upsertBodyByName } from "../lib/upsert";

async function main() {
  const pool = getPool();
  const categoryId = await getBodyCategoryId(pool, "official_elected");

  const { rows } = await pool.query<{ jurisdiction_id: string; jurisdiction_name: string; website: string | null; default_body_name: string }>(
    `select v.jurisdiction_id, j.name as jurisdiction_name, j.website, v.default_body_name
       from jurisdiction_profile_view v
       join jurisdictions j on j.id = v.jurisdiction_id
      where v.has_active_government and v.default_body_name is not null`,
  );

  let created = 0;
  for (const row of rows) {
    await upsertBodyByName(pool, {
      jurisdictionId: row.jurisdiction_id,
      categoryId,
      name: row.default_body_name,
      isGovernmental: true,
      website: row.website,
    });
    created++;
  }

  console.log(`  upserted ${created} bodies across active-government jurisdictions`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
