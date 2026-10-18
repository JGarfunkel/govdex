import { cache } from "react";
import { notFound } from "next/navigation";
import type { GeoPayload } from "./geoTypes";

// Same-origin fetch wrapper against /api/stack/*. In the browser, a relative
// path is enough (GovDex's Next app and its API are mounted in the same
// process/port). Server components run in Node with no implicit request
// origin, so they need an absolute URL — GOVDEX_API_BASE_URL (defaulting to
// the same port this process listens on) supplies that.
function apiBaseUrl(): string {
  if (typeof window !== "undefined") return "";
  return process.env.GOVDEX_API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 5000}`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// For server pages: a 404 from the API means "no such page"; anything else
// (database down, 5xx, network failure) is a real error and must reach the
// error boundary (app/error.tsx) instead of masquerading as a 404.
export function notFoundOrRethrow(e: unknown): never {
  if (e instanceof ApiError && e.status === 404) notFound();
  throw e;
}

export async function govdexFetch(path: string, init?: RequestInit & { idToken?: string }) {
  const { idToken, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  if (idToken) headers.set("Authorization", `Bearer ${idToken}`);
  if (rest.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  // Default to no-store; callers opting into Next's data cache pass
  // `next: { revalidate }` (which can't be combined with no-store).
  const res = await fetch(`${apiBaseUrl()}/api/stack${path}`, {
    ...rest,
    headers,
    ...((rest as { next?: unknown }).next ? {} : { cache: "no-store" as const }),
  });
  return res;
}

export async function govdexFetchJson<T>(path: string, init?: RequestInit & { idToken?: string }): Promise<T> {
  const res = await govdexFetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? `Request to ${path} failed with ${res.status}`);
  }
  return res.json();
}

// generateMetadata and the page body both need the same payload; React's
// cache() shares one fetch between them within a single request, so each page
// view costs one API call (and one set of DB queries) instead of two.
//
// The payload is public and identical for every viewer, so it goes in Next's
// data cache (which also makes the page itself ISR). Writes call POST
// /revalidate (app/revalidate/route.ts) to expire the "geo" tag; the long
// revalidate is only a safety net for changes that bypass it.
export const GEO_CACHE_TAG = "geo";
const GEO_REVALIDATE_SECONDS = 24 * 60 * 60;
export const fetchGeoPayload = cache((geoPath: string) =>
  govdexFetchJson<GeoPayload>(`/geo/${geoPath}`, {
    next: { revalidate: GEO_REVALIDATE_SECONDS, tags: [GEO_CACHE_TAG] },
  } as RequestInit),
);
