import { govdexFetchJson } from "../../lib/api";

interface Seat {
  id: string;
  title: string;
  official_id: string | null;
  official_name: string | null;
}

interface Channel {
  id: string;
  kind: string;
  status: string;
  platform: string | null;
  url: string | null;
}

interface Body {
  id: string;
  name: string;
  category: string;
  seats: Seat[];
  channels: Channel[];
}

interface Jurisdiction {
  id: string;
  name: string;
  concept: string;
  local_name: string | null;
  bodies: Body[];
}

interface ResolveResponse {
  address: string;
  jurisdictions: Jurisdiction[];
  warnings: string[];
}

export default async function ResolvePage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const address = (await searchParams).address ?? "";
  if (!address.trim()) {
    return (
      <main>
        <p>No address given. <a href="/">Try another search.</a></p>
      </main>
    );
  }

  const data = await govdexFetchJson<ResolveResponse>(`/resolve?address=${encodeURIComponent(address)}`);

  return (
    <main>
      <p><a href="/">&larr; New search</a></p>
      <h1>{data.address}</h1>

      {data.jurisdictions.length === 0 && <p>No jurisdictions matched this address yet.</p>}

      {data.jurisdictions.map((j) => (
        <section key={j.id} style={{ marginTop: 24 }}>
          <h2>{j.local_name ?? j.concept} — {j.name}</h2>
          {j.bodies.length === 0 && <p className="field-blank">No bodies recorded yet.</p>}
          {j.bodies.map((b) => (
            <div key={b.id} style={{ marginTop: 12 }}>
              <h3>{b.name}</h3>
              <ul>
                {b.seats.map((s) => (
                  <li key={s.id}>
                    {s.title}: {s.official_name ?? <span className="field-blank">vacant / not yet recorded</span>}
                  </li>
                ))}
              </ul>
              {b.channels.map((c) => (
                <div key={c.id} className="field">
                  {c.kind}: {c.status === "present" ? <a href={c.url ?? "#"}>{c.platform ?? c.url}</a> : c.status}
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}

      {data.warnings.length > 0 && (
        <ul style={{ marginTop: 24 }}>
          {data.warnings.map((w, i) => (
            <li key={i} className="warning">{w}</li>
          ))}
        </ul>
      )}
    </main>
  );
}
