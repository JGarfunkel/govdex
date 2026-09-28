"use client";

import type { SourceLink } from "../lib/geoTypes";
import { useAuth } from "./AuthProvider";
import { govdexFetchJson } from "../lib/api";
import { EditableGlyph } from "./EditableGlyph";

// Section-level "authoritative source" link — globe for a plain web page,
// brackets for a machine-queryable feed (Legistar/ArcGIS/Socrata/etc; see
// apps/api/src/lib/geoPayload.ts's classifySourceKind). Lives inside an
// AccordionSection's <summary>, so clicks must not bubble into the native
// details-toggle behavior.
// `editColumn` makes this glyph itself editable (right-click), for sections
// backed by a single jurisdictions column — currently only
// legislative_districts_url, the seed page a scribe adds so the spider can
// go find districts/seat holders/committees before any of those rows exist.
// Sections whose source is derived from several bodies/relations (committees,
// subdivisions) have no single column to write to and stay read-only here.
export function SourceGlyph({
  source,
  jurisdictionId,
  editColumn,
}: {
  source: SourceLink | null;
  jurisdictionId?: string;
  editColumn?: "legislative_districts_url";
}) {
  const { idToken, canEdit } = useAuth();
  const editable = canEdit && Boolean(editColumn) && Boolean(jurisdictionId);
  if (!source && !editable) return null;

  const isApi = source?.kind === "api";
  const title = editable
    ? "authoritative source (right-click to edit)"
    : isApi
      ? "authoritative source (API)"
      : "authoritative source";

  return (
    <EditableGlyph
      edit={
        editable
          ? {
              value: source?.url ?? null,
              kind: "url",
              save: (newValue) =>
                govdexFetchJson<{ revisionId: string; applied: boolean }>("/propose", {
                  method: "POST",
                  idToken: idToken ?? undefined,
                  body: JSON.stringify({
                    tableName: "jurisdictions",
                    recordId: jurisdictionId,
                    op: "update",
                    diff: { [editColumn!]: newValue },
                  }),
                }),
            }
          : undefined
      }
    >
      {source ? (
        <a href={source.url} target="_blank" rel="noopener noreferrer" title={title} className="source-glyph" onClick={(e) => e.stopPropagation()}>
          <i className={`ti ${isApi ? "ti-brackets" : "ti-world"}`} />
        </a>
      ) : (
        <span className="source-glyph" title="no authoritative source (right-click to add)">
          <i className="ti ti-world" />
        </span>
      )}
    </EditableGlyph>
  );
}
