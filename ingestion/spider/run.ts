// Spider CLI — batch/ad-hoc entry point over crawlSeed.ts (channel,
// affiliation, board/committee, email, calendar, and vendor/SaaS
// discovery — see crawlSeed.ts for the fetch-and-traverse loop itself).
// Never writes channel status='absent' — "spider found none" is weaker than
// "human verified none." The spider only proposes; promotion is a human
// action — apps/api's POST /candidates/:id/promote for channels,
// ingestion/tools/add-body.ts (run by hand) for boards/committees so far.
//
// worker.ts is the other caller of crawlSeed.ts: a long-running process that
// drains crawl_jobs, queued automatically by apps/api's propose route
// whenever a scribe sets/changes a website through the web UI, rather than
// waiting for one of the batch runs below.
//
// Run modes:
//   npx tsx ingestion/spider/run.ts --smoke   one or two real, already-loaded
//                                              jurisdiction websites — a narrow
//                                              proof the cascade+classifier work
//   npx tsx ingestion/spider/run.ts           full pass over every loaded
//                                              jurisdiction/body website (not
//                                              exercised in this pass — a real
//                                              crawl of ~1600 sites is a
//                                              separate, deliberate run)
//   npx tsx ingestion/spider/run.ts --url=<url> [--jurisdiction=<id>]
//                                              crawl exactly one URL — e.g. a
//                                              candidate_links.target_url that
//                                              turned out to be a hub itself
//                                              (jurisdiction is looked up from
//                                              an existing candidate_links row
//                                              for that URL, or from
//                                              jurisdictions.website matching
//                                              its hostname, unless overridden)
//   ... --recurse[=N]                         under any seed above: when a
//                                              cascade hit's anchor text looks
//                                              like a committee/board name
//                                              (see boardDetector.ts), also
//                                              fetch and cascade *that* link,
//                                              up to N hops (default 1) —
//                                              same-origin, or cross-domain
//                                              onto a known GovTech vendor
//                                              host whose name still matches
//                                              this jurisdiction (see
//                                              affiliation.ts — e.g. a
//                                              Granicus-hosted "boards" page
//                                              at westchestercountynyexec.
//                                              granicus.com is still
//                                              Westchester's own site, not an
//                                              unrelated one) — some "Boards &
//                                              Committees" hubs are
//                                              themselves a directory of
//                                              sub-hubs rather than a flat
//                                              list of bodies
import "dotenv/config";
import { getPool } from "@govdex/db";
import { crawlSeed } from "./crawlSeed";
import { pruneDeadCandidates } from "./pruneDeadCandidates";

async function main() {
  const pool = getPool();
  const smoke = process.argv.includes("--smoke");
  const likeArg = process.argv.find((a) => a.startsWith("--like="));
  const namePattern = likeArg ? likeArg.slice("--like=".length) : null;
  const urlArg = process.argv.find((a) => a.startsWith("--url="));
  const targetUrl = urlArg ? urlArg.slice("--url=".length) : null;
  const jurisdictionArg = process.argv.find((a) => a.startsWith("--jurisdiction="));
  const explicitJurisdictionId = jurisdictionArg ? jurisdictionArg.slice("--jurisdiction=".length) : null;
  const recurseArg = process.argv.find((a) => a === "--recurse" || a.startsWith("--recurse="));
  const recurseDepth = recurseArg ? Number(recurseArg.split("=")[1] ?? 1) || 1 : 0;

  let seeds: { jurisdiction_id: string | null; jurisdiction_name: string | null; source_body_id: string | null; website: string }[];

  if (targetUrl) {
    let jurisdictionId = explicitJurisdictionId;
    let sourceBodyId: string | null = null;
    if (!jurisdictionId) {
      const { rows } = await pool.query<{ jurisdiction_id: string | null; source_body_id: string | null }>(
        `select jurisdiction_id, source_body_id from candidate_links where target_url = $1 order by discovered_at desc limit 1`,
        [targetUrl],
      );
      jurisdictionId = rows[0]?.jurisdiction_id ?? null;
      sourceBodyId = rows[0]?.source_body_id ?? null;
    }
    if (!jurisdictionId) {
      const hostname = new URL(targetUrl).hostname.replace(/^www\./, "");
      const { rows } = await pool.query<{ id: string }>(`select id from jurisdictions where website ilike $1`, [`%${hostname}%`]);
      jurisdictionId = rows[0]?.id ?? null;
    }
    let jurisdictionName: string | null = null;
    if (jurisdictionId) {
      const { rows } = await pool.query<{ name: string }>(`select name from jurisdictions where id = $1`, [jurisdictionId]);
      jurisdictionName = rows[0]?.name ?? null;
    } else {
      console.warn(`  could not resolve a jurisdiction for ${targetUrl} — pass --jurisdiction=<id> to associate the results`);
    }
    seeds = [{ jurisdiction_id: jurisdictionId, jurisdiction_name: jurisdictionName, source_body_id: sourceBodyId, website: targetUrl }];
  } else {
    const { rows } = await pool.query<{ jurisdiction_id: string; name: string; website: string }>(
      namePattern
        ? `select id as jurisdiction_id, name, website from jurisdictions where website is not null and origin = 'import' and name ilike $1`
        : smoke
          ? `select id as jurisdiction_id, name, website from jurisdictions where website is not null and origin = 'import' order by name limit 2`
          : `select id as jurisdiction_id, name, website from jurisdictions where website is not null and origin = 'import'`,
      namePattern ? [namePattern] : [],
    );
    seeds = rows.map((r) => ({ jurisdiction_id: r.jurisdiction_id, jurisdiction_name: r.name, source_body_id: null, website: r.website }));
  }

  console.log(
    `Crawling ${seeds.length} seed(s)${smoke ? " (smoke test)" : ""}${recurseDepth ? ` (recurse depth ${recurseDepth})` : ""}...`,
  );
  let total = 0;
  for (const seed of seeds) {
    total += await crawlSeed(pool, seed.jurisdiction_id, seed.jurisdiction_name, seed.source_body_id, seed.website, recurseDepth);
  }
  console.log(`  wrote ${total} candidate_links rows`);

  // Catch dead links as part of the same pass — the pages just crawled are
  // the freshest 'new' rows there are, and worth checking before they sit in
  // a scribe's triage queue. Scoped to the jurisdictions just crawled, not
  // every 'new' row in the table, so an ad-hoc --url run with no resolvable
  // jurisdiction doesn't kick off an unrelated full-table sweep.
  const crawledJurisdictionIds = [...new Set(seeds.map((s) => s.jurisdiction_id).filter((id): id is string => id != null))];
  if (crawledJurisdictionIds.length > 0) {
    console.log(`Checking freshly-found candidates for dead pages...`);
    const pruned = await pruneDeadCandidates(pool, { jurisdictionIds: crawledJurisdictionIds });
    console.log(`  ${pruned.dead} rejected as dead, ${pruned.ambiguous} ambiguous (left as-is), ${pruned.alive} confirmed alive`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
