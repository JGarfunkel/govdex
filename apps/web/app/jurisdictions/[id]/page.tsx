import type { Metadata } from "next";
import { govdexFetchJson } from "../../../lib/api";

interface JurisdictionDetail {
  id: string;
  name: string;
  concept: string;
  local_name: string | null;
  website: string | null;
  verification: string;
  origin: string;
  identifiers: { scheme: string; value: string }[];
  within: { jurisdiction_id: string; name: string; concept: string }[];
  children: { jurisdiction_id: string; name: string; concept: string }[];
  overlaps: { jurisdiction_id: string; name: string; concept: string; relation: string; coverage: string }[];
  bodies: { id: string; name: string; category: string; is_governmental: boolean }[];
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const j = await govdexFetchJson<JurisdictionDetail>(`/jurisdictions/${id}`);
    return { title: `${j.name} - GovDex` };
  } catch {
    return {};
  }
}

export default async function JurisdictionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const j = await govdexFetchJson<JurisdictionDetail>(`/jurisdictions/${id}`);

  return (
    <main>
      <p><a href="/">&larr; New search</a></p>
      <h1>{j.local_name ?? j.concept} — {j.name}</h1>
      {j.website ? <p><a href={j.website}>{j.website}</a></p> : <p className="field-blank">No website recorded.</p>}

      <h2>Within</h2>
      <ul>
        {j.within.map((w) => (
          <li key={w.jurisdiction_id}><a href={`/jurisdictions/${w.jurisdiction_id}`}>{w.name} ({w.concept})</a></li>
        ))}
      </ul>

      <h2>Contains</h2>
      <ul>
        {j.children.map((c) => (
          <li key={c.jurisdiction_id}><a href={`/jurisdictions/${c.jurisdiction_id}`}>{c.name} ({c.concept})</a></li>
        ))}
      </ul>

      <h2>Bodies</h2>
      <ul>
        {j.bodies.map((b) => (
          <li key={b.id}><a href={`/bodies/${b.id}`}>{b.name}</a></li>
        ))}
      </ul>
    </main>
  );
}
