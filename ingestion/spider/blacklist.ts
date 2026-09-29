// Per-jurisdiction list of candidate_links target_urls confirmed dead (404,
// gone, unresolvable host, ...) by ingestion/tools/prune-dead-candidates.ts.
// Lives in data/govdex/blacklists/, which is checked into git (the rest of
// data/govdex/ is regeneratable and gitignored) since this records a judgment
// — "we already checked, it's gone" — that a future crawl shouldn't have to re-discover and a scribe
// shouldn't have to re-triage. Consulted by crawlSeed.ts so a dead link
// found again on a later crawl of the same site is silently skipped rather
// than re-inserted as a 'new' candidate.
import fs from "fs";
import path from "path";
import { normalizeUrl } from "./urlMatch";

const BLACKLIST_DIR = path.resolve(process.cwd(), "data/govdex/blacklists");

export interface BlacklistEntry {
  url: string;
  reason: string; // e.g. "404 Not Found", "ENOTFOUND"
  status: number | null; // HTTP status, or null for a network-level failure
  blacklistedAt: string;
}

interface BlacklistFile {
  jurisdictionName: string | null;
  urls: BlacklistEntry[];
}

function fileFor(jurisdictionId: string): string {
  return path.join(BLACKLIST_DIR, `${jurisdictionId}.json`);
}

function readFile(jurisdictionId: string): BlacklistFile {
  const file = fileFor(jurisdictionId);
  if (!fs.existsSync(file)) return { jurisdictionName: null, urls: [] };
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

// One in-process cache entry per jurisdiction crawled this run — a crawl
// visits many pages for the same jurisdiction and shouldn't re-read/re-parse
// the file from disk for every hit.
const setCache = new Map<string, Set<string>>();

export function loadBlacklistSet(jurisdictionId: string | null): Set<string> {
  if (!jurisdictionId) return new Set();
  const cached = setCache.get(jurisdictionId);
  if (cached) return cached;
  const set = new Set(readFile(jurisdictionId).urls.map((e) => normalizeUrl(e.url)));
  setCache.set(jurisdictionId, set);
  return set;
}

export function isBlacklisted(jurisdictionId: string | null, url: string): boolean {
  return loadBlacklistSet(jurisdictionId).has(normalizeUrl(url));
}

// Appends one dead-URL finding, deduped by normalized url. Rewrites the
// whole file (these lists are small — dead links per jurisdiction, not
// pages) and refreshes the in-process cache so a later isBlacklisted() call
// in the same run sees it immediately.
export function addToBlacklist(
  jurisdictionId: string,
  jurisdictionName: string | null,
  entry: { url: string; reason: string; status: number | null },
): void {
  fs.mkdirSync(BLACKLIST_DIR, { recursive: true });
  const data = readFile(jurisdictionId);
  if (jurisdictionName) data.jurisdictionName = jurisdictionName;
  const normalized = normalizeUrl(entry.url);
  if (data.urls.some((e) => normalizeUrl(e.url) === normalized)) return; // already recorded
  data.urls.push({ url: entry.url, reason: entry.reason, status: entry.status, blacklistedAt: new Date().toISOString() });
  data.urls.sort((a, b) => a.url.localeCompare(b.url));
  fs.writeFileSync(fileFor(jurisdictionId), JSON.stringify(data, null, 2) + "\n", "utf-8");
  setCache.delete(jurisdictionId); // reload from disk next time, rather than reimplementing the merge above
}
