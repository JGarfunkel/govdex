import { Router } from "express";
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
  return router;
}
