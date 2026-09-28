import Link from "next/link";
import { US_STATE_PATHS } from "../lib/usStatePaths";

// State -> slug for jurisdictions that actually resolve today (see
// apps/api/src/lib/geoPayload.ts's "NY-only today" note) — these get the
// full entity page. Every other state that has a config YAML (see
// packages/shared/src/conf/*.yaml, listed via GET /api/stack/conf) links to
// its /conf review page instead. A state with neither renders unlinked.
const LIVE_STATES: Record<string, string> = {
  NY: "ny",
};

// DC isn't a state, so it isn't in US_STATE_PATHS — same small marker
// (a sliver of the district plus a dot) react-usa-map draws for it, at the
// same coordinates, kept separate since it's a circle+path pair rather than
// a single state path.
const DC_PATH = "M801.8,253.8 l-1.1-1.6 -1-0.8 1.1-1.6 2.2,1.5z";

export function UsMap({ configuredStates }: { configuredStates: string[] }) {
  const configured = new Set(configuredStates);

  return (
    <svg className="us-map" viewBox="0 0 959 593" width="600" height="371" role="img" aria-labelledby="us-map-title">
      <title id="us-map-title">United States — click a state to view it</title>
      <g className="us-map-states">
        {Object.entries(US_STATE_PATHS).map(([code, { name, d }]) => {
          const slug = LIVE_STATES[code];
          const path = <path d={d} />;

          if (slug) {
            return (
              <Link key={code} href={`/${slug}`} className="us-map-state us-map-state-live" aria-label={name}>
                {path}
              </Link>
            );
          }
          if (configured.has(code)) {
            const confSlug = code.toLowerCase();
            return (
              <Link
                key={code}
                href={`/${confSlug}/conf`}
                className="us-map-state us-map-state-configured"
                aria-label={`${name} (config review)`}
              >
                {path}
              </Link>
            );
          }
          return (
            <g key={code} className="us-map-state" aria-label={`${name} (not configured)`}>
              <title>{`${name} — not configured yet`}</title>
              {path}
            </g>
          );
        })}
        <g className="us-map-state" aria-label="District of Columbia (not configured)">
          <title>District of Columbia — not configured yet</title>
          <path d={DC_PATH} />
          <circle cx="801.3" cy="251.8" r="5" />
        </g>
      </g>
    </svg>
  );
}
