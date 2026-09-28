// prune-guarded-links — one-time cleanup for candidate_links rows (and their
// disk-cached pages) that were found before crawlSeed.ts's guards against
// alert/calendar noise were tightened, and would be rejected outright by
// today's code:
//
//   - looksLikeAlertLink(target_url) (alertDetector.ts) — crawlSeed.ts now
//     skips any hit matching this before classification even runs, so no
//     link_type should still carry an alert-shaped target_url.
//   - link_type in ('board','district','index') with
//     looksLikeCalendarLink(target_url) (calendarDetector.ts) — boardDetector's
//     guessBoard() now refuses to guess a board/district/index off a
//     calendar-shaped URL, so an existing row of that shape is a stale guess
//     from before that check existed. A link_type='calendar' row matching the
//     same regex is the correct, still-current classification and is left
//     alone.
//
// Only 'new' (unreviewed) rows are touched — a promoted/rejected/duplicate
// row reflects a human decision and stays untouched, same as
// pruneDeadCandidates.ts and crawlJobs.ts's requeue cleanup. Matching rows
// are hard-deleted (not marked 'rejected'): they're spider noise that
// shouldn't have been proposed under current rules, not a real candidate a
// scribe judged and rejected — same precedent as crawlJobs.ts's requeue
// cleanup of 'new' rows.
//
// Each deleted row's target_url is also evicted from the local disk page
// cache (ingestion/spider/cache.ts), so a page fetched only because of the
// since-tightened guard doesn't linger as a stale "fresh" cache entry.
//
// Usage:
//   npx tsx ingestion/tools/prune-guarded-links.ts                 delete every matching 'new' row
//   npx tsx ingestion/tools/prune-guarded-links.ts "Bethlehem"      scope to jurisdictions matching this name
//   npx tsx ingestion/tools/prune-guarded-links.ts --dry-run        report what would be deleted without writing anything
import "dotenv/config";
import { getPool } from "@govdex/db";
import { looksLikeAlertLink } from "../spider/alertDetector";
import { looksLikeCalendarLink } from "../spider/calendarDetector";
import { hasCachedPage, removeCachedPage } from "../spider/cache";

interface CandidateRow {
  id: string;
  jurisdiction_name: string | null;
  link_type: string;
  target_url: string;
}

const BOARD_SHAPED_TYPES = new Set(["board", "district", "index"]);

function guardReason(row: CandidateRow): string | null {
  if (looksLikeAlertLink(row.target_url)) return "alert-shaped link";
  if (BOARD_SHAPED_TYPES.has(row.link_type) && looksLikeCalendarLink(row.target_url)) {
    return `calendar-shaped ${row.link_type} guess`;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const namePattern = args.find((a) => !a.startsWith("--")) ?? null;

  const pool = getPool();
  console.log(`Scanning 'new' candidate(s)${namePattern ? ` for jurisdictions matching "${namePattern}"` : ""}...\n`);

  const { rows } = await pool.query<CandidateRow>(
    `select cl.id, j.name as jurisdiction_name, cl.link_type, cl.target_url
       from candidate_links cl
       left join jurisdictions j on j.id = cl.jurisdiction_id
      where cl.status = 'new'
        and ($1::text is null or j.name ilike $1)
      order by j.name, cl.target_url`,
    [namePattern ? `%${namePattern}%` : null],
  );

  let deleted = 0;
  let cacheEvicted = 0;

  for (const row of rows) {
    const reason = guardReason(row);
    if (!reason) continue;

    deleted++;
    const evicted = dryRun ? hasCachedPage(row.target_url) : removeCachedPage(row.target_url);
    if (evicted) cacheEvicted++;
    console.log(
      `  x [${row.jurisdiction_name ?? "?"}] ${row.link_type} — ${row.target_url} (${reason})${evicted ? ", cache evicted" : ""}${dryRun ? " (dry run, not deleting)" : ""}`,
    );
    if (dryRun) continue;

    await pool.query(`delete from candidate_links where id = $1`, [row.id]);
  }

  console.log(
    `\n${rows.length} 'new' candidate(s) scanned, ${deleted} matched a guard${dryRun ? " (dry run, nothing deleted)" : `, ${cacheEvicted} cache entr${cacheEvicted === 1 ? "y" : "ies"} evicted`}`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
