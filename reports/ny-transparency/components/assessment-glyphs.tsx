import { Rabbit, Snail } from "lucide-react";
import type { Assessment, ExistStatus, Visibility } from "../lib/types";

const NOT_COLLECTED_LABEL: Partial<Record<ExistStatus, { text: string; title: string }>> = {
  higher_level: { text: "higher level", title: "Not collected here — collected at the higher (state) level" },
  no_mandate: { text: "no mandate", title: "Not collected by either jurisdiction — no legal requirement to" },
  not_found: { text: "not found", title: "Searched, couldn't find it — flagged for follow-up, don't assume it doesn't exist" },
};

const VISIBILITY_TAGS: Record<Exclude<Visibility, "">, { label: string; title: string }> = {
  restricted: { label: "Restricted", title: "Requires a login (e.g. employees/contractors) — not visible to the public" },
  internal: { label: "Internal", title: "Not released outside the agency" },
  public: { label: "Public", title: "Publicly visible without a login" },
};

function VisibilityTag({ visibility }: { visibility: Visibility }) {
  if (!visibility || visibility === "public") return null;
  const tag = VISIBILITY_TAGS[visibility];
  return (
    <span className="provider-tag visibility-tag" title={tag.title}>
      <i className="ti ti-lock" aria-hidden="true" /> {tag.label}
    </span>
  );
}

// `highlight` keys mirror the filter-bar's metric-glyph legend items exactly
// (scorecard-spec.md §1): collected, not_collected, map, trend, search,
// point, area, current, lagging, blank. A glyph only ever matches the one
// key that names its "good"/legend-listed state — the muted "no
// map"/"no trend"/"no search" variants have no key of their own and simply
// dim along with everything else.

function matchable(base: string, key: string, highlight?: Set<string>): string {
  if (!highlight || highlight.size === 0) return base;
  return highlight.has(key) ? `${base} glyph-emphasized` : `${base} glyph-dimmed`;
}

function unmatchable(base: string, highlight?: Set<string>): string {
  if (!highlight || highlight.size === 0) return base;
  return `${base} glyph-dimmed`;
}

export function AssessmentGlyphs({
  assessment,
  exists,
  visibility,
  highlight,
}: {
  assessment: Assessment;
  exists: ExistStatus;
  visibility: Visibility;
  highlight?: Set<string>;
}) {
  if (assessment.availability === null) {
    return (
      <span className={matchable("assessment assessment-blank", "blank", highlight)} title="Not yet evaluated">
        not yet evaluated
      </span>
    );
  }

  if (assessment.availability === "not_collected") {
    const label = NOT_COLLECTED_LABEL[exists];
    return (
      <span className="assessment">
        <i
          className={matchable("ti ti-ban glyph glyph-danger", "not_collected", highlight)}
          aria-hidden="true"
          title={label?.title ?? "Not collected by this jurisdiction"}
        />
        <span className="glyph-text">{label?.text ?? "not collected"}</span>
      </span>
    );
  }

  const hasMap = assessment.hasDashboard && assessment.hasMap;
  const hasTrend = assessment.hasDashboard && assessment.hasTrend;
  const hasSearch = assessment.hasDashboard && assessment.hasSearch;

  return (
    <span className="assessment">
      <VisibilityTag visibility={visibility} />
      <i
        className={matchable("ti ti-table glyph glyph-active", "collected", highlight)}
        aria-hidden="true"
        title="Government collects and releases the data"
      />
      <i
        className={
          hasMap
            ? matchable("ti ti-map glyph glyph-active", "map", highlight)
            : unmatchable("ti ti-map glyph glyph-off", highlight)
        }
        aria-hidden="true"
        title={hasMap ? "A geographic view exists" : "No map view"}
      />
      <i
        className={
          hasTrend
            ? matchable("ti ti-chart-line glyph glyph-active", "trend", highlight)
            : unmatchable("ti ti-chart-line glyph glyph-off", highlight)
        }
        aria-hidden="true"
        title={hasTrend ? "A time-series view exists" : "No trend view"}
      />
      <i
        className={
          hasSearch
            ? matchable("ti ti-search glyph glyph-active", "search", highlight)
            : unmatchable("ti ti-search glyph glyph-off", highlight)
        }
        aria-hidden="true"
        title={hasSearch ? "A name/case/address search exists" : "No search"}
      />
      {assessment.granularity && (
        <span className="glyph-pair">
          <i
            className={
              assessment.granularity === "point"
                ? matchable("ti ti-map-pin glyph glyph-active", "point", highlight)
                : matchable("ti ti-hexagon glyph glyph-muted", "area", highlight)
            }
            aria-hidden="true"
            title={assessment.granularity === "point" ? "Resolvable to address / parcel / tree / intersection" : "Aggregated to precinct / tract / county / borough"}
          />
          {assessment.granularityLabel && <span className="glyph-text">{assessment.granularityLabel}</span>}
        </span>
      )}
      {assessment.timeliness && (
        <span className="glyph-pair">
          {assessment.timeliness === "current" ? (
            <span className={matchable("", "current", highlight)} title="Lag acceptable">
              <Rabbit className="glyph glyph-active" aria-hidden="true" size="1.05rem" />
            </span>
          ) : (
            <span className={matchable("", "lagging", highlight)} title="Lag excessive">
              <Snail className="glyph glyph-muted" aria-hidden="true" size="1.05rem" />
            </span>
          )}
          {assessment.timelinessLabel && <span className="glyph-text">{assessment.timelinessLabel}</span>}
        </span>
      )}
    </span>
  );
}
