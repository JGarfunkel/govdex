"use client";

import type { RelationCode } from "../lib/types";
import { RelationIcon } from "./relation-icon";

const METRIC_ITEMS: { key: string; icon: string; label: string }[] = [
  { key: "collected", icon: "ti-table", label: "collected" },
  { key: "not_collected", icon: "ti-ban", label: "not collected" },
  { key: "map", icon: "ti-map", label: "map" },
  { key: "trend", icon: "ti-chart-line", label: "trend" },
  { key: "search", icon: "ti-search", label: "search" },
  { key: "point", icon: "ti-map-pin", label: "point-resolvable" },
  { key: "area", icon: "ti-hexagon", label: "area only" },
  { key: "current", icon: "ti-bolt", label: "current" },
  { key: "lagging", icon: "ti-hourglass", label: "lagging" },
];

const RELATION_ITEMS: { key: Exclude<RelationCode, null>; label: string }[] = [
  { key: "neither", label: "neither" },
  { key: "state_only", label: "state only" },
  { key: "city_only", label: "city only" },
  { key: "parallel_equivalent", label: "parallel" },
  { key: "city_superior", label: "city superior" },
  { key: "state_superior", label: "state superior" },
  { key: "city_divergent", label: "divergent" },
  { key: "third_party", label: "third party" },
];

interface FilterBarProps {
  highlight: Set<string>;
  onToggleHighlight: (key: string) => void;
  relationFilter: Set<RelationCode>;
  onToggleRelation: (key: RelationCode) => void;
  thesisActive: boolean;
  onToggleThesis: () => void;
}

export function FilterBar({
  highlight,
  onToggleHighlight,
  relationFilter,
  onToggleRelation,
  thesisActive,
  onToggleThesis,
}: FilterBarProps) {
  return (
    <div className="filter-bar">
      <div className="filter-group" role="group" aria-label="Highlight by metric">
        {METRIC_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={highlight.has(item.key) ? "filter-chip active" : "filter-chip"}
            aria-pressed={highlight.has(item.key)}
            onClick={() => onToggleHighlight(item.key)}
          >
            <i className={`ti ${item.icon} glyph`} aria-hidden="true" />
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className={highlight.has("blank") ? "filter-chip active" : "filter-chip"}
          aria-pressed={highlight.has("blank")}
          onClick={() => onToggleHighlight("blank")}
        >
          blank
        </button>
      </div>

      <div className="filter-group" role="group" aria-label="Filter by relation">
        {RELATION_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={relationFilter.has(item.key) ? "filter-chip active" : "filter-chip"}
            aria-pressed={relationFilter.has(item.key)}
            onClick={() => onToggleRelation(item.key)}
          >
            <RelationIcon relation={item.key} />
            {item.label}
          </button>
        ))}
      </div>

      <p className="legend-note">Greyed = missing. Blank = not yet evaluated, not approval.</p>
    </div>
  );
}
