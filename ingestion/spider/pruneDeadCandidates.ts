// Checks a set of 'new' candidate_links rows' target_urls actually resolve,
// rejects the ones that don't, and records them in a per-jurisdiction
// blacklist (blacklist.ts) so a later crawl of the same site doesn't
// re-propose a link that's confirmed gone. Only a definitive "this page
// doesn't exist" result (404/410, or a DNS/connection failure meaning the
// host itself is gone) is treated as dead — an ambiguous result (403, 5xx,
// timeout, bot-management challenge) is left alone, since none of those
// prove the page doesn't exist.
//
// Shared by ingestion/tools/prune-dead-candidates.ts (standalone/scheduled
// pass over everything, or one jurisdiction by name) and, so dead links get
// caught as part of spider finds rather than as a separate manual step, by
// run.ts (batch CLI, scoped to the jurisdictions just crawled) and
// worker.ts (per crawl job, scoped to just that job's finds).
import type { getPool } from "@govdex/db";
import { addToBlacklist } from "./blacklist";
import { extractTitle, looksLikeDeadPageTitle } from "./deadPageDetector";

const USER_AGENT = process.env.USER_AGENT ?? "GovdexSpider/0.1 (+https://github.com/; civic transparency research)";
const FETCH_TIMEOUT_MS = 15000;

interface CandidateRow {
  id: string;
  jurisdiction_id: string | null;
  jurisdiction_name: string | null;
  target_url: string;
}

type CheckResult =
  | { verdict: "alive" }
  | { verdict: "dead"; reason: string; status: number | null }
  | { verdict: "ambiguous"; reason: string };

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// A GET, not a HEAD — an HTTP-status check alone misses a soft-404 (server
// answers 200, but the page's own <title> says the content is gone: a CMS
// "not found" template, a parked/expired domain, a suspended host), which is
// common enough on municipal sites to be worth the extra download; see
// deadPageDetector.ts for the title check (dead_page_detector.yaml).
async function checkPage(url: string): Promise<CheckResult> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      if (res.status === 404 || res.status === 410) return { verdict: "dead", reason: `${res.status} ${res.statusText}`, status: res.status };
      return { verdict: "ambiguous", reason: `${res.status} ${res.statusText}` };
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return { verdict: "alive" }; // a PDF/doc/etc. that downloaded fine — nothing to read a title from
    const title = extractTitle(await res.text());
    if (looksLikeDeadPageTitle(title)) return { verdict: "dead", reason: `soft-404 title "${title}"`, status: res.status };
    return { verdict: "alive" };
  } catch (err) {
    const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ?? (err as { code?: string })?.code;
    // Host doesn't exist or refuses connections outright — as dead as a 404,
    // just at the DNS/TCP layer instead of HTTP's.
    if (code === "ENOTFOUND" || code === "ECONNREFUSED") return { verdict: "dead", reason: code, status: null };
    return { verdict: "ambiguous", reason: err instanceof Error ? err.message : String(err) };
  }
}

export interface PruneOptions {
  // undefined = no jurisdiction filter (every 'new' candidate). Passed by
  // run.ts as the jurisdictions just crawled in this pass.
  jurisdictionIds?: string[];
  // undefined = no crawl-job filter. Passed by worker.ts to check only what
  // that one job just found, rather than re-checking every older 'new' row
  // for the job's jurisdiction on every website edit.
  crawlJobId?: string;
  namePattern?: string | null;
  dryRun?: boolean;
}

export interface PruneSummary {
  checked: number;
  alive: number;
  dead: number;
  ambiguous: number;
}

export async function pruneDeadCandidates(pool: ReturnType<typeof getPool>, opts: PruneOptions = {}): Promise<PruneSummary> {
  const { rows } = await pool.query<CandidateRow>(
    `select cl.id, cl.jurisdiction_id, j.name as jurisdiction_name, cl.target_url
       from candidate_links cl
       left join jurisdictions j on j.id = cl.jurisdiction_id
      where cl.status = 'new'
        and ($1::uuid[] is null or cl.jurisdiction_id = any($1))
        and ($2::text is null or j.name ilike $2)
        and ($3::uuid is null or cl.crawl_job_id = $3)
      order by j.name, cl.target_url`,
    [opts.jurisdictionIds ?? null, opts.namePattern ? `%${opts.namePattern}%` : null, opts.crawlJobId ?? null],
  );

  const summary: PruneSummary = { checked: rows.length, alive: 0, dead: 0, ambiguous: 0 };

  for (const row of rows) {
    const result = await checkPage(row.target_url);
    if (result.verdict === "alive") {
      summary.alive++;
      continue;
    }
    if (result.verdict === "ambiguous") {
      summary.ambiguous++;
      console.log(`  ? ${row.target_url} — ${result.reason} (leaving as-is)`);
      continue;
    }

    summary.dead++;
    console.log(`  x ${row.target_url} — ${result.reason}${opts.dryRun ? " (dry run, not rejecting)" : ""}`);
    if (opts.dryRun) continue;

    await pool.query(`update candidate_links set status = 'rejected', reviewed_at = now() where id = $1`, [row.id]);
    if (row.jurisdiction_id) {
      addToBlacklist(row.jurisdiction_id, row.jurisdiction_name, { url: row.target_url, reason: result.reason, status: result.status });
    }
  }

  return summary;
}
