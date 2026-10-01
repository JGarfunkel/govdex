// mn-websites — fill jurisdictions.website for Minnesota's cities, townships and
// counties. Replaces the earlier cities-only mn-city-websites.ts.
//
// Sources, in priority order (the first to give a jurisdiction a website wins):
//   cities     1. League of Minnesota Cities directory (mylmc.lmc.org). An ASP.NET
//                 form: GET citydirectory.aspx for the __VIEWSTATE fields, POST them
//                 to citystatus.aspx with "All cities", then GET each of the 856
//                 citydetail.aspx pages for its "Web Site" and "County" rows.
//              2. mn.gov/portal/government/local/cities/ — an A-Z list of links.
//   townships  mn.gov/portal/government/local/townships/ — saved by hand (the live
//                 page serves a bot-check to scripts). It lists only a subset of
//                 townships and gives no county, so a name shared by several
//                 townships is reported as ambiguous and skipped, never guessed.
//   counties   mn.gov/portal/government/local/counties/ — saved by hand, same reason.
//
// Matching is by normalized name (this is a website directory with no IDs), using
// the county to break ties where the source gives one. Only import-origin rows are
// written (a scribe's manual edit is never clobbered); blank websites are filled,
// existing ones kept unless --overwrite. A jurisdiction with no listed website is
// left blank — blank never means "none exists".
//
// Usage:
//   npx tsx ingestion/tools/mn-websites.ts [--dry-run] [--overwrite] [--verbose]
//       [--towns=<html>] [--counties=<html>]
//   (file defaults: local/data/states/mn/{town,county}-websites.html)
//
//   --dry-run   no database connection; matches against the live MnGeo layers
//               instead, so it works before the MN load has been run
import "dotenv/config";
import fs from "node:fs";
import { getPool } from "@govdex/db";
import { arcgisFetchAll } from "../lib/arcgis";
import { normalizeName } from "../lib/sourceSpec";
import { ensureProtocol } from "../spider/urlMatch";

const LMC = "https://mylmc.lmc.org/cms/cities/";
const MNGOV_CITIES = "https://mn.gov/portal/government/local/cities/";
const HEADERS = { "User-Agent": "Mozilla/5.0 (GovdexIngestion/0.1)" };
const GIS = "https://feat.gisdata.mn.gov/arcgis/rest/services/MnGeo";

type Concept = "city" | "town" | "county";

interface Entry {
  name: string; // as the source writes it
  county: string | null; // may list several ("Hennepin Ramsey")
  website: string | null;
  source: string;
}
interface Target {
  id: string | null; // null in dry-run
  name: string;
  county: string | null;
  website: string | null;
  origin: string | null;
}

// "St. Cloud" -> "Saint Cloud" (MnGeo's spelling), "Saint Anthony Village" -> the
// Ramsey County city MnGeo calls "Saint Anthony", then strip a trailing type word.
const key = (name: string, concept: Concept) => {
  let n = name.replace(/\bSt\.?(?=\s)/g, "Saint").replace(/^Saint Anthony Village$/, "Saint Anthony");
  if (concept === "county") n = n.replace(/\s+County$/i, "");
  if (concept === "town") n = n.replace(/\s+(Township|Twp\.?)$/i, "");
  return normalizeName(n);
};

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function hiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input[^>]+name="(__[A-Z]+)"[^>]*value="([^"]*)"/g)) out[m[1]] = m[2].replace(/&amp;/g, "&");
  return out;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function mapPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// --- sources -----------------------------------------------------------------

async function lmcCities(): Promise<Entry[]> {
  const page = await (await fetch(`${LMC}citydirectory.aspx`, { headers: HEADERS })).text();
  const form = new URLSearchParams({ ...hiddenFields(page), lstCities: "all", Population1: "0", Population2: "1000000", Button1: "Search" });
  const res = await fetch(`${LMC}citystatus.aspx`, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded", Referer: `${LMC}citydirectory.aspx` },
    body: form,
  });
  if (!res.ok) throw new Error(`citystatus.aspx: ${res.status}`);
  const html = await res.text();
  const cities = [...html.matchAll(/<a href='citydetail\.aspx\?city=(\d+)'>([^<]+)<\/a>/g)].map((m) => ({ id: m[1], name: text(m[2]) }));
  if (cities.length === 0) throw new Error("LMC directory returned no cities — the form fields probably changed");
  console.log(`LMC directory: ${cities.length} cities; fetching detail pages...`);

  return mapPool(cities, 5, async (c): Promise<Entry> => {
    let html = "";
    for (let attempt = 0; attempt < 3 && !html; attempt++) {
      const r = await fetch(`${LMC}citydetail.aspx?city=${c.id}`, { headers: HEADERS });
      if (r.ok) html = await r.text();
      else await sleep(500 * (attempt + 1));
    }
    const span = (id: string) => html.match(new RegExp(`<span id="${id}">([\\s\\S]*?)</span>`))?.[1] ?? "";
    const href = span("lblWebSite").match(/href=['"]([^'"]+)['"]/)?.[1] ?? text(span("lblWebSite"));
    return { name: c.name, county: text(span("lblCounty")) || null, website: href ? ensureProtocol(href) : null, source: "lmc" };
  });
}

// mn.gov "local government" lists: <li><a href="http://…">Name</a></li>, name is the
// link text. Parse from the A-Z anchor on, so the page's header/footer links
// (511, 911, …) are never mistaken for jurisdictions.
function mnGovList(html: string, source: string): Entry[] {
  const start = html.search(/name="A"/);
  const body = start >= 0 ? html.slice(start) : html;
  return [...body.matchAll(/<a href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => ({
    name: text(m[2]),
    county: null,
    website: ensureProtocol(m[1]),
    source,
  }));
}

async function mnGovCities(): Promise<Entry[]> {
  const res = await fetch(MNGOV_CITIES, { headers: HEADERS });
  const html = await res.text();
  if (!res.ok || /Radware|captcha/i.test(html)) {
    console.warn(`WARN mn.gov cities page unavailable (${res.status}, bot-check?) — skipped`);
    return [];
  }
  return mnGovList(html, "mn.gov");
}

function savedList(path: string, source: string): Entry[] {
  if (!fs.existsSync(path)) {
    console.warn(`WARN ${path} not found — ${source} skipped`);
    return [];
  }
  const html = fs.readFileSync(path, "utf8");
  if (/Radware|captcha/i.test(html)) throw new Error(`${path} is a bot-check page, not the list — save the page from a browser`);
  return mnGovList(html, source);
}

// --- targets -----------------------------------------------------------------

async function dbTargets(pool: ReturnType<typeof getPool>, concept: Concept): Promise<Target[]> {
  const { rows } = await pool.query<Target>(
    `select j.id, j.name, j.website, j.origin, c.name as county
       from jurisdictions j
       join profiles p on p.id = j.profile_id
       join type_concepts tc on tc.id = j.concept_id
       left join jurisdictions c on c.profile_id = j.profile_id
                                and c.concept_id = (select id from type_concepts where code = 'county')
                                and c.attributes->>'mn_county_code' = j.attributes->>'mn_county_code'
                                and tc.code <> 'county'
      where p.code = 'US-MN' and tc.code = $1`,
    [concept],
  );
  return rows;
}

// Dry-run stand-in for the database: the same MnGeo layers the loader reads.
async function gisTargets(concept: Concept): Promise<Target[]> {
  if (concept === "county") {
    const rows = await arcgisFetchAll<{ county_name: string }>(`${GIS}/mn_counties/FeatureServer/0/query`, ["county_name"]);
    return rows.map((r) => ({ id: null, name: r.county_name, county: null, website: null, origin: "import" }));
  }
  const cls = concept === "city" ? "CITY" : "TOWNSHIP";
  const rows = await arcgisFetchAll<{ feature_name: string; county_name: string; gnis_feature_id: number }>(
    `${GIS}/CTU/FeatureServer/0/query`,
    ["feature_name", "county_name", "gnis_feature_id"],
    `ctu_class='${cls}'`,
  );
  const seen = new Set<number>();
  return rows
    .filter((r) => !seen.has(r.gnis_feature_id) && seen.add(r.gnis_feature_id))
    .map((r) => ({ id: null, name: r.feature_name, county: r.county_name, website: null, origin: "import" }));
}

// --- matching ----------------------------------------------------------------

async function apply(pool: ReturnType<typeof getPool> | null, concept: Concept, entries: Entry[], overwrite: boolean, verbose: boolean) {
  const targets = pool ? await dbTargets(pool, concept) : await gisTargets(concept);
  if (pool && targets.length === 0) throw new Error(`no US-MN ${concept} jurisdictions in the database — run the MN load first`);

  const byName = new Map<string, Target[]>();
  for (const t of targets) byName.set(key(t.name, concept), [...(byName.get(key(t.name, concept)) ?? []), t]);

  const claimed = new Map<Target, Entry>(); // a target takes the first (highest-priority) source's website
  const matchedTargets = new Set<Target>();
  const ambiguous: string[] = [];
  const unmatched: string[] = [];
  for (const e of entries) {
    const cands = byName.get(key(e.name, concept)) ?? [];
    const sameCounty = cands.filter((t) => t.county && e.county && normalizeName(e.county).includes(normalizeName(t.county)));
    const pick = cands.length === 1 ? cands[0] : sameCounty.length === 1 ? sameCounty[0] : null;
    if (!pick) {
      (cands.length ? ambiguous : unmatched).push(`${e.name}${e.county ? ` (${e.county})` : ""}`);
      continue;
    }
    matchedTargets.add(pick);
    if (e.website && !claimed.has(pick)) claimed.set(pick, e);
  }

  let written = 0;
  let kept = 0;
  let skippedManual = 0;
  const bySource: Record<string, number> = {};
  for (const [t, e] of claimed) {
    bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    if (!pool || !t.id) continue;
    if (t.origin !== "import") skippedManual++;
    else if (t.website && !overwrite) kept++;
    else written += (await pool.query(`update jurisdictions set website = $2 where id = $1 and origin = 'import'`, [t.id, e.website])).rowCount ?? 0;
  }

  console.log(
    `${concept}: ${targets.length} in ${pool ? "database" : "MnGeo"}; ${matchedTargets.size} matched a directory entry, ${claimed.size} got a website ${JSON.stringify(bySource)}, ` +
      `${targets.length - claimed.size} left blank; ${ambiguous.length} ambiguous entries, ${unmatched.length} unmatched entries`,
  );
  if (pool) console.log(`  wrote ${written}; ${kept} already set (use --overwrite), ${skippedManual} scribe-edited rows left alone`);
  const show = (label: string, xs: string[]) => xs.length && (verbose || xs.length <= 15) && console.log(`  ${label}: ${xs.join("; ")}`);
  show("ambiguous (skipped)", ambiguous);
  show("unmatched entries", unmatched);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const overwrite = args.includes("--overwrite");
  const verbose = args.includes("--verbose");
  const arg = (n: string, d: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
  const townFile = arg("towns", "local/data/states/mn/town-websites.html");
  const countyFile = arg("counties", "local/data/states/mn/county-websites.html");

  const pool = dryRun ? null : getPool();
  console.log(dryRun ? "dry run — nothing will be written" : "writing to the database");

  await apply(pool, "county", savedList(countyFile, "mn.gov"), overwrite, verbose);
  await apply(pool, "town", savedList(townFile, "mn.gov"), overwrite, verbose);
  await apply(pool, "city", [...(await lmcCities()), ...(await mnGovCities())], overwrite, verbose);

  if (pool) await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
