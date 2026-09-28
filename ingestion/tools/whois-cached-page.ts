// whois-cached-page — given a cached page (by its URL, or by its
// data/govdex/page-cache filename/hash), reports everything the DB knows
// about it: the cache entry's own jurisdiction/body metadata (see
// cache.ts's CacheEntry — sourceBodyId is null for anything found by a
// jurisdiction-level crawl, which is the common case, not a data gap; see
// crawlSeed.ts/run.ts), any candidate_links row(s) referencing it as either
// found_on_url or target_url, and — since a promoted vendor/agenda/etc.
// candidate is attached to a body chosen at promote time
// (apps/api/src/routes/candidates.ts), not to candidate_links.source_body_id
// — every real table a URL this exact can be promoted onto (channels,
// bodies, jurisdictions, adoptions), whether or not a candidate_links row
// exists for it at all (a scribe can also enter one of these fields by hand).
//
// Usage:
//   npx tsx ingestion/tools/whois-cached-page.ts "https://mountvernonny.legistar.com/"
//   npx tsx ingestion/tools/whois-cached-page.ts 91547ada738230551cefedd7
//   npx tsx ingestion/tools/whois-cached-page.ts 91547ada738230551cefedd7.html.gz
import "dotenv/config";
import { getPool } from "@govdex/db";
import { listCachedPages } from "../spider/cache";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npx tsx ingestion/tools/whois-cached-page.ts <url | cache filename | hash>");
    process.exit(1);
  }

  const entry = listCachedPages().find((e) => e.url === arg || e.file === arg || e.file === `${arg}.html.gz` || e.file.startsWith(arg));
  if (!entry) {
    console.error(`No local cache entry matches "${arg}" (checked by URL, filename, and filename prefix).`);
    process.exit(1);
  }

  console.log(`URL: ${entry.url}`);
  console.log(`file: ${entry.file}  (${entry.bytes} bytes, fetched ${entry.fetchedAt}, ${entry.contentType ?? "unknown content-type"})`);

  const pool = getPool();

  const { rows: jur } = await pool.query<{ name: string }>(`select name from jurisdictions where id = $1`, [entry.jurisdictionId]);
  console.log(`crawl jurisdiction: ${jur[0]?.name ?? "(none on the cache entry)"}${entry.jurisdictionId ? ` [${entry.jurisdictionId}]` : ""}`);

  if (entry.sourceBodyId) {
    const { rows: body } = await pool.query<{ name: string }>(`select name from bodies where id = $1`, [entry.sourceBodyId]);
    console.log(`crawl source body: ${body[0]?.name ?? "(id on the cache entry has no matching bodies row)"} [${entry.sourceBodyId}]`);
  } else {
    console.log(`crawl source body: (none — this was found by a jurisdiction-level crawl, not a body-scoped one; that's the normal case)`);
  }

  const { rows: candidates } = await pool.query(
    `select cl.id, cl.link_type, cl.status, cl.guessed_body_name, cl.guessed_platform, cl.guessed_vendor,
            cl.discovered_at, cl.found_on_url, cl.target_url, j.name as jurisdiction_name, b.name as source_body_name
       from candidate_links cl
       join jurisdictions j on j.id = cl.jurisdiction_id
       left join bodies b on b.id = cl.source_body_id
      where cl.target_url = $1 or cl.found_on_url = $1
      order by cl.discovered_at desc`,
    [entry.url],
  );
  console.log(`\ncandidate_links referencing this URL: ${candidates.length}`);
  for (const c of candidates) {
    const role = c.target_url === entry.url ? "target_url" : "found_on_url";
    console.log(
      `  [${c.status}] ${c.link_type} (${role}) — jurisdiction ${c.jurisdiction_name}, source body ${c.source_body_name ?? "(none)"}` +
        `${c.guessed_body_name ? `, guessed body "${c.guessed_body_name}"` : ""}${c.guessed_vendor ? `, vendor ${c.guessed_vendor}` : ""}` +
        ` — discovered ${new Date(c.discovered_at).toISOString().slice(0, 10)}`,
    );
  }

  // Every real (non-staging) place this exact URL could be promoted onto —
  // mirrors apps/api/src/routes/candidates.ts's promote destinations — plus
  // channels/bodies.website, which a scribe can set by hand with no
  // candidate_links row involved at all.
  const { rows: promoted } = await pool.query(
    `select 'channels.url' as location, c.id::text as id, b.name as owner, j.name as jurisdiction_name
       from channels c join bodies b on b.id = c.body_id join jurisdictions j on j.id = b.jurisdiction_id
      where c.url = $1
     union all
     select 'bodies.website', b.id::text, b.name, j.name from bodies b join jurisdictions j on j.id = b.jurisdiction_id where b.website = $1
     union all
     select 'bodies.committees_url', b.id::text, b.name, j.name from bodies b join jurisdictions j on j.id = b.jurisdiction_id where b.committees_url = $1
     union all
     select 'bodies.agenda_url', b.id::text, b.name, j.name from bodies b join jurisdictions j on j.id = b.jurisdiction_id where b.agenda_url = $1
     union all
     select 'bodies.minutes_url', b.id::text, b.name, j.name from bodies b join jurisdictions j on j.id = b.jurisdiction_id where b.minutes_url = $1
     union all
     select 'jurisdictions.website', j.id::text, j.name, j.name from jurisdictions j where j.website = $1
     union all
     select 'jurisdictions.policy_url', j.id::text, j.name, j.name from jurisdictions j where j.policy_url = $1
     union all
     select 'jurisdictions.budget_url', j.id::text, j.name, j.name from jurisdictions j where j.budget_url = $1
     union all
     select 'jurisdictions.calendar_url', j.id::text, j.name, j.name from jurisdictions j where j.calendar_url = $1
     union all
     select 'jurisdictions.open_data_api_url', j.id::text, j.name, j.name from jurisdictions j where j.open_data_api_url = $1
     union all
     select 'jurisdictions.legistar_api_url', j.id::text, j.name, j.name from jurisdictions j where j.legistar_api_url = $1
     union all
     select 'adoptions.instance_url', b.id::text, b.name || ' — ' || p.vendor || ' ' || p.name, j.name
       from adoptions a
       join products p on p.id = a.product_id
       join bodies b on b.id = a.body_id
       join jurisdictions j on j.id = b.jurisdiction_id
      where a.instance_url = $1`,
    [entry.url],
  );
  console.log(`\nreal (promoted/manual) references to this exact URL: ${promoted.length}`);
  for (const p of promoted as { location: string; id: string; owner: string; jurisdiction_name: string }[]) {
    console.log(`  ${p.location} — ${p.owner} (${p.jurisdiction_name}) [${p.id}]`);
  }
  if (promoted.length === 0) {
    console.log(`  (none — this URL isn't attached to any real record yet, only ${candidates.length ? "staged in candidate_links" : "sitting in the cache"})`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
