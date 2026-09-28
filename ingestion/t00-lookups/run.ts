// t00 — concepts, profiles, and policies. The actual seed SQL is applied via
// `npm run govdex:seed` (docker compose exec ... psql), not by this script —
// this just runs the doc's own acceptance check afterward: field_policies has
// its six seed rows, the permission functions exist, and every seed table has
// the row count we expect.
import "dotenv/config";
import { getPool } from "@govdex/db";

async function main() {
  const pool = getPool();

  const checks: [string, string, number][] = [
    ["select count(*)::int as n from field_policies", "field_policies", 6],
    ["select count(*)::int as n from type_concepts", "type_concepts", 13],
    ["select count(*)::int as n from body_categories", "body_categories", 6],
    ["select count(*)::int as n from product_functions", "product_functions", 7],
    ["select count(*)::int as n from profiles", "profiles", 1],
    ["select count(*)::int as n from concept_profiles", "concept_profiles", 13],
  ];

  let ok = true;
  for (const [sql, label, expected] of checks) {
    const { rows } = await pool.query<{ n: number }>(sql);
    const actual = rows[0].n;
    const pass = actual === expected;
    ok &&= pass;
    console.log(`${pass ? "OK " : "FAIL"} ${label}: expected ${expected}, got ${actual}`);
  }

  const { rows: fns } = await pool.query<{ proname: string }>(
    "select proname from pg_proc where proname in ('can_edit_field','scribe_editable_jurisdictions')",
  );
  const fnNames = fns.map((r) => r.proname).sort();
  const fnOk = fnNames.length === 2;
  ok &&= fnOk;
  console.log(`${fnOk ? "OK " : "FAIL"} permission functions present: ${fnNames.join(", ") || "(none)"}`);

  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
