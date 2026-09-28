// Cross-jurisdiction relation determinant (scorecard-spec.md §8).
// Computes `relation` and `adequacy` for one domain from the per-jurisdiction
// scores already produced by assess.ts. No authored-override branch is wired
// here yet (§8.1's override short-circuit) — there is no sheet column or
// overrides file to source `divergent`/`thirdParty`/manual relation from.

import type { Adequacy, AssessedRow, Assessment, FacetResult, RelationCode } from "../types";
import { cadenceDays, lagDays } from "./cadence";

export interface FacetOutcome {
  result: FacetResult;
  reviewFlag?: string;
}

const GRANULARITY_RANK: Record<string, number> = { point: 2, area: 1 };

export function compareGranularity(city: AssessedRow, state: AssessedRow): FacetOutcome {
  const c = city.assessment;
  const s = state.assessment;
  const rc = c.granularity ? GRANULARITY_RANK[c.granularity] : undefined;
  const rs = s.granularity ? GRANULARITY_RANK[s.granularity] : undefined;

  if (rc === undefined || rs === undefined) {
    return { result: "TIE", reviewFlag: "granularity not resolvable for one or both jurisdictions" };
  }
  if (rc !== rs) return { result: rc > rs ? "CITY" : "STATE" };

  if (c.granularityLabel.trim().toLowerCase() !== s.granularityLabel.trim().toLowerCase()) {
    return {
      result: "TIE",
      reviewFlag: `same granularity tier but labels differ: "${c.granularityLabel}" vs "${s.granularityLabel}"`,
    };
  }
  return { result: "TIE" };
}

export function compareTimeliness(city: AssessedRow, state: AssessedRow): FacetOutcome {
  const cc = cadenceDays(city.row.cadence);
  const cs = cadenceDays(state.row.cadence);

  if (cc === null || cs === null) {
    return { result: "TIE", reviewFlag: "cadence not parseable for one or both jurisdictions" };
  }
  if (cc !== cs) return { result: cc < cs ? "CITY" : "STATE" };

  const lc = lagDays(city.row.lag);
  const ls = lagDays(state.row.lag);
  if (lc === null || ls === null || lc === ls) return { result: "TIE" };
  return { result: lc < ls ? "CITY" : "STATE" };
}

export function compareMap(city: AssessedRow, state: AssessedRow): FacetOutcome {
  const { hasMap: c } = city.assessment;
  const { hasMap: s } = state.assessment;
  if (c === s) return { result: "TIE" };
  return { result: c ? "CITY" : "STATE" };
}

export function compareTrend(city: AssessedRow, state: AssessedRow): FacetOutcome {
  const { hasTrend: c } = city.assessment;
  const { hasTrend: s } = state.assessment;
  if (c === s) return { result: "TIE" };
  return { result: c ? "CITY" : "STATE" };
}

function collected(availability: Assessment["availability"]): boolean | null {
  if (availability === "collected") return true;
  if (availability === "not_collected") return false;
  return null;
}

// Returns a settled relation when it can be determined without facet
// comparison, or `undefined` when both sides are collected and the caller
// should proceed to facet comparison (§8.2/§8.3).
function provisionGate(city: Assessment, state: Assessment): RelationCode | undefined {
  const c = collected(city.availability);
  const s = collected(state.availability);
  if (c === null || s === null) return null;
  if (!c && !s) return "neither";
  if (c && !s) return "city_only";
  if (!c && s) return "state_only";
  return undefined;
}

// Access gate: a publicly reachable dataset always beats a restricted one,
// regardless of how the other facets compare — a richer dashboard nobody
// outside government can open doesn't out-transparency a plainer public one.
// Runs after provisionGate (both sides already collected) and before facet
// comparison, so it overrides rather than merely counting as one vote.
function visibilityGate(city: AssessedRow, state: AssessedRow): RelationCode | undefined {
  const c = city.row.visibility;
  const s = state.row.visibility;
  if (c === "public" && s === "restricted") return "city_superior";
  if (s === "public" && c === "restricted") return "state_superior";
  return undefined;
}

function isGovernmentCollected(ar: AssessedRow | undefined): boolean {
  return ar ? collected(ar.assessment.availability) === true : false;
}

// A third-party row beats its own jurisdiction's government row either by
// showing up where government has nothing at all, or — government can be
// collected and still lose — by out-facet-ing it (e.g. having a map
// government's own dashboard lacks). Reuses the same four facet comparators
// as the city/state vote below; the third-party row plays the "city" slot
// since those functions only care about winner-vs-loser; who's who is
// irrelevant to them.
function thirdPartyBeatsGovernment(gov: AssessedRow | undefined, tp: AssessedRow): boolean {
  if (collected(tp.assessment.availability) !== true) return false;
  if (!isGovernmentCollected(gov)) return true;

  const facets = [
    compareGranularity(tp, gov!),
    compareTimeliness(tp, gov!),
    compareMap(tp, gov!),
    compareTrend(tp, gov!),
  ];
  const wins = facets.filter((f) => f.result === "CITY").length;
  const losses = facets.filter((f) => f.result === "STATE").length;
  return wins > losses;
}

// Third-party gate: a third-party row that beats its own jurisdiction's
// government row (see above) becomes the finding for the whole metric —
// its own relation ("government is not the source") rather than folded into
// the government-vs-government facet vote below. Sheets are expected to
// carry more than one third-party row per metric over time; the first one
// that wins its jurisdiction is used, there's no ranking among third
// parties yet.
function thirdPartyGate(
  city: AssessedRow | undefined,
  state: AssessedRow | undefined,
  thirdParty: AssessedRow[],
): "city" | "state" | undefined {
  if (thirdParty.some((ar) => ar.row.scope === "New York City" && thirdPartyBeatsGovernment(city, ar))) return "city";
  if (thirdParty.some((ar) => ar.row.scope === "New York State" && thirdPartyBeatsGovernment(state, ar))) return "state";
  return undefined;
}

export function computeRelation(
  city: AssessedRow | undefined,
  state: AssessedRow | undefined,
  thirdParty: AssessedRow[] = [],
): { relation: RelationCode; thirdPartySource: "city" | "state" | null; reviewFlags: string[] } {
  const tpSource = thirdPartyGate(city, state, thirdParty);
  if (tpSource) return { relation: "third_party", thirdPartySource: tpSource, reviewFlags: [] };

  if (!city || !state) return { relation: null, thirdPartySource: null, reviewFlags: [] };

  const gate = provisionGate(city.assessment, state.assessment);
  if (gate !== undefined) return { relation: gate, thirdPartySource: null, reviewFlags: [] };

  const visGate = visibilityGate(city, state);
  if (visGate !== undefined) return { relation: visGate, thirdPartySource: null, reviewFlags: [] };

  const facets = [
    compareGranularity(city, state),
    compareTimeliness(city, state),
    compareMap(city, state),
    compareTrend(city, state),
  ];
  const reviewFlags = facets.flatMap((f) => (f.reviewFlag ? [f.reviewFlag] : []));

  const wC = facets.filter((f) => f.result === "CITY").length;
  const wS = facets.filter((f) => f.result === "STATE").length;

  let relation: RelationCode;
  if (wC && !wS) relation = "city_superior";
  else if (wS && !wC) relation = "state_superior";
  else if (wC && wS) relation = "traded";
  else relation = "parallel_equivalent";

  return { relation, thirdPartySource: null, reviewFlags };
}

// Placeholder for the per-domain threshold called for in §8.5 ("The threshold
// is per-domain ... and lives beside the domain, not in this function").
// There is no per-domain threshold data yet, so one constant stands in for
// every domain until that authoring surface exists.
export const DEFAULT_ADEQUACY_THRESHOLD_DAYS = 91;

function clearsDefaultThreshold(ar: AssessedRow): boolean {
  const days = cadenceDays(ar.row.cadence);
  const cadenceOk = days !== null && days <= DEFAULT_ADEQUACY_THRESHOLD_DAYS;
  const grainOk = ar.assessment.granularity !== null;
  return cadenceOk && grainOk;
}

export function computeAdequacy(relation: RelationCode, city: AssessedRow | undefined, state: AssessedRow | undefined): Adequacy {
  switch (relation) {
    case "neither":
    case "third_party":
    case "city_divergent":
    case "city_only":
    case "city_superior":
    case "traded":
      return "finding";
    case "state_only":
    case "state_superior":
    case "parallel_equivalent":
      return state && clearsDefaultThreshold(state) ? "sufficient" : "finding";
    default:
      return null;
  }
}

const STATE_INADEQUATE_RELATIONS = new Set<RelationCode>([
  "city_only",
  "city_superior",
  "traded",
  "city_divergent",
  "third_party",
]);

export function isStateInadequate(relation: RelationCode, adequacy: Adequacy): boolean {
  if (relation && STATE_INADEQUATE_RELATIONS.has(relation)) return true;
  return (relation === "state_only" || relation === "parallel_equivalent") && adequacy === "finding";
}
