// Same-origin fetch wrapper against /api/stack/*. In the browser, a relative
// path is enough (GovDex's Next app and its API are mounted in the same
// process/port). Server components run in Node with no implicit request
// origin, so they need an absolute URL — GOVDEX_API_BASE_URL (defaulting to
// the same port this process listens on) supplies that.
function apiBaseUrl(): string {
  if (typeof window !== "undefined") return "";
  return process.env.GOVDEX_API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 5000}`;
}

export async function govdexFetch(path: string, init?: RequestInit & { idToken?: string }) {
  const { idToken, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  if (idToken) headers.set("Authorization", `Bearer ${idToken}`);
  if (rest.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${apiBaseUrl()}/api/stack${path}`, {
    ...rest,
    headers,
    cache: "no-store",
  });
  return res;
}

export async function govdexFetchJson<T>(path: string, init?: RequestInit & { idToken?: string }): Promise<T> {
  const res = await govdexFetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message ?? `Request to ${path} failed with ${res.status}`);
  }
  return res.json();
}
