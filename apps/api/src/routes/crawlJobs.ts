import { Router } from "express";
import { getPool } from "../db";
import { authMiddleware } from "../auth";

export const crawlJobsRouter = Router();

// GET /crawl-jobs?jurisdiction=…&body=… — recent background crawl jobs,
// queued by propose.ts whenever a scribe sets/changes a website and drained
// by ingestion/spider/worker.ts. Lets the web UI show "checking <url> for
// related info…" / "found N" right after a website edit, instead of only
// the eventual candidate_links rows the job produces (see /candidates).
crawlJobsRouter.get("/crawl-jobs", authMiddleware, async (req, res) => {
  const jurisdictionId = typeof req.query.jurisdiction === "string" ? req.query.jurisdiction : null;
  const bodyId = typeof req.query.body === "string" ? req.query.body : null;
  const pool = getPool();
  const { rows } = await pool.query(
    `select id, jurisdiction_id, body_id, seed_url, status, candidates_found, error, queued_at, started_at, finished_at
       from crawl_jobs
      where ($1::uuid is null or jurisdiction_id = $1)
        and ($2::uuid is null or body_id = $2)
      order by queued_at desc
      limit 50`,
    [jurisdictionId, bodyId],
  );
  res.json({ jobs: rows });
});

// POST /crawl-jobs — manually re-enqueue a crawl ("unearth" in the UI), e.g.
// to pick up pages the spider missed the first time or that have gone up
// since. Re-reads the seed from the DB rather than trusting a client-supplied
// URL, so this can only ever crawl a site the entity is already attributed to.
crawlJobsRouter.post("/crawl-jobs", authMiddleware, async (req, res) => {
  const jurisdictionId = typeof req.body.jurisdictionId === "string" ? req.body.jurisdictionId : null;
  const bodyId = typeof req.body.bodyId === "string" ? req.body.bodyId : null;
  if (!jurisdictionId) {
    res.status(400).json({ message: "jurisdictionId is required" });
    return;
  }
  const pool = getPool();
  const { rows } = await pool.query<{ website: string | null }>(
    bodyId
      ? `select website from bodies where id = $1 and jurisdiction_id = $2`
      : `select website from jurisdictions where id = $1`,
    bodyId ? [bodyId, jurisdictionId] : [jurisdictionId],
  );
  const website = rows[0]?.website;
  if (!website) {
    res.status(400).json({ message: "No website recorded to crawl" });
    return;
  }
  // Clear this entity's untriaged finds from the last crawl before queuing a
  // new one — otherwise a link the spider no longer finds (page moved/removed
  // since) lingers forever, and a link it finds again is silently swallowed
  // by candidate_links' on-conflict-do-nothing insert instead of refreshing
  // discovered_at. Reviewed rows (promoted/rejected/duplicate) are a human
  // decision and stay untouched.
  await pool.query(
    `delete from candidate_links
       where status = 'new' and jurisdiction_id = $1 and source_body_id is not distinct from $2`,
    [jurisdictionId, bodyId],
  );
  const { rows: jobRows } = await pool.query<{ id: string }>(
    `insert into crawl_jobs (jurisdiction_id, body_id, seed_url, queued_by) values ($1, $2, $3, $4) returning id`,
    [jurisdictionId, bodyId, website, req.govdexUser!.id],
  );
  res.status(201).json({ id: jobRows[0].id });
});
