import { Router } from "express";
import { listConfiguredStateCodes, loadStateProfile } from "@govdex/shared/src/conf/profile";

// Serves a state's raw locale pack (packages/shared/src/conf/<state>.yaml)
// for review — see apps/web/app/[state]/conf/page.tsx. Deliberately not
// routed through geoRouter's DB-backed slug resolution: this exists so a
// state's config can be reviewed before it has any jurisdiction data seeded.
export const confRouter = Router();

// Every state with a locale pack, for the home page's US map (see
// apps/web/components/UsMap.tsx) to link to /:state/conf instead of leaving
// an unseeded state dead.
confRouter.get("/conf", (_req, res) => {
  res.json({ states: listConfiguredStateCodes() });
});

confRouter.get("/conf/:state", (req, res) => {
  const stateCode = req.params.state.toLowerCase();
  try {
    res.json(loadStateProfile(stateCode));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      res.status(404).json({ message: `No config found for state "${stateCode}"` });
      return;
    }
    throw err;
  }
});
