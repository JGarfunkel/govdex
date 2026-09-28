// Disk cache for pages the spider fetches. The original point was to have
// raw HTML sitting still on disk so vendor-detection rules
// (ecode360/CivicPlus/Granicus/etc., see the note in channel_detector.yaml)
// can be developed and re-run against real pages without re-crawling the
// network every time — but fetchRaw (fetcher.ts) also now reads from here
// first via getFreshCachedPage(), so it doubles as a politeness/performance
// cache: a page fetched within MAX_CACHE_AGE_MS isn't re-downloaded at all.
// One file per unique URL, keyed by a hash of the URL (not the content) so
// re-fetching the same URL overwrites in place — we want "latest known
// page," not a version history.
//
// Lives under data/govdex/ (already .gitignored, same as pgdata/) since these
// are large, local, regeneratable artifacts, not source.
//
// Also mirrored to Cloudflare R2 (write-through, via @govdex/storage) so the
// pages survive this machine being wiped and can be read back by a process
// that doesn't have this local disk — a no-op unless R2_* env vars are set.
//
// Stored gzip-compressed (.html.gz) — this is a write-once, rarely-read
// archive (crawlSeed.ts writes it, a scribe or a detector-development
// session occasionally reads one back), not a hot path, so trading a bit of
// CPU on write for a lot less disk is the right call as the tranche of
// cached documents grows. Pre-compression entries (.html, uncompressed) are
// still read back correctly — see readCacheFile — so no migration is needed
// for what's already on disk.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import zlib from "zlib";
import { putCachedPage } from "@govdex/storage";

const CACHE_DIR = path.resolve(process.cwd(), "data/govdex/page-cache");
const INDEX_PATH = path.join(CACHE_DIR, "index.json");

// How long a cached page is trusted as "current" before the spider will
// re-fetch it over the network. During this early development stage the
// whole point of the cache is to let detector rules be developed and
// re-run against real pages without re-downloading the internet on every
// run — see fetcher.ts's fetchRaw, which checks getFreshCachedPage() first.
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CacheEntry {
  url: string;
  jurisdictionId: string | null;
  sourceBodyId: string | null;
  fetchedAt: string;
  contentType: string | null;
  bytes: number;
  file: string;
}

type Index = Record<string, CacheEntry>;

let index: Index | null = null;

function loadIndex(): Index {
  if (index) return index;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  index = fs.existsSync(INDEX_PATH) ? JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8")) : {};
  return index!;
}

function saveIndex() {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

function hashUrl(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 24);
}

// Reads a cached file back to a UTF-8 string, transparently decompressing
// .html.gz entries. Older .html entries (written before compression was
// added) are read as plain text.
function readCacheFile(file: string): string {
  const buf = fs.readFileSync(path.join(CACHE_DIR, file));
  return file.endsWith(".gz") ? zlib.gunzipSync(buf).toString("utf-8") : buf.toString("utf-8");
}

export async function savePage(
  url: string,
  html: string,
  meta: { jurisdictionId?: string | null; sourceBodyId?: string | null; contentType?: string | null } = {},
) {
  const idx = loadIndex();
  const file = `${hashUrl(url)}.html.gz`;
  const compressed = zlib.gzipSync(html);
  fs.writeFileSync(path.join(CACHE_DIR, file), compressed);
  const fetchedAt = new Date().toISOString();
  idx[url] = {
    url,
    jurisdictionId: meta.jurisdictionId ?? null,
    sourceBodyId: meta.sourceBodyId ?? null,
    fetchedAt,
    contentType: meta.contentType ?? null,
    bytes: compressed.byteLength,
    file,
  };
  saveIndex();

  await putCachedPage(url, html, {
    jurisdictionId: meta.jurisdictionId ?? null,
    sourceBodyId: meta.sourceBodyId ?? null,
    fetchedAt,
    contentType: meta.contentType ?? null,
  });
}

export function listCachedPages(): CacheEntry[] {
  return Object.values(loadIndex());
}

export function hasCachedPage(url: string): boolean {
  return url in loadIndex();
}

// Returns the on-disk copy of `url` if one exists and was fetched within
// MAX_CACHE_AGE_MS, so fetchRaw can skip the network entirely. null on a
// cache miss or a stale entry — either way the caller falls back to fetching.
export function getFreshCachedPage(url: string): { html: string; contentType: string | null } | null {
  const idx = loadIndex();
  const entry = idx[url];
  if (!entry) return null;
  if (Date.now() - new Date(entry.fetchedAt).getTime() > MAX_CACHE_AGE_MS) return null;
  const filePath = path.join(CACHE_DIR, entry.file);
  if (!fs.existsSync(filePath)) return null;
  return { html: readCacheFile(entry.file), contentType: entry.contentType };
}

export function readCachedPage(entry: CacheEntry): string {
  return readCacheFile(entry.file);
}

// Evicts one URL's cached copy (index entry + file) — for one-time cleanups
// like ingestion/tools/prune-guarded-links.ts, where a page was cached under
// a since-tightened guard and shouldn't be trusted as "current" for that URL
// anymore. Not used by the normal fetch path; savePage() already overwrites
// in place on a re-fetch. Local disk only — the R2 mirror (@govdex/storage)
// has no delete API yet and is left to expire/be overwritten on its own.
export function removeCachedPage(url: string): boolean {
  const idx = loadIndex();
  const entry = idx[url];
  if (!entry) return false;
  const filePath = path.join(CACHE_DIR, entry.file);
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
  delete idx[url];
  saveIndex();
  return true;
}
