import "dotenv/config";
import path from "path";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupNyTransparency } from "./ny-transparency";
import { setupGovdex } from "./govdex";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

export const ORDINIZER_CONTEXT_PATH = process.env.ORDINIZER_CONTEXT_PATH || "/ordinizer";

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    }
  });

  next();
});

// earlier setup
// app.get("/", (_req, res) => {
//   res.redirect("/transparency");
// });

// working mockup — static representation-index page, served directly (not part of the built SPA yet)
app.get("/representing.html", (_req, res) => {
  console.log("request for representing.html");
  res.sendFile(path.resolve(process.cwd(), "client", "representing.html"));
});

(async () => {
  try {
    console.log("Starting server...");
    // getPool() only throws on first query, i.e. on the first request. Surface a
    // missing/empty DATABASE_URL at boot (presence only — never log the value).
    if (!process.env.DATABASE_URL) {
      const dbKeys = Object.keys(process.env).filter((k) => k.toUpperCase().includes("DATABASE"));
      console.error(
        `WARNING: DATABASE_URL is not set or empty (DATABASE* env keys present: ${dbKeys.join(", ") || "none"}). ` +
          "All /api/stack requests that touch the database will fail.",
      );
    }
    const server = await registerRoutes(app);
    console.log("Routes registered.");

    await setupNyTransparency(app, server, app.get("env") === "development");
    console.log("NY Transparency setup complete.");

    await setupGovdex(app, server, app.get("env") === "development");
    console.log("GovDex setup complete.");

    if (app.get("env") !== "development") {
      app.get("*", (req, res, next) => {
        if (req.path.includes(".") || req.path.startsWith("/api")) {
          return next();
        }
        const ordinizerDist = path.resolve(process.cwd(), "dist", "public");
        res.sendFile(path.join(ordinizerDist, "index.html"));
      });
    }

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
      throw err;
    });

    if (app.get("env") === "development") {
      console.log("Setting up Vite...");
      await setupVite(app, server);
      console.log("Vite setup complete.");
    } else {
      const expressStatic = express.static;
      const ordinizerDist = path.resolve(process.cwd(), "dist", "public");

      app.use(ORDINIZER_CONTEXT_PATH, expressStatic(ordinizerDist));
      app.get(`${ORDINIZER_CONTEXT_PATH}/*`, (_req, res) => {
        res.sendFile(path.join(ordinizerDist, "index.html"));
      });

      console.log(`Static serving setup for ${ORDINIZER_CONTEXT_PATH}.`);
    }

    const port = parseInt(process.env.PORT || "5000", 10);
    server.listen({ port, host: "0.0.0.0" }, () => {
      log(`serving on port ${port}`);
    });
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
})();
