import { capabilityForFunctionCode } from "@govdex/shared";
import Link from "next/link";
import { AccordionSection } from "./Accordion";
import type { AdoptionDetail } from "../lib/geoTypes";

// Every product this jurisdiction (or one of its bodies) has adopted — the
// jurisdiction is what licenses the software, so most rows have no body. The
// per-body glyph rows (CapabilityGlyphs) are a summary of the same data.
export function AdoptionsCard({ adoptions }: { adoptions: AdoptionDetail[] }) {
  return (
    <AccordionSection title="Software products used" count={adoptions.length} defaultOpen>
      {adoptions.length === 0 && <p className="field-blank">No adopted products recorded.</p>}
      <ul className="entity-list">
        {adoptions.map((a) => {
          const capability = capabilityForFunctionCode(a.functionCode);
          return (
            <li key={a.id}>
              <span className="entity-name">
                {capability && <i className={`ti ${capability.glyph}`} style={{ color: capability.color }} title={capability.label} />}{" "}
                {a.instanceUrl ? (
                  <a href={a.instanceUrl} target="_blank" rel="noopener noreferrer">
                    {a.productName}
                  </a>
                ) : (
                  a.productName
                )}{" "}
                <span className="entity-meta">
                  {a.vendor}
                  {capability ? ` · ${capability.label}` : ""}
                </span>
              </span>
              <span className="entity-meta">
                {a.bodyId ? <Link href={`/bodies/${a.bodyId}`}>{a.bodyName}</Link> : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </AccordionSection>
  );
}
