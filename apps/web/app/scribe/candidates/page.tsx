"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChannelKind } from "@govdex/shared";
import { useAuth } from "../../../components/AuthProvider";
import { govdexFetchJson } from "../../../lib/api";

type LinkType = "channel" | "board" | "district" | "calendar" | "vendor" | "index" | "agenda" | "minutes" | "agenda_minutes" | "api";

interface Candidate {
  id: string;
  jurisdiction_id: string | null;
  source_body_id: string | null;
  found_on_url: string;
  target_url: string;
  link_type: LinkType;
  guessed_platform: string | null;
  guessed_kind: ChannelKind | null;
  guessed_body_name: string | null;
  guessed_vendor: string | null;
  guessed_function: string | null;
  guessed_target_body_id: string | null;
}

interface CrawlJob {
  id: string;
  jurisdiction_id: string | null;
  body_id: string | null;
  seed_url: string;
  status: "queued" | "running" | "done" | "error";
  candidates_found: number;
  error: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function PromoteAsChannel({ candidate, onDone }: { candidate: Candidate; onDone: () => void }) {
  const { idToken } = useAuth();
  const [bodyId, setBodyId] = useState(candidate.source_body_id ?? "");
  const [error, setError] = useState<string | null>(null);

  async function promote() {
    if (!idToken || !bodyId) return;
    try {
      await govdexFetchJson(`/candidates/${candidate.id}/promote`, {
        method: "POST",
        idToken,
        body: JSON.stringify({
          promoteAs: "channel",
          bodyId,
          kind: candidate.guessed_kind ?? "community",
          platform: candidate.guessed_platform ?? undefined,
        }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to promote");
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <input placeholder="body id" value={bodyId} onChange={(e) => setBodyId(e.target.value)} style={{ width: 280 }} />
      <button onClick={promote} style={{ marginLeft: 8 }}>Promote as channel</button>
      {error && <p className="warning">{error}</p>}
    </div>
  );
}

const LINK_TYPE_LABEL: Record<LinkType, string> = {
  channel: "channel",
  board: "board/committee",
  district: "special district",
  calendar: "calendar/agenda",
  vendor: "SaaS vendor",
  index: "directory/index page",
  agenda: "committee agenda",
  minutes: "committee minutes",
  agenda_minutes: "committee agenda & minutes",
  api: "civic-data API",
};

function jobStatusLabel(job: CrawlJob): string {
  switch (job.status) {
    case "queued":
      return "queued…";
    case "running":
      return "checking for related info…";
    case "done":
      return job.candidates_found > 0 ? `found ${job.candidates_found}` : "found nothing new";
    case "error":
      return `failed${job.error ? `: ${job.error}` : ""}`;
  }
}

function CrawlJobs() {
  const { idToken } = useAuth();
  const [jobs, setJobs] = useState<CrawlJob[] | null>(null);

  const reload = useCallback(() => {
    if (!idToken) return;
    govdexFetchJson<{ jobs: CrawlJob[] }>("/crawl-jobs", { idToken })
      .then((d) => setJobs(d.jobs))
      .catch(() => setJobs(null));
  }, [idToken]);

  useEffect(() => {
    reload();
    // Poll while anything is still in flight, so "checking…" resolves to a
    // result without a manual refresh — this list is short-lived triage, not
    // a dashboard, so a simple interval beats wiring up push updates.
    const interval = setInterval(() => {
      setJobs((current) => {
        if (current?.some((j) => j.status === "queued" || j.status === "running")) reload();
        return current;
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [reload]);

  if (!jobs || jobs.length === 0) return null;

  return (
    <section style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: "1em" }}>Recent crawl jobs</h2>
      {jobs.slice(0, 10).map((job) => (
        <p key={job.id} style={{ fontSize: "0.85em", margin: "4px 0" }}>
          <a href={job.seed_url}>{job.seed_url}</a>{" "}
          <span className={job.status === "error" ? "warning" : "field-blank"}>— {jobStatusLabel(job)}</span>
        </p>
      ))}
    </section>
  );
}

export default function ScribeCandidatesPage() {
  const { user, idToken, loading } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!idToken) return;
    govdexFetchJson<{ candidates: Candidate[] }>("/candidates", { idToken })
      .then((d) => setCandidates(d.candidates))
      .catch((e) => setError(e.message));
  }, [idToken]);

  useEffect(reload, [reload]);

  if (loading) return <main><p>Loading…</p></main>;
  if (!user) return <main><p>Please <a href="/login">sign in</a> first.</p></main>;

  return (
    <main>
      <p><a href="/scribe">&larr; Queue</a></p>
      <h1>Spider candidates</h1>
      <CrawlJobs />
      {error && <p className="warning">{error}</p>}
      {candidates?.length === 0 && <p className="field-blank">Nothing to triage.</p>}
      {candidates?.map((c) => (
        <div key={c.id} style={{ border: "1px solid #d7dddf", padding: 12, marginBottom: 12 }}>
          <p><a href={c.target_url}>{c.target_url}</a></p>
          <p style={{ fontSize: "0.85em" }} className="field-blank">
            {LINK_TYPE_LABEL[c.link_type] ?? c.link_type} — found on <a href={c.found_on_url}>{c.found_on_url}</a>
            {c.link_type === "channel" && ` — guessed ${c.guessed_kind ?? "?"} / ${c.guessed_platform ?? "?"}`}
            {c.link_type === "board" && c.guessed_body_name && ` — looks like a new body: "${c.guessed_body_name}"`}
            {c.link_type === "vendor" && ` — ${c.guessed_vendor ?? "?"} / ${c.guessed_function ?? "?"}`}
            {c.link_type === "api" && ` — ${c.guessed_vendor ?? "?"} / ${c.guessed_function ?? "?"}`}
            {(c.link_type === "agenda" || c.link_type === "minutes" || c.link_type === "agenda_minutes") &&
              (c.guessed_body_name ? ` — matched to existing body: "${c.guessed_body_name}"` : " — no matching body found")}
          </p>
          {c.link_type === "channel" && <PromoteAsChannel candidate={c} onDone={reload} />}
        </div>
      ))}
    </main>
  );
}
