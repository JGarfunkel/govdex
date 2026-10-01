import Link from "next/link";
import { ResourceGlyphs } from "./ResourceGlyphs";
import { ChannelGlyphs } from "./ChannelGlyphs";
import type { EntityRef } from "../lib/geoTypes";

// Concepts for general-purpose governments (state, county, municipality):
// these get Projects and Budget glyphs and no community channels.
const GENERAL_GOVERNMENT_CONCEPTS = new Set(["state", "county", "city", "town", "village", "borough", "township", "municipality"]);

// A row per child entity: hyperlinked name (its own /<state>/... page when it
// has a slug, falling back to the stable UUID permalink otherwise) with the
// resource and channel glyph rows to the right.
export function EntityList({ items, basePath }: { items: EntityRef[]; basePath: string }) {
  return (
    <ul className="entity-list">
      {items.map((item) => {
        const isGeneralGov = GENERAL_GOVERNMENT_CONCEPTS.has(item.concept);
        const childPath = item.relativePath ?? item.slug;
        const href = childPath ? `${basePath}/${childPath}` : `/jurisdictions/${item.id}`;
        return (
          <li key={item.id}>
            <Link href={href} className="entity-name">
              {item.name} <span className="entity-meta">({item.localName ?? item.concept})</span>
              {item.hasSevereFriction && (
                <span className="friction-warning" title="Severe friction found">
                  {" "}
                  ⚠
                </span>
              )}
            </Link>
            <span className="entity-meta">
              Last updated{" "}
              {new Date(item.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            </span>
            <span className="entity-glyph-rows">
              <ResourceGlyphs
                website={item.website}
                budgetUrl={item.budgetUrl}
                showBudget={isGeneralGov}
                showProjects={isGeneralGov}
                editTarget={item.editTarget}
              />
              <span className="glyph-divider" aria-hidden="true" />
              <ChannelGlyphs
                email={item.email}
                channels={item.channels}
                editTarget={item.editTarget}
                hideCommunity={isGeneralGov}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
