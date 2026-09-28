import { Router } from "express";
import { getPool } from "../db";
import { authMiddleware } from "../auth";

export const productsRouter = Router();

// GET /products?vendor=<text>&function=<product_functions.code> — search
// used by the scribe UI to match a spider-found GovTech vendor hit
// (candidate_links link_type='vendor') against an existing catalog product
// before falling back to adding a new one. A vendor like Granicus can host
// several distinct products (Legistar, EngagementHQ, meeting media, ...),
// so this returns candidates for a human to disambiguate rather than
// guessing — see apps/api/src/routes/candidates.ts's adoptionLink/
// adoptionCreate branches.
productsRouter.get("/products", authMiddleware, async (req, res) => {
  const vendor = typeof req.query.vendor === "string" ? req.query.vendor.trim() : "";
  const fn = typeof req.query.function === "string" ? req.query.function : null;
  if (vendor.length < 2) {
    res.json({ products: [] });
    return;
  }
  const { rows } = await getPool().query(
    `select p.id, p.name, p.vendor, pf.code as function_code
       from products p
       join product_functions pf on pf.id = p.function_id
      where p.vendor ilike '%' || $1 || '%'
        and ($2::text is null or pf.code = $2)
      order by p.name
      limit 20`,
    [vendor, fn],
  );
  res.json({ products: rows });
});
