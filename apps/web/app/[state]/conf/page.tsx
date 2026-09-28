import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { govdexFetchJson } from "../../../lib/api";
import { AccordionSection } from "../../../components/Accordion";
import { ConfKvTable, humanize } from "../../../components/ConfKv";

// Raw shape of packages/shared/src/conf/<state>.yaml, as served by
// apps/api's /conf/:state route — see StateProfile in
// packages/shared/src/conf/profile.ts. Typed loosely (Record<string,
// unknown> per entry) on purpose: this page renders whatever fields the
// YAML actually has, not just the ones profile.ts's interfaces declare.
interface ConfPayload {
  profile: { code: string; name: string; config: Record<string, unknown> };
  concepts: Record<string, Record<string, unknown>>;
  governance?: Record<string, Record<string, unknown>>;
  sources?: Record<string, Record<string, unknown> & { field_mapping?: Record<string, unknown> }>;
}

async function loadConf(state: string): Promise<ConfPayload> {
  return govdexFetchJson<ConfPayload>(`/conf/${state}`);
}

export async function generateMetadata({ params }: { params: Promise<{ state: string }> }): Promise<Metadata> {
  const { state } = await params;
  try {
    const conf = await loadConf(state);
    return { title: `${conf.profile.name} Config Review - GovDex` };
  } catch {
    return {};
  }
}

export default async function ConfPage({ params }: { params: Promise<{ state: string }> }) {
  const { state } = await params;
  let conf: ConfPayload;
  try {
    conf = await loadConf(state);
  } catch {
    notFound();
  }

  const concepts = Object.entries(conf.concepts ?? {});
  const governance = Object.entries(conf.governance ?? {});
  const sources = Object.entries(conf.sources ?? {});

  return (
    <main>
      <header className="entity-header">
        <nav className="breadcrumb">
          <span>
            <Link href="/">Stack</Link>
          </span>
          <span>
            {" / "}
            <Link href={`/${state}`}>{state.toUpperCase()}</Link>
          </span>
          <span>
            {" / "}
            <Link href={`/${state}/conf`}>Config review</Link>
          </span>
        </nav>
        <h1>{conf.profile.name} — Config Review</h1>
        <p className="entity-meta">
          {conf.profile.code} · packages/shared/src/conf/{state}.yaml
        </p>
      </header>

      <AccordionSection title="Profile config" defaultOpen>
        <ConfKvTable data={conf.profile.config} />
      </AccordionSection>

      <AccordionSection title="Concepts" count={concepts.length} defaultOpen>
        {concepts.length === 0 && <p className="field-blank">No concepts recorded.</p>}
        {concepts.map(([code, concept]) => (
          <AccordionSection key={code} title={(concept.local_name as string | undefined) ?? code}>
            <ConfKvTable data={concept} />
          </AccordionSection>
        ))}
      </AccordionSection>

      <AccordionSection title="Governance" count={governance.length}>
        {governance.length === 0 && <p className="field-blank">No governance entries recorded.</p>}
        {governance.map(([key, entry]) => (
          <AccordionSection key={key} title={humanize(key)}>
            <ConfKvTable data={entry} />
          </AccordionSection>
        ))}
      </AccordionSection>

      <AccordionSection title="Sources" count={sources.length}>
        {sources.length === 0 && <p className="field-blank">No sources recorded.</p>}
        {sources.map(([key, source]) => {
          const { field_mapping, ...rest } = source;
          return (
            <AccordionSection key={key} title={humanize(key)}>
              <ConfKvTable data={rest} />
              {field_mapping && (
                <AccordionSection title="Field mapping" count={Object.keys(field_mapping).length}>
                  <ConfKvTable data={field_mapping} />
                </AccordionSection>
              )}
            </AccordionSection>
          );
        })}
      </AccordionSection>
    </main>
  );
}
