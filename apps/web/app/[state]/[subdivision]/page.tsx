import type { Metadata } from "next";
import { fetchGeoPayload, notFoundOrRethrow } from "../../../lib/api";
import { EntityPage } from "../../../components/EntityPage";
import type { GeoPayload } from "../../../lib/geoTypes";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; subdivision: string }>;
}): Promise<Metadata> {
  const { state, subdivision } = await params;
  try {
    const payload = await fetchGeoPayload(`${state}/${subdivision}`);
    return { title: `${payload.jurisdiction.name} - GovDex` };
  } catch {
    return {};
  }
}

export default async function SubdivisionPage({ params }: { params: Promise<{ state: string; subdivision: string }> }) {
  const { state, subdivision } = await params;
  let payload: GeoPayload;
  try {
    payload = await fetchGeoPayload(`${state}/${subdivision}`);
  } catch (e) {
    notFoundOrRethrow(e);
  }

  return (
    <EntityPage
      payload={payload}
      basePath={`/${state}/${subdivision}`}
      breadcrumbs={[
        { label: "Stack", href: "/" },
        { label: state.toUpperCase(), href: `/${state}` },
        { label: payload.jurisdiction.name, href: `/${state}/${subdivision}` },
      ]}
    />
  );
}
