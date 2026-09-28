import { Router } from "express";
import { getPool } from "../db";

export const bodiesRouter = Router();

bodiesRouter.get("/bodies/:id", async (req, res) => {
  const pool = getPool();
  const { rows } = await pool.query(
    `select b.*, bc.code as category, j.name as jurisdiction_name
       from bodies b
       join body_categories bc on bc.id = b.category_id
       join jurisdictions j on j.id = b.jurisdiction_id
      where b.id = $1`,
    [req.params.id],
  );
  const body = rows[0];
  if (!body) {
    res.status(404).json({ message: "Body not found" });
    return;
  }

  const { rows: seats } = await pool.query(
    `select s.*,
            r.id as current_role_id, r.official_id as current_official_id,
            o.full_name as current_official_name
       from seats s
       left join roles r on r.seat_id = s.id and r.end_date is null
       left join officials o on o.id = r.official_id
      where s.body_id = $1
      order by s.title`,
    [body.id],
  );
  const { rows: channels } = await pool.query(
    "select * from channels where body_id = $1 order by kind",
    [body.id],
  );
  const { rows: adoptions } = await pool.query(
    `select a.id, a.instance_url, a.first_observed, p.name as product_name, pf.code as function
       from adoptions a
       join products p on p.id = a.product_id
       left join product_functions pf on pf.id = p.function_id
      where a.body_id = $1`,
    [body.id],
  );

  res.json({ ...body, seats, channels, adoptions });
});
