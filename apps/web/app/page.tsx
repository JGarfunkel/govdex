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

export default async function HomePage() {
  const configuredStates = await loadConfiguredStates();

  return (
    <main>
      <h1>GovDex: U.S. Governance Index</h1>
      <p>Find who represents an address in New York, and how reachable they are.</p>
      <UsMap configuredStates={configuredStates} />
      <p style={{ color: "var(--soft)", fontSize: "0.9em", marginTop: -12 }}>
        New York is live today — other states link to their config review page.
      </p>
    </main>
  );
}
