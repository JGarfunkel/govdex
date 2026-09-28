"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { govdexFetchJson } from "../lib/api";
import { EditableGlyph } from "./EditableGlyph";

// The jurisdiction-level website line in EntityPage's header: the link
// itself, a click-to-edit pencil (writes jurisdictions.website via /propose,
// same path as ResourceGlyphs' website glyph), an "Unearth" button that
// re-queues a crawl_jobs row against whatever's already recorded — see POST
// /crawl-jobs in apps/api's crawlJobs route — the jurisdiction's "laws"
// glyph (jurisdictions.policy_url — a Municode/eCode360-style code-publishing
// page, typically promoted from a spider vendor find; see SpiderCandidates),
// and its "budget" glyph (jurisdictions.budget_url), shown only when this
// jurisdiction runs its own active government (concept_profiles.
// has_active_government) — a district that just elects a member to a
// larger body (an Assembly/Senate/Congressional district, say) has no
// budget of its own to publish.
export function HeaderWebsite({
  jurisdictionId,
  website,
  policyUrl,
  budgetUrl,
  hasActiveGovernment,
}: {
  jurisdictionId: string;
  website: string | null;
  policyUrl?: string | null;
  budgetUrl?: string | null;
  hasActiveGovernment?: boolean;
}) {
  const router = useRouter();
  const { idToken, canEdit } = useAuth();
  const [unearthing, setUnearthing] = useState(false);
  const [unearthStatus, setUnearthStatus] = useState<string | null>(null);

  async function proposeField(column: "website" | "policy_url" | "budget_url", newValue: string | null) {
    return govdexFetchJson<{ revisionId: string; applied: boolean }>("/propose", {
      method: "POST",
      idToken: idToken ?? undefined,
      body: JSON.stringify({
        tableName: "jurisdictions",
        recordId: jurisdictionId,
        op: "update",
        diff: { [column]: newValue },
      }),
    });
  }

  async function unearth() {
    setUnearthing(true);
    setUnearthStatus(null);
    try {
      await govdexFetchJson("/crawl-jobs", {
        method: "POST",
        idToken: idToken ?? undefined,
        body: JSON.stringify({ jurisdictionId }),
      });
      setUnearthStatus("Queued for crawling.");
      router.refresh();
    } catch (err) {
      setUnearthStatus(err instanceof Error ? err.message : "Failed to queue crawl");
    } finally {
      setUnearthing(false);
    }
  }

  return (
    <p className="entity-website">
      {website ? (
        <a href={website} target="_blank" rel="noopener noreferrer">
          {website}
        </a>
      ) : (
        <span className="field-blank">No website recorded.</span>
      )}
      {canEdit && (
        <EditableGlyph edit={{ value: website, kind: "url", save: (v) => proposeField("website", v) }} trigger="click">
          <i className="ti ti-pencil" title="edit website" />
        </EditableGlyph>
      )}
      {canEdit && website && (
        <button type="button" className="unearth-button" disabled={unearthing} onClick={unearth} title="Re-crawl this website for related info">
          {unearthing ? "Unearthing…" : "Unearth"}
        </button>
      )}
      {unearthStatus && <span className="entity-meta">{unearthStatus}</span>}
      <span className="glyph-divider" aria-hidden="true" />
      <EditableGlyph
        edit={canEdit ? { value: policyUrl ?? null, kind: "url", save: (v) => proposeField("policy_url", v) } : undefined}
      >
        {policyUrl ? (
          <a href={policyUrl} target="_blank" rel="noopener noreferrer" title={canEdit ? "policies / law (right-click to edit)" : "policies / law"}>
            <i className="ti ti-gavel" style={{ color: "#5a686e" }} />
          </a>
        ) : (
          <i className="ti ti-gavel" title={canEdit ? "no policies / law (right-click to edit)" : "no policies / law"} />
        )}
      </EditableGlyph>
      {hasActiveGovernment && (
        <EditableGlyph
          edit={canEdit ? { value: budgetUrl ?? null, kind: "url", save: (v) => proposeField("budget_url", v) } : undefined}
        >
          {budgetUrl ? (
            <a href={budgetUrl} target="_blank" rel="noopener noreferrer" title={canEdit ? "budget (right-click to edit)" : "budget"}>
              <i className="ti ti-report-money" style={{ color: "#5a686e" }} />
            </a>
          ) : (
            <i className="ti ti-report-money" title={canEdit ? "no budget (right-click to edit)" : "no budget"} />
          )}
        </EditableGlyph>
      )}
      {/* No projects_url field exists yet, so this is always the faint "no
          projects" state — same has_active_government gate as Rules/Budget,
          per data-dictionary.md's Typing rules. */}
      {hasActiveGovernment && <i className="ti ti-crane" title="no projects" />}
      {unearthStatus && <span className="entity-meta">{unearthStatus}</span>}
    </p>
  );
}
