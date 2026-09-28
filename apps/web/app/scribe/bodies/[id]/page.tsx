"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../components/AuthProvider";
import { ChannelQuestion } from "../../../../components/ScribeForm";
import { govdexFetchJson } from "../../../../lib/api";

interface BodyDetail {
  id: string;
  name: string;
  jurisdiction_id: string;
  jurisdiction_name: string;
  channels: { id: string; kind: string; status: string; platform: string | null; url: string | null }[];
}

const QUESTIONS: { kind: "broadcast" | "community"; label: string }[] = [
  { kind: "broadcast", label: "Is there a public page or newsletter (Facebook page, X/Twitter, Substack, etc.)?" },
  { kind: "community", label: "Is there a member-to-member community channel (Facebook group, Discord, Slack)?" },
];

export default function ScribeBodyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useAuth();
  const [data, setData] = useState<BodyDetail | null>(null);

  const reload = useCallback(() => {
    govdexFetchJson<BodyDetail>(`/bodies/${id}`).then(setData);
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading) return <main><p>Loading…</p></main>;
  if (!user) return <main><p>Please <a href="/login">sign in</a> first.</p></main>;
  if (!data) return <main><p>Loading…</p></main>;

  const answeredKinds = new Set(data.channels.map((c) => c.kind));

  return (
    <main>
      <p><a href={`/scribe/jurisdictions/${data.jurisdiction_id}`}>&larr; {data.jurisdiction_name}</a></p>
      <h1>{data.name}</h1>

      <h2>Recorded channels</h2>
      <ul>
        {data.channels.length === 0 && <li className="field-blank">None yet.</li>}
        {data.channels.map((c) => (
          <li key={c.id}>{c.kind}: {c.status}{c.url ? ` — ${c.url}` : ""}</li>
        ))}
      </ul>

      <h2>Guided questions</h2>
      {QUESTIONS.filter((q) => !answeredKinds.has(q.kind)).map((q) => (
        <ChannelQuestion key={q.kind} bodyId={data.id} kind={q.kind} label={q.label} onSaved={reload} />
      ))}
      {QUESTIONS.every((q) => answeredKinds.has(q.kind)) && <p className="field-blank">All channel questions answered.</p>}
    </main>
  );
}
