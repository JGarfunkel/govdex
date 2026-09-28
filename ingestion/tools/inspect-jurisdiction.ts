// inspect-jurisdiction — read-only lookup for one jurisdiction ("town") by
// name. Answers the questions the spider/ingestion pipeline doesn't surface
// anywhere else: what seed URL(s) do we have for this place, what has the
// spider found so far (candidate_links), and what raw pages are sitting in
// the disk cache (ingestion/spider/cache.ts) for it.
//
// Usage:
//   npx tsx ingestion/tools/inspect-jurisdiction.ts <name-pattern>
//   npx tsx ingestion/tools/inspect-jurisdiction.ts "Town of Bethlehem"
import "dotenv/config";
import { getPool } from "@govdex/db";
import { listCachedPages } from "../spider/cache";

async function main() {
  const pattern = process.argv[2];
  if (!pattern) {
    console.error('Usage: npx tsx ingestion/tools/inspect-jurisdiction.ts "<name pattern>"');
    process.exit(1);
  }

  const pool = getPool();

  const { rows: jurisdictions } = await pool.query(
    `select id, name, ocd_id, website, origin, verification
       from jurisdictions
      where name ilike $1
      order by name`,
    [`%${pattern}%`],
  );

  if (jurisdictions.length === 0) {
    console.log(`No jurisdictions matching "${pattern}"`);
    await pool.end();
    return;
  }

  for (const j of jurisdictions) {
    console.log(`\n=== ${j.name} (${j.id}) ===`);
    console.log(`  ocd_id:       ${j.ocd_id ?? "(none)"}`);
    console.log(`  seed website: ${j.website ?? "(none)"}`);
    console.log(`  origin:       ${j.origin}, verification: ${j.verification}`);

    const { rows: identifiers } = await pool.query(
      `select scheme, value from jurisdiction_identifiers where jurisdiction_id = $1 order by scheme`,
      [j.id],
    );
    if (identifiers.length) {
      console.log(`  identifiers:`);
      for (const id of identifiers) console.log(`    ${id.scheme} = ${id.value}`);
    }

    const { rows: bodies } = await pool.query(
      `select id, name, website, parent_body_id from bodies where jurisdiction_id = $1 order by name`,
      [j.id],
    );
    if (bodies.length) {
      console.log(`  bodies (${bodies.length}):`);
      const byId = new Map(bodies.map((b) => [b.id, b]));
      for (const b of bodies) {
        const parent = b.parent_body_id ? byId.get(b.parent_body_id) : null;
        const indent = parent ? "      " : "    ";
        const label = parent ? `${b.name} (committee of ${parent.name})` : b.name;
        console.log(`${indent}${label}: ${b.website ?? "(no website)"}`);
      }
    }

    const bodyIds = bodies.map((b) => b.id);
    if (bodyIds.length) {
      const { rows: channels } = await pool.query(
        `select b.name as body_name, c.kind, c.status, c.platform, c.url
           from channels c
           join bodies b on b.id = c.body_id
          where c.body_id = any($1)
          order by b.name, c.kind`,
        [bodyIds],
      );
      if (channels.length) {
        console.log(`  channels (${channels.length}):`);
        for (const c of channels) {
          console.log(`    [${c.body_name}] ${c.kind}: ${c.status}${c.url ? ` -> ${c.url}` : ""}${c.platform ? ` (${c.platform})` : ""}`);
        }
      }
    }

    const { rows: candidates } = await pool.query(
      `select found_on_url, target_url, guessed_platform, guessed_kind, guessed_body_name, guessed_jurisdiction_name, status, discovered_at
         from candidate_links
        where jurisdiction_id = $1
        order by discovered_at desc`,
      [j.id],
    );
    console.log(`  candidate_links (spider-discovered, ${candidates.length}):`);
    if (candidates.length === 0) {
      console.log(`    (none — spider has not been run for this jurisdiction, or found nothing)`);
    } else {
      for (const c of candidates) {
        const guess = c.guessed_jurisdiction_name
          ? `guessed DISTRICT (own jurisdiction, not a body here): "${c.guessed_jurisdiction_name}"`
          : c.guessed_body_name
            ? `guessed board/committee: "${c.guessed_body_name}"`
            : `guessed: ${c.guessed_kind ?? "?"}/${c.guessed_platform ?? "?"}`;
        console.log(`    [${c.status}] ${c.target_url} (found on ${c.found_on_url}, ${guess}, ${c.discovered_at.toISOString()})`);
      }
    }

    const cached = listCachedPages().filter((p) => p.jurisdictionId === j.id);
    console.log(`  cached pages on disk (${cached.length}):`);
    if (cached.length === 0) {
      console.log(`    (none — spider hasn't fetched this jurisdiction since the page cache was added)`);
    } else {
      for (const c of cached) {
        console.log(`    ${c.url} (${c.bytes} bytes, fetched ${c.fetchedAt})`);
      }
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
