import { Router } from "express";
import { getPool } from "../db";
import { authMiddleware } from "../auth";

export const productFunctionsRouter = Router();

// GET /product-functions — the fixed reference list a scribe picks from when
// promoting a spider-found vendor candidate into a new products row (see
// candidatePromoteSchema's "adoptionCreate" branch, which requires a
// functionCode the spider's guess may or may not match).
productFunctionsRouter.get("/product-functions", authMiddleware, async (_req, res) => {
  const { rows } = await getPool().query("select code, label from product_functions order by label");
  res.json({ functions: rows });
});
