import crypto from "crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2Bucket, getR2Client, isR2Configured } from "./client";

const PREFIX = "page-cache/";

// Same scheme as the local disk cache (ingestion/spider/cache.ts) — one
// object per unique URL, keyed by a hash of the URL so re-fetching the same
// URL overwrites in place.
export function keyForUrl(url: string): string {
  const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 24);
  return `${PREFIX}${hash}.html`;
}

export interface CachedPageMeta {
  jurisdictionId: string | null;
  sourceBodyId: string | null;
  fetchedAt: string;
  contentType: string | null;
}

export async function putCachedPage(url: string, html: string, meta: CachedPageMeta): Promise<void> {
  if (!isR2Configured()) return;
  try {
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: getR2Bucket(),
        Key: keyForUrl(url),
        Body: html,
        ContentType: meta.contentType ?? "text/html",
        Metadata: {
          url: encodeURIComponent(url),
          jurisdictionid: meta.jurisdictionId ?? "",
          sourcebodyid: meta.sourceBodyId ?? "",
          fetchedat: meta.fetchedAt,
        },
      }),
    );
  } catch (err) {
    console.warn(`  R2 upload failed for ${url}: ${err instanceof Error ? err.message : err}`);
  }
}

export async function getCachedPage(url: string): Promise<{ html: string; meta: CachedPageMeta } | null> {
  if (!isR2Configured()) return null;
  try {
    const res = await getR2Client().send(new GetObjectCommand({ Bucket: getR2Bucket(), Key: keyForUrl(url) }));
    const html = (await res.Body?.transformToString()) ?? "";
    const m = res.Metadata ?? {};
    return {
      html,
      meta: {
        jurisdictionId: m.jurisdictionid || null,
        sourceBodyId: m.sourcebodyid || null,
        fetchedAt: m.fetchedat ?? "",
        contentType: res.ContentType ?? null,
      },
    };
  } catch (err: any) {
    if (err?.name === "NoSuchKey") return null;
    console.warn(`  R2 read failed for ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
