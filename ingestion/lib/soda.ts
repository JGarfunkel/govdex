// Minimal Socrata SODA client: pages through $limit/$offset until a page
// comes back short, so callers don't have to know the total row count ahead
// of time.
export async function sodaFetchAll<T = Record<string, unknown>>(
  resourceUrl: string,
  params: Record<string, string> = {},
  pageSize = 5000,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const url = new URL(resourceUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("$limit", String(pageSize));
    url.searchParams.set("$offset", String(offset));

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Socrata request failed: ${res.status} ${res.statusText} (${url})`);
    }
    const page = (await res.json()) as T[];
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}
