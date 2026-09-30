# Production image for the combined server (root server/index.ts): GovDex
# (apps/web), the NY transparency Next app, and the legacy Ordinizer SPA, all
# served from one Express process. Built by cloudbuild.yaml for Cloud Run.
#
# The esbuild bundle keeps `next` and `vite` external and apps/web/.next is
# loaded at runtime, so the full workspace (with node_modules) ships in the
# image rather than a pruned output.
FROM node:20-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

# NEXT_PUBLIC_* values are inlined into the client bundle at build time
# (apps/web/next.config.mjs), so they must be build args, not runtime env.
# ARG NEXT_PUBLIC_FIREBASE_API_KEY
# ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
# ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
# ARG NEXT_PUBLIC_FIREBASE_APP_ID
# ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
#     NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
#     NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
#     NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID

RUN pnpm run build

ENV NODE_ENV=production
# Cloud Run injects PORT (8080); server/index.ts honors it.
CMD ["pnpm", "run", "start"]
