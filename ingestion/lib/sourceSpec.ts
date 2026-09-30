// Pure helpers for the generic state loader (ingestion/load-state/run.ts):
// the shape of a `sources.*` block in packages/shared/src/conf/<state>.yaml and
// the row -> record transforms it describes. No I/O here so it can be unit
// tested — see sourceSpec.test.ts. The YAML header comment (ma.yaml) is the
// reference for what each key means.

export type Coercion = "string" | "number" | "comma_list" | "date_us";
// strip_suffix / prefix apply to the coerced string, in that order (e.g.
// "San Bernardino County" -> "San Bernardino"; "051" -> "06051").
export type FieldRef = string | { field: string; as?: Coercion; strip_suffix?: string; prefix?: string };

export interface NameSpec {
  field: string;
  transform?: "title_case" | "as_is";
  lowercase_words?: string[];
}

export interface IdentifierSpec {
  scheme: string;
  field?: FieldRef; // source field holding the value (may carry prefix/strip_suffix)
  value?: string; // static: a literal value
  derive?: "slug_of_name" | "number" | "official_name";
}

export interface RelationSpec {
  relation: "within" | "overlaps" | "coextensive";
  to: string; // "state" or a concept code ("county")
  via?: string; // "attributes.county_fips" — join key present on both sides
  coverage?: "full" | "partial"; // default full
}

export interface DistrictTypeSpec {
  relation: "within" | "overlaps" | "coextensive";
  // coextensive: district <-> the municipality with the same normalized name.
  // within + members_from: each municipality named in that attribute is `within` the district.
  members_from?: string;
  coverage?: "full" | "partial";
}

export interface WebsitesSpec {
  kind: "html_scrape";
  url: string;
  // `container` (optional): only the FIRST element matching it is searched.
  // `rows`: selector for one entry. Each field is a selector, optionally
  // "sel@attr" (empty sel = the row itself), or { select, as }.
  entry: { container?: string; rows: string; fields: Record<string, string | { select: string; as?: Coercion }> };
  attributes?: string[]; // entry field keys stored in jurisdictions.attributes
  match?: { aliases?: Record<string, string> };
  expected_entries?: number;
  known_missing?: string[];
}

export interface SourceSpec {
  kind?: string;
  url?: string;
  concept?: string;
  concept_from?: { field: string; map: Record<string, string> };
  name?: NameSpec | string;
  identifiers?: IdentifierSpec[];
  attributes?: Record<string, FieldRef> | string[];
  relations?: RelationSpec[];
  district_types?: Record<string, DistrictTypeSpec>;
  // by transformed name: a row whose source type field is wrong or ambiguous
  concept_overrides?: Record<string, string>;
  // by transformed name: the source's name is a short/wrong form of the real one
  name_overrides?: Record<string, string>;
  // district_types joins: a name as written in another field -> the municipality's name
  name_aliases?: Record<string, string>;
  // a url/host column on the source itself (CDE's WebSite); directories go in `websites`
  website?: FieldRef;
  // keep the first row per value of this source field (polygons split across features)
  dedupe_on?: string;
  // tsv sources: keep rows whose field equals one of the listed values (null = blank)
  filter?: Record<string, string | string[] | null>;
  null_values?: string[];
  expected_count?: number;
  expected_entries?: number;
  // static
  entries?: string[];
  count?: number;
  label?: string;
  fips?: string;
  websites?: WebsitesSpec;
}

export function titleCase(s: string, lowercaseWords: string[] = []): string {
  const keep = new Set(lowercaseWords.map((w) => w.toLowerCase()));
  return s
    .toLowerCase()
    .split(/([\s-]+)/)
    .map((tok, i) => (/^[\s-]+$/.test(tok) || (i > 0 && keep.has(tok)) ? tok : tok.charAt(0).toUpperCase() + tok.slice(1)))
    .join("");
}

// Lowercase, strip diacritics, drop every non-letter — the one rule every
// name-to-name join uses ("Mt. Shasta" never equals "Mount Shasta"; that is what
// `aliases` are for).
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function slugOf(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// With no `as`, numbers pass through as numbers and everything else is a
// trimmed string; `as: string` forces a string (e.g. an integer FIPS code).
export function coerce(value: unknown, as?: Coercion): unknown {
  if (value === undefined || value === null) return null;
  if (as === undefined && typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (text === "") return null;
  switch (as) {
    case "number": {
      const n = Number(text.replace(/,/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    case "comma_list":
      return text
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
    case "date_us": {
      const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
    }
    default:
      return text;
  }
}

export function readField(row: Record<string, unknown>, ref: FieldRef): unknown {
  if (typeof ref === "string") return coerce(row[ref]);
  let v = coerce(row[ref.field], ref.as);
  if (typeof v === "string") {
    if (ref.strip_suffix && v.endsWith(ref.strip_suffix)) v = v.slice(0, -ref.strip_suffix.length).trimEnd();
    if (ref.prefix) v = ref.prefix + v;
  }
  return v;
}

export function dedupeRows<T extends Record<string, unknown>>(rows: T[], field: string): { rows: T[]; dropped: number } {
  const seen = new Set<string>();
  const kept = rows.filter((r) => {
    const k = String(r[field]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { rows: kept, dropped: rows.length - kept.length };
}

// A row passes when, for every filter key, its value (null for blank) is one
// of the allowed values. `null` in the filter means "must be blank".
export function filterRows<T extends Record<string, unknown>>(rows: T[], filter: Record<string, string | string[] | null>): T[] {
  const tests = Object.entries(filter).map(([k, allowed]) => {
    const set = new Set((Array.isArray(allowed) ? allowed : [allowed]).map((a) => (a === null ? null : String(a))));
    return (r: T) => set.has(r[k] == null ? null : String(r[k]));
  });
  return rows.filter((r) => tests.every((t) => t(r)));
}

export interface JurisdictionRecord {
  conceptCode: string;
  name: string;
  identifiers: { scheme: string; value: string }[];
  attributes: Record<string, unknown>;
  website: string | null; // raw value from spec.website; the runner normalizes it
  // the raw source row, kept for relation steps (e.g. DISTRICT_TYPE)
  row: Record<string, unknown>;
}

export function conceptFor(spec: SourceSpec, row: Record<string, unknown>): string | null {
  if (spec.concept) return spec.concept;
  if (spec.concept_from) {
    const v = row[spec.concept_from.field];
    return (v != null && spec.concept_from.map[String(v).trim()]) || null;
  }
  return null;
}

export function nameFor(spec: SourceSpec, row: Record<string, unknown>): string | null {
  const n: NameSpec = typeof spec.name === "string" ? { field: spec.name } : (spec.name as NameSpec);
  const raw = coerce(row[n.field]);
  if (typeof raw !== "string") return null;
  const out = n.transform === "title_case" ? titleCase(raw, n.lowercase_words) : raw;
  return spec.name_overrides?.[out] ?? out;
}

// Every source field a spec reads, for the ArcGIS `outFields` parameter.
export function sourceFields(spec: SourceSpec): string[] {
  const fields = new Set<string>();
  if (spec.concept_from) fields.add(spec.concept_from.field);
  if (spec.name) fields.add(typeof spec.name === "string" ? spec.name : spec.name.field);
  for (const id of spec.identifiers ?? []) if (id.field) fields.add(typeof id.field === "string" ? id.field : id.field.field);
  if (spec.attributes && !Array.isArray(spec.attributes)) {
    for (const ref of Object.values(spec.attributes)) fields.add(typeof ref === "string" ? ref : ref.field);
  }
  if (spec.website) fields.add(typeof spec.website === "string" ? spec.website : spec.website.field);
  if (spec.dedupe_on) fields.add(spec.dedupe_on);
  return [...fields];
}

// One source row -> a record, or a reason it was skipped.
export function buildRecord(spec: SourceSpec, row: Record<string, unknown>): { record: JurisdictionRecord } | { skip: string } {
  const name = nameFor(spec, row);
  if (!name) return { skip: "missing name" };
  const conceptCode = spec.concept_overrides?.[name] ?? conceptFor(spec, row);
  if (!conceptCode) return { skip: `no concept for ${JSON.stringify(spec.concept_from ? row[spec.concept_from.field] : null)}` };

  const identifiers: { scheme: string; value: string }[] = [];
  for (const id of spec.identifiers ?? []) {
    const v = id.field ? readField(row, id.field) : (id.value ?? null);
    if (v !== null) identifiers.push({ scheme: id.scheme, value: String(v) });
  }
  if (identifiers.length === 0) return { skip: `no identifier for ${name}` };

  const attributes: Record<string, unknown> = {};
  if (spec.attributes && !Array.isArray(spec.attributes)) {
    for (const [key, ref] of Object.entries(spec.attributes)) {
      const v = readField(row, ref);
      if (v !== null) attributes[key] = v;
    }
  }
  const w = spec.website ? readField(row, spec.website) : null;
  return { record: { conceptCode, name, identifiers, attributes, website: typeof w === "string" ? w : null, row } };
}

// Static sources: a literal `entries` list (slug identifiers) or a numbered
// series (`count` + `label`). Returns [] for anything else.
export function staticRecords(spec: SourceSpec): JurisdictionRecord[] {
  const concept = spec.concept;
  if (!concept) return [];
  const idSpec = spec.identifiers?.[0];
  if (!idSpec) return [];

  if (spec.entries) {
    return spec.entries.map((name) => ({
      conceptCode: concept,
      name,
      identifiers: [{ scheme: idSpec.scheme, value: slugOf(name) }],
      attributes: {},
      website: null,
      row: {},
    }));
  }
  if (spec.count && idSpec.derive === "number") {
    const label = spec.label ?? "{n}";
    return Array.from({ length: spec.count }, (_, i) => {
      const n = i + 1;
      return {
        conceptCode: concept,
        name: label.replace("{n}", String(n)),
        identifiers: [{ scheme: idSpec.scheme, value: String(n) }],
        attributes: { district_number: n },
        website: null,
        row: {},
      };
    });
  }
  return [];
}
