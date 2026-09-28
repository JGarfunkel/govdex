"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../components/AuthProvider";
import { govdexFetchJson } from "../../../lib/api";

interface Revision {
  id: string;
  table_name: string;
  record_id: string;
  op: string;
  diff: Record<string, unknown>;
  source_url: string | null;
  changed_at: string;
}

export default function ScribeRevisionsPage() {
  const { user, idToken, loading } = useAuth();
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!idToken) return;
    govdexFetchJson<{ revisions: Revision[] }>("/revisions?status=proposed", { idToken })
      .then((d) => setRevisions(d.revisions))
      .catch((e) => setError(e.message));
  }, [idToken]);

  useEffect(reload, [reload]);

  async function accept(id: string) {
    if (!idToken) return;
    try {
      await govdexFetchJson(`/revisions/${id}/accept`, { method: "POST", idToken, body: JSON.stringify({}) });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept");
    }
  }

  if (loading) return <main><p>Loading…</p></main>;
  if (!user) return <main><p>Please <a href="/login">sign in</a> first.</p></main>;

  return (
    <main>
      <p><a href="/scribe">&larr; Queue</a></p>
      <h1>Revisions to accept</h1>
      {error && <p className="warning">{error}</p>}
      {!revisions && <p>Loading…</p>}
      {revisions?.length === 0 && <p className="field-blank">Nothing pending.</p>}
      {revisions?.map((r) => (
        <div key={r.id} style={{ border: "1px solid #d7dddf", padding: 12, marginBottom: 12 }}>
          <p><strong>{r.op}</strong> {r.table_name} ({r.record_id})</p>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(r.diff, null, 2)}</pre>
          {r.source_url && <p><a href={r.source_url}>{r.source_url}</a></p>}
          <button onClick={() => accept(r.id)}>Accept</button>
        </div>
      ))}
    </main>
  );
}
