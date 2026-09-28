# Runs `npm run govdex:crawl-worker` (ingestion/spider/worker.ts) — polls
# crawl_jobs for website edits made through the EditableGlyph UI and runs
# the same seed+cascade crawl the batch spider uses. See worker.ts's own
# header for details. Long-running; restart policy in docker-compose.yml
# handles process lifecycle.
#
# Build context is the repo root (needed for the pnpm workspace), so build
# via docker-compose.yml rather than `docker build` from this directory:
#   docker compose -f infra/docker-compose.yml build crawl-worker
FROM node:20-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

CMD ["pnpm", "run", "govdex:crawl-worker"]
