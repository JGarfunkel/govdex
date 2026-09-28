// Shared by classifier.ts (channels) and vendorClassifier.ts (products):
// plain substring matching lets a domain pattern like "x.com/" match inside
// an unrelated host ("...clickfix.com/web_portal..."). Require the pattern
// to start at a domain boundary (start of string, or right after "/" or ".")
// instead.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesAtBoundary(url: string, pattern: string): boolean {
  return new RegExp(`(^|[/.])${escapeRegExp(pattern.toLowerCase())}`).test(url);
}

// "https://x.com/foo" and "https://x.com/foo/" are the same page (a trailing
// slash on a non-root path is almost always cosmetic) but would otherwise be
// stored as two distinct candidate_links rows, since the table's uniqueness
// is a raw string match on target_url. Strip it at the point every hit URL
// is collected (cascade.ts) so every downstream consumer — page-level
// dedup, the DB's on-conflict, fetchedUrls/sameOrigin checks — compares the
// same canonical form. Never touches the root path itself ("/" stays "/").
// A jurisdiction/body's website is free text a scribe types into an edit
// field (see apps/api/src/routes/propose.ts) — some get saved without a
// scheme ("villageofx.gov", "www.villageofx.gov"). Used unmodified, that
// breaks every relative link resolved against it (an invalid base URL) and
// shows up as a found_on_url missing "https://" in the Spider Candidates
// review UI. Defaults a bare host/path to https, the same protocol every
// other candidate_links URL in this pipeline already carries; a
// protocol-relative URL ("//villageofx.gov") keeps its own scheme-inheriting
// shape and just gets "https:" prefixed rather than a second "//".
export function ensureProtocol(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

// True when `a` and `b` share the same hostname — the boundary crawlSeed.ts
// uses to decide what's safe to fetch/cache as "this jurisdiction's own
// site" vs. someone else's server (see crawlSeed.ts's isAllowedFetchHost).
// Hostname only, not a full origin match: a scheme mismatch (a seed stored
// as "http://" while a linked page is "https://") or a bare "www." prefix
// shouldn't cause a false "different site" verdict, and a port difference is
// never meaningful for the municipal sites this crawls.
export function sameHost(a: string, b: string): boolean {
  try {
    const stripWww = (h: string) => h.replace(/^www\./, "");
    return stripWww(new URL(a).hostname.toLowerCase()) === stripWww(new URL(b).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
