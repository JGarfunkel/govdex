import { Router } from "express";
import { getPool } from "../db";
import { resolveApprox } from "../lib/resolveApprox";

export const resolveRouter = Router();

// GET /resolve?address=… — geocode, then return every jurisdiction covering
// the point with its bodies, seats, current roles, channels. Pre-PostGIS this
// approximates from the relation graph (see resolveApprox.ts); once t03
// boundaries load, this should switch to a point-in-polygon query.
resolveRouter.get("/resolve", async (req, res) => {
  const address = typeof req.query.address === "string" ? req.query.address : "";
  if (!address.trim()) {
    res.status(400).json({ message: "address query parameter is required" });
    return;
  }

  const { matched, warnings } = await resolveApprox(address);
  if (matched.length === 0) {
    res.json({ address, jurisdictions: [], warnings });
    return;
  }

  const pool = getPool();
  const jurisdictions = await Promise.all(
    matched.map(async (j) => {
      const { rows: bodies } = await pool.query(
        `select b.id, b.name, b.category_id, bc.code as category, b.is_governmental,
                b.oml_applies, b.website, b.email
           from bodies b
           join body_categories bc on bc.id = b.category_id
          where b.jurisdiction_id = $1
          order by b.name`,
        [j.id],
      );

      const bodiesWithDetail = await Promise.all(
        bodies.map(async (b) => {
          const { rows: seats } = await pool.query(
            `select s.id, s.title, s.selection_method, s.office_email, s.office_website,
                    r.id as role_id, r.official_id, o.full_name as official_name
               from seats s
               left join roles r on r.seat_id = s.id and r.end_date is null
               left join officials o on o.id = r.official_id
              where s.body_id = $1
              order by s.title`,
            [b.id],
          );
          const { rows: channels } = await pool.query(
            `select id, kind, status, platform, url from channels where body_id = $1 order by kind`,
            [b.id],
          );
          return { ...b, seats, channels };
        }),
      );

      return { ...j, bodies: bodiesWithDetail };
    }),
  );

  res.json({ address, jurisdictions, warnings });
});
