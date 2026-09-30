// load-state — generic, config-driven jurisdiction loader. Reads the structured
// `sources` block of packages/shared/src/conf/<state>.yaml (see the header
// comment in ma.yaml for the spec) and, for that state:
//   1. upserts the state jurisdiction, every `arcgis` source that has a
//      structured spec, and every `static` source (lists / numbered series);
//   2. derives `within`/`coextensive` relations the specs describe;
//   3. scrapes each source's `websites` directory and writes jurisdictions.website.
// Sources with no structured spec yet (most of ca.yaml) and `pending_source`
// entries are reported and skipped, never guessed at.
//
// Ingestion rules (AGENTS.md) hold throughout: rows match on
// jurisdiction_identifiers, every insert is origin='import' (via lib/upsert.ts),
// and nothing here ever writes channels.status='absent'.
//
// Usage:
//   npx tsx ingestion/load-state/run.ts <state> [--dry-run] [--skip-websites] [--only-websites]
//
//   --dry-run        fetch + transform + report; no database connection at all
//   --skip-websites  jurisdictions and relations only
//   --only-websites  just the website step, matching against rows already in the DB
//   --file <key>=<path>  read a tsv source from a local file instead of downloading it
//                    (repeatable; e.g. --file school_districts=cde.txt --file educational_region=cde.txt)
//
// The state's profile + concept_profiles rows are seeded from the YAML first
// (same as `ingestion/tools/seed-profile.ts <state>`), so no separate step.
// type_concepts itself must already exist (`govdex:seed:concepts`).
import "dotenv/config";
import fs from "node:fs";
import type { Pool } from "pg";
import { getPool } from "@govdex/db";
import { loadStateProfile } from "@govdex/shared/src/conf/profile";
import { arcgisFetchAll } from "../lib/arcgis";
import { fetchHtml, extractEntries } from "../lib/htmlExtract";
import { getConceptIds, getProfileId } from "../lib/identifiers";
import { seedProfile } from "../lib/seedProfile";
import { parseTsv } from "../lib/tsv";
import {
  buildRecord,
  dedupeRows,
  filterRows,
  normalizeName,
  sourceFields,
  staticRecords,
  type JurisdictionRecord,
  type SourceSpec,
  type WebsitesSpec,
} from "../lib/sourceSpec";
import { addIdentifier, upsertJurisdictionByIdentifier, upsertRelation } from "../lib/upsert";
import { ensureProtocol } from "../spider/urlMatch";

interface Loaded extends JurisdictionRecord {
  id: string; // "dry:<n>" under --dry-run
}

interface Ctx {
  pool: Pool | null; // null under --dry-run
  profileId: number;
  conceptIds: Record<string, number>;
  dryRun: boolean;
  seq: number;
}

function isStructured(spec: SourceSpec): boolean {
  return (spec.kind === "arcgis" || spec.kind === "tsv" || spec.kind === "static") && Boolean((spec.concept || spec.concept_from) && spec.identifiers && (spec.name || spec.kind === "static"));
}

// A scraped/column URL -> https URL, or null (no guessing) when it isn't a web link.
function webUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const url = ensureProtocol(raw);
  return /^https?:\/\/[^\s/]+\.[^\s/]+/.test(url) ? url : null;
}

async function saveRecord(ctx: Ctx, rec: JurisdictionRecord, sourceUrl?: string): Promise<Loaded> {
  if (!ctx.pool) return { ...rec, id: `dry:${++ctx.seq}` };
  const conceptId = ctx.conceptIds[rec.conceptCode];
  if (!conceptId) throw new Error(`No type_concepts row for "${rec.conceptCode}" — run govdex:seed`);
  const [first, ...rest] = rec.identifiers;
  const id = await upsertJurisdictionByIdentifier(ctx.pool, {
    scheme: first.scheme,
    value: first.value,
    name: rec.name,
    profileId: ctx.profileId,
    conceptId,
    website: webUrl(rec.website),
    attributes: rec.attributes,
    sourceUrl,
  });
  for (const extra of rest) await addIdentifier(ctx.pool, id, extra.scheme, extra.value, sourceUrl);
  return { ...rec, id };
}

// --file <sourceKey>=<path> replaces the download for that source (for a host
// that serves a captcha to scripts — CDE does, intermittently). One download
// per URL per run: CA reads the same CDE file for districts and county offices.
const fileOverrides = new Map<string, string>();
const downloads = new Map<string, Promise<string>>();

function tsvText(key: string, spec: SourceSpec): Promise<string> {
  const local = fileOverrides.get(key);
  if (local) return Promise.resolve(fs.readFileSync(local, "utf8"));
  let p = downloads.get(spec.url!);
  if (!p) {
    p = fetchHtml(spec.url!);
    downloads.set(spec.url!, p);
  }
  return p;
}

async function loadSource(ctx: Ctx, key: string, spec: SourceSpec): Promise<Loaded[]> {
  let records: JurisdictionRecord[] = [];

  if (spec.kind === "static") {
    records = staticRecords(spec);
  } else {
    let rows: Record<string, unknown>[];
    if (spec.kind === "tsv") {
      rows = parseTsv(await tsvText(key, spec), spec.null_values);
      // A bot-check or error page parses as "valid" TSV with no matching
      // columns; never let that turn into a silent empty load.
      const needed = [...sourceFields(spec), ...Object.keys(spec.filter ?? {})];
      const have = new Set(Object.keys(rows[0] ?? {}));
      const missing = needed.filter((f) => !have.has(f));
      if (missing.length) {
        throw new Error(
          `${key}: downloaded file has no column(s) ${missing.join(", ")} — got a bot-check/error page instead of the data? ` +
            `Save the file by hand and pass --file ${key}=<path>.`,
        );
      }
      if (spec.filter) rows = filterRows(rows, spec.filter);
    } else {
      rows = await arcgisFetchAll<Record<string, unknown>>(`${spec.url}/query`, sourceFields(spec));
    }
    if (spec.expected_count !== undefined && rows.length !== spec.expected_count) {
      console.warn(`  WARN ${key}: fetched ${rows.length} rows, spec expects ${spec.expected_count}`);
    }
    if (spec.dedupe_on) {
      const d = dedupeRows(rows, spec.dedupe_on);
      if (d.dropped) console.log(`  ${key}: dropped ${d.dropped} duplicate rows on ${spec.dedupe_on}`);
      rows = d.rows;
    }
    const skipped: string[] = [];
    for (const row of rows) {
      const built = buildRecord(spec, row);
      if ("skip" in built) skipped.push(built.skip);
      else records.push(built.record);
    }
    if (skipped.length) console.warn(`  WARN ${key}: skipped ${skipped.length} rows (e.g. ${skipped[0]})`);
  }

  if (spec.expected_entries !== undefined && spec.kind === "static" && records.length !== spec.expected_entries) {
    console.warn(`  WARN ${key}: ${records.length} entries, spec expects ${spec.expected_entries}`);
  }

  const loaded: Loaded[] = [];
  for (const rec of records) loaded.push(await saveRecord(ctx, rec, spec.url ?? spec.kind));
  const byConcept: Record<string, number> = {};
  for (const l of loaded) byConcept[l.conceptCode] = (byConcept[l.conceptCode] ?? 0) + 1;
  console.log(`  ${key}: ${loaded.length} ${ctx.dryRun ? "would be upserted" : "upserted"} ${JSON.stringify(byConcept)}`);
  return loaded;
}

async function relate(ctx: Ctx, from: string, to: string, relation: "within" | "overlaps" | "coextensive", coverage: "full" | "partial" = "full") {
  if (ctx.pool) await upsertRelation(ctx.pool, from, to, relation, coverage);
}

// `relations:` on a source spec — "to: state" or "to: <concept>" joined on
// `via: attributes.<key>` (same key on both sides).
async function deriveSpecRelations(ctx: Ctx, key: string, spec: SourceSpec, records: Loaded[], all: Loaded[], stateId: string | null) {
  for (const rel of spec.relations ?? []) {
    let made = 0;
    let unmatched = 0;
    if (rel.to === "state") {
      if (!stateId) continue;
      for (const r of records) {
        await relate(ctx, r.id, stateId, rel.relation, rel.coverage);
        made++;
      }
    } else if (rel.via?.startsWith("attributes.")) {
      const attr = rel.via.slice("attributes.".length);
      const targets = new Map<string, string>();
      for (const t of all) if (t.conceptCode === rel.to && t.attributes[attr] !== undefined) targets.set(String(t.attributes[attr]), t.id);
      for (const r of records) {
        const target = targets.get(String(r.attributes[attr]));
        if (target) {
          await relate(ctx, r.id, target, rel.relation, rel.coverage);
          made++;
        } else unmatched++;
      }
    }
    console.log(`  relations ${key} ${rel.relation} ${rel.to}: ${made}${unmatched ? `, ${unmatched} with no ${rel.to} match` : ""}`);
  }
}

// school_districts.district_types — the one place a name join is unavoidable
// (see the comment in ma.yaml). Every unmatched name is listed, none guessed.
async function deriveDistrictRelations(ctx: Ctx, spec: SourceSpec, districts: Loaded[], municipalities: Loaded[]) {
  const types = spec.district_types;
  if (!types) return;
  const byName = new Map(municipalities.map((m) => [normalizeName(m.name), m.id]));
  const aliases = spec.name_aliases ?? {};
  const unmatched: string[] = [];
  let made = 0;

  for (const d of districts) {
    const t = types[String(d.attributes.district_type)];
    if (!t) continue;
    if (t.members_from) {
      const members = d.attributes[t.members_from];
      for (const name of Array.isArray(members) ? (members as string[]) : []) {
        const id = byName.get(normalizeName(aliases[name] ?? name));
        if (!id) unmatched.push(`${d.name} member "${name}"`);
        else {
          await relate(ctx, id, d.id, t.relation, t.coverage ?? "full");
          made++;
        }
      }
    } else if (t.relation === "coextensive") {
      const id = byName.get(normalizeName(aliases[d.name] ?? d.name));
      if (!id) unmatched.push(`${d.name}`);
      else {
        await relate(ctx, d.id, id, "coextensive");
        made++;
      }
    }
  }
  console.log(`  relations school_districts -> municipalities: ${made}${unmatched.length ? `, ${unmatched.length} unmatched:` : ""}`);
  for (const u of unmatched) console.log(`    - ${u}`);
}

interface Target {
  id: string | null;
  name: string;
  website?: string | null;
}

async function runWebsites(ctx: Ctx, key: string, spec: SourceSpec, inMemory: Loaded[] | null) {
  const w = spec.websites as WebsitesSpec;
  console.log(`  ${key}.websites: fetching ${w.url}`);
  const entries = extractEntries(await fetchHtml(w.url), w.entry);
  if (w.expected_entries !== undefined && entries.length !== w.expected_entries) {
    console.warn(`  WARN ${key}.websites: extracted ${entries.length} entries, spec expects ${w.expected_entries}`);
  }

  // Who can receive a website: this run's records if we just loaded them,
  // otherwise whatever is already in the DB for this profile and concept(s).
  let targets: Target[];
  if (inMemory) {
    targets = inMemory.map((r) => ({ id: r.id.startsWith("dry:") ? null : r.id, name: r.name }));
  } else if (ctx.pool) {
    const concepts = spec.concept ? [spec.concept] : Object.values(spec.concept_from?.map ?? {});
    const { rows } = await ctx.pool.query<{ id: string; name: string; website: string | null }>(
      `select j.id, j.name, j.website from jurisdictions j join type_concepts tc on tc.id = j.concept_id
        where j.profile_id = $1 and tc.code = any($2)`,
      [ctx.profileId, concepts],
    );
    targets = rows;
  } else {
    console.warn(`  ${key}.websites: dry run with no records loaded this run — nothing to match against`);
    return;
  }

  const aliases = w.match?.aliases ?? {};
  const byName = new Map(targets.map((t) => [normalizeName(t.name), t]));
  const seen = new Set<string>();
  const unmatchedEntries: string[] = [];
  let matched = 0;
  let written = 0;

  for (const e of entries) {
    const norm = normalizeName(aliases[e.name] ?? e.name);
    const target = byName.get(norm);
    if (!target) {
      unmatchedEntries.push(e.name);
      continue;
    }
    if (seen.has(norm)) {
      console.warn(`  WARN ${key}.websites: duplicate directory entry "${e.name}" ignored`);
      continue;
    }
    seen.add(norm);
    matched++;

    if (!e.website) continue;
    const url = webUrl(e.website);
    if (!url) {
      console.warn(`  WARN ${key}.websites: "${e.name}" has a non-web link (${e.website}) — skipped`);
      continue;
    }
    const attrs: Record<string, unknown> = {};
    for (const a of w.attributes ?? []) if (e.fields[a] !== null && e.fields[a] !== undefined) attrs[a] = e.fields[a];

    if (ctx.pool && target.id) {
      // import-origin rows only: a scribe's manual edit is never overwritten.
      const { rowCount } = await ctx.pool.query(
        `update jurisdictions set website = $2, attributes = attributes || $3::jsonb
          where id = $1 and origin = 'import'`,
        [target.id, url, JSON.stringify(attrs)],
      );
      written += rowCount ?? 0;
    }
  }

  // Report both directions; blank is never treated as "none exists".
  const missing = targets.filter((t) => !seen.has(normalizeName(t.name))).map((t) => t.name);
  console.log(`  ${key}.websites: ${entries.length} entries, ${matched} matched, ${ctx.dryRun ? "0 written (dry run)" : `${written} written`}`);
  if (unmatchedEntries.length) console.log(`    directory entries with no jurisdiction: ${unmatchedEntries.join(", ")}`);
  if (missing.length) {
    console.log(`    jurisdictions with no directory entry (${missing.length}): ${missing.slice(0, 25).join(", ")}${missing.length > 25 ? ", …" : ""}`);
    if (w.known_missing) {
      const known = new Set(w.known_missing.map(normalizeName));
      const surprising = missing.filter((m) => !known.has(normalizeName(m)));
      const gone = w.known_missing.filter((k) => !missing.some((m) => normalizeName(m) === normalizeName(k)));
      if (surprising.length) console.warn(`  WARN ${key}.websites: not in spec known_missing: ${surprising.join(", ")}`);
      if (gone.length) console.warn(`  WARN ${key}.websites: known_missing now present in directory: ${gone.join(", ")}`);
    }
  }
}

async function main() {
  const [stateCode, ...flags] = process.argv.slice(2);
  if (!stateCode) {
    console.error("Usage: npx tsx ingestion/load-state/run.ts <state> [--dry-run] [--skip-websites] [--only-websites]");
    process.exit(1);
  }
  const dryRun = flags.includes("--dry-run");
  const skipWebsites = flags.includes("--skip-websites");
  const onlyWebsites = flags.includes("--only-websites");
  flags.forEach((f, i) => {
    if (f !== "--file") return;
    const [k, ...rest] = (flags[i + 1] ?? "").split("=");
    if (!k || rest.length === 0) throw new Error("--file expects <sourceKey>=<path>");
    fileOverrides.set(k, rest.join("="));
  });

  const { profile, sources } = loadStateProfile(stateCode);
  if (!sources) throw new Error(`${stateCode}.yaml has no sources block`);
  const specs = sources as Record<string, SourceSpec>;

  const pool = dryRun ? null : getPool();
  if (pool) {
    // Idempotent; saves a separate `seed-profile.ts <state>` step per state.
    const seeded = await seedProfile(pool, stateCode);
    console.log(`Profile ${seeded.code}: ${seeded.updated} concept_profiles upserted, ${seeded.skipped} skipped`);
  }
  const ctx: Ctx = {
    pool,
    dryRun,
    seq: 0,
    profileId: pool ? await getProfileId(pool, profile.code) : 0,
    conceptIds: pool ? await getConceptIds(pool) : {},
  };
  console.log(`${profile.code}${dryRun ? " (dry run)" : ""}`);

  const loadedBySource = new Map<string, Loaded[]>();
  const specOf = new Map<string, SourceSpec>();
  const all: Loaded[] = [];
  let stateId: string | null = null;

  if (!onlyWebsites) {
    console.log("Loading jurisdictions...");
    // Sources in document order; `state` first so county -> state can resolve.
    for (const [key, spec] of Object.entries(specs)) {
      if (key === "population" || key === "governance") continue;
      if (spec.kind === "pending_source") {
        console.log(`  ${key}: pending_source — skipped`);
        continue;
      }
      // `numbered_districts` is a group of static sub-sources, one per concept.
      const subs = key === "numbered_districts" ? Object.entries(spec as Record<string, SourceSpec>) : [[key, spec] as const];
      for (const [subKey, sub] of subs) {
        if (sub.kind === "pending_source") {
          console.log(`  ${subKey}: pending_source — skipped (no verified source yet)`);
          continue;
        }
        if (!sub.kind) continue; // e.g. `judicial_region: { status: omitted }`
        if (!isStructured(sub)) {
          if (sub.websites === undefined) console.log(`  ${subKey}: no structured spec yet — skipped`);
          continue;
        }
        const recs = key === "state" ? await loadStateSource(ctx, sub) : await loadSource(ctx, subKey, sub);
        loadedBySource.set(subKey, recs);
        specOf.set(subKey, sub);
        all.push(...recs);
        if (key === "state") stateId = recs[0]?.id ?? null;
      }
    }

    console.log("Deriving relations...");
    for (const [key, recs] of loadedBySource) {
      if (key === "state") continue;
      await deriveSpecRelations(ctx, key, specOf.get(key)!, recs, all, stateId);
    }
    const sd = specOf.get("school_districts");
    if (sd && loadedBySource.has("school_districts")) {
      const munis = all.filter((r) => r.conceptCode === "city" || r.conceptCode === "town");
      await deriveDistrictRelations(ctx, sd, loadedBySource.get("school_districts")!, munis);
    }
  }

  if (!skipWebsites) {
    console.log("Scraping website directories...");
    for (const [key, spec] of Object.entries(specs)) {
      if (!spec.websites) continue;
      await runWebsites(ctx, key, spec, loadedBySource.get(key) ?? null);
    }
  }

  if (pool) await pool.end();
}

// The `state` source is a single literal jurisdiction, not a list.
async function loadStateSource(ctx: Ctx, spec: SourceSpec): Promise<Loaded[]> {
  const rec: JurisdictionRecord = {
    conceptCode: spec.concept!,
    name: spec.name as string,
    identifiers: (spec.identifiers ?? []).filter((i) => i.value).map((i) => ({ scheme: i.scheme, value: i.value! })),
    attributes: spec.fips ? { state_fips: spec.fips } : {},
    website: null,
    row: {},
  };
  const saved = await saveRecord(ctx, rec, "yaml:sources.state");
  console.log(`  state: ${ctx.dryRun ? "would upsert" : "upserted"} ${rec.name}`);
  return [saved];
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
