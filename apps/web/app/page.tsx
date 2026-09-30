import { UsMap } from "../components/UsMap";
import { govdexFetchJson } from "../lib/api";

async function loadConfiguredStates(): Promise<string[]> {
  try {
    const { states } = await govdexFetchJson<{ states: string[] }>("/conf", {
      // Only changes when a locale pack YAML is added, so cache it.
      next: { revalidate: 300 },
    } as RequestInit);
    return states;
  } catch {
    return [];
  }
}

interface LiveState {
  code: string;
  name: string;
  slug: string;
}

// States with loaded data and a slug (t06) — the API decides, so going live
// needs no change here.
async function loadLiveStates(): Promise<LiveState[]> {
  try {
    const { states } = await govdexFetchJson<{ states: LiveState[] }>("/geo", {
      next: { revalidate: 60 },
    } as RequestInit);
    return states;
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const [configuredStates, liveStates] = await Promise.all([loadConfiguredStates(), loadLiveStates()]);
  const liveBySlug = Object.fromEntries(liveStates.map((s) => [s.code, s.slug]));
  const liveNames = liveStates.map((s) => s.name);

  return (
    <main>
      <h1>GovDex: U.S. Governance Index</h1>
      <p>Find who represents an address, and how reachable they are.</p>
      <UsMap configuredStates={configuredStates} liveStates={liveBySlug} />
      <p style={{ color: "var(--soft)", fontSize: "0.9em", marginTop: -12 }}>
        {liveNames.length > 0 ? `Live today: ${liveNames.join(", ")}.` : "No states are live yet."} Other states link to their config review page.
      </p>
    </main>
  );
}
