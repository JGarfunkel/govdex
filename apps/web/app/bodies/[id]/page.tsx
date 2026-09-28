import type { Metadata } from "next";
import { govdexFetchJson } from "../../../lib/api";
import { CapabilityGlyphs } from "../../../components/CapabilityGlyphs";

interface BodyDetail {
  id: string;
  name: string;
  category: string;
  jurisdiction_id: string;
  jurisdiction_name: string;
  website: string | null;
  meeting_cadence: string | null;
  seats: { id: string; title: string; current_official_id: string | null; current_official_name: string | null }[];
  channels: { id: string; kind: string; status: string; platform: string | null; url: string | null }[];
  adoptions: { id: string; product_name: string; function: string | null; instance_url: string | null }[];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const b = await govdexFetchJson<BodyDetail>(`/bodies/${id}`);
    return { title: `${b.name} - GovDex` };
  } catch {
    return {};
  }
}

export default async function BodyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await govdexFetchJson<BodyDetail>(`/bodies/${id}`);

  return (
    <main>
      <p><a href={`/jurisdictions/${b.jurisdiction_id}`}>&larr; {b.jurisdiction_name}</a></p>
      <h1>{b.name}</h1>
      {b.website ? <p><a href={b.website}>{b.website}</a></p> : <p className="field-blank">No website recorded.</p>}
      {b.meeting_cadence && <p>Meets: {b.meeting_cadence}</p>}
      <CapabilityGlyphs
        category={b.category}
        adoptions={b.adoptions.map((a) => ({ id: a.id, productName: a.product_name, functionCode: a.function, instanceUrl: a.instance_url }))}
      />

      <h2>Seats</h2>
      <ul>
        {b.seats.map((s) => (
          <li key={s.id}>{s.title}: {s.current_official_name ?? <span className="field-blank">vacant / not yet recorded</span>}</li>
        ))}
      </ul>

      <h2>Channels</h2>
      <ul>
        {b.channels.length === 0 && <li className="field-blank">None recorded.</li>}
        {b.channels.map((c) => (
          <li key={c.id}>
            {c.kind}: {c.status === "present" ? <a href={c.url ?? "#"}>{c.platform ?? c.url}</a> : c.status}
          </li>
        ))}
      </ul>

      <h2>Products in use</h2>
      <ul>
        {b.adoptions.length === 0 && <li className="field-blank">None recorded.</li>}
        {b.adoptions.map((a) => (
          <li key={a.id}>{a.product_name} {a.function ? `(${a.function})` : ""}</li>
        ))}
      </ul>
    </main>
  );
}
