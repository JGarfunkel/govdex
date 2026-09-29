"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChannelKind } from "@govdex/shared";
import { useAuth } from "./AuthProvider";
import { govdexFetchJson } from "../lib/api";
import { JurisdictionPicker, type JurisdictionResult } from "./JurisdictionPicker";
import { ProductPicker, type ProductResult } from "./ProductPicker";

type LinkType = "channel" | "board" | "district" | "calendar" | "vendor" | "index" | "agenda" | "minutes" | "agenda_minutes" | "budget" | "api";

interface Candidate {
  id: string;
  source_body_id: string | null;
  found_on_url: string;
  target_url: string;
  link_type: LinkType;
  title: string | null;
  guessed_platform: string | null;
  guessed_kind: ChannelKind | null;
  guessed_body_name: string | null;
  guessed_jurisdiction_name: string | null;
  guessed_vendor: string | null;
  guessed_function: string | null;
  guessed_target_body_id: string | null;
}

interface CategoryOption {
  code: string;
  label: string;
}

interface FunctionOption {
  code: string;
  label: string;
}

interface CrawlJob {
  id: string;
  status: "queued" | "running" | "done" | "error";
  seed_url: string;
  started_at: string | null;
  finished_at: string | null;
}

const ACTIVE_JOB_POLL_MS = 4000; // while a job is queued/running
const IDLE_POLL_MS = 15000; // otherwise — still needs to notice a fresh "Unearth" click from HeaderWebsite, a sibling component

type PromoteKind =
  | "channel"
  | "body"
  | "committeesUrl"
  | "policyUrl"
  | "budgetUrl"
  | "calendarUrl"
  | "agendaUrl"
  | "minutesUrl"
  | "agendaMinutesUrl"
  | "openDataApiUrl"
  | "legistarApiUrl";

// What POST /candidates/:id/promote can turn this candidate into (see
// packages/shared/src/schemas/candidatePromote.ts). 'district' and the
// non-code_publishing half of 'vendor' aren't in this dispatch table at all —
// they need a match-existing-or-create picker (JurisdictionPicker/
// ProductPicker below) rather than a single guessable default, so they get
// their own bespoke form blocks and promote handlers further down instead of
// going through promoteKind/promoteOne. 'calendar' promotes onto the
// jurisdiction's calendar_url, same shape as budgetUrl. The one 'vendor'
// sub-case handled here is a code-publishing page (Municode/eCode360) — it
// promotes onto the jurisdiction's policy_url ("laws" glyph); every other
// vendor hit becomes a products/adoptions match-or-create below.
// 'agenda'/'minutes'/'agenda_minutes' are a meeting-record page matched by
// name to an existing body (see ingestion/spider/agendaDetector.ts) — they
// promote onto that body's agenda_url/minutes_url. 'budget' is a
// jurisdiction's budget page (see ingestion/spider/budgetDetector.ts) —
// it promotes onto the jurisdiction's budget_url ("budget" glyph). 'api' is
// a civic-data platform API found off-domain (see
// ingestion/tools/probe-civic-apis.ts) — guessed_function='open_data'
// promotes onto open_data_api_url, 'legistar' onto legistar_api_url.
function promoteKind(c: Candidate): PromoteKind | null {
  if (c.link_type === "channel") return "channel";
  if (c.link_type === "board") return "body";
  if (c.link_type === "index") return "committeesUrl";
  if (c.link_type === "vendor" && c.guessed_function === "code_publishing") return "policyUrl";
  if (c.link_type === "budget") return "budgetUrl";
  if (c.link_type === "calendar") return "calendarUrl";
  if (c.link_type === "agenda") return "agendaUrl";
  if (c.link_type === "minutes") return "minutesUrl";
  if (c.link_type === "agenda_minutes") return "agendaMinutesUrl";
  if (c.link_type === "api" && c.guessed_function === "open_data") return "openDataApiUrl";
  if (c.link_type === "api" && c.guessed_function === "legistar") return "legistarApiUrl";
  return null;
}

// Button copy for each promoteKind — a Record so TS flags a missing entry
// the moment a new PromoteKind is added, instead of silently falling through.
const PROMOTE_LABELS: Record<PromoteKind, string> = {
  channel: "Promote",
  body: "Promote",
  committeesUrl: "Promote",
  policyUrl: "Promote as laws",
  budgetUrl: "Promote as budget",
  calendarUrl: "Promote as calendar",
  agendaUrl: "Promote as agenda",
  minutesUrl: "Promote as minutes",
  agendaMinutesUrl: "Promote as agenda & minutes",
  openDataApiUrl: "Promote as open data API",
  legistarApiUrl: "Promote as Legistar API",
};

const GROUP_ORDER: { type: LinkType; label: string }[] = [
  { type: "channel", label: "Social & newsletter channels" },
  { type: "board", label: "Boards & committees" },
  { type: "index", label: "Directory/index pages" },
  { type: "agenda", label: "Committee agendas" },
  { type: "minutes", label: "Committee minutes" },
  { type: "agenda_minutes", label: "Committee agendas & minutes" },
  { type: "budget", label: "Budget pages" },
  { type: "api", label: "Civic-data APIs" },
  { type: "vendor", label: "GovTech vendors" },
  { type: "calendar", label: "Calendar links" },
  { type: "district", label: "Special districts" },
];

// Shows this jurisdiction's still-unreviewed spider finds (candidate_links,
// status='new') right where a scribe just triggered the crawl — via
// HeaderWebsite's website edit or "Unearth" — instead of only in the
// separate /scribe/candidates global triage queue. A promote here is the
// same permission-checked POST /candidates/:id/promote that queue uses; the
// spider still only proposes, this just puts the proposal in front of the
// person who asked for it, with its own guesses pre-filled as the default.
export function SpiderCandidates({ jurisdictionId, bodies }: { jurisdictionId: string; bodies: { id: string; name: string }[] }) {
  const router = useRouter();
  const { idToken, canEdit } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [functions, setFunctions] = useState<FunctionOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<LinkType | null>(null);

  const [bodyChoice, setBodyChoice] = useState<Record<string, string>>({});
  const [categoryChoice, setCategoryChoice] = useState<Record<string, string>>({});
  const [nameChoice, setNameChoice] = useState<Record<string, string>>({});
  const [activeJob, setActiveJob] = useState<CrawlJob | null>(null);
  const [lastJob, setLastJob] = useState<CrawlJob | null>(null);

  // link_type='district' bespoke form state (kept outside the generic
  // promoteKind/promoteOne dispatch — see that function's doc comment).
  const [districtMode, setDistrictMode] = useState<Record<string, "link" | "create">>({});
  const [districtJurisdiction, setDistrictJurisdiction] = useState<Record<string, JurisdictionResult | null>>({});
  const [districtName, setDistrictName] = useState<Record<string, string>>({});
  const [districtConcept, setDistrictConcept] = useState<Record<string, "school_district" | "special_district">>({});
  const [districtRelation, setDistrictRelation] = useState<Record<string, "within" | "overlaps" | "coextensive">>({});
  const [districtCoverage, setDistrictCoverage] = useState<Record<string, "full" | "partial">>({});

  // link_type='vendor' (non-code_publishing) bespoke form state.
  const [adoptionMode, setAdoptionMode] = useState<Record<string, "link" | "create">>({});
  const [adoptionBody, setAdoptionBody] = useState<Record<string, string>>({});
  const [adoptionProduct, setAdoptionProduct] = useState<Record<string, ProductResult | null>>({});
  const [adoptionName, setAdoptionName] = useState<Record<string, string>>({});
  const [adoptionVendor, setAdoptionVendor] = useState<Record<string, string>>({});
  const [adoptionFunction, setAdoptionFunction] = useState<Record<string, string>>({});
  const [adoptionResultCount, setAdoptionResultCount] = useState<Record<string, number>>({});

  const reload = useCallback(() => {
    if (!canEdit) return;
    govdexFetchJson<{ candidates: Candidate[] }>(`/candidates?jurisdiction=${jurisdictionId}`, { idToken: idToken ?? undefined })
      .then((d) => setCandidates(d.candidates))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load spider finds"));
  }, [canEdit, idToken, jurisdictionId]);

  useEffect(reload, [reload]);

  useEffect(() => {
    if (!canEdit) return;
    govdexFetchJson<{ categories: CategoryOption[] }>("/body-categories", { idToken: idToken ?? undefined })
      .then((d) => setCategories(d.categories))
      .catch(() => setCategories([]));
  }, [canEdit, idToken]);

  useEffect(() => {
    if (!canEdit) return;
    govdexFetchJson<{ functions: FunctionOption[] }>("/product-functions", { idToken: idToken ?? undefined })
      .then((d) => setFunctions(d.functions))
      .catch(() => setFunctions([]));
  }, [canEdit, idToken]);

  // Polls GET /crawl-jobs (queued by HeaderWebsite's website edit/"Unearth")
  // so a scribe sees "checking <url> for related info…" right after
  // triggering a crawl, instead of just silence until candidates show up —
  // see crawlJobs.ts's own doc comment, which this finally consumes.
  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let wasActive = false; // tracked locally, not via React state — avoids a stale closure across setTimeout ticks

    async function poll() {
      try {
        const { jobs } = await govdexFetchJson<{ jobs: CrawlJob[] }>(`/crawl-jobs?jurisdiction=${jurisdictionId}`, {
          idToken: idToken ?? undefined,
        });
        if (cancelled) return;
        const latest = jobs[0] ?? null;
        setLastJob(latest);
        const stillActive = Boolean(latest && (latest.status === "queued" || latest.status === "running"));
        setActiveJob(stillActive ? latest : null);
        if (wasActive && !stillActive) {
          reload(); // a job just finished — pick up whatever it found
        }
        wasActive = stillActive;
      } catch {
        // best-effort status only; the candidates list below is authoritative
      } finally {
        if (!cancelled) timer = setTimeout(poll, wasActive ? ACTIVE_JOB_POLL_MS : IDLE_POLL_MS);
      }
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [canEdit, idToken, jurisdictionId, reload]);

  if (!canEdit) return null;
  if ((!candidates || candidates.length === 0) && !activeJob) return null;

  async function promoteOne(c: Candidate): Promise<boolean> {
    setBusyId(c.id);
    try {
      const kind = promoteKind(c);
      if (kind === "channel") {
        const bodyId = bodyChoice[c.id] ?? c.source_body_id ?? bodies[0]?.id;
        if (!bodyId) throw new Error("no body to attach this channel to");
        await govdexFetchJson(`/candidates/${c.id}/promote`, {
          method: "POST",
          idToken: idToken ?? undefined,
          body: JSON.stringify({
            promoteAs: "channel",
            bodyId,
            kind: c.guessed_kind ?? "community",
            platform: c.guessed_platform ?? undefined,
          }),
        });
      } else if (kind === "body") {
        await govdexFetchJson(`/candidates/${c.id}/promote`, {
          method: "POST",
          idToken: idToken ?? undefined,
          body: JSON.stringify({
            promoteAs: "body",
            jurisdictionId,
            categoryCode: categoryChoice[c.id] ?? categories[0]?.code ?? "advisory",
            name: nameChoice[c.id] ?? c.guessed_body_name ?? c.title ?? c.target_url,
          }),
        });
      } else if (kind === "committeesUrl") {
        const bodyId = bodyChoice[c.id] ?? c.source_body_id ?? bodies[0]?.id;
        if (!bodyId) throw new Error("no body to attach this boards & committees page to");
        await govdexFetchJson(`/candidates/${c.id}/promote`, {
          method: "POST",
          idToken: idToken ?? undefined,
          body: JSON.stringify({ promoteAs: "committeesUrl", bodyId }),
        });
      } else if (kind === "policyUrl") {
        await govdexFetchJson(`/candidates/${c.id}/promote`, {
          method: "POST",
          idToken: idToken ?? undefined,
          body: JSON.stringify({ promoteAs: "policyUrl", jurisdictionId }),
        });
      } else if (kind === "budgetUrl" || kind === "calendarUrl") {
        await govdexFetchJson(`/candidates/${c.id}/promote`, {
          method: "POST",
          idToken: idToken ?? undefined,
          body: JSON.stringify({ promoteAs: kind, jurisdictionId }),
        });
      } else if (kind === "openDataApiUrl" || kind === "legistarApiUrl") {
        await govdexFetchJson(`/candidates/${c.id}/promote`, {
          method: "POST",
          idToken: idToken ?? undefined,
          body: JSON.stringify({ promoteAs: kind, jurisdictionId }),
        });
      } else if (kind === "agendaUrl" || kind === "minutesUrl" || kind === "agendaMinutesUrl") {
        const bodyId = bodyChoice[c.id] ?? c.guessed_target_body_id ?? c.source_body_id ?? bodies[0]?.id;
        if (!bodyId) throw new Error("no body to attach this meeting-record page to");
        await govdexFetchJson(`/candidates/${c.id}/promote`, {
          method: "POST",
          idToken: idToken ?? undefined,
          body: JSON.stringify({ promoteAs: kind, bodyId }),
        });
      } else {
        throw new Error("not promotable");
      }
      setCandidates((cur) => cur?.filter((x) => x.id !== c.id) ?? null);
      return true;
    } catch (err) {
      setError(`${c.target_url}: ${err instanceof Error ? err.message : "failed to promote"}`);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function promote(c: Candidate) {
    setError(null);
    setResult(null);
    if (await promoteOne(c)) router.refresh();
  }

  async function reject(c: Candidate) {
    setError(null);
    setResult(null);
    setBusyId(c.id);
    try {
      await govdexFetchJson(`/candidates/${c.id}/reject`, { method: "POST", idToken: idToken ?? undefined });
      setCandidates((cur) => cur?.filter((x) => x.id !== c.id) ?? null);
      router.refresh();
    } catch (err) {
      setError(`${c.target_url}: ${err instanceof Error ? err.message : "failed to reject"}`);
    } finally {
      setBusyId(null);
    }
  }

  async function promoteAll(type: LinkType) {
    setError(null);
    setResult(null);
    setBulkBusy(type);
    const targets = (candidates ?? []).filter((c) => c.link_type === type && promoteKind(c) !== null);
    let ok = 0;
    for (const c of targets) {
      if (await promoteOne(c)) ok++;
    }
    setBulkBusy(null);
    setResult(`Promoted ${ok} of ${targets.length}.`);
    if (ok > 0) router.refresh();
  }

  // link_type='district' — outside promoteKind/promoteOne because there's no
  // safe default to promote onto: the editor must either pick a matched
  // existing jurisdiction (JurisdictionPicker) or supply a name/concept for a
  // new one. Both write via jurisdiction_relations, editor/admin-gated at the
  // DB level — a scribe's attempt here surfaces as the usual red error text.
  async function promoteDistrict(c: Candidate) {
    setError(null);
    setResult(null);
    const mode = districtMode[c.id] ?? "link";
    setBusyId(c.id);
    try {
      if (mode === "link") {
        const target = districtJurisdiction[c.id];
        if (!target) throw new Error("pick a matching jurisdiction first");
        await govdexFetchJson(`/candidates/${c.id}/promote`, {
          method: "POST",
          idToken: idToken ?? undefined,
          body: JSON.stringify({
            promoteAs: "districtLink",
            jurisdictionId: target.id,
            relation: districtRelation[c.id] ?? "overlaps",
            coverage: districtCoverage[c.id] ?? "partial",
          }),
        });
      } else {
        const name = districtName[c.id] ?? c.guessed_jurisdiction_name ?? c.title;
        if (!name) throw new Error("enter a name for the new district");
        await govdexFetchJson(`/candidates/${c.id}/promote`, {
          method: "POST",
          idToken: idToken ?? undefined,
          body: JSON.stringify({
            promoteAs: "districtCreate",
            name,
            conceptCode: districtConcept[c.id] ?? "school_district",
            relation: districtRelation[c.id] ?? "overlaps",
            coverage: districtCoverage[c.id] ?? "partial",
          }),
        });
      }
      setCandidates((cur) => cur?.filter((x) => x.id !== c.id) ?? null);
      router.refresh();
    } catch (err) {
      setError(`${c.target_url}: ${err instanceof Error ? err.message : "failed to promote"}`);
    } finally {
      setBusyId(null);
    }
  }

  // link_type='vendor' (guessed_function other than code_publishing) —
  // outside promoteKind/promoteOne for the same reason as district: the
  // adoption belongs to the candidate's jurisdiction (it licenses the
  // software) unless the editor narrows it to one body (source_body_id is
  // unreliable on vendor rows, so it's not used as a default), and either match an existing products row (ProductPicker — the
  // Granicus-hosts-several-products disambiguation) or add a new one.
  async function promoteAdoption(c: Candidate) {
    setError(null);
    setResult(null);
    const mode = adoptionMode[c.id] ?? "link";
    const bodyId = adoptionBody[c.id] || undefined; // "" = the jurisdiction itself
    setBusyId(c.id);
    try {
      if (mode === "link") {
        const product = adoptionProduct[c.id];
        if (!product) throw new Error("pick a matching product first");
        await govdexFetchJson(`/candidates/${c.id}/promote`, {
          method: "POST",
          idToken: idToken ?? undefined,
          body: JSON.stringify({ promoteAs: "adoptionLink", bodyId, productId: product.id }),
        });
      } else {
        const productName = adoptionName[c.id] ?? c.title;
        const vendor = adoptionVendor[c.id] ?? c.guessed_vendor;
        const functionCode = adoptionFunction[c.id] ?? c.guessed_function ?? functions[0]?.code;
        if (!productName || !vendor || !functionCode) throw new Error("enter the product's name, vendor, and function");
        await govdexFetchJson(`/candidates/${c.id}/promote`, {
          method: "POST",
          idToken: idToken ?? undefined,
          body: JSON.stringify({ promoteAs: "adoptionCreate", bodyId, productName, vendor, functionCode }),
        });
      }
      setCandidates((cur) => cur?.filter((x) => x.id !== c.id) ?? null);
      router.refresh();
    } catch (err) {
      setError(`${c.target_url}: ${err instanceof Error ? err.message : "failed to promote"}`);
    } finally {
      setBusyId(null);
    }
  }

  // The last completed/errored run of the fetch+parse pipeline for this
  // jurisdiction — not when a given candidate's page was downloaded (which
  // may be a cached fetch from a much earlier run) and not when a candidate
  // row was first discovered (unchanged by a later run that finds nothing
  // new — see candidate_links' on-conflict-do-nothing insert).
  const lastParsedAt = lastJob?.finished_at ?? null;

  return (
    <section className="spider-candidates">
      <h2 style={{ fontSize: "1em" }}>
        Spider finds{lastParsedAt && ` — last parsed ${new Date(lastParsedAt).toLocaleString()}`} — pending review
      </h2>
      {activeJob && (
        <p className="entity-meta">
          {activeJob.status === "running" ? "Checking" : "Queued to check"} {activeJob.seed_url} for related info…
        </p>
      )}
      {error && <p className="warning">{error}</p>}
      {result && <p className="entity-meta">{result}</p>}
      {GROUP_ORDER.map(({ type, label }) => {
        const group = (candidates ?? []).filter((c) => c.link_type === type);
        if (group.length === 0) return null;
        const promotableCount = group.filter((c) => promoteKind(c) !== null).length;
        return (
          <div key={type} className="spider-candidate-group">
            <div className="spider-candidate-group-header">
              <span>
                {label} <span className="entity-meta">({group.length})</span>
              </span>
              {promotableCount > 0 && (
                <button type="button" className="unearth-button" disabled={bulkBusy !== null} onClick={() => promoteAll(type)}>
                  {bulkBusy === type ? "Promoting…" : `Promote all ${promotableCount}`}
                </button>
              )}
            </div>
            <ul className="entity-list spider-candidate-list">
              {group.map((c) => {
                const kind = promoteKind(c);
                return (
                  <li key={c.id}>
                    <span className="spider-candidate-info">
                      <a href={c.target_url} target="_blank" rel="noopener noreferrer" className="entity-name">
                        {c.title || c.guessed_body_name || c.target_url}
                      </a>
                      <span className="entity-meta">
                        {c.link_type === "channel" && `${c.guessed_kind ?? "?"} / ${c.guessed_platform ?? "?"}`}
                        {c.link_type === "vendor" &&
                          (kind === "policyUrl"
                            ? `${c.guessed_vendor ?? "?"} / laws (${c.guessed_function})`
                            : `${c.guessed_vendor ?? "?"} / ${c.guessed_function ?? "?"} — match or add the product below`)}
                        {c.link_type === "calendar" && "meeting/agenda calendar link"}
                        {c.link_type === "budget" && "jurisdiction budget page"}
                        {c.link_type === "api" &&
                          (kind === "openDataApiUrl"
                            ? `${c.guessed_vendor ?? "?"} open data catalog`
                            : kind === "legistarApiUrl"
                              ? `${c.guessed_vendor ?? "?"} API — boards & seats`
                              : `${c.guessed_vendor ?? "?"} / ${c.guessed_function ?? "?"}`)}
                        {c.link_type === "district" && "special district — match or create its jurisdiction below"}
                        {c.link_type === "index" && "boards & committees hub — promote onto a body's listing page"}
                        {(c.link_type === "agenda" || c.link_type === "minutes" || c.link_type === "agenda_minutes") &&
                          (c.guessed_body_name
                            ? `${c.link_type.replace("_", " & ")} for "${c.guessed_body_name}"`
                            : `${c.link_type.replace("_", " & ")} — pick which body this belongs to`)}
                      </span>
                    </span>

                    {c.link_type === "channel" && (
                      <span className="spider-candidate-form">
                        {bodies.length > 1 && (
                          <select
                            value={bodyChoice[c.id] ?? c.source_body_id ?? bodies[0]?.id ?? ""}
                            onChange={(e) => setBodyChoice((cur) => ({ ...cur, [c.id]: e.target.value }))}
                          >
                            {bodies.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </span>
                    )}

                    {c.link_type === "board" && c.source_body_id && (
                      <span className="spider-candidate-form">
                        <input
                          type="text"
                          value={nameChoice[c.id] ?? c.guessed_body_name ?? c.title ?? ""}
                          onChange={(e) => setNameChoice((cur) => ({ ...cur, [c.id]: e.target.value }))}
                        />
                        <select
                          value={categoryChoice[c.id] ?? categories[0]?.code ?? ""}
                          onChange={(e) => setCategoryChoice((cur) => ({ ...cur, [c.id]: e.target.value }))}
                        >
                          {categories.map((cat) => (
                            <option key={cat.code} value={cat.code}>
                              {cat.label}
                            </option>
                          ))}
                        </select>
                      </span>
                    )}

                    {c.link_type === "index" && bodies.length > 1 && (
                      <span className="spider-candidate-form">
                        <select
                          value={bodyChoice[c.id] ?? c.source_body_id ?? bodies[0]?.id ?? ""}
                          onChange={(e) => setBodyChoice((cur) => ({ ...cur, [c.id]: e.target.value }))}
                        >
                          {bodies.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </span>
                    )}

                    {(c.link_type === "agenda" || c.link_type === "minutes" || c.link_type === "agenda_minutes") &&
                      bodies.length > 1 && (
                        <span className="spider-candidate-form">
                          <select
                            value={bodyChoice[c.id] ?? c.guessed_target_body_id ?? c.source_body_id ?? bodies[0]?.id ?? ""}
                            onChange={(e) => setBodyChoice((cur) => ({ ...cur, [c.id]: e.target.value }))}
                          >
                            {bodies.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        </span>
                      )}

                    {c.link_type === "district" && (
                      <span className="spider-candidate-form" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                        <span className="spider-candidate-form">
                          <select
                            value={districtMode[c.id] ?? "link"}
                            onChange={(e) => setDistrictMode((cur) => ({ ...cur, [c.id]: e.target.value as "link" | "create" }))}
                          >
                            <option value="link">Link to existing</option>
                            <option value="create">Create new</option>
                          </select>
                          <select
                            value={districtRelation[c.id] ?? "overlaps"}
                            onChange={(e) =>
                              setDistrictRelation((cur) => ({ ...cur, [c.id]: e.target.value as "within" | "overlaps" | "coextensive" }))
                            }
                          >
                            <option value="overlaps">overlaps</option>
                            <option value="within">within</option>
                            <option value="coextensive">coextensive</option>
                          </select>
                          <select
                            value={districtCoverage[c.id] ?? "partial"}
                            onChange={(e) => setDistrictCoverage((cur) => ({ ...cur, [c.id]: e.target.value as "full" | "partial" }))}
                          >
                            <option value="partial">partial</option>
                            <option value="full">full</option>
                          </select>
                        </span>
                        {(districtMode[c.id] ?? "link") === "link" ? (
                          <JurisdictionPicker
                            idToken={idToken ?? undefined}
                            level="special_district"
                            defaultQuery={c.guessed_jurisdiction_name ?? ""}
                            onSelect={(r) => setDistrictJurisdiction((cur) => ({ ...cur, [c.id]: r }))}
                          />
                        ) : (
                          <span className="spider-candidate-form">
                            <input
                              type="text"
                              value={districtName[c.id] ?? c.guessed_jurisdiction_name ?? ""}
                              onChange={(e) => setDistrictName((cur) => ({ ...cur, [c.id]: e.target.value }))}
                            />
                            <select
                              value={districtConcept[c.id] ?? "school_district"}
                              onChange={(e) =>
                                setDistrictConcept((cur) => ({ ...cur, [c.id]: e.target.value as "school_district" | "special_district" }))
                              }
                            >
                              <option value="school_district">school district</option>
                              <option value="special_district">special district (fire/sewer/water)</option>
                            </select>
                          </span>
                        )}
                        <button
                          type="button"
                          className="unearth-button"
                          disabled={busyId === c.id || bulkBusy !== null}
                          onClick={() => promoteDistrict(c)}
                        >
                          {busyId === c.id ? "Promoting…" : (districtMode[c.id] ?? "link") === "link" ? "Link district" : "Create & link district"}
                        </button>
                      </span>
                    )}

                    {c.link_type === "vendor" && promoteKind(c) === null && (
                      <span className="spider-candidate-form" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                        <span className="spider-candidate-form">
                          <select
                            value={adoptionMode[c.id] ?? "link"}
                            onChange={(e) => setAdoptionMode((cur) => ({ ...cur, [c.id]: e.target.value as "link" | "create" }))}
                          >
                            {adoptionResultCount[c.id] !== 0 && <option value="link">Link to existing product</option>}
                            <option value="create">Add new product</option>
                          </select>
                          {bodies.length > 0 && (
                            <select
                              value={adoptionBody[c.id] ?? ""}
                              onChange={(e) => setAdoptionBody((cur) => ({ ...cur, [c.id]: e.target.value }))}
                            >
                              {bodies.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </span>
                        {(adoptionMode[c.id] ?? "link") === "link" ? (
                          <ProductPicker
                            idToken={idToken ?? undefined}
                            vendor={c.guessed_vendor ?? ""}
                            functionCode={c.guessed_function}
                            onSelect={(r) => setAdoptionProduct((cur) => ({ ...cur, [c.id]: r }))}
                            onResultsChange={(count) => {
                              setAdoptionResultCount((cur) => ({ ...cur, [c.id]: count }));
                              if (count === 0) setAdoptionMode((cur) => ({ ...cur, [c.id]: "create" }));
                            }}
                          />
                        ) : (
                              <option value="">Whole jurisdiction</option>
                          <span className="spider-candidate-form">
                            <input
                              type="text"
                              placeholder="product name"
                              value={adoptionName[c.id] ?? c.title ?? ""}
                              onChange={(e) => setAdoptionName((cur) => ({ ...cur, [c.id]: e.target.value }))}
                            />
                            <input
                              type="text"
                              placeholder="vendor"
                              value={adoptionVendor[c.id] ?? c.guessed_vendor ?? ""}
                              onChange={(e) => setAdoptionVendor((cur) => ({ ...cur, [c.id]: e.target.value }))}
                            />
                            <select
                              value={adoptionFunction[c.id] ?? (c.guessed_function ?? functions[0]?.code ?? "")}
                              onChange={(e) => setAdoptionFunction((cur) => ({ ...cur, [c.id]: e.target.value }))}
                            >
                              {functions.map((f) => (
                                <option key={f.code} value={f.code}>
                                  {f.label}
                                </option>
                              ))}
                            </select>
                          </span>
                        )}
                        <button
                          type="button"
                          className="unearth-button"
                          disabled={busyId === c.id || bulkBusy !== null}
                          onClick={() => promoteAdoption(c)}
                        >
                          {busyId === c.id ? "Promoting…" : (adoptionMode[c.id] ?? "link") === "link" ? "Link product" : "Add & link product"}
                        </button>
                      </span>
                    )}

                    {kind && (
                      <button
                        type="button"
                        className="unearth-button"
                        disabled={busyId === c.id || bulkBusy !== null}
                        onClick={() => promote(c)}
                      >
                        {busyId === c.id ? "Promoting…" : PROMOTE_LABELS[kind]}
                      </button>
                    )}
                    <button
                      type="button"
                      className="unearth-button reject-button"
                      disabled={busyId === c.id || bulkBusy !== null}
                      onClick={() => reject(c)}
                    >
                      {busyId === c.id ? "…" : "Reject"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
