import { parse } from "csv-parse/sync";
import type { ExistStatus, Scope, TransparencyRow, Visibility } from "./types";

// Sheet authors shouldn't have to remember whether a token is
// underscore_separated or space separated — collapse both (and hyphens) to
// underscores before matching against a controlled vocabulary.
function canonicalToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

const EXIST_VALUES = new Set(["published", "partial", "not_found", "higher_level", "no_mandate", "n/a"]);

// `verify` was renamed to `not_found` (with a scoring change — see types.ts)
// but existing sheet cells still say "verify", so accept it as an input
// alias rather than letting those rows silently go blank.
const EXIST_ALIASES: Record<string, ExistStatus> = { verify: "not_found" };

function normalizeExist(value: string): ExistStatus {
  const v = canonicalToken(value);
  if (EXIST_ALIASES[v]) return EXIST_ALIASES[v];
  return EXIST_VALUES.has(v) ? (v as ExistStatus) : "";
}

const SCOPE_VALUES: Record<string, Scope> = {
  "new york city": "New York City",
  "nyc": "New York City",
  "city": "New York City",
  "new york state": "New York State",
  "nys": "New York State",
  "state": "New York State",
};

function normalizeScope(value: string): Scope {
  const v = value.trim().toLowerCase();
  return SCOPE_VALUES[v] ?? (value.trim() as Scope);
}

const VISIBILITY_VALUES = new Set(["public", "restricted", "internal"]);

function normalizeVisibility(value: string): Visibility {
  const v = canonicalToken(value);
  return VISIBILITY_VALUES.has(v) ? (v as Visibility) : "";
}

const TRUTHY_VALUES = new Set(["y", "yes", "true", "1", "x"]);

function normalizeBoolean(value: string): boolean {
  return TRUTHY_VALUES.has(value.trim().toLowerCase());
}

export function parseCsvToRows(raw: string): TransparencyRow[] {
  const records: Record<string, string>[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return records
    .filter((r) => (r.domain ?? "").trim() !== "")
    .map((r) => ({
      domain: r.domain ?? "",
      metric: r.metric ?? "",
      scope: normalizeScope(r.scope ?? ""),

      exists: normalizeExist(r.exists ?? ""),
      dataset_url: r.dataset_url ?? "",
      dashboard_url: r.dashboard_url ?? "",
      dashboard_name: r.dashboard_name ?? "",
      visibility: normalizeVisibility(r.visibility ?? ""),
      provider: r.provider ?? "",
      source: r.source ?? "",
      format: r.format ?? "",
      has_map: normalizeBoolean(r.has_map ?? ""),
      has_trend: normalizeBoolean(r.has_trend ?? ""),
      has_search: normalizeBoolean(r.has_search ?? ""),
      granularity: r.granularity ?? "",
      range: r.range ?? "",
      cadence: r.cadence ?? "",
      lag: r.lag ?? "",
      legal_basis: r.legal_basis ?? "",
      notes: r.notes ?? "",

      tune: r.tune ?? "",
      who_can_tune: r.who_can_tune ?? "",
    }));
}
