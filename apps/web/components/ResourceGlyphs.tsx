"use client";

import type { EditTarget } from "../lib/geoTypes";
import { useAuth } from "./AuthProvider";
import { govdexFetchJson } from "../lib/api";
import { EditableGlyph, type GlyphEdit } from "./EditableGlyph";

// The "Key Resources" glyph row: what an entity makes available — presence
// (website), Meetings (calendar/agenda/minutes), and Rules (policy). Distinct
// from ChannelGlyphs, which covers the channels an entity uses to
// communicate (email, social platforms) — see the Entities/Resources/
// Channels/Capabilities split in data-dictionary.md.
function Glyph({
  icon,
  label,
  color,
  href,
  edit,
}: {
  icon: string;
  label: string;
  color: string;
  href?: string | null;
  edit?: GlyphEdit;
}) {
  const title = edit ? `${label} (right-click to edit)` : `no ${label}`;
  const glyph = !href ? (
    <i className={`ti ${icon}`} title={title} />
  ) : (
    <a href={href} target="_blank" rel="noopener noreferrer" title={edit ? title : label}>
      <i className={`ti ${icon}`} style={{ color }} />
    </a>
  );
  return <EditableGlyph edit={edit}>{glyph}</EditableGlyph>;
}

export function ResourceGlyphs({
  website,
  calendarUrl,
  agendaUrl,
  minutesUrl,
  policyUrl,
  isJurisdiction,
  // Projects has no backing field yet (no capital-projects table), so this
  // always renders faint/unlinked when shown. Callers opt in per the
  // Entity x Resource matrix in data-dictionary.md — Projects is blank
  // (not applicable) for Region, Media, and Online community, so leave
  // this off there rather than showing a glyph that can never light up.
  showProjects,
  editTarget,
}: {
  website?: string | null;
  calendarUrl?: string | null;
  agendaUrl?: string | null;
  minutesUrl?: string | null;
  policyUrl?: string | null;
  isJurisdiction?: boolean;
  showProjects?: boolean;
  // Where an edit writes to — see ChannelGlyphs' editTarget for the same
  // bodies/jurisdictions split.
  editTarget?: EditTarget;
}) {
  const { idToken, canEdit } = useAuth();
  const editableWebsite = canEdit && Boolean(editTarget);
  const editableBodyOnly = canEdit && editTarget?.table === "bodies";

  async function proposeField(
    table: "bodies" | "jurisdictions",
    column: "website" | "agenda_url" | "minutes_url",
    newValue: string | null,
  ) {
    return govdexFetchJson<{ revisionId: string; applied: boolean }>("/propose", {
      method: "POST",
      idToken: idToken ?? undefined,
      body: JSON.stringify({
        tableName: table,
        recordId: editTarget!.id,
        op: "update",
        diff: { [column]: newValue },
      }),
    });
  }

  return (
    <div className="glyphs">
      <Glyph
        icon="ti-world"
        label="website"
        color="#5a686e"
        href={website}
        edit={
          editableWebsite
            ? { value: website ?? null, kind: "url", save: (v) => proposeField(editTarget!.table, "website", v) }
            : undefined
        }
      />
      <Glyph icon="ti-calendar" label="calendar" color="#5a686e" href={calendarUrl} />
      <Glyph
        icon="ti-list-details"
        label="agenda"
        color="#5a686e"
        href={agendaUrl}
        edit={editableBodyOnly ? { value: agendaUrl ?? null, kind: "url", save: (v) => proposeField("bodies", "agenda_url", v) } : undefined}
      />
      <Glyph
        icon="ti-notes"
        label="minutes"
        color="#5a686e"
        href={minutesUrl}
        edit={
          editableBodyOnly ? { value: minutesUrl ?? null, kind: "url", save: (v) => proposeField("bodies", "minutes_url", v) } : undefined
        }
      />
      {isJurisdiction && <Glyph icon="ti-gavel" label="policies / law" color="#5a686e" href={policyUrl} />}
      {/* No projects_url field exists yet — this glyph is always the faint
          "no projects" state until capital projects are modeled. It's shown
          anyway (when applicable) so the gap reads as an opportunity rather
          than staying invisible — see data-dictionary.md's "Present but
          undiscoverable" / gaps-as-empty-circles framing. */}
      {showProjects && <Glyph icon="ti-crane" label="projects" color="#5a686e" href={null} />}
    </div>
  );
}
