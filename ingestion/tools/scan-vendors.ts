// scan-vendors — offline vendor-detection pass over the disk page cache
// (ingestion/spider/cache.ts). Report-only: it never writes to the database.
// Two outputs:
//   1. known vendor hits (ecode360/CivicPlus/Granicus/etc., per
//      ingestion/spider/vendor_detector.yaml), attributed to a jurisdiction
//      and page — the raw material for eventually promoting matches into
//      products/adoptions, the same way candidate_links gets promoted into
//      channels today.
//   2. unclassified external hosts — everything left over once known
//      vendors, known social/community channels (channel_detector.yaml),
//      same-site links, and CDN/analytics noise (ignore_hosts in
//      vendor_detector.yaml) are excluded — ranked by how often they show
//      up, so it's obvious which ones are worth turning into a new rule.
//
// Usage:
//   npx tsx ingestion/tools/scan-vendors.ts                  scan every cached page
//   npx tsx ingestion/tools/scan-vendors.ts "Bethlehem"       scan pages for jurisdictions matching this name
import "dotenv/config";
import * as cheerio from "cheerio";
import { getPool } from "@govdex/db";
import { listCachedPages, readCachedPage, type CacheEntry } from "../spider/cache";
import { classifyLink } from "../spider/classifier";
import { classifyVendor, isIgnoredHost } from "../spider/vendorClassifier";

interface VendorHit {
  vendor: string;
  function: string;
  url: string;
  foundOn: string;
  jurisdictionId: string | null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function extractLinks(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];
  $("a[href], iframe[src], script[src], link[href]").each((_, el) => {
    const raw = $(el).attr("href") ?? $(el).attr("src");
    if (!raw) return;
    try {
      urls.push(new URL(raw, pageUrl).toString());
    } catch {
      // not resolvable to an absolute URL (mailto:, javascript:, etc.) — skip
    }
  });
  return urls;
}

async function main() {
  const namePattern = process.argv[2] ?? null;

  let pages: CacheEntry[] = listCachedPages();
  const jurisdictionNames = new Map<string, string>();

  const pool = namePattern || pages.length ? getPool() : null;
  if (pool) {
    const { rows } = await pool.query<{ id: string; name: string }>(`select id, name from jurisdictions`);
    for (const r of rows) jurisdictionNames.set(r.id, r.name);
  }

  if (namePattern) {
    const matchingIds = new Set(
      [...jurisdictionNames.entries()].filter(([, name]) => name.toLowerCase().includes(namePattern.toLowerCase())).map(([id]) => id),
    );
    pages = pages.filter((p) => p.jurisdictionId && matchingIds.has(p.jurisdictionId));
  }

  console.log(`Scanning ${pages.length} cached page(s)${namePattern ? ` matching "${namePattern}"` : ""}...\n`);

  const vendorHits: VendorHit[] = [];
  const unknownHostCounts = new Map<string, number>();

  for (const page of pages) {
    const html = readCachedPage(page);
    const pageHost = hostOf(page.url);
    const links = extractLinks(html, page.url);

    for (const link of links) {
      const linkHost = hostOf(link);
      if (!linkHost || linkHost === pageHost) continue; // same-site navigation, not a vendor

      const vendorMatch = classifyVendor(link);
      if (vendorMatch) {
        vendorHits.push({ ...vendorMatch, url: link, foundOn: page.url, jurisdictionId: page.jurisdictionId });
        continue;
      }

      if (classifyLink(link).kind) continue; // already accounted for as a social/community channel
      if (isIgnoredHost(link)) continue; // CDN/analytics noise

      unknownHostCounts.set(linkHost, (unknownHostCounts.get(linkHost) ?? 0) + 1);
    }
  }

  console.log(`=== Known vendor hits (${vendorHits.length}) ===`);
  if (vendorHits.length === 0) {
    console.log("  (none)");
  } else {
    for (const hit of vendorHits) {
      const jname = hit.jurisdictionId ? jurisdictionNames.get(hit.jurisdictionId) ?? hit.jurisdictionId : "(no jurisdiction)";
      console.log(`  [${hit.vendor} / ${hit.function}] ${jname}: ${hit.url} (found on ${hit.foundOn})`);
    }
  }

  const ranked = [...unknownHostCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n=== Unclassified external hosts (${ranked.length}) ===`);
  console.log("  Candidates for a new vendor_detector.yaml rule or ignore_hosts entry:");
  for (const [host, count] of ranked.slice(0, 50)) {
    console.log(`  ${count.toString().padStart(4)}  ${host}`);
  }

  if (pool) await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
