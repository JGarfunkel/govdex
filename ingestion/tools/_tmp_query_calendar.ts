import "dotenv/config";
import { getPool } from "@govdex/db";

async function main() {
  const pool = getPool();
  const { rows } = await pool.query(
    `select j.name as jurisdiction, cl.target_url, cl.found_on_url, cl.link_type, cl.title, cl.status
       from candidate_links cl
       join jurisdictions j on j.id = cl.jurisdiction_id
      where j.name ilike '%White Plains%' or j.name ilike '%Scarsdale%'
      order by j.name, cl.link_type`,
  );
  for (const r of rows) {
    console.log(`[${r.jurisdiction}] link_type=${r.link_type} status=${r.status} title="${r.title}"\n    target=${r.target_url}\n    found_on=${r.found_on_url}`);
  }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
