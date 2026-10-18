import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { GEO_CACHE_TAG } from "../../lib/api";

// Expires cached GovDex pages. revalidateTag only works inside a Next request,
// so anything outside Next (the API's withUser, ingestion scripts, an admin
// with curl) POSTs here:
//   curl -X POST https://<host>/revalidate -H "Authorization: Bearer $REVALIDATE_SECRET"
// Optional JSON body {"tags": ["geo"]}; defaults to the "geo" tag (all
// jurisdiction/state pages). Shared-secret auth for now; swap for an admin
// check once the auth model is extended.
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ message: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { tags?: unknown };
  const tags =
    Array.isArray(body.tags) && body.tags.every((t) => typeof t === "string") && body.tags.length > 0
      ? (body.tags as string[])
      : [GEO_CACHE_TAG];

  // expire: 0 = next request waits for fresh data rather than seeing stale.
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
  return Response.json({ revalidated: tags });
}
