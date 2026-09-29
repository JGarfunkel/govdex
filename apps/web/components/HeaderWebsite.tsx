"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { govdexFetchJson } from "../lib/api";
import { EditableGlyph, type GlyphEdit } from "./EditableGlyph";

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
// One labelled "Key Resources" chip: linked and colored when the resource is
// recorded, faint when not (right-click to add, for editors).
function ResourceChip({ icon, label, href, edit }: { icon: string; label: string; href?: string | null; edit?: GlyphEdit }) {
  const content = (
    <>
      <i className={`ti ${icon}`} /> {label}
    </>
  );
  return (
    <EditableGlyph edit={edit}>
      {href ? (
        <a className="resource-chip" href={href} target="_blank" rel="noopener noreferrer" title={edit ? `${label} (right-click to edit)` : label}>
          {content}
        </a>
      ) : (
        <span className="resource-chip resource-chip-missing" title={edit ? `no ${label.toLowerCase()} (right-click to add)` : `no ${label.toLowerCase()} recorded`}>
          {content}
        </span>
      )}
    </EditableGlyph>
  );
}

export function HeaderWebsite({
  jurisdictionId,
  website,
  policyUrl,
  budgetUrl,
  calendarUrl,
  hasActiveGovernment,
}: {
  jurisdictionId: string;
  website: string | null;
  policyUrl?: string | null;
  budgetUrl?: string | null;
  calendarUrl?: string | null;
  hasActiveGovernment?: boolean;
}) {
  const router = useRouter();
  const { idToken, canEdit } = useAuth();
  const [unearthing, setUnearthing] = useState(false);
  const [unearthStatus, setUnearthStatus] = useState<string | null>(null);

  async function proposeField(column: "website" | "policy_url" | "budget_url" | "calendar_url", newValue: string | null) {
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

  const websiteLine = (
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
    </p>
  );

  return (
    <>
      {websiteLine}
      <div className="key-resources" aria-label="Key Resources">
        <span className="key-resources-label">Key Resources</span>
        <ResourceChip
          icon="ti-gavel"
          label="Rules"
          href={policyUrl}
          edit={canEdit ? { value: policyUrl ?? null, kind: "url", save: (v) => proposeField("policy_url", v) } : undefined}
        />
        {hasActiveGovernment && (
          <ResourceChip
            icon="ti-report-money"
            label="Budget"
            href={budgetUrl}
            edit={canEdit ? { value: budgetUrl ?? null, kind: "url", save: (v) => proposeField("budget_url", v) } : undefined}
          />
        )}
        <ResourceChip
          icon="ti-calendar"
          label="Meetings"
          href={calendarUrl}
          edit={canEdit ? { value: calendarUrl ?? null, kind: "url", save: (v) => proposeField("calendar_url", v) } : undefined}
        />
        {/* No projects_url field exists yet, so this is always the faint
            "not recorded" state — same has_active_government gate as
            Rules/Budget, per data-dictionary.md's Typing rules. */}
        {hasActiveGovernment && <ResourceChip icon="ti-crane" label="Projects" href={null} />}
      </div>
    </>
  );
}
