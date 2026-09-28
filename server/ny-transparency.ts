import path from "path";
import type { Express } from "express";
import type { Server } from "http";
import { log } from "./vite";
import { startPoller } from "../reports/ny-transparency/lib/poller";

export async function setupNyTransparency(app: Express, httpServer: Server, dev: boolean) {
  await startPoller(Number(process.env.NY_TRANSPARENCY_POLL_INTERVAL_MS) || 6 * 60 * 60 * 1000, (msg) =>
    log(msg, "ny-transparency"),
  );

  const dir = path.resolve(process.cwd(), "reports", "ny-transparency");
  const next = (await import("next")).default;
  const nextApp = next({ dev, dir });
  await nextApp.prepare();
  const requestHandler = nextApp.getRequestHandler();

  if (dev) {
    const upgradeHandler = nextApp.getUpgradeHandler();
    httpServer.on("upgrade", (req, socket, head) => {
      if (req.url?.startsWith("/reports/ny-transparency/_next/webpack-hmr")) {
        upgradeHandler(req, socket, head);
      }
    });
  }

  // Permanent redirect for the old pre-move URL, preserving any deep-linked subpath.
  app.all(/^\/transparency(?:\/.*)?$/, (req, res) => {
    const suffix = req.path.slice("/transparency".length);
    const query = req.url.slice(req.path.length);
    res.redirect(301, `/reports/ny-transparency${suffix}${query}`);
  });

  app.all(/^\/reports\/ny-transparency(?:\/.*)?$/, (req, res, next) => {
    Promise.resolve(requestHandler(req, res)).catch(next);
  });

  log("NY Transparency mounted at /reports/ny-transparency", "ny-transparency");
}
