import { Router } from "express";
import { getPool } from "../db";
import { authMiddleware } from "../auth";

export const bodyCategoriesRouter = Router();

// GET /body-categories — the fixed reference list a scribe picks from when
// promoting a spider-found board/committee candidate into a new bodies row
// (see candidatePromoteSchema's "body" branch, which requires a categoryCode
// the spider never guesses on its own).
bodyCategoriesRouter.get("/body-categories", authMiddleware, async (_req, res) => {
  const { rows } = await getPool().query("select code, label from body_categories order by label");
  res.json({ categories: rows });
});
