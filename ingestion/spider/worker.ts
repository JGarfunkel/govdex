// crawl-jobs worker — polls crawl_jobs for status='queued' rows (queued by
// apps/api's propose route whenever a scribe sets/changes a jurisdiction's
// or body's website through the EditableGlyph UI) and runs the same
// seed+cascade crawl run.ts uses for batch passes, so a website edit gets
// its related-info discovery (channels, boards, emails, calendars, SaaS
// vendors) without waiting for the next scheduled `npm run govdex:spider`.
//
// Long-running; deploy as its own process (whatever runs the site's other
// background processes — pm2/systemd/a container). Claims one job at a time
// with `for update skip locked`, safe to run more than one instance of.
//
// Usage: npx tsx ingestion/spider/worker.ts
//
// runCrawlWorker() below is also imported directly by server/govdex.ts when
// CRAWL_IN_SERVER_THREAD=true, so local dev can get website-edit-triggered
// crawls without rebuilding/restarting the separate crawl-worker container.
import "dotenv/config";
import { pathToFileURL } from "url";
import { getPool } from "@govdex/db";
import { crawlSeed } from "./crawlSeed";
import { pruneDeadCandidates } from "./pruneDeadCandidates";

const POLL_MS = Number(process.env.CRAWL_WORKER_POLL_MS ?? 10_000);
// A website-edit-triggered crawl follows the "Boards & Committees" hub one
// hop deep by default — same as `--recurse` on the CLI — since this is a
// single seed, not a 1600-site batch pass, so the extra politeness cost is
// worth it for a scribe waiting on the result.
const RECURSE_DEPTH = 1;

interface QueuedJob {
  id: string;
  jurisdiction_id: string | null;
  body_id: string | null;
  seed_url: string;
}

async function claimNextJob(pool: ReturnType<typeof getPool>): Promise<QueuedJob | null> {
  const { rows } = await pool.query<QueuedJob>(
    `update crawl_jobs set status = 'running', started_at = now()
       where id = (
         select id from crawl_jobs
          where status = 'queued'
          order by queued_at
          for update skip locked
          limit 1
       )
       returning id, jurisdiction_id, body_id, seed_url`,
  );
  return rows[0] ?? null;
}

async function runJob(pool: ReturnType<typeof getPool>, job: QueuedJob): Promise<void> {
  console.log(`[crawl-jobs] running ${job.id} (${job.seed_url})`);
  let jurisdictionName: string | null = null;
  if (job.jurisdiction_id) {
    const { rows } = await pool.query<{ name: string }>(`select name from jurisdictions where id = $1`, [job.jurisdiction_id]);
    jurisdictionName = rows[0]?.name ?? null;
  }
  try {
    const written = await crawlSeed(pool, job.jurisdiction_id, jurisdictionName, job.body_id, job.seed_url, RECURSE_DEPTH, job.id);
    await pool.query(`update crawl_jobs set status = 'done', finished_at = now(), candidates_found = $2 where id = $1`, [
      job.id,
      written,
    ]);
    console.log(`[crawl-jobs] done ${job.id} — ${written} candidate(s)`);

    // Scoped to just this job's own finds (not the jurisdiction's whole 'new'
    // backlog) — a scribe waiting on a website-edit-triggered crawl only
    // cares about what this crawl found, not re-checking everything else.
    if (written > 0) {
      const pruned = await pruneDeadCandidates(pool, { crawlJobId: job.id });
      if (pruned.dead > 0) console.log(`[crawl-jobs] ${job.id} — ${pruned.dead} of those rejected as dead pages`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(`update crawl_jobs set status = 'error', finished_at = now(), error = $2 where id = $1`, [
      job.id,
      message.slice(0, 2000),
    ]);
    console.error(`[crawl-jobs] ${job.id} failed: ${message}`);
  }
}

// Runs until killed — unlike the batch CLI tools, this never returns on its
// own; process-lifecycle (restart policy, or the host process exiting) is
// the caller's job, not ours.
export async function runCrawlWorker(log: (msg: string) => void = console.log): Promise<never> {
  const pool = getPool();
  log(`crawl-jobs worker started (polling every ${POLL_MS}ms)`);
  for (;;) {
    const job = await claimNextJob(pool);
    if (job) {
      await runJob(pool, job);
    } else {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  runCrawlWorker().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
