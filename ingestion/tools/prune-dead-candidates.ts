// prune-dead-candidates — standalone/scheduled pass over 'new'
// candidate_links rows, rejecting the ones whose target_url is confirmed
// dead (see pruneDeadCandidates.ts for the check itself). run.ts and
// worker.ts also call pruneDeadCandidates() automatically after a crawl, so
// this CLI is for a manual sweep — e.g. re-checking older 'new' rows that
// weren't part of any recent crawl, or one jurisdiction on demand.
//
// Usage:
//   npx tsx ingestion/tools/prune-dead-candidates.ts                  check every 'new' candidate
//   npx tsx ingestion/tools/prune-dead-candidates.ts "Bethlehem"      check candidates for jurisdictions matching this name
//   npx tsx ingestion/tools/prune-dead-candidates.ts --dry-run        report what would be rejected without writing anything
import "dotenv/config";
import { getPool } from "@govdex/db";
import { pruneDeadCandidates } from "../spider/pruneDeadCandidates";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const namePattern = args.find((a) => !a.startsWith("--")) ?? null;

  const pool = getPool();
  console.log(`Checking 'new' candidate(s)${namePattern ? ` for jurisdictions matching "${namePattern}"` : ""}...\n`);

  const summary = await pruneDeadCandidates(pool, { namePattern, dryRun });

  console.log(
    `\n${summary.alive} alive, ${summary.dead} dead${dryRun ? " (dry run)" : ", rejected + blacklisted"}, ${summary.ambiguous} ambiguous (left as-is)`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
