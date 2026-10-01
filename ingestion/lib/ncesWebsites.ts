import fs from "node:fs";
import type { Pool } from "pg";
import { ensureProtocol } from "../spider/urlMatch";
import { addIdentifier } from "./upsert";

// NCES CCD district directory -> school-district jurisdictions. Fills in
// `jurisdictions.website` and records the NCES LEAID as a jurisdiction
// identifier (scheme 'nces_leaid'), so later runs match on the identifier and
// the name join below only has to succeed once per district.
//
// Name matching is the bootstrap step only (AGENTS.md: match on identifiers,
// never names, once an identifier exists). Two tiers, both case-insensitive,
// and a match is only accepted when it is unique on BOTH sides — an ambiguous
// name is reported, never guessed:
//   exact      lowercase/trimmed names are equal (CA, MA load this way)
//   normalized abbreviations expanded (NYSED style "Csd"/"Ufsd"/"Nyc Geog
//              Dist"), generic district-type words dropped, so
//              "Kinderhook Csd" ~ "KINDERHOOK CENTRAL SCHOOL DISTRICT"
// What this does NOT do: attach a district to municipalities. That is a
// separate boundary-overlap pass (t03+).

export const NCES_SCHEME = "nces_leaid";
export const DEFAULT_NCES_CSV = "local/NCES_regular_districts.csv";

export interface NcesDistrict {
  leaid: string;
  name: string;
  state: string;
  website: string | null;
  city: string;
  students: number | null;
}

// RFC-4180 enough for the CCD export (quoted fields, "" escapes, CRLF).
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

function webUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const url = ensureProtocol(raw);
  return /^https?:\/\/[^\s/]+\.[^\s/]+/.test(url) ? url : null;
}

export function loadNcesDistricts(csvPath: string, state: string): NcesDistrict[] {
  const st = state.toUpperCase();
  return parseCsv(fs.readFileSync(csvPath, "utf8"))
    .filter((r) => r.state.toUpperCase() === st)
    .map((r) => ({
      leaid: r.nces_leaid,
      name: r.district_name,
      state: r.state,
      website: webUrl(r.website),
      city: r.city,
      students: r.student_count ? Number(r.student_count) : null,
    }));
}

const exactKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// Multi-word phrases first, then single-token abbreviations.
const PHRASES: [RegExp, string][] = [
  [/\bunion free\b/g, "ufsd"],
  [/\bcentral (high )?school\b/g, "csd"],
  // "common school district" is a distinct type from UFSD/city (Tuckahoe and
  // Glens Falls each have both), so it stays as an identity token.
  [/\b(comn|common)\b/g, "commonsd"],
  [/\bcity school\b/g, "citysd"],
  [/\bunified school\b/g, "unified"],
  [/\bschool district\b/g, "sd"],
  [/\bschools?\b/g, "sd"],
  [/\bst\b/g, "saint"],
  [/\bmt\b/g, "mount"],
];
// Generic district-type words that carry no identity.
const DROP = new Set(["sd", "csd", "ufsd", "citysd", "district", "dist", "city", "unified", "public", "of", "the", "school", "schools", "cs", "usd", "isd"]);

export function normalizedKey(s: string): string {
  let t = s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[.,']/g, "");
  // NYC geographic districts: "nyc geog dist #23 - brooklyn" and
  // "new york city geographic district #23" both reduce to the number.
  const nyc = t.match(/\b(?:nyc|new york city)\b.*?(?:#|no|number)\s*(\d+)/);
  if (nyc) return `nyc geog ${Number(nyc[1])}`;
  t = t.replace(/[-–/]/g, " ");
  for (const [re, rep] of PHRASES) t = t.replace(re, rep);
  return t
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !DROP.has(w))
    .join(" ");
}

export interface DbDistrict {
  id: string;
  name: string;
  website: string | null;
  origin: string;
}

export interface NcesMatch {
  nces: NcesDistrict;
  db: DbDistrict;
  how: "identifier" | "exact" | "normalized";
}

export interface MatchResult {
  matches: NcesMatch[];
  unmatchedNces: NcesDistrict[];
  unmatchedDb: DbDistrict[];
  ambiguous: { nces: NcesDistrict; candidates: DbDistrict[] }[];
}

// key -> item, or null when two items share the key (a collision).
function uniqueIndex<T>(items: T[], key: (t: T) => string): Map<string, T | null> {
  const m = new Map<string, T | null>();
  for (const it of items) {
    const k = key(it);
    m.set(k, m.has(k) ? null : it);
  }
  return m;
}

// Pure: no DB, no writes. `byIdentifier` maps leaid -> jurisdiction id for
// districts that already carry an nces_leaid identifier.
export function matchDistricts(nces: NcesDistrict[], db: DbDistrict[], byIdentifier: Map<string, string> = new Map()): MatchResult {
  const matches: NcesMatch[] = [];
  const dbById = new Map(db.map((d) => [d.id, d]));
  const usedDb = new Set<string>();
  let left: NcesDistrict[] = [];

  for (const n of nces) {
    const id = byIdentifier.get(n.leaid);
    const d = id ? dbById.get(id) : undefined;
    if (d && !usedDb.has(d.id)) {
      matches.push({ nces: n, db: d, how: "identifier" });
      usedDb.add(d.id);
    } else left.push(n);
  }

  for (const [how, key] of [
    ["exact", exactKey],
    ["normalized", normalizedKey],
  ] as const) {
    const dbIdx = uniqueIndex(
      db.filter((d) => !usedDb.has(d.id)),
      (d) => key(d.name),
    );
    const ncesIdx = uniqueIndex(left, (n) => key(n.name));
    const next: NcesDistrict[] = [];
    for (const n of left) {
      const k = key(n.name);
      const cand = k ? dbIdx.get(k) : undefined;
      if (cand && ncesIdx.get(k) === n) {
        matches.push({ nces: n, db: cand, how });
        usedDb.add(cand.id);
      } else next.push(n);
    }
    left = next;
  }

  // Whatever is left but shares a normalized name with something is ambiguous
  // (a collision on one side or the other) — surfaced for a human, not guessed.
  const ambiguous: MatchResult["ambiguous"] = [];
  const unmatchedNces: NcesDistrict[] = [];
  const freeDb = db.filter((d) => !usedDb.has(d.id));
  for (const n of left) {
    const k = normalizedKey(n.name);
    const candidates = k ? freeDb.filter((d) => normalizedKey(d.name) === k) : [];
    if (candidates.length) ambiguous.push({ nces: n, candidates });
    else unmatchedNces.push(n);
  }

  return { matches, unmatchedNces, unmatchedDb: freeDb, ambiguous };
}

export async function loadDbDistricts(pool: Pool, state: string) {
  const profile = `US-${state.toUpperCase()}`;
  const { rows } = await pool.query<DbDistrict>(
    `select j.id, j.name, j.website, j.origin
       from jurisdictions j
       join profiles p on p.id = j.profile_id
       join type_concepts c on c.id = j.concept_id
      where c.code = 'school_district' and p.code = $1`,
    [profile],
  );
  const ids = await pool.query<{ value: string; jurisdiction_id: string }>(
    `select ji.value, ji.jurisdiction_id from jurisdiction_identifiers ji
       join jurisdictions j on j.id = ji.jurisdiction_id
       join profiles p on p.id = j.profile_id
      where ji.scheme = $1 and p.code = $2`,
    [NCES_SCHEME, profile],
  );
  return { db: rows, byIdentifier: new Map(ids.rows.map((r) => [r.value, r.jurisdiction_id])) };
}

export interface ApplyOptions {
  dryRun?: boolean;
  overwrite?: boolean; // replace an existing website (default: fill only when null)
}

export interface ApplyResult extends MatchResult {
  websitesWritten: number;
  identifiersAdded: number;
  skippedManual: number;
}

// Extract one state's districts from the NCES CSV, match them to our
// school_district jurisdictions, record the NCES id, and set the website.
// Import-origin rows only: a scribe-edited row (origin='manual') is never
// overwritten (same guard as upsert.ts / seed-website.ts).
export async function applyNcesWebsites(pool: Pool, state: string, csvPath = DEFAULT_NCES_CSV, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const nces = loadNcesDistricts(csvPath, state);
  const { db, byIdentifier } = await loadDbDistricts(pool, state);
  const result = matchDistricts(nces, db, byIdentifier);

  let websitesWritten = 0;
  let identifiersAdded = 0;
  let skippedManual = 0;
  if (!opts.dryRun) {
    for (const m of result.matches) {
      if (m.how !== "identifier") {
        await addIdentifier(pool, m.db.id, NCES_SCHEME, m.nces.leaid, "https://nces.ed.gov/ccd/files.asp");
        identifiersAdded++;
      }
      if (!m.nces.website) continue;
      if (m.db.origin !== "import") {
        skippedManual++;
        continue;
      }
      if (m.db.website && !opts.overwrite) continue;
      const r = await pool.query(`update jurisdictions set website = $2 where id = $1 and origin = 'import'`, [m.db.id, m.nces.website]);
      websitesWritten += r.rowCount ?? 0;
    }
  }
  return { ...result, websitesWritten, identifiersAdded, skippedManual };
}
