// Ported from local/probe-civic-apis.js. For a jurisdiction, probe the major
// civic-data platforms to determine what API data exists — without relying
// on the jurisdiction's own (possibly blocked) website. Each platform is
// queried through its central, off-domain registry where one exists.
//
// Platforms:
//   - Socrata / Tyler Data & Insights   (central discovery API)
//   - ArcGIS / Esri                     (org portal probe)
//   - Legistar / Granicus               (slug probe + identity corroboration)
//   - CKAN via data.gov                 (federated catalog search)
//   - Certificate Transparency (crt.sh) (subdomain hints, not confirmation)
//
// Confirmation model: a hit is 'confirmed' only when the API returns an
// identity string (domain / org name / contact-email domain) that matches
// the jurisdiction name above the CONFIRM threshold. A hit with no
// corroborating identity (mainly a Legistar slug that merely resolves) is
// 'needs_review'. Below REVIEW it is 'rejected'. Both 'confirmed' and
// 'needs_review' still go through candidate_links for a human to promote —
// see ingestion/tools/probe-civic-apis.ts — matching every other detector in
// this codebase (nothing here writes to jurisdictions directly).

const UA = "civic-govdex-api-probe/1.0 (+https://civic-dashboards.org)";

const CONFIRM = 0.85; // >= this  -> auto-confirmed, still filed for review
const REVIEW = 0.6; // >= this  -> needs_review
// below REVIEW      -> rejected

export type ProbeStatus = "confirmed" | "needs_review" | "rejected";

export interface ProbeTarget {
  name: string;
  domain?: string;
}

export interface PlatformHit {
  platform: "socrata" | "arcgis" | "legistar" | "datagov" | "crt";
  found: boolean;
  status?: ProbeStatus | "hint";
  endpoint?: string;
  api?: string;
  identity?: string;
  score?: number;
  datasetCount?: number;
  bodyCount?: number;
  subdomains?: string[];
  note?: string;
  error?: string;
}

const uniq = <T,>(a: T[]): T[] => [...new Set(a)];
const round = (n: number) => Math.round(n * 100) / 100;

/** Strip governance nouns, state suffixes and punctuation for comparison. */
export function normalize(name: string): string {
  return String(name)
    .toLowerCase()
    .replace(/\b(county|city|town|village|borough|township|of|the)\b/g, " ")
    .replace(/,?\s*(n\.?y\.?|new york)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Collapse a normalized name to a bare slug candidate. */
export function slugify(name: string): string {
  return normalize(name).replace(/\s+/g, "");
}

/** Dice coefficient over character bigrams. 1.0 == identical after normalize. */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const A = grams(na);
  const B = grams(nb);
  let overlap = 0;
  let total = 0;
  for (const [g, c] of A) {
    total += c;
    if (B.has(g)) overlap += Math.min(c, B.get(g)!);
  }
  for (const [, c] of B) total += c;
  return total === 0 ? 0 : (2 * overlap) / total;
}

export function classify(score: number): ProbeStatus {
  if (score >= CONFIRM) return "confirmed";
  if (score >= REVIEW) return "needs_review";
  return "rejected";
}

interface JsonResult {
  ok: boolean;
  status?: number;
  data?: any;
  raw?: string;
  error?: string;
}

// Called with every URL right before it's fetched, across all platforms —
// --verbose in probe-civic-apis.ts wires this to a console.log so a scribe
// can see exactly what's being queried (candidate ArcGIS/Legistar slugs
// included, not just the ones that hit).
export type OnRequest = (url: string) => void;

/** Fetch JSON with a timeout. Never throws — returns a shaped result. */
async function getJson(
  url: string,
  { timeout = 10000, headers = {}, onRequest }: { timeout?: number; headers?: Record<string, string>; onRequest?: OnRequest } = {},
): Promise<JsonResult> {
  onRequest?.(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json", "user-agent": UA, ...headers },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const text = await res.text();
    try {
      return { ok: true, status: res.status, data: JSON.parse(text) };
    } catch {
      return { ok: true, status: res.status, data: null, raw: text };
    }
  } catch (e: any) {
    return { ok: false, error: e?.name === "AbortError" ? "timeout" : String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Reduce a hostname to its comparable core (drop service prefix + TLD). */
function domainCore(domain: string): string {
  return String(domain)
    .toLowerCase()
    .replace(/^(data|opendata|performance|internal|maps|gis|hub|api)\./, "")
    .replace(/\.(gov|org|us|com|net|edu)$/, "")
    .replace(/\.ny$/, "")
    .replace(/\./g, " ");
}

export interface ProbeContext {
  socrataDomains: { domain: string; count: number }[];
  onRequest?: OnRequest;
}

/** Load the full Socrata/Tyler domain list once; reuse across all entities. */
export async function loadSocrataDomains(onRequest?: OnRequest): Promise<{ domain: string; count: number }[]> {
  const r = await getJson("https://api.us.socrata.com/api/catalog/v1/domains", { timeout: 15000, onRequest });
  return r.ok && r.data && Array.isArray(r.data.results) ? r.data.results : [];
}

/** Match the jurisdiction slug against the central Socrata domain list. */
export async function probeSocrata(target: ProbeTarget, ctx: ProbeContext): Promise<PlatformHit> {
  const domains = ctx.socrataDomains || [];
  if (!domains.length) return { platform: "socrata", found: false, note: "domain list unavailable" };
  const slug = slugify(target.name);
  let best: { domain: string; count: number; score: number } | null = null;
  for (const { domain, count } of domains) {
    const score = similarity(domainCore(domain), slug);
    if (!best || score > best.score) best = { domain, count, score };
  }
  const status = classify(best!.score);
  if (status === "rejected") return { platform: "socrata", found: false, score: round(best!.score) };
  return {
    platform: "socrata",
    found: true,
    status,
    endpoint: `https://${best!.domain}/`,
    api: `https://api.us.socrata.com/api/catalog/v1?domains=${best!.domain}`,
    identity: best!.domain,
    datasetCount: best!.count,
    score: round(best!.score),
  };
}

/** Probe candidate ArcGIS Online org portals; identity = returned org name. */
export async function probeArcGIS(target: ProbeTarget, ctx: ProbeContext = { socrataDomains: [] }): Promise<PlatformHit> {
  const slug = slugify(target.name);
  const candidates = uniq([slug, `${slug}ny`, `${slug}gov`, `cityof${slug}`, `countyof${slug}`]);
  for (const c of candidates) {
    const r = await getJson(`https://${c}.maps.arcgis.com/sharing/rest/portals/self?f=json`, { onRequest: ctx.onRequest });
    if (!(r.ok && r.data && r.data.name && !r.data.error)) continue;
    const score = similarity(r.data.name, target.name);
    const status = classify(score);
    if (status === "rejected") continue;
    return {
      platform: "arcgis",
      found: true,
      status,
      endpoint: `https://${c}.maps.arcgis.com`,
      api: `https://${c}.maps.arcgis.com/sharing/rest/search?f=json&q=owner:${c}`,
      identity: r.data.name,
      score: round(score),
    };
  }
  return { platform: "arcgis", found: false };
}

/**
 * Probe Legistar/Granicus. A resolving slug is necessary but not sufficient:
 * corroborate the jurisdiction from contact-email domains before confirming.
 */
export async function probeLegistar(target: ProbeTarget, ctx: ProbeContext = { socrataDomains: [] }): Promise<PlatformHit> {
  const slug = slugify(target.name);
  const candidates = uniq([slug, `${slug}ny`, `${slug}legistar`]);
  for (const c of candidates) {
    const r = await getJson(`https://webapi.legistar.com/v1/${c}/bodies?$top=50`, {
      headers: { accept: "application/json" },
      onRequest: ctx.onRequest,
    });
    if (!(r.ok && Array.isArray(r.data) && r.data.length)) continue;

    const emailDomains = uniq(
      r.data
        .map((b: any) => b && b.BodyContactEmail)
        .filter(Boolean)
        .map((e: string) => (String(e).split("@")[1] || "").toLowerCase())
        .filter(Boolean),
    );
    let idScore = 0;
    let idHit: string | null = null;
    for (const d of emailDomains) {
      const s = similarity(domainCore(d), slug);
      if (s > idScore) {
        idScore = s;
        idHit = d;
      }
    }
    const status: ProbeStatus = idScore >= CONFIRM ? "confirmed" : "needs_review";
    return {
      platform: "legistar",
      found: true,
      status,
      endpoint: `https://${c}.legistar.com`,
      api: `https://webapi.legistar.com/v1/${c}`,
      identity: idHit || `slug:${c}`,
      bodyCount: r.data.length,
      score: round(idScore),
      note:
        status === "confirmed"
          ? undefined
          : "client resolves at this slug but identity not corroborated — verify it is the intended jurisdiction",
    };
  }
  return { platform: "legistar", found: false };
}

/** Search data.gov's federated CKAN catalog for a matching organization. */
export async function probeDataGov(target: ProbeTarget, ctx: ProbeContext = { socrataDomains: [] }): Promise<PlatformHit> {
  const q = encodeURIComponent(target.name);
  const r = await getJson(`https://catalog.data.gov/api/3/action/organization_autocomplete?q=${q}&limit=5`, {
    onRequest: ctx.onRequest,
  });
  if (!(r.ok && r.data && r.data.result && r.data.result.length)) {
    return { platform: "datagov", found: false };
  }
  let best: { org: any; score: number } | null = null;
  for (const org of r.data.result) {
    const label = org.title || org.name || "";
    const score = similarity(label, target.name);
    if (!best || score > best.score) best = { org, score };
  }
  const status = classify(best!.score);
  if (status === "rejected") return { platform: "datagov", found: false, score: round(best!.score) };
  return {
    platform: "datagov",
    found: true,
    status,
    endpoint: `https://catalog.data.gov/organization/${best!.org.name}`,
    api: `https://catalog.data.gov/api/3/action/package_search?fq=organization:${best!.org.name}`,
    identity: best!.org.title || best!.org.name,
    score: round(best!.score),
  };
}

/**
 * Certificate Transparency: surface API-ish subdomains of a known base domain.
 * This is a discovery HINT, never a confirmation — it tells you where to look.
 * crt.sh can be slow or rate-limited; give it a longer timeout.
 */
export async function probeCertTransparency(target: ProbeTarget, ctx: ProbeContext = { socrataDomains: [] }): Promise<PlatformHit> {
  if (!target.domain) return { platform: "crt", found: false, note: "no base domain provided" };
  const r = await getJson(`https://crt.sh/?q=${encodeURIComponent("%." + target.domain)}&output=json`, {
    timeout: 20000,
    onRequest: ctx.onRequest,
  });
  if (!(r.ok && Array.isArray(r.data))) {
    return { platform: "crt", found: false, error: r.error ?? String(r.status) };
  }
  const names = uniq(r.data.flatMap((x: any) => String(x.name_value || "").split("\n")));
  const interesting = names.filter((n) => /^(api|data|opendata|gis|maps|hub|arcgis|socrata)\./i.test(n));
  return {
    platform: "crt",
    found: interesting.length > 0,
    status: "hint",
    subdomains: interesting.slice(0, 50),
  };
}

export interface ProbeResult {
  jurisdiction: string;
  hits: PlatformHit[]; // found hits only, excludes rejected/not-found
  checkedAt: string;
}

/** Probe every platform for one jurisdiction. ctx.socrataDomains is loaded once by the caller and shared across entities. */
export async function probeEntity(target: ProbeTarget, ctx: ProbeContext): Promise<ProbeResult> {
  const hits = await Promise.all([
    probeSocrata(target, ctx),
    probeArcGIS(target, ctx),
    probeLegistar(target, ctx),
    probeDataGov(target, ctx),
    probeCertTransparency(target, ctx),
  ]);
  return {
    jurisdiction: target.name,
    hits: hits.filter((h) => h.found),
    checkedAt: new Date().toISOString(),
  };
}
