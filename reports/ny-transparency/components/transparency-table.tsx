"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AssessmentGlyphs } from "./assessment-glyphs";
import { FilterBar } from "./filter-bar";
import { RelationIcon } from "./relation-icon";
import type { CategoryGroup } from "../lib/grading/build-domains";
import { isThirdPartyProvider } from "../lib/provider";
import type { AssessedRow, DomainEntry, RelationCode, Scope } from "../lib/types";

const SCOPE_CLASS: Record<Scope, string> = {
  "New York City": "scope-city",
  "New York State": "scope-state",
};
const SCOPE_SHORT: Record<Scope, string> = {
  "New York City": "City",
  "New York State": "State",
};

function parseView(value: string | null): { city: boolean; state: boolean } {
  switch (value) {
    case "city":
      return { city: true, state: false };
    case "state":
      return { city: false, state: true };
    case "none":
      return { city: false, state: false };
    default:
      return { city: true, state: true };
  }
}

function viewParam(city: boolean, state: boolean): string | null {
  if (city && state) return null;
  if (city) return "city";
  if (state) return "state";
  return "none";
}

function parseSet(value: string | null): Set<string> {
  return new Set(value ? value.split(",").filter(Boolean) : []);
}

function setParam(set: Set<string>): string | null {
  return set.size ? Array.from(set).join(",") : null;
}

function DashboardCell({ ar }: { ar: AssessedRow }) {
  const { row, assessment } = ar;
  if (assessment.availability === "not_collected") {
    return <span className="dash-cell muted">—</span>;
  }

  const url = row.dashboard_url.trim() || row.dataset_url.trim();
  if (!url) return <span className="dash-cell muted">Not published</span>;

  const label = row.dashboard_url.trim() ? row.dashboard_name || "Dashboard" : "Dataset";
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="dash-cell-link">
      {isThirdPartyProvider(row.provider) && <span className="provider-tag">NGO</span>}
      {label}
    </a>
  );
}

// §2: metric filter — mirrors AssessmentGlyphs' matchable() keys exactly, so
// a row is visible whenever the metric legend chip that would highlight it
// is active. Empty selection shows everything.
function metricVisible(ar: AssessedRow, highlight: Set<string>): boolean {
  if (highlight.size === 0) return true;
  const { assessment } = ar;
  if (highlight.has("blank")) {
    if (assessment.availability === null) return true;
  }
  if (highlight.has("not_collected")) {
    if (assessment.availability === "not_collected") return true;
  }
  if (assessment.availability !== "collected") return false;
  if (highlight.has("collected")) return true;
  if (highlight.has("map") && assessment.hasDashboard && assessment.hasMap) return true;
  if (highlight.has("trend") && assessment.hasDashboard && assessment.hasTrend) return true;
  if (highlight.has("search") && assessment.hasDashboard && assessment.hasSearch) return true;
  if (highlight.has("point") && assessment.granularity === "point") return true;
  if (highlight.has("area") && assessment.granularity === "area") return true;
  if (highlight.has("current") && assessment.timeliness === "current") return true;
  if (highlight.has("lagging") && assessment.timeliness === "lagging") return true;
  return false;
}

interface TableRow {
  key: string;
  scopeLabel: string;
  scopeClass: string;
  ar: AssessedRow;
}

// Third-party rows carry their own `scope` (the jurisdiction their coverage
// maps to, e.g. EvictionLab → New York City) rather than a "third party"
// scope of their own, so they piggyback on the city/state toggles instead of
// getting a toggle of their own, and keep the City/State scope label — the
// third-party distinction shows up via the row's border color and the NGO
// badge in DashboardCell instead of overwriting the scope column.
function jurisdictionRows(entry: DomainEntry, showCity: boolean, showState: boolean, highlight: Set<string>): TableRow[] {
  const rows: TableRow[] = [];
  if (showCity && entry.city) {
    rows.push({ key: "city", scopeLabel: SCOPE_SHORT["New York City"], scopeClass: SCOPE_CLASS["New York City"], ar: entry.city });
  }
  if (showState && entry.state) {
    rows.push({ key: "state", scopeLabel: SCOPE_SHORT["New York State"], scopeClass: SCOPE_CLASS["New York State"], ar: entry.state });
  }
  entry.thirdParty.forEach((ar, i) => {
    const visible = ar.row.scope === "New York City" ? showCity : showState;
    if (!visible) return;
    rows.push({ key: `third-party-${i}`, scopeLabel: SCOPE_SHORT[ar.row.scope], scopeClass: "scope-third-party", ar });
  });
  return rows.filter(({ ar }) => metricVisible(ar, highlight));
}

export function TransparencyTable({ groups }: { groups: CategoryGroup[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialView = parseView(searchParams.get("view"));
  const [showCity, setShowCity] = useState(initialView.city);
  const [showState, setShowState] = useState(initialView.state);
  const [relationFilter, setRelationFilter] = useState<Set<RelationCode>>(
    () => parseSet(searchParams.get("relation")) as Set<RelationCode>,
  );
  const [thesisActive, setThesisActive] = useState(searchParams.get("thesis") === "1");
  const [highlight, setHighlight] = useState<Set<string>>(() => parseSet(searchParams.get("highlight")));

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());

    const view = viewParam(showCity, showState);
    if (view) params.set("view", view);
    else params.delete("view");

    const relation = setParam(relationFilter as Set<string>);
    if (relation) params.set("relation", relation);
    else params.delete("relation");

    if (thesisActive) params.set("thesis", "1");
    else params.delete("thesis");

    const highlightParam = setParam(highlight);
    if (highlightParam) params.set("highlight", highlightParam);
    else params.delete("highlight");

    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCity, showState, relationFilter, thesisActive, highlight]);

  function toggleRelation(key: RelationCode) {
    setRelationFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleHighlight(key: string) {
    setHighlight((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // §1: relation filters union — a domain shows if it matches any active
  // relation toggle OR (when the thesis preset is on) its precomputed
  // stateInadequate flag. Empty selection (and thesis off) shows everything.
  function relationVisible(entry: DomainEntry): boolean {
    if (relationFilter.size === 0 && !thesisActive) return true;
    if (thesisActive && entry.stateInadequate) return true;
    return entry.relation !== null && relationFilter.has(entry.relation);
  }

  const categoryGroups = useMemo(() => {
    return groups
      .map(({ category, entries }) => {
        const visibleEntries = entries
          .filter(relationVisible)
          .map((entry) => ({ entry, rows: jurisdictionRows(entry, showCity, showState, highlight) }))
          .filter(({ rows }) => rows.length > 0);
        return { category, visibleEntries };
      })
      .filter((g) => g.visibleEntries.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, showCity, showState, relationFilter, thesisActive, highlight]);

  return (
    <>
      <FilterBar
        highlight={highlight}
        onToggleHighlight={toggleHighlight}
        relationFilter={relationFilter}
        onToggleRelation={toggleRelation}
        thesisActive={thesisActive}
        onToggleThesis={() => setThesisActive((v) => !v)}
      />

      <div className="jurisdiction-toggles" role="group" aria-label="Filter by jurisdiction">
        <button
          type="button"
          className={showCity ? "toggle-btn active" : "toggle-btn"}
          aria-pressed={showCity}
          onClick={() => setShowCity((v) => !v)}
        >
          City
        </button>
        <button
          type="button"
          className={showState ? "toggle-btn active" : "toggle-btn"}
          aria-pressed={showState}
          onClick={() => setShowState((v) => !v)}
        >
          State
        </button>
      </div>

      {categoryGroups.map(({ category, visibleEntries }) => (
        <section key={category} className="domain-group">
          <h2>{category}</h2>
          <div className="table">
            {visibleEntries.map(({ entry, rows }, domainIndex) => (
              <div key={entry.domain} className={`couplet ${domainIndex % 2 ? "band" : ""}`}>
                <span
                  className="col-domain col-domain-span"
                  style={{ "--span": rows.length } as unknown as CSSProperties}
                >
                  <RelationIcon relation={entry.relation} thirdPartySource={entry.thirdPartySource ?? undefined} />
                  <span className="col-domain-label">{entry.domain}</span>
                </span>
                {rows.map(({ key, scopeLabel, scopeClass, ar }) => (
                  <div key={key} className={`couplet-row ${scopeClass}`}>
                    <span className="col-scope">{scopeLabel}</span>
                    <span className="col-dashboard">
                      <DashboardCell ar={ar} />
                    </span>
                    <span className="col-assessment">
                      <AssessmentGlyphs
                        assessment={ar.assessment}
                        exists={ar.row.exists}
                        visibility={ar.row.visibility}
                        highlight={highlight}
                      />
                    </span>
                    <span className="col-recommendation">{ar.row.tune}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
