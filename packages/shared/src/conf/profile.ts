// Loader for a state's locale pack (packages/shared/src/conf/<state>.yaml —
// every state has one; only ny.yaml is backed by seeded jurisdiction data so
// far). See ny.yaml's own header comment for what this file feeds: the DB
// seed (ingestion/tools/seed-profile.ts) and the spider's chief-executive
// name matching (ingestion/tools/legistar-bodies.ts).
//
// Node-only (reads a file off disk) — do not import this from client
// components; apps/web's server routes/loaders are fine.
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

// Resolved from the repo root (cwd), not import.meta.url: the production server
// is an esbuild CJS bundle (dist/index.cjs), where import.meta.url is undefined
// and the yaml files aren't next to the bundle anyway. Same convention as
// server/index.ts. Run from the repo root (tsx scripts, Docker WORKDIR /app).
const __dirname = path.resolve(process.cwd(), "packages", "shared", "src", "conf");

export interface ConceptProfile {
  local_name: string;
  local_abbrev?: string;
  parent_org_name?: string;
  has_active_government: boolean;
  default_body_name?: string;
  executive_title?: string;
  executive_required?: boolean;
  // The label for this concept's "Subdivisions" section on the entity page
  // (e.g. county: "Cities, Towns, Villages"), or `false` when a concept
  // never has any (city/town/village) so the section shouldn't show at all.
  // Omitted (undefined) falls back to showing a generic "Subdivisions".
  subdivisions?: string | false;
  // Extra sections that pull specific jurisdictions (matched by
  // jurisdictions.name) out of the main `subdivisions` list into their own
  // section — keyed by section id, humanized into a label (major_cities ->
  // "Major Cities"). Value is one name or a list of names.
  additional_subdivisions?: Record<string, string | string[]>;
  legislative_committees?: boolean;
  committees_label?: string;
  governance?: string | string[];
  // Named exceptions to the concept's default governance form (`governance`
  // above, or its first entry when a list) — e.g. CA cities default to
  // council-manager, but Los Angeles, San Francisco, San Diego, Oakland and
  // Fresno use strong-mayor instead. Keyed by governance entry name, value
  // is the jurisdictions that use it, matched against jurisdictions.name
  // exactly — same convention as additional_subdivisions.
  governance_exceptions?: Record<string, string[]>;
}

export interface AdditionalSubdivisionSection {
  label: string;
  names: string[];
}

export interface GovernanceEntry {
  legislative_committees: boolean;
  committees_label?: string;
}

export interface StateProfile {
  profile: {
    code: string;
    name: string;
    config: Record<string, unknown>;
  };
  concepts: Record<string, ConceptProfile>;
  governance: Record<string, GovernanceEntry>;
  // Documentary only — not read by loadStateProfile or any ingestion script.
  // Where this state's jurisdiction data actually comes from (or should,
  // for a state with no ingestion script yet) and how source fields map
  // onto our schema, so a future ingestion script isn't written from
  // scratch. See ny.yaml's `sources` block for the field shape in use.
  sources?: Record<string, unknown>;
}

const cache = new Map<string, StateProfile>();

export function loadStateProfile(stateCode: string): StateProfile {
  const cached = cache.get(stateCode);
  if (cached) return cached;

  const raw = fs.readFileSync(path.resolve(__dirname, `${stateCode}.yaml`), "utf-8");
  const profile = yaml.load(raw) as StateProfile;
  cache.set(stateCode, profile);
  return profile;
}

// Every state code with a locale pack on disk (uppercase USPS abbreviation),
// regardless of whether it has any seeded jurisdiction data yet — see
// apps/api/src/routes/conf.ts's "/conf" list route and the home page's US
// map (apps/web/components/UsMap.tsx), which link an unseeded-but-configured
// state to its /conf review page instead of leaving it dead.
export function listConfiguredStateCodes(): string[] {
  return fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, "").toUpperCase())
    .sort();
}

// The governance entry that applies to a concept, for a specific named
// jurisdiction when given. Checks `governance_exceptions` for a name match
// first (e.g. "Los Angeles" -> strong-mayor), then falls back to a
// multi-valued `governance` list's first entry — still a guess where no
// exception is recorded for that jurisdiction.
export function governanceForConcept(profile: StateProfile, conceptCode: string, jurisdictionName?: string): GovernanceEntry | null {
  const concept = profile.concepts[conceptCode];
  if (!concept) return null;
  if (concept.legislative_committees !== undefined) {
    return { legislative_committees: concept.legislative_committees, committees_label: concept.committees_label };
  }
  if (!concept.governance) return null;

  let governanceKey = Array.isArray(concept.governance) ? concept.governance[0] : concept.governance;
  if (jurisdictionName && concept.governance_exceptions) {
    for (const [key, names] of Object.entries(concept.governance_exceptions)) {
      if (names.includes(jurisdictionName)) {
        governanceKey = key;
        break;
      }
    }
  }
  return profile.governance[governanceKey] ?? null;
}

// All concepts' executive_title values, for building a chief-executive
// name-matching pattern (see ingestion/tools/legistar-bodies.ts).
export function executiveTitles(profile: StateProfile): string[] {
  return Object.values(profile.concepts)
    .map((c) => c.executive_title)
    .filter((t): t is string => Boolean(t));
}

// Whether a concept's "Subdivisions" section should show on the entity
// page, and what to label it — see ConceptProfile.subdivisions above.
export function subdivisionsForConcept(profile: StateProfile, conceptCode: string): { show: boolean; label: string } {
  const value = profile.concepts[conceptCode]?.subdivisions;
  if (value === false) return { show: false, label: "" };
  return { show: true, label: value || "Subdivisions" };
}

// A concept's additional_subdivisions sections, each naming which
// jurisdictions (by exact name) to pull out of the main subdivisions list —
// see ConceptProfile.additional_subdivisions above.
export function additionalSubdivisionSections(profile: StateProfile, conceptCode: string): AdditionalSubdivisionSection[] {
  const raw = profile.concepts[conceptCode]?.additional_subdivisions;
  if (!raw) return [];
  return Object.entries(raw).map(([key, value]) => ({
    label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    names: Array.isArray(value) ? value : [value],
  }));
}
