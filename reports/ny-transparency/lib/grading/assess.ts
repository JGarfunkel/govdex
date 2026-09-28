import type { Assessment, Availability, Granularity, Timeliness, TransparencyRow } from "../types";

// Heuristics derived from free-text sheet columns. First-draft keyword lists,
// expected to be recalibrated against known examples as the sheet grows.
// (has_map/has_trend/has_search are authored directly on the sheet, not
// inferred here — see spreadsheet-guide.md.)

const POINT_GRANULARITY_KEYWORDS = [
  "incident", "case", "complaint", "transaction", "record", "employee",
  "arrest", "ticket", "crash", "request-level", "application-level",
  "facility", "precinct", "district", "building", "contract", "payment",
  "tax lot", "parcel", "establishment", "lot", "street"
];

const AREA_GRANULARITY_KEYWORDS = ["county", "borough", "statewide", "aggregate", "state", "district-level"];

const CURRENT_TIMELINESS_KEYWORDS = ["short", "day", "days", "week", "weekly", "weeks", "daily", "real-time", "real time"];
const LAGGING_TIMELINESS_KEYWORDS = ["month", "months", "lag", "lagged", "annual", "12+", "year", "years"];

function textIncludesAny(text: string, keywords: string[]): boolean {
  const t = text.toLowerCase();
  return keywords.some((k) => t.includes(k));
}

function deriveAvailability(exists: TransparencyRow["exists"]): Availability {
  if (exists === "n/a" || exists === "higher_level" || exists === "no_mandate" || exists === "not_found") return "not_collected";
  if (exists === "published" || exists === "partial") return "collected";
  return null;
}

function deriveGranularity(text: string): Granularity {
  if (!text.trim()) return null;
  if (textIncludesAny(text, POINT_GRANULARITY_KEYWORDS)) return "point";
  if (textIncludesAny(text, AREA_GRANULARITY_KEYWORDS)) return "area";
  return null;
}

function deriveTimeliness(row: TransparencyRow): Timeliness {
  const primary = row.lag.trim() || row.cadence.trim();
  if (!primary) return null;
  if (textIncludesAny(primary, LAGGING_TIMELINESS_KEYWORDS)) return "lagging";
  if (textIncludesAny(primary, CURRENT_TIMELINESS_KEYWORDS)) return "current";
  return null;
}

export function assessRow(row: TransparencyRow): Assessment {
  const availability = deriveAvailability(row.exists);
  const hasDashboard = row.dashboard_url.trim() !== "";

  const scoreable = availability !== "not_collected";

  return {
    availability,
    hasDashboard,
    hasMap: hasDashboard && row.has_map,
    hasTrend: hasDashboard && row.has_trend,
    hasSearch: hasDashboard && row.has_search,
    granularity: scoreable ? deriveGranularity(row.granularity) : null,
    granularityLabel: scoreable ? row.granularity.trim() : "",
    timeliness: scoreable ? deriveTimeliness(row) : null,
    timelinessLabel: scoreable ? (row.lag.trim() || row.cadence.trim()) : "",
  };
}
