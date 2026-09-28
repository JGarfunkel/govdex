import type { RelationCode } from "../lib/types";

// Rectangle pair icon (scorecard-spec.md §7). Two independent axes —
// spatial (overlap vs. separate) and size (winner vs. dominated) — plus a
// fixed city/state/third-party color. Coordinates are hand-placed within a
// shared 46x28 viewBox rather than derived, since the grammar has only nine
// fixed cases.

const CITY = { fill: "#2f6fd6", stroke: "#1e4f9c" };
const STATE = { fill: "#e07b2f", stroke: "#b25e1c" };
const THIRD = { fill: "#2e9e57", stroke: "#1f7040" };

const UNIT = { w: 22, h: 13.2 }; // 5:3
const BIG = { w: 30, h: 18 }; // 5:3, superior size

interface ShapeSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  opacity: number;
  dashed?: boolean;
}

const RELATION_LABELS: Record<Exclude<RelationCode, null>, string> = {
  neither: "Neither jurisdiction publishes this",
  state_only: "State only",
  city_only: "City only",
  parallel_equivalent: "Parallel — separate data, equivalent coverage",
  city_superior: "City superior — exceeds the state baseline",
  state_superior: "State superior",
  traded: "Traded — each jurisdiction wins a different facet",
  city_divergent: "Divergent — city dashboard built on different data than the authoritative source",
  third_party: "Third party — government is not the source",
};

function staticShapes(relation: Exclude<RelationCode, null | "third_party">): ShapeSpec[] {
  switch (relation) {
    case "neither":
      return [{ x: 12, y: 7.4, w: UNIT.w, h: UNIT.h, fill: "none", stroke: "var(--text-muted)", opacity: 1, dashed: true }];
    case "state_only":
      return [{ x: 12, y: 7.4, w: UNIT.w, h: UNIT.h, ...STATE, opacity: 1 }];
    case "city_only":
      return [{ x: 12, y: 7.4, w: UNIT.w, h: UNIT.h, ...CITY, opacity: 1 }];
    case "traded":
      return [
        { x: 6, y: 12, w: UNIT.w, h: UNIT.h, ...STATE, opacity: 0.8 },
        { x: 18, y: 3, w: UNIT.w, h: UNIT.h, ...CITY, opacity: 0.8 },
      ];
    case "city_superior":
      return [
        { x: 16, y: 12, w: UNIT.w, h: UNIT.h, ...STATE, opacity: 0.5 },
        { x: 4, y: 2, w: BIG.w, h: BIG.h, ...CITY, opacity: 0.85 },
      ];
    case "state_superior":
      return [
        { x: 16, y: 12, w: UNIT.w, h: UNIT.h, ...CITY, opacity: 0.5 },
        { x: 4, y: 2, w: BIG.w, h: BIG.h, ...STATE, opacity: 0.85 },
      ];
    case "parallel_equivalent":
      return [
        { x: 2, y: 7.4, w: 20, h: 12, ...STATE, opacity: 1 },
        { x: 24, y: 7.4, w: 20, h: 12, ...CITY, opacity: 1 },
      ];
    case "city_divergent":
      return [
        { x: 2, y: 10, w: 16, h: 9.6, ...STATE, opacity: 1 },
        { x: 16, y: 2, w: BIG.w, h: BIG.h, ...CITY, opacity: 1 },
      ];
  }
}

function thirdPartyShapes(source: "city" | "state"): ShapeSpec[] {
  const sourceColors = source === "city" ? CITY : STATE;
  return [
    { x: 16, y: 12, w: UNIT.w, h: UNIT.h, ...sourceColors, opacity: 0.5 },
    { x: 4, y: 2, w: BIG.w, h: BIG.h, ...THIRD, opacity: 0.85 },
  ];
}

export function RelationIcon({
  relation,
  thirdPartySource = "state",
}: {
  relation: RelationCode;
  thirdPartySource?: "city" | "state";
}) {
  if (!relation) {
    return <span className="relation-icon relation-icon-blank" title="Not yet evaluated" aria-hidden="true" />;
  }

  const shapes = relation === "third_party" ? thirdPartyShapes(thirdPartySource) : staticShapes(relation);
  const label = RELATION_LABELS[relation];

  return (
    <svg className="relation-icon" viewBox="0 0 46 28" width="34" height="20.7" role="img" aria-label={label}>
      <title>{label}</title>
      {shapes.map((s, i) => (
        <rect
          key={i}
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          rx={1.5}
          fill={s.fill}
          stroke={s.stroke}
          strokeWidth={1.1}
          strokeDasharray={s.dashed ? "2 2" : undefined}
          opacity={s.opacity}
        />
      ))}
    </svg>
  );
}
