import Link from "next/link";
import { AccordionSection } from "./Accordion";
import { CapabilityGlyphs } from "./CapabilityGlyphs";
import { ResourceGlyphs } from "./ResourceGlyphs";
import { ChannelGlyphs } from "./ChannelGlyphs";
import { EntityList } from "./EntityList";
import { HeaderWebsite } from "./HeaderWebsite";
import { SpiderCandidates } from "./SpiderCandidates";
import { Friction } from "./Friction";
import type { GeoPayload } from "../lib/geoTypes";

interface Crumb {
  label: string;
  href: string;
}

export function EntityPage({
  payload,
  basePath,
  breadcrumbs,
}: {
  payload: GeoPayload;
  basePath: string;
  breadcrumbs: Crumb[];
}) {
  const {
    jurisdiction,
    chiefExecutive,
    governingBody,
    legislativeDistricts,
    legislativeDistrictsSource,
    legislativeDistrictsLabel,
    committees,
    committeesSource,
    committeesLabel,
    advisoryBoards,
    advisoryBoardsSource,
    subdivisions,
    subdivisionsSource,
    subdivisionsLabel,
    additionalSubdivisions,
    linkedEntities,
    candidateDocuments,
    frictions,
  } = payload;
  const districtCount = legislativeDistricts.seats.length + legislativeDistricts.districts.length;
  // Every body already loaded for this jurisdiction, offered as the target
  // picker when promoting a spider-found channel candidate — see
  // SpiderCandidates, which defaults to a candidate's own source_body_id
  // (when the crawl was scoped to that body) and falls back to the first
  // entry here otherwise.
  const allBodies = [...chiefExecutive, ...governingBody, ...committees, ...advisoryBoards].map((b) => ({ id: b.id, name: b.name }));

  return (
    <main>
      <header className="entity-header">
        <nav className="breadcrumb">
          {breadcrumbs.map((c, i) => (
            <span key={c.href}>
              {i > 0 && " / "}
              <Link href={c.href}>{c.label}</Link>
            </span>
          ))}
        </nav>

        <h1>
          {jurisdiction.localName ?? jurisdiction.concept} — {jurisdiction.name}
        </h1>
        <HeaderWebsite
          jurisdictionId={jurisdiction.id}
          website={jurisdiction.website}
          policyUrl={jurisdiction.policyUrl}
          budgetUrl={jurisdiction.budgetUrl}
          hasActiveGovernment={jurisdiction.hasActiveGovernment}
        />
        <p className="entity-meta">
          Last updated{" "}
          {new Date(jurisdiction.updatedAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
        {jurisdiction.hasSevereFriction && (
          <p className="warning">
            <a href="#friction">⚠ Severe friction found — see Friction below</a>
          </p>
        )}
      </header>

      <SpiderCandidates jurisdictionId={jurisdiction.id} bodies={allBodies} />

      <AccordionSection title="Chief executive" count={chiefExecutive.length} defaultOpen>
        {chiefExecutive.length === 0 && <p className="field-blank">No chief executive recorded.</p>}
        <ul className="entity-list">
          {chiefExecutive.map((b) => (
            <li key={b.id}>
              <Link href={`/bodies/${b.id}`} className="entity-name">
                {b.name}
              </Link>
              <span className="entity-glyph-rows">
                <ResourceGlyphs
                  website={b.website}
                  agendaUrl={b.agendaUrl}
                  minutesUrl={b.minutesUrl}
                  showProjects
                  editTarget={{ table: "bodies", id: b.id }}
                />
                <span className="glyph-divider" aria-hidden="true" />
                <ChannelGlyphs email={b.email} channels={b.channels} editTarget={{ table: "bodies", id: b.id }} />
                <span className="glyph-divider" aria-hidden="true" />
                <CapabilityGlyphs category={b.category} adoptions={b.adoptions} />
              </span>
            </li>
          ))}
        </ul>
      </AccordionSection>

      <AccordionSection title="Governing body" count={governingBody.length} defaultOpen>
        {governingBody.length === 0 && <p className="field-blank">No governing body recorded.</p>}
        <ul className="entity-list">
          {governingBody.map((b) => (
            <li key={b.id}>
              <Link href={`/bodies/${b.id}`} className="entity-name">
                {b.name}
              </Link>
              <span className="entity-glyph-rows">
                <ResourceGlyphs
                  website={b.website}
                  agendaUrl={b.agendaUrl}
                  minutesUrl={b.minutesUrl}
                  showProjects
                  editTarget={{ table: "bodies", id: b.id }}
                />
                <span className="glyph-divider" aria-hidden="true" />
                <ChannelGlyphs email={b.email} channels={b.channels} editTarget={{ table: "bodies", id: b.id }} />
                <span className="glyph-divider" aria-hidden="true" />
                <CapabilityGlyphs category={b.category} adoptions={b.adoptions} />
              </span>
            </li>
          ))}
        </ul>
      </AccordionSection>

      {legislativeDistrictsLabel && (
        <AccordionSection
          title={legislativeDistrictsLabel}
          count={districtCount}
          source={legislativeDistrictsSource}
          sourceEditColumn="legislative_districts_url"
          jurisdictionId={jurisdiction.id}
        >
          {districtCount === 0 && <p className="field-blank">No seats or districts recorded.</p>}
          {legislativeDistricts.seats.length > 0 && (
            <ul className="entity-list">
              {legislativeDistricts.seats.map((s) => (
                <li key={s.id}>
                  <span className="entity-name">{s.title}</span>
                  <span className="entity-meta">{s.officialName ?? "vacant / not yet recorded"}</span>
                </li>
              ))}
            </ul>
          )}
          {legislativeDistricts.districts.length > 0 && <EntityList items={legislativeDistricts.districts} basePath={basePath} />}
        </AccordionSection>
      )}

      {committeesLabel && (
        <AccordionSection title={committeesLabel} count={committees.length} source={committeesSource}>
          {committees.length === 0 && <p className="field-blank">No committees recorded.</p>}
          <ul className="entity-list">
            {committees.map((b) => (
              <li key={b.id}>
                <Link href={`/bodies/${b.id}`} className="entity-name">
                  {b.name}
                </Link>
                <span className="entity-glyph-rows">
                  <ResourceGlyphs
                    website={b.website}
                    agendaUrl={b.agendaUrl}
                    minutesUrl={b.minutesUrl}
                    showProjects
                    editTarget={{ table: "bodies", id: b.id }}
                  />
                  <span className="glyph-divider" aria-hidden="true" />
                  <ChannelGlyphs email={b.email} channels={b.channels} editTarget={{ table: "bodies", id: b.id }} />
                  <span className="glyph-divider" aria-hidden="true" />
                  <CapabilityGlyphs category={b.category} adoptions={b.adoptions} />
                </span>
              </li>
            ))}
          </ul>
        </AccordionSection>
      )}

      <AccordionSection title="Advisory boards" count={advisoryBoards.length} source={advisoryBoardsSource}>
        {advisoryBoards.length === 0 && <p className="field-blank">No advisory boards recorded.</p>}
        <ul className="entity-list">
          {advisoryBoards.map((b) => (
            <li key={b.id}>
              <Link href={`/bodies/${b.id}`} className="entity-name">
                {b.name}
              </Link>
              <span className="entity-glyph-rows">
                <ResourceGlyphs
                  website={b.website}
                  agendaUrl={b.agendaUrl}
                  minutesUrl={b.minutesUrl}
                  showProjects
                  editTarget={{ table: "bodies", id: b.id }}
                />
                <span className="glyph-divider" aria-hidden="true" />
                <ChannelGlyphs email={b.email} channels={b.channels} editTarget={{ table: "bodies", id: b.id }} />
                <span className="glyph-divider" aria-hidden="true" />
                <CapabilityGlyphs category={b.category} adoptions={b.adoptions} />
              </span>
            </li>
          ))}
        </ul>
      </AccordionSection>

      {subdivisionsLabel && (
        <AccordionSection title={subdivisionsLabel} count={subdivisions.length} source={subdivisionsSource}>
          {subdivisions.length === 0 && <p className="field-blank">No {subdivisionsLabel.toLowerCase()} recorded.</p>}
          <EntityList items={subdivisions} basePath={basePath} />
        </AccordionSection>
      )}

      {additionalSubdivisions.map((section) => (
        <AccordionSection key={section.label} title={section.label} count={section.entities.length} source={section.source}>
          {section.entities.length === 0 && <p className="field-blank">No {section.label.toLowerCase()} recorded.</p>}
          <EntityList items={section.entities} basePath={basePath} />
        </AccordionSection>
      ))}

      <AccordionSection title="Linked entities" count={linkedEntities.length}>
        {linkedEntities.length === 0 && <p className="field-blank">No linked entities recorded.</p>}
        <ul className="entity-list">
          {linkedEntities.map((e) => (
            <li key={e.id}>
              <Link href={`/jurisdictions/${e.id}`} className="entity-name">
                {e.name} <span className="entity-meta">({e.localName ?? e.concept})</span>
              </Link>
              <span className="entity-glyph-rows">
                <ResourceGlyphs website={e.website} editTarget={e.editTarget} isJurisdiction />
                <span className="glyph-divider" aria-hidden="true" />
                <ChannelGlyphs email={e.email} channels={e.channels} editTarget={e.editTarget} />
              </span>
            </li>
          ))}
        </ul>
      </AccordionSection>

      <AccordionSection title="Crawled documents" count={candidateDocuments.length}>
        {candidateDocuments.length === 0 && <p className="field-blank">No crawled documents recorded.</p>}
        <ul className="entity-list">
          {candidateDocuments.map((d) => (
            <li key={d.id}>
              <a href={d.targetUrl} target="_blank" rel="noopener noreferrer" className="entity-name">
                {d.title ?? d.targetUrl}
              </a>
              <span className="entity-meta">
                {d.cached && <i className="ti ti-device-floppy" title="cached locally" />}{" "}
                last fetched{" "}
                {new Date(d.discoveredAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </span>
            </li>
          ))}
        </ul>
      </AccordionSection>

      <AccordionSection id="friction" title="Friction" count={frictions.length}>
        <Friction jurisdictionId={jurisdiction.id} frictions={frictions} />
      </AccordionSection>
    </main>
  );
}
