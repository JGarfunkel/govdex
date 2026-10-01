import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import type { Express } from "express";
import type { Server } from "http";
import { log } from "./vite";

// USPS state/territory postal codes GovDex's [state] route accepts. DC and the
// territories don't have a packages/shared/src/conf/*.yaml profile yet (see
// apps/web/components/UsMap.tsx), but the path is reserved for them.
const US_STATE_CODES = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id", "il", "in", "ia", "ks", "ky", "la",
  "me", "md", "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok",
  "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy",
  "dc",
  "pr", "vi", "gu", "as", "mp",
]);

// GovDex routes that aren't scoped under a state code: the home page (US
// map), auth, the scribe editing console, address resolution, the /about
// static documents (apps/web/content), and the
// stable UUID-permalink fallback for entities without a slug yet (see
// EntityList.tsx).
const GOVDEX_UNSCOPED_PATH = /^\/(?:login|resolve|scribe|about)(?:\/.*)?$/;
const GOVDEX_ID_PERMALINK = /^\/(?:jurisdictions|bodies)\/[^/]+$/;

function isGovdexPath(pathname: string): boolean {
  if (pathname === "/" || pathname.startsWith("/_next/")) return true;
  if (GOVDEX_UNSCOPED_PATH.test(pathname) || GOVDEX_ID_PERMALINK.test(pathname)) return true;
  const stateMatch = /^\/([a-z]{2})(?:\/.*)?$/i.exec(pathname);
  return stateMatch !== null && US_STATE_CODES.has(stateMatch[1].toLowerCase());
}

// Structural mirror of ny-transparency.ts's custom-server mount, for GovDex's
// own Next.js app (apps/web).
export async function setupGovdex(app: Express, httpServer: Server, dev: boolean) {
  // The crawl-jobs worker (ingestion/spider/worker.ts) normally runs as its
  // own long-running process/container (see infra/crawl-worker.Dockerfile) —
  // fine for prod, but it means rebuilding the docker image and restarting
  // that container on every code change in local dev. Set
  // CRAWL_IN_SERVER_THREAD=true (e.g. in .env for local dev) to instead run
  // it in-process here, so it restarts along with the rest of the dev server.
  if (process.env.CRAWL_IN_SERVER_THREAD === "true") {
    const { runCrawlWorker } = await import("../ingestion/spider/worker");
    runCrawlWorker((msg) => log(msg, "crawl-worker")).catch((err) => {
      log(`crawl worker crashed: ${err instanceof Error ? err.message : String(err)}`, "crawl-worker");
    });
  }

  const dir = path.resolve(process.cwd(), "apps", "web");
  // Bare `import("next")` resolves relative to this file (server/), which
  // finds the root workspace's next (pinned older for ny-transparency), not
  // apps/web's own version. Resolve from apps/web's package.json instead so
  // this always runs the same next that built apps/web/.next.
  const requireFromWeb = createRequire(path.join(dir, "package.json"));
  const nextEntry = requireFromWeb.resolve("next");
  const next = (await import(pathToFileURL(nextEntry).href)).default;
  const nextApp = next({ dev, dir });
  await nextApp.prepare();
  const requestHandler = nextApp.getRequestHandler();

  if (dev) {
    // Next's request handler otherwise auto-attaches its own "upgrade" listener
    // to the shared http server on the first request, and that listener
    // socket.end()s any websocket whose path matches a Next route -- including
    // Vite's HMR socket (ws://host/?token=...), which matches Next's "/" page.
    // Vite's client then sees its socket die and reloads the page in a loop
    // (visible on any path that falls through to the legacy Vite app, e.g. a
    // 404). Claim the wiring ourselves and forward only Next's own sockets.
    nextApp.didWebSocketSetup = true;
    // nextApp.getUpgradeHandler() delegates to the inner NextServer.handleUpgrade,
    // which never answers Next 16's /_next/hmr handshake (the socket just hangs,
    // so the client never hydrates — no errors, dead buttons). The router-server's
    // own handler, exposed as nextApp.upgradeHandler, is the one that does.
    const upgradeHandler = nextApp.upgradeHandler;
    httpServer.on("upgrade", (req, socket, head) => {
      // Next 16 serves HMR at /_next/hmr (older versions: /_next/webpack-hmr).
      if (req.url?.startsWith("/_next/")) {
        upgradeHandler(req, socket, head);
      }
    });
  }

  app.use((req, res, next) => {
    if (!isGovdexPath(req.path)) {
      next();
      return;
    }
    Promise.resolve(requestHandler(req, res)).catch(next);
  });

  log("GovDex mounted at /<state>", "govdex");
}
