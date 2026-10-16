import { Router, type NextFunction, type Request, type Response } from "express";
import { healthRouter } from "./routes/health";
import { resolveRouter } from "./routes/resolve";
import { jurisdictionsRouter } from "./routes/jurisdictions";
import { bodiesRouter } from "./routes/bodies";
import { proposeRouter } from "./routes/propose";
import { revisionsRouter } from "./routes/revisions";
import { scribeQueueRouter } from "./routes/scribeQueue";
import { candidatesRouter } from "./routes/candidates";
import { crawlJobsRouter } from "./routes/crawlJobs";
import { bodyCategoriesRouter } from "./routes/bodyCategories";
import { productsRouter } from "./routes/products";
import { productFunctionsRouter } from "./routes/productFunctions";
import { geoRouter } from "./routes/geo";
import { frictionRouter } from "./routes/friction";
import { confRouter } from "./routes/conf";

// Assembles the GovDex API surface. Mounted at /api/stack by server/routes.ts,
// sharing the root Express process/port with everything else in this repo
// rather than running as a separate server (deliberate: GovDex is folded into
// the existing website, not stood up alongside it).
//
// Express 4 doesn't catch rejected promises from async handlers: a throw
// (e.g. the database being unreachable) left the request hanging forever
// with no response. Wrap every handler so rejections reach next(err).
type Layer = { handle: ((...a: unknown[]) => unknown) & { stack?: Layer[] }; route?: { stack: Layer[] } };
function forwardAsyncErrors(stack: Layer[]): void {
  for (const layer of stack) {
    if (layer.route) forwardAsyncErrors(layer.route.stack);
    const fn = layer.handle;
    if (fn.stack) {
      forwardAsyncErrors(fn.stack); // nested router
    } else if (fn.length < 4) {
      layer.handle = (...args: unknown[]) => {
        const result = fn(...args);
        if (result && typeof (result as Promise<unknown>).catch === "function") {
          (result as Promise<unknown>).catch(args[args.length - 1] as NextFunction);
        }
        return result;
      };
    }
  }
}

const DB_DOWN = /connection|timeout|ECONNREFUSED|ENOTFOUND|terminated/i;

export function createGovdexRouter(): Router {
  const router = Router();
  router.use(healthRouter);
  router.use(resolveRouter);
  router.use(jurisdictionsRouter);
  router.use(bodiesRouter);
  router.use(proposeRouter);
  router.use(revisionsRouter);
  router.use(scribeQueueRouter);
  router.use(candidatesRouter);
  router.use(crawlJobsRouter);
  router.use(bodyCategoriesRouter);
  router.use(productsRouter);
  router.use(productFunctionsRouter);
  router.use(geoRouter);
  router.use(frictionRouter);
  router.use(confRouter);
  forwardAsyncErrors(router.stack as unknown as Layer[]);
  router.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error(`[api] ${req.method} ${req.originalUrl} failed:`, err.message);
    if (res.headersSent) return;
    const dbDown = DB_DOWN.test(err.message);
    res.status(dbDown ? 503 : 500).json({ message: dbDown ? "Database unavailable" : "Internal error" });
  });
  return router;
}
