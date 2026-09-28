import type { ReactNode } from "react";
import type { SourceLink } from "../lib/geoTypes";
import { SourceGlyph } from "./SourceGlyph";

// Native <details>/<summary> accordion — no JS, no new dependency (apps/web
// has neither Radix nor Tailwind wired up today).
export function AccordionSection({
  id,
  title,
  count,
  source,
  sourceEditColumn,
  jurisdictionId,
  defaultOpen,
  children,
}: {
  id?: string;
  title: string;
  count?: number;
  source?: SourceLink | null;
  // Makes the source glyph itself editable — see SourceGlyph's editColumn.
  sourceEditColumn?: "legislative_districts_url";
  jurisdictionId?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details id={id} className="accordion-section" open={defaultOpen}>
      <summary>
        <span>
          {title}
          {typeof count === "number" && <span className="accordion-count"> ({count})</span>}
          {(source || sourceEditColumn) && (
            <SourceGlyph source={source ?? null} jurisdictionId={jurisdictionId} editColumn={sourceEditColumn} />
          )}
        </span>
      </summary>
      <div className="accordion-body">{children}</div>
    </details>
  );
}
