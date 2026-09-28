"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import { govdexFetchJson } from "../../lib/api";

interface QueueResponse {
  jurisdictions: { jurisdiction_id: string; name: string; concept: string; grant_reason: string }[];
  needsAttention: { body_id: string; body_name: string; jurisdiction_id: string; body_unverified: boolean; has_unknown_channel: boolean }[];
}

export default function ScribeQueuePage() {
  const { user, idToken, loading } = useAuth();
  const [data, setData] = useState<QueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!idToken) return;
    govdexFetchJson<QueueResponse>("/scribe/queue", { idToken }).then(setData).catch((e) => setError(e.message));
  }, [idToken]);

  if (loading) return <main><p>Loading…</p></main>;
  if (!user) return <main><p>Please <a href="/login">sign in</a> first.</p></main>;
  if (error) return <main><p className="warning">{error}</p></main>;
  if (!data) return <main><p>Loading queue…</p></main>;

  return (
    <main>
      <h1>Scribe queue</h1>
      <p>
        <a href="/scribe/revisions">Revisions to accept</a> &middot;{" "}
        <a href="/scribe/candidates">Spider candidates</a>
      </p>

      <h2>Your editable jurisdictions</h2>
      <ul>
        {data.jurisdictions.map((j) => (
          <li key={j.jurisdiction_id}>
            <a href={`/scribe/jurisdictions/${j.jurisdiction_id}`}>{j.name}</a> ({j.concept}, {j.grant_reason})
          </li>
        ))}
      </ul>

      <h2>Needs attention</h2>
      <ul>
        {data.needsAttention.map((b) => (
          <li key={b.body_id}>
            <a href={`/scribe/bodies/${b.body_id}`}>{b.body_name}</a>
            {b.body_unverified && " — unverified"}
            {b.has_unknown_channel && " — channel status unknown"}
          </li>
        ))}
      </ul>
    </main>
  );
}
