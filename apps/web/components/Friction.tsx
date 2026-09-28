"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { govdexFetchJson } from "../lib/api";
import type { FrictionInfo } from "../lib/geoTypes";

// Manual-only pattern types (see packages/shared/src/enums.ts's
// MANUAL_FRICTION_TYPES) — robots_txt_* are only ever written by
// ingestion/spider/fetcher.ts, so they're not offered in the report form.
const MANUAL_TYPES: { value: string; label: string }[] = [
  { value: "api_inadequate", label: "API is inadequate" },
  { value: "index_in_menu_not_page", label: "Index (e.g. committees) buried in a menu instead of its own page" },
];

const TYPE_LABELS: Record<string, string> = {
  robots_txt_excludes_crawler: "robots.txt excludes crawlers",
  robots_txt_discriminatory: "robots.txt discriminates against this crawler",
  api_inadequate: "API is inadequate",
  index_in_menu_not_page: "Index buried in a menu instead of its own page",
  budget_only_pdf: "Budget is only published as a PDF, not an HTML page",
  website_com_tld: "Government site uses a .com domain",
  crawler_blocked: "Bot-management challenge blocks this crawler",
  crawler_blocked_secondary: "Bot-management challenge blocks this crawler on a secondary page",
};

// Public list of this jurisdiction's open friction (payload.frictions
// already excludes resolved/dismissed rows — see loadFriction in
// apps/api/src/lib/geoPayload.ts), with scribe-only triage actions inline:
// a spider-found 'new' row can be confirmed or dismissed, any open row can be
// marked resolved once the underlying issue is actually fixed. Scribes can
// also file a new friction directly for a judgment call the spider can't make.
export function Friction({ jurisdictionId, frictions }: { jurisdictionId: string; frictions: FrictionInfo[] }) {
  const router = useRouter();
  const { idToken, canEdit } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportType, setReportType] = useState(MANUAL_TYPES[0].value);
  const [reportPageUrl, setReportPageUrl] = useState("");
  const [reportSummary, setReportSummary] = useState("");
  const [reporting, setReporting] = useState(false);

  async function act(id: string, action: "confirm" | "dismiss" | "resolve") {
    setBusyId(id);
    setError(null);
    try {
      await govdexFetchJson(`/frictions/${id}/${action}`, { method: "POST", idToken: idToken ?? undefined });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setBusyId(null);
    }
  }

  async function submitReport() {
    if (!reportPageUrl || !reportSummary) return;
    setReporting(true);
    setError(null);
    try {
      await govdexFetchJson("/frictions", {
        method: "POST",
        idToken: idToken ?? undefined,
        body: JSON.stringify({ jurisdictionId, patternType: reportType, pageUrl: reportPageUrl, summary: reportSummary }),
      });
      setShowReportForm(false);
      setReportPageUrl("");
      setReportSummary("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to file friction");
    } finally {
      setReporting(false);
    }
  }

  return (
    <>
      {frictions.length === 0 && <p className="field-blank">No friction recorded.</p>}
      <ul className="entity-list">
        {frictions.map((p) => (
          <li key={p.id}>
            <span className="entity-name">{TYPE_LABELS[p.patternType] ?? p.patternType}</span>
            {p.severity === "severe" && <span className="severity-badge">Severe</span>}
            <span className="entity-meta">
              {p.summary} — {p.status === "new" ? "unreviewed" : "confirmed"}
            </span>
            {canEdit && (
              <span className="spider-candidate-form">
                {p.status === "new" && (
                  <button type="button" className="unearth-button" disabled={busyId === p.id} onClick={() => act(p.id, "confirm")}>
                    Confirm
                  </button>
                )}
                {p.status === "new" && (
                  <button type="button" className="unearth-button" disabled={busyId === p.id} onClick={() => act(p.id, "dismiss")}>
                    Dismiss
                  </button>
                )}
                <button type="button" className="unearth-button" disabled={busyId === p.id} onClick={() => act(p.id, "resolve")}>
                  Mark resolved
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="warning">{error}</p>}
      {canEdit && (
        <p>
          {!showReportForm ? (
            <button type="button" className="unearth-button" onClick={() => setShowReportForm(true)}>
              Report friction
            </button>
          ) : (
            <span className="spider-candidate-form">
              <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
                {MANUAL_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input type="url" placeholder="page URL" value={reportPageUrl} onChange={(e) => setReportPageUrl(e.target.value)} />
              <input type="text" placeholder="summary" value={reportSummary} onChange={(e) => setReportSummary(e.target.value)} />
              <button type="button" className="unearth-button" disabled={reporting} onClick={submitReport}>
                {reporting ? "Filing…" : "File"}
              </button>
              <button type="button" className="unearth-button" onClick={() => setShowReportForm(false)}>
                Cancel
              </button>
            </span>
          )}
        </p>
      )}
    </>
  );
}
