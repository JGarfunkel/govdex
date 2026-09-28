// backfill-candidate-page-cache — one-off (re-runnable) catch-up for
// candidate_links rows discovered before crawlSeed.ts started caching each
// candidate's own target_url (see crawlSeed.ts's post-insert
// politeFetchWithType call). Walks every 'new'/'promoted' row lacking a
// local cache entry for its target_url and fetches+caches it, so
// hasCachedPage(target_url) — what geoPayload.ts's public "crawled
// documents" card checks — reflects reality for older rows too, not just
// ones discovered from now on.
//
// Concurrency is per jurisdiction, not per row: different jurisdictions are
// different servers, so working several at once doesn't cost any one of
// them extra politeness, but two candidates on the *same* jurisdiction's
// site are worked strictly one at a time with a fixed delay between them.
// This is `concurrency` concurrent async workers pulling jurisdictions off a
// shared queue, not OS threads — there's no CPU-bound work here, and a real
// worker-thread-per-jurisdiction would need its own DB pool and would fight
// over the single on-disk cache index for no throughput benefit.
//
// Usage:
//   npx tsx ingestion/tools/backfill-candidate-page-cache.ts
//   npx tsx ingestion/tools/backfill-candidate-page-cache.ts --like="Bethlehem"
//   npx tsx ingestion/tools/backfill-candidate-page-cache.ts --dry-run
//   npx tsx ingestion/tools/backfill-candidate-page-cache.ts --delay=30000       (ms between requests to the same jurisdiction; default 20000)
//   npx tsx ingestion/tools/backfill-candidate-page-cache.ts --concurrency=12    (jurisdictions worked at once; default 8)
import "dotenv/config";
import { getPool } from "@govdex/db";
import { politeFetchWithType } from "../spider/fetcher";
import { hasCachedPage } from "../spider/cache";
import { sameHost, ensureProtocol } from "../spider/urlMatch";
import { isAffiliatedVendorHost } from "../spider/affiliation";

interface Row {
  id: string;
  jurisdiction_id: string;
  source_body_id: string | null;
  target_url: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Same rule crawlSeed.ts's isAllowedFetchHost applies at discovery time: only
// this jurisdiction's own site (or a GovTech vendor host that already names
// it — e.g. a Granicus subdomain), never an arbitrary third party's server —
// see crawlSeed.ts for the full rationale. `seedUrl` here is the
// jurisdiction's `website` on file, the closest stand-in this tool has for
// "the seed a crawl of this jurisdiction would have used."
function isAllowedFetchHost(url: string, seedUrl: string, jurisdictionName: string): boolean {
  return sameHost(url, seedUrl) || isAffiliatedVendorHost(url, jurisdictionName);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const likeArg = args.find((a) => a.startsWith("--like="));
  const namePattern = likeArg ? likeArg.slice("--like=".length) : null;
  const delayArg = args.find((a) => a.startsWith("--delay="));
  const delayMs = delayArg ? Number(delayArg.slice("--delay=".length)) : 8_000;
  const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
  const concurrency = concurrencyArg ? Number(concurrencyArg.slice("--concurrency=".length)) : 8;

  const pool = getPool();
  const { rows } = await pool.query<Row & { jurisdiction_name: string; website: string | null }>(
    `select cl.id, cl.jurisdiction_id, cl.source_body_id, cl.target_url, j.name as jurisdiction_name, j.website
       from candidate_links cl
       join jurisdictions j on j.id = cl.jurisdiction_id
      where cl.status in ('new', 'promoted')
        and ($1::text is null or j.name ilike $1)
      order by j.name, cl.target_url`,
    [namePattern ? `%${namePattern}%` : null],
  );

  const byJurisdiction = new Map<string, { name: string; seedUrl: string | null; rows: Row[] }>();
  for (const row of rows) {
    if (hasCachedPage(row.target_url)) continue; // already has a snapshot — nothing to backfill
    const bucket =
      byJurisdiction.get(row.jurisdiction_id) ??
      { name: row.jurisdiction_name, seedUrl: row.website ? ensureProtocol(row.website) : null, rows: [] };
    bucket.rows.push(row);
    byJurisdiction.set(row.jurisdiction_id, bucket);
  }

  const jurisdictions = [...byJurisdiction.entries()];
  const totalMissing = jurisdictions.reduce((n, [, b]) => n + b.rows.length, 0);
  console.log(
    `${rows.length} candidate(s) scanned, ${totalMissing} missing a cached copy across ${jurisdictions.length} jurisdiction(s)` +
      `${dryRun ? " (dry run — nothing will be fetched)" : ` (concurrency=${concurrency}, delay=${delayMs}ms)`}`,
  );
  if (totalMissing === 0) {
    await pool.end();
    return;
  }

  let cached = 0;
  let failed = 0;
  let skippedOffHost = 0;
  let skippedNoSeed = 0;

  // A queue over jurisdictions (not their rows): each of the `concurrency`
  // workers below claims the next not-yet-started jurisdiction, runs it to
  // completion (one request at a time, `delayMs` apart), then claims
  // another — so no jurisdiction is ever touched by more than one worker.
  let nextJurisdiction = 0;
  async function runWorker() {
    for (;;) {
      const index = nextJurisdiction++;
      if (index >= jurisdictions.length) return;
      const [jurisdictionId, bucket] = jurisdictions[index];
      // Only counts actual network requests, not rows skipped below — a run
      // of off-host/no-seed rows shouldn't burn a delay that was never
      // needed because nothing was fetched.
      let madeRequest = false;
      for (const row of bucket.rows) {
        if (!bucket.seedUrl) {
          if (dryRun) console.log(`  [${bucket.name}] no website on file, can't verify host — skipping ${row.target_url}`);
          skippedNoSeed++;
          continue;
        }
        if (!isAllowedFetchHost(row.target_url, bucket.seedUrl, bucket.name)) {
          if (dryRun) console.log(`  [${bucket.name}] off this jurisdiction's host — skipping ${row.target_url}`);
          skippedOffHost++;
          continue;
        }
        if (dryRun) {
          console.log(`  [${bucket.name}] would fetch — ${row.target_url}`);
          continue;
        }
        if (madeRequest) await sleep(delayMs);
        madeRequest = true;
        try {
          const { html } = await politeFetchWithType(row.target_url, {
            jurisdictionId,
            sourceBodyId: row.source_body_id,
          });
          if (html) {
            cached++;
            console.log(`  [${bucket.name}] cached — ${row.target_url}`);
          } else {
            failed++;
            console.log(`  [${bucket.name}] no HTML captured (non-HTML content or fetch failed) — ${row.target_url}`);
          }
        } catch (err) {
          failed++;
          console.warn(`  [${bucket.name}] error fetching ${row.target_url}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jurisdictions.length) }, runWorker));

  console.log(`(${skippedOffHost} off-host, ${skippedNoSeed} no website on file — neither counted as missing)`);
  if (dryRun) {
    console.log(`\nDry run — ${totalMissing - skippedOffHost - skippedNoSeed} page(s) would have been fetched`);
  } else {
    console.log(`\nDone — ${cached} page(s) cached, ${failed} failed or non-HTML`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
