// backfill-page-cache-to-r2 — one-off (re-runnable) push of every page
// already sitting in the local disk cache (ingestion/spider/cache.ts) up to
// Cloudflare R2. Ongoing fetches mirror themselves automatically via
// savePage()'s write-through; this just covers what was fetched before that
// existed, or anything written while R2 was unreachable. Safe to re-run —
// each upload overwrites its key in place.
//
// Usage:
//   npx tsx ingestion/tools/backfill-page-cache-to-r2.ts
import "dotenv/config";
import { isR2Configured, putCachedPage } from "@govdex/storage";
import { listCachedPages, readCachedPage } from "../spider/cache";

async function main() {
  if (!isR2Configured()) {
    console.error("R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET first.");
    process.exit(1);
  }

  const pages = listCachedPages();
  console.log(`Backfilling ${pages.length} cached page(s) to R2...`);

  let done = 0;
  for (const page of pages) {
    const html = readCachedPage(page);
    await putCachedPage(page.url, html, {
      jurisdictionId: page.jurisdictionId,
      sourceBodyId: page.sourceBodyId,
      fetchedAt: page.fetchedAt,
      contentType: page.contentType,
    });
    done++;
    console.log(`  [${done}/${pages.length}] ${page.url}`);
  }

  console.log(`Done — ${done} page(s) uploaded.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
