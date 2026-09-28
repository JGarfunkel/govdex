// "n/a" used to mean two different things: (a) this jurisdiction doesn't
// collect it because the state does, and (b) neither jurisdiction collects
// it because there's no requirement to. Split into `higher_level` /
// `no_mandate` so the reason is legible on the row itself. Bare `n/a` still
// parses (unmigrated rows), but means "not collected, reason unspecified" —
// prefer the specific value going forward.
//
// `higher_level` is directional: state is the higher level relative to
// city, so it's meant for a City row saying "the state has this." It
// doesn't have a matching "lower_level" for a State row deferring to a
// city-only dataset — that's a different situation (out of scope for the
// state entirely, not "collected elsewhere") and isn't represented yet.
// `verify` was renamed to `not_found` and its scoring changed: it used to
// count as availability="collected" (provisional credit pending
// confirmation); `not_found` counts as "not_collected" instead, since the
// label now says the search came up empty rather than "probably there, just
// unconfirmed." `verify` is still accepted as a legacy input alias for
// `not_found` (see parse-rows.ts) so existing sheet cells keep working, but
// it's not a distinct value going forward.
export type ExistStatus =
  | "published"
  | "partial"
  | "not_found"
  | "higher_level"
  | "no_mandate"
  | "n/a"
  | "";

export type Scope = "New York City" | "New York State";

// Who the published dashboard/dataset is actually reachable by — distinct
// from `exists`, which asks whether government collects/releases the data
// at all. A row can be "published" and still be "restricted" (e.g. NYSDOT's
// crash dashboard, visible only to logged-in employees/contractors).
export type Visibility = "public" | "restricted" | "internal" | "";

export interface TransparencyRow {
  domain: string;
  metric: string;
  scope: Scope;

  exists: ExistStatus;
  dataset_url: string;
  dashboard_url: string;
  dashboard_name: string;
  visibility: Visibility;
  provider: string;
  source: string;
  format: string;
  has_map: boolean;
  has_trend: boolean;
  has_search: boolean;
  granularity: string;
  range: string;
  cadence: string;
  lag: string;
  legal_basis: string;
  notes: string;

  tune: string;
  who_can_tune: string;
}

export type Availability = "collected" | "not_collected" | null;
export type Granularity = "point" | "area" | null;
export type Timeliness = "current" | "lagging" | null;

export interface Assessment {
  availability: Availability;
  hasDashboard: boolean;
  hasMap: boolean;
  hasTrend: boolean;
  hasSearch: boolean;
  granularity: Granularity;
  granularityLabel: string;
  timeliness: Timeliness;
  timelinessLabel: string;
}

export interface AssessedRow {
  row: TransparencyRow;
  assessment: Assessment;
}

export interface Snapshot {
  sourceHash: string;
  fetchedAt: string;
  rows: TransparencyRow[];
}

export type RelationCode =
  | "neither"
  | "state_only"
  | "city_only"
  | "parallel_equivalent"
  | "city_superior"
  | "state_superior"
  | "traded"
  | "city_divergent"
  | "third_party"
  | null;

export type Adequacy = "finding" | "sufficient" | "out_of_scope" | null;

export type FacetResult = "CITY" | "STATE" | "TIE";

export interface DomainEntry {
  category: string;
  domain: string;
  city?: AssessedRow;
  state?: AssessedRow;
  thirdParty: AssessedRow[];
  thirdPartySource: "city" | "state" | null;
  relation: RelationCode;
  adequacy: Adequacy;
  reviewFlags: string[];
  stateInadequate: boolean;
}
