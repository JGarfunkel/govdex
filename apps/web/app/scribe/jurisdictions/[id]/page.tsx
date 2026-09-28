"use client";

import { use, useEffect, useState } from "react";
import { useAuth } from "../../../../components/AuthProvider";
import { govdexFetchJson } from "../../../../lib/api";

interface JurisdictionDetail {
  id: string;
  name: string;
  concept: string;
  bodies: { id: string; name: string; category: string }[];
}

export default function ScribeJurisdictionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useAuth();
  const [data, setData] = useState<JurisdictionDetail | null>(null);

  useEffect(() => {
    govdexFetchJson<JurisdictionDetail>(`/jurisdictions/${id}`).then(setData);
  }, [id]);

  if (loading) return <main><p>Loading…</p></main>;
  if (!user) return <main><p>Please <a href="/login">sign in</a> first.</p></main>;
  if (!data) return <main><p>Loading…</p></main>;

  return (
    <main>
      <p><a href="/scribe">&larr; Queue</a></p>
      <h1>{data.name}</h1>
      <ul>
        {data.bodies.map((b) => (
          <li key={b.id}><a href={`/scribe/bodies/${b.id}`}>{b.name}</a></li>
        ))}
      </ul>
    </main>
  );
}
