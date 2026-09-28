// Minimal ArcGIS REST feature-layer client: pages through resultOffset until
// a page comes back short, mirroring lib/soda.ts's Socrata pager.
export async function arcgisFetchAll<T = Record<string, unknown>>(
  layerQueryUrl: string, // e.g. ".../MapServer/18/query"
  outFields: string[],
  where = "1=1",
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const url = new URL(layerQueryUrl);
    url.searchParams.set("where", where);
    url.searchParams.set("outFields", outFields.join(","));
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(pageSize));
    url.searchParams.set("f", "json");

    const res = await fetch(url, { headers: { "User-Agent": "GovdexIngestion/0.1" } });
    if (!res.ok) {
      throw new Error(`ArcGIS request failed: ${res.status} ${res.statusText} (${url})`);
    }
    const body = (await res.json()) as { features?: { attributes: T }[]; error?: { message: string } };
    if (body.error) {
      throw new Error(`ArcGIS query error: ${body.error.message} (${url})`);
    }
    const page = (body.features ?? []).map((f) => f.attributes);
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}
