import robotsParser from "robots-parser";
import { getPool } from "@govdex/db";
import { savePage, getFreshCachedPage } from "./cache";

const USER_AGENT = process.env.USER_AGENT ?? "GovdexSpider/0.1 (+https://github.com/; civic transparency research)";

const robotsCache = new Map<string, ReturnType<typeof robotsParser> | null>();
// One frictions check per origin per process run — the DB insert itself
// is deduped by the unique constraint, this just skips the redundant query
// on every one of a site's disallowed pages, not just the first.
const robotsChecked = new Set<string>();

async function getRobots(origin: string) {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT } });
    const text = res.ok ? await res.text() : "";
    const robots = robotsParser(`${origin}/robots.txt`, text);
    robotsCache.set(origin, robots);
    return robots;
  } catch {
    robotsCache.set(origin, null);
    return null;
  }
}

// Records robots.txt blocking this crawler as a frictions row (see
// schema.sql), distinguishing "blocks every crawler" from "blocks this
// crawler specifically while allowing others" (checked against '*', robots-
// parser's wildcard rule set) — the latter is the discriminatory case the
// jurisdiction should have to answer for on its EntityPage. Never writes
// without a jurisdictionId to attach the finding to (an ad-hoc --url crawl
// with no resolvable jurisdiction — see run.ts).
async function recordRobotsFinding(
  origin: string,
  blockedUrl: string,
  robots: NonNullable<ReturnType<typeof robotsParser>>,
  meta?: { jurisdictionId?: string | null; sourceBodyId?: string | null; crawlJobId?: string | null },
) {
  if (!meta?.jurisdictionId || robotsChecked.has(origin)) return;
  robotsChecked.add(origin);

  const blocksEveryone = robots.isDisallowed(blockedUrl, "*") ?? false;
  const patternType = blocksEveryone ? "robots_txt_excludes_crawler" : "robots_txt_discriminatory";
  const summary = blocksEveryone
    ? `robots.txt at ${origin} disallows all crawlers`
    : `robots.txt at ${origin} disallows ${USER_AGENT} while allowing other crawlers`;

  try {
    await getPool().query(
      `insert into frictions
         (jurisdiction_id, body_id, crawl_job_id, pattern_type, page_url, summary, detail)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (jurisdiction_id, pattern_type, page_url) do nothing`,
      [
        meta.jurisdictionId,
        meta.sourceBodyId ?? null,
        meta.crawlJobId ?? null,
        patternType,
        `${origin}/robots.txt`,
        summary,
        `First observed blocking: ${blockedUrl}`,
      ],
    );
  } catch (err) {
    console.warn(`  failed to record robots.txt finding for ${origin}: ${err instanceof Error ? err.message : err}`);
  }
}

// Cloudflare sets this on responses it intercepted with a Managed/JS
// Challenge -- distinguishes "the site's edge bot-management blocked an
// honestly-identified crawler" from an ordinary 403/site-side block. The
// site's own robots.txt may well permit the crawl; a third-party layer in
// front of it is what's actually blocking it.
function isBotChallenge(res: Response): boolean {
  return res.headers.get("cf-mitigated") === "challenge";
}

// One finding per (origin, pattern_type) per process run, same reasoning as
// robotsChecked — keyed by pattern_type too so a block recorded on a
// secondary page doesn't suppress a later, more severe finding on the prime
// seed page itself at the same origin (or vice versa).
const botProtectionChecked = new Set<string>();

// Only a block of the prime seed page itself is severe (see
// frictionSeverity's SEVERE_FRICTION_TYPES) — that means the spider can't
// keep this jurisdiction in sync at all. A block on some other page found
// while crawling (a hub page, a recursed board sub-page, an affiliated
// vendor host, ...) is still worth recording, but it's a lesser friction:
// the jurisdiction's core presence is still reachable.
async function recordBotProtectionFinding(origin: string, blockedUrl: string, meta?: FetchMeta) {
  if (!meta?.jurisdictionId) return;
  const isSeedPage = meta.isSeedPage ?? false;
  const patternType = isSeedPage ? "crawler_blocked" : "crawler_blocked_secondary";
  const checkedKey = `${patternType}:${origin}`;
  if (botProtectionChecked.has(checkedKey)) return;
  botProtectionChecked.add(checkedKey);

  const summary = isSeedPage
    ? `Bot-management challenge at ${origin} blocks ${USER_AGENT} even though robots.txt permits it`
    : `Bot-management challenge at ${origin} blocks ${USER_AGENT} on a secondary page even though robots.txt permits it`;

  try {
    await getPool().query(
      `insert into frictions
         (jurisdiction_id, body_id, crawl_job_id, pattern_type, page_url, summary, detail)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (jurisdiction_id, pattern_type, page_url) do nothing`,
      [
        meta.jurisdictionId,
        meta.sourceBodyId ?? null,
        meta.crawlJobId ?? null,
        patternType,
        origin,
        summary,
        `First observed blocking: ${blockedUrl}`,
      ],
    );
  } catch (err) {
    console.warn(`  failed to record bot-protection finding for ${origin}: ${err instanceof Error ? err.message : err}`);
  }
}

// isSeedPage marks the URL being fetched as the jurisdiction's own prime
// seed page (set only by crawlSeed.ts's initial politeFetch(seedUrl, ...))
// — see recordBotProtectionFinding.
type FetchMeta = {
  jurisdictionId?: string | null;
  sourceBodyId?: string | null;
  crawlJobId?: string | null;
  isSeedPage?: boolean;
};

// Shared by politeFetch and politeFetchWithType below: robots/bot-protection
// checks and the actual fetch, without politeFetch's "non-HTML ⇒ discard"
// opinion (politeFetchWithType's callers need to see a PDF response, not
// just have it silently dropped).
async function fetchRaw(url: string, meta?: FetchMeta): Promise<{ contentType: string; html: string | null } | null> {
  const cached = getFreshCachedPage(url);
  if (cached) return { contentType: cached.contentType ?? "", html: cached.html };

  const parsed = new URL(url);
  const robots = await getRobots(parsed.origin);
  if (robots && robots.isDisallowed(url, USER_AGENT)) {
    console.warn(`  robots.txt disallows ${url}, skipping`);
    await recordRobotsFinding(parsed.origin, url, robots, meta);
    return null;
  }
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
    if (!res.ok) {
      if (isBotChallenge(res)) {
        console.warn(`  fetch ${url} intercepted by bot-management challenge (${res.status}), skipping`);
        await recordBotProtectionFinding(parsed.origin, url, meta);
      } else {
        console.warn(`  fetch ${url} returned ${res.status} ${res.statusText}, skipping`);
      }
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return { contentType, html: null };
    const html = await res.text();
    await savePage(url, html, { ...meta, contentType });
    return { contentType, html };
  } catch (err) {
    console.warn(`  fetch failed for ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export async function politeFetch(url: string, meta?: FetchMeta): Promise<string | null> {
  const result = await fetchRaw(url, meta);
  if (!result) return null;
  if (!result.html) {
    console.warn(`  fetch ${url} returned non-HTML content-type "${result.contentType}", skipping`);
    return null;
  }
  return result.html;
}

// Like politeFetch, but reports the content-type instead of silently
// discarding a non-HTML response — budgetDetector.ts's verifyBudgetPage
// needs to tell a PDF budget document (friction to flag, not an error)
// apart from an actual HTML budget page.
export async function politeFetchWithType(url: string, meta?: FetchMeta): Promise<{ contentType: string; html: string | null }> {
  return (await fetchRaw(url, meta)) ?? { contentType: "", html: null };
}
