// Asks the Next app to expire its cached pages. Next's revalidateTag only works
// inside a Next request, so even though the API shares the process with Next we
// go through POST /revalidate (apps/web/app/revalidate/route.ts).
//
// Targets this process's own server by default, so a local instance pointed at
// the prod database only expires the local cache. Set REVALIDATE_URL to aim at
// another deployment (the ingestion scripts do this to hit prod).
// Best-effort: a failure is logged, never thrown — the 24h TTL is the backstop.
export async function requestRevalidate(tags?: string[]): Promise<void> {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return; // not configured: nothing is being served from cache that we know of
  const base = process.env.REVALIDATE_URL ?? `http://localhost:${process.env.PORT ?? 5000}`;
  try {
    const res = await fetch(`${base}/revalidate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(tags ? { tags } : {}),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`[revalidate] ${base}/revalidate -> ${res.status}`);
  } catch (e) {
    console.error(`[revalidate] ${base}/revalidate failed:`, e instanceof Error ? e.message : e);
  }
}
