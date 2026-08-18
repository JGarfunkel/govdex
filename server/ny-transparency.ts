import path from "path";
import type { Express } from "express";
import type { Server } from "http";
import { log } from "./vite";
import { startPoller } from "../ny-transparency/lib/poller";

export async function setupNyTransparency(app: Express, httpServer: Server, dev: boolean) {
  await startPoller(Number(process.env.NY_TRANSPARENCY_POLL_INTERVAL_MS) || 6 * 60 * 60 * 1000, (msg) =>
    log(msg, "ny-transparency"),
  );

  const dir = path.resolve(process.cwd(), "ny-transparency");
  const next = (await import("next")).default;
  const nextApp = next({ dev, dir });
  await nextApp.prepare();
  const requestHandler = nextApp.getRequestHandler();

  if (dev) {
    const upgradeHandler = nextApp.getUpgradeHandler();
    httpServer.on("upgrade", (req, socket, head) => {
      if (req.url?.startsWith("/transparency/_next/webpack-hmr")) {
        upgradeHandler(req, socket, head);
      }
    });
  }

  app.all(/^\/transparency(?:\/.*)?$/, (req, res, next) => {
    Promise.resolve(requestHandler(req, res)).catch(next);
  });

  log("NY Transparency mounted at /transparency", "ny-transparency");
}
