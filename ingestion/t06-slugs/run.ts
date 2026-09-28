// t06 — computes a human-readable `attributes.slug` for every jurisdiction,
// backing /<state>/<subdivision>/<sub-entity> routing. Deterministic
// and idempotent (safe to rerun after t01d or any relation change).
//
// Uniqueness only has to hold among siblings sharing a `within` parent —
// the URL already scopes by parent segment, so "westchester" only needs to
// be unique among NY's children, and "rye-town" only among Westchester's.
// Collisions (Rye City / Rye Town, Ossining Town / Village, Mamaroneck
// Town / Village, Pelham Town / Village) are resolved generically by
// appending the entity's local type name (-town, -village, -city) rather
// than a hardcoded name list, so any future collision resolves the same way.
//
// The numbered AD/SD/CD/JD jurisdictions (t01) never got a `within` relation
// to the state — t02 only derives relations from the county/city/town/
// village locality dataset. This script backfills that relation first so
// they show up under the state as a "legislative districts" group.
import "dotenv/config";
import type { Pool } from "pg";
import { getPool } from "@govdex/db";
import { upsertRelation } from "../lib/upsert";

const DISTRICT_SCHEMES = ["ny_ad", "ny_sd", "ny_cd", "ny_jd"];

function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .replace(/['".]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function backfillDistrictRelations(pool: Pool) {
  const { rows: stateRows } = await pool.query<{ id: string }>(
    `select jurisdiction_id as id from jurisdiction_identifiers where scheme = 'usps_state' and value = 'NY'`,
  );
  const stateId = stateRows[0]?.id;
  if (!stateId) throw new Error("NY state jurisdiction not found — run govdex:t01 first.");

  const { rows: districts } = await pool.query<{ jurisdiction_id: string }>(
    `select jurisdiction_id from jurisdiction_identifiers where scheme = any($1)`,
    [DISTRICT_SCHEMES],
  );
  for (const d of districts) {
    await upsertRelation(pool, d.jurisdiction_id, stateId, "within");
  }
  console.log(`  backfilled ${districts.length} legislative-district -> state relations`);
}

async function assignStateSlugs(pool: Pool) {
  const { rows } = await pool.query<{ id: string; code: string }>(
    `select j.id, p.code
       from jurisdictions j
       join type_concepts tc on tc.id = j.concept_id
       join profiles p on p.id = j.profile_id
      where tc.code = 'state'`,
  );
  for (const row of rows) {
    const slug = slugify(row.code.replace(/^US-/, ""));
    await pool.query(`update jurisdictions set attributes = attributes || jsonb_build_object('slug', $2::text) where id = $1`, [
      row.id,
      slug,
    ]);
  }
  console.log(`  assigned ${rows.length} state slug(s)`);
}

async function assignChildSlugs(pool: Pool) {
  // Villages are legally `within` their town, but are routed as if they were
  // direct children of the county (a village and its like-named town are
  // real-world peers — Village of Ossining / Town of Ossining — and the site
  // flattens them to the same URL depth rather than nesting a 4th path
  // segment). So a village's collision-scope "parent" for slugging is its
  // town's county, not its immediate town parent.
  const { rows } = await pool.query<{
    parent_id: string;
    child_id: string;
    name: string;
    local_name: string | null;
    concept: string;
  }>(
    `select r.to_id as parent_id, r.from_id as child_id, j.name,
            coalesce(cp.local_name, tc.code) as local_name, tc.code as concept
       from jurisdiction_relations r
       join jurisdictions j on j.id = r.from_id
       join type_concepts tc on tc.id = j.concept_id
       left join concept_profiles cp on cp.profile_id = j.profile_id and cp.concept_id = j.concept_id
      where r.relation = 'within' and tc.code <> 'village'
     union all
     select r2.to_id as parent_id, v.id as child_id, v.name,
            coalesce(vcp.local_name, vtc.code) as local_name, vtc.code as concept
       from jurisdiction_relations r1
       join jurisdictions v on v.id = r1.from_id
       join type_concepts vtc on vtc.id = v.concept_id
       left join concept_profiles vcp on vcp.profile_id = v.profile_id and vcp.concept_id = v.concept_id
       join jurisdiction_relations r2 on r2.from_id = r1.to_id and r2.relation = 'within'
      where r1.relation = 'within' and vtc.code = 'village'`,
  );

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = groups.get(row.parent_id);
    if (group) group.push(row);
    else groups.set(row.parent_id, [row]);
  }

  let assigned = 0;
  let warned = 0;
  for (const [, siblings] of groups) {
    const baseCounts = new Map<string, number>();
    for (const s of siblings) {
      const base = slugify(s.name);
      baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
    }
    const finalCounts = new Map<string, number>();
    for (const s of siblings) {
      const base = slugify(s.name);
      const slug = (baseCounts.get(base) ?? 0) > 1 ? `${base}-${slugify(s.local_name ?? s.concept)}` : base;
      finalCounts.set(slug, (finalCounts.get(slug) ?? 0) + 1);
      await pool.query(`update jurisdictions set attributes = attributes || jsonb_build_object('slug', $2::text) where id = $1`, [
        s.child_id,
        slug,
      ]);
      assigned++;
    }
    for (const [slug, count] of finalCounts) {
      if (count > 1) {
        console.warn(`  slug "${slug}" is still duplicated among siblings — resolve manually`);
        warned++;
      }
    }
  }
  console.log(`  assigned ${assigned} child slug(s)${warned ? ` (${warned} unresolved collisions)` : ""}`);
}

async function main() {
  const pool = getPool();
  await backfillDistrictRelations(pool);
  await assignStateSlugs(pool);
  await assignChildSlugs(pool);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
