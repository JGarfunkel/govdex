import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { govdexFetchJson } from "../../lib/api";
import { EntityPage } from "../../components/EntityPage";
import type { GeoPayload } from "../../lib/geoTypes";

export async function generateMetadata({ params }: { params: Promise<{ state: string }> }): Promise<Metadata> {
  const { state } = await params;
  try {
    const payload = await govdexFetchJson<GeoPayload>(`/geo/${state}`);
    return { title: `${payload.jurisdiction.name} - GovDex` };
  } catch {
    return {};
  }
}

export default async function StatePage({ params }: { params: Promise<{ state: string }> }) {
  const { state } = await params;
  let payload: GeoPayload;
  try {
    payload = await govdexFetchJson<GeoPayload>(`/geo/${state}`);
  } catch {
    notFound();
  }

  return (
    <EntityPage
      payload={payload}
      basePath={`/${state}`}
      breadcrumbs={[
        { label: "Stack", href: "/" },
        { label: payload.jurisdiction.name, href: `/${state}` },
      ]}
    />
  );
}
