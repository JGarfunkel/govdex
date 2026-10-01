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

      <p>
        The right to know what government does is well established. 
        The ability to find it easily is not. Records are often public but scattered across dozens of websites, in formats only insiders can navigate.
      </p>

<ol>
  <li><i>To find who holds power</i>. Every executive, legislative, judicial, advisory, and party seat that affects your address, with an official way to reach each one.</li>
  <li><i>To find what they are working on</i>. Agendas, minutes, and the projects and tasks those meetings produce.</li>
  <li><i>To find where to be heard</i>. Which channels each body runs, and whether residents can talk back or only listen.</li>
  <li><i>To find the tools of government</i>. Which software each body uses to do its work.</li>
  <li><i>To find what is measured</i>. Which conditions government tracks where you live, and which it does not.</li>
  <li><i>To find data you can use</i>. Public data on maps and over time, at a fine grain, and current enough to matter.</li>
  <li><i>To find what is missing</i>. A checked absence, recorded separately from a gap nobody has looked into.</li>
</ol>
    </main>
  );
}
