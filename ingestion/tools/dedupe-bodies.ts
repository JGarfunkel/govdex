// dedupe-bodies — finds bodies rows that are duplicates of each other (same
// jurisdiction, same parent, and the same name once case/whitespace is
// normalized — the gap upsertBodyByName didn't close until now, see
// ingestion/lib/upsert.ts and migration 0016) and merges them: repoints
// every FK at the surviving row, then deletes the rest.
//
// Keeper selection per duplicate group, in order: origin='manual' beats
// 'import' (a scribe's hand-entered row always wins, same rule as
// upsertBodyByName); higher verification rank; earliest created_at as a
// final tiebreak (the original row survives).
//
// Usage:
//   npx tsx ingestion/tools/dedupe-bodies.ts                    dry run: report only
//   npx tsx ingestion/tools/dedupe-bodies.ts --write             actually merge + delete
//   npx tsx ingestion/tools/dedupe-bodies.ts "Bedford" --write   limit to jurisdictions matching this name
import "dotenv/config";
import { getPool } from "@govdex/db";

const VERIFICATION_RANK: Record<string, number> = {
  official_confirmed: 0,
  scribe_verified: 1,
  source_cited: 2,
  disputed: 3,
  unverified: 4,
};

interface BodyRow {
  id: string;
  name: string;
  origin: string;
  verification: string;
  created_at: string;
}

function pickKeeper(rows: BodyRow[]): BodyRow {
  return [...rows].sort((a, b) => {
    if (a.origin !== b.origin) return a.origin === "manual" ? -1 : 1;
    const va = VERIFICATION_RANK[a.verification] ?? 99;
    const vb = VERIFICATION_RANK[b.verification] ?? 99;
    if (va !== vb) return va - vb;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  })[0];
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const namePattern = args.find((a) => !a.startsWith("--")) ?? null;

  const pool = getPool();

  const { rows: groups } = await pool.query<{
    jurisdiction_name: string;
    norm_name: string;
    ids: string[];
  }>(
    `select j.name as jurisdiction_name, lower(trim(b.name)) as norm_name,
            array_agg(b.id order by b.created_at) as ids
       from bodies b
       join jurisdictions j on j.id = b.jurisdiction_id
      where ($1::text is null or j.name ilike '%' || $1 || '%')
      group by b.jurisdiction_id, j.name, b.parent_body_id, lower(trim(b.name))
     having count(*) > 1`,
    [namePattern],
  );

  if (groups.length === 0) {
    console.log(namePattern ? `No duplicate bodies found for jurisdictions matching "${namePattern}".` : "No duplicate bodies found.");
    await pool.end();
    return;
  }

  let merged = 0;
  for (const group of groups) {
    const { rows: bodyRows } = await pool.query<BodyRow>(`select id, name, origin, verification, created_at::text from bodies where id = any($1)`, [
      group.ids,
    ]);
    const keeper = pickKeeper(bodyRows);
    const losers = bodyRows.filter((r) => r.id !== keeper.id);

    console.log(`\n${group.jurisdiction_name} — "${group.norm_name}" (${bodyRows.length} rows)`);
    console.log(`  keep:   ${keeper.name} (${keeper.id}, origin=${keeper.origin}, verification=${keeper.verification})`);
    for (const loser of losers) {
      console.log(`  merge:  ${loser.name} (${loser.id}, origin=${loser.origin}, verification=${loser.verification}) -> ${keeper.id}`);
    }

    if (!write) continue;

    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const loser of losers) {
        await client.query(`update seats set body_id = $1 where body_id = $2`, [keeper.id, loser.id]);
        await client.query(`update channels set body_id = $1 where body_id = $2`, [keeper.id, loser.id]);
        // adoptions has unique(body_id, product_id) — repoint what doesn't
        // collide, drop what's left (the keeper already has that product).
        await client.query(
          `update adoptions set body_id = $1
             where body_id = $2
               and not exists (select 1 from adoptions a2 where a2.body_id = $1 and a2.product_id = adoptions.product_id)`,
          [keeper.id, loser.id],
        );
        await client.query(`delete from adoptions where body_id = $1`, [loser.id]);
        await client.query(`update crawl_jobs set body_id = $1 where body_id = $2`, [keeper.id, loser.id]);
        await client.query(`update candidate_links set source_body_id = $1 where source_body_id = $2`, [keeper.id, loser.id]);
        await client.query(`update candidate_links set guessed_target_body_id = $1 where guessed_target_body_id = $2`, [keeper.id, loser.id]);
        await client.query(`update frictions set body_id = $1 where body_id = $2`, [keeper.id, loser.id]);
        await client.query(`update bodies set parent_body_id = $1 where parent_body_id = $2`, [keeper.id, loser.id]);
        await client.query(`delete from bodies where id = $1`, [loser.id]);
      }
      await client.query("commit");
      merged++;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(
    write ? `\nMerged ${merged} duplicate group(s).` : `\n${groups.length} duplicate group(s) found (dry run — rerun with --write to merge).`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
