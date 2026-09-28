"use client";

import { GOV_CAPABILITIES, capabilityForFunctionCode, scopeForBodyCategory } from "@govdex/shared";
import type { AdoptionInfo } from "../lib/geoTypes";
import { useAuth } from "./AuthProvider";
import { govdexFetchJson } from "../lib/api";
import { EditableGlyph } from "./EditableGlyph";

// Per-body row of the seven gov-capability glyphs (see
// packages/shared/src/govCapabilities.ts): colored + linked when the body
// has a recorded adoption rolling up to that category, faint when not.
// Jurisdiction/body page only (EntityPage's chief-executive/governing-body/
// committee/advisory-board lists) — deliberately absent from the
// subdivisions chart.
export function CapabilityGlyphs({ category, adoptions }: { category: string; adoptions: AdoptionInfo[] }) {
  const { idToken, canEdit } = useAuth();
  const scope = scopeForBodyCategory(category);
  if (!scope) return null;

  const capabilities = GOV_CAPABILITIES.filter((c) => c.appliesTo.includes(scope));

  async function proposeInstanceUrl(adoptionId: string, newValue: string | null) {
    return govdexFetchJson<{ revisionId: string; applied: boolean }>("/propose", {
      method: "POST",
      idToken: idToken ?? undefined,
      body: JSON.stringify({
        tableName: "adoptions",
        recordId: adoptionId,
        op: "update",
        diff: { instance_url: newValue },
      }),
    });
  }

  return (
    <span className="glyphs capability-glyphs">
      {capabilities.map((c) => {
        const matches = adoptions.filter((a) => capabilityForFunctionCode(a.functionCode)?.id === c.id);
        if (matches.length === 0) {
          return <i key={c.id} className={`ti ${c.glyph}`} title={`${c.label}: not recorded`} />;
        }
        const title = `${c.label}: ${matches.map((m) => m.productName).join(", ")}`;
        const href = matches.find((m) => m.instanceUrl)?.instanceUrl;
        // Editing needs one unambiguous adoption row to write instance_url
        // back to — skip the affordance when several products roll up to
        // this capability, rather than guessing which one a right-click means.
        const edit =
          canEdit && matches.length === 1
            ? { value: matches[0].instanceUrl, kind: "url" as const, save: (v: string | null) => proposeInstanceUrl(matches[0].id, v) }
            : undefined;
        const label = edit ? `${title} (right-click to edit)` : title;
        const glyph = !href ? (
          <i className={`ti ${c.glyph}`} title={label} />
        ) : (
          <a href={href} target="_blank" rel="noopener noreferrer" title={label}>
            <i className={`ti ${c.glyph}`} style={{ color: c.color }} />
          </a>
        );
        return (
          <EditableGlyph key={c.id} edit={edit}>
            {glyph}
          </EditableGlyph>
        );
      })}
    </span>
  );
}
