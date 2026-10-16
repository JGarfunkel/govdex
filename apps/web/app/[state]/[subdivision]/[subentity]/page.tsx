import type { Metadata } from "next";
import { fetchGeoPayload, notFoundOrRethrow } from "../../../../lib/api";
import { EntityPage } from "../../../../components/EntityPage";
import type { GeoPayload } from "../../../../lib/geoTypes";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; subdivision: string; subentity: string }>;
}): Promise<Metadata> {
  const { state, subdivision, subentity } = await params;
  try {
    const payload = await fetchGeoPayload(`${state}/${subdivision}/${subentity}`);
    return { title: `${payload.jurisdiction.name} - GovDex` };
  } catch {
    return {};
  }
}

export default async function SubentityPage({
  params,
}: {
  params: Promise<{ state: string; subdivision: string; subentity: string }>;
}) {
  const { state, subdivision, subentity } = await params;
  let payload: GeoPayload;
  try {
    payload = await fetchGeoPayload(`${state}/${subdivision}/${subentity}`);
  } catch (e) {
    notFoundOrRethrow(e);
  }

  return (
    <EntityPage
      payload={payload}
      basePath={`/${state}/${subdivision}/${subentity}`}
      breadcrumbs={[
        { label: "Stack", href: "/" },
        { label: state.toUpperCase(), href: `/${state}` },
        { label: subdivision, href: `/${state}/${subdivision}` },
        { label: payload.jurisdiction.name, href: `/${state}/${subdivision}/${subentity}` },
      ]}
    />
  );
}
