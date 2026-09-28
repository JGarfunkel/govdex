// t05 — state legislators from the OpenStates v3 API. NOT RUN in this pass:
// no OPENSTATES_API_KEY has been provisioned. Written and ready — get a key
// at https://open.pluralpolicy.com/accounts/profile/ and set
// OPENSTATES_API_KEY in .env, then run this script.
//
// KNOWN GAP (fix before relying on this beyond a first run): unlike the other
// tranches, the officials/seats/roles inserts below are not yet guarded
// idempotent-by-origin — a second run will create duplicate officials/seats
// rather than updating in place. officials has no natural unique key to
// upsert on; add one (e.g. an openstates person id in a new identifiers-style
// table, or a source_url+full_name check) before running this more than once.
import "dotenv/config";
import { getPool } from "@govdex/db";
import { getBodyCategoryId } from "../lib/identifiers";
import { upsertBodyByName } from "../lib/upsert";

const OPENSTATES_BASE = "https://v3.openstates.org";

interface OpenStatesPerson {
  id: string;
  name: string;
  party: string;
  current_role?: { district?: string; org_classification?: string };
}

async function fetchNyLegislators(apiKey: string): Promise<OpenStatesPerson[]> {
  const all: OpenStatesPerson[] = [];
  let page = 1;
  for (;;) {
    const url = new URL(`${OPENSTATES_BASE}/people`);
    url.searchParams.set("jurisdiction", "ocd-jurisdiction/country:us/state:ny/government");
    url.searchParams.set("per_page", "50");
    url.searchParams.set("page", String(page));
    const res = await fetch(url, { headers: { "X-API-KEY": apiKey } });
    if (!res.ok) throw new Error(`OpenStates request failed: ${res.status} ${res.statusText}`);
    const body = await res.json();
    all.push(...(body.results ?? []));
    if (!body.pagination || page >= body.pagination.max_page) break;
    page++;
  }
  return all;
}

async function main() {
  const apiKey = process.env.OPENSTATES_API_KEY;
  if (!apiKey) {
    console.error("OPENSTATES_API_KEY is not set. Get one at https://open.pluralpolicy.com/accounts/profile/ and add it to .env.");
    process.exit(1);
  }

  const pool = getPool();
  const categoryId = await getBodyCategoryId(pool, "official_elected");
  const people = await fetchNyLegislators(apiKey);
  console.log(`  fetched ${people.length} people from OpenStates`);

  let matched = 0;
  for (const person of people) {
    const chamber = person.current_role?.org_classification; // 'upper' | 'lower'
    const districtNumber = person.current_role?.district ? parseInt(person.current_role.district, 10) : null;
    if (!chamber || districtNumber === null || Number.isNaN(districtNumber)) continue;

    const scheme = chamber === "upper" ? "ny_sd" : "ny_ad";
    const { rows: jurisdictionRows } = await pool.query<{ id: string; name: string; website: string | null }>(
      `select j.id, j.name, j.website from jurisdictions j
         join jurisdiction_identifiers ji on ji.jurisdiction_id = j.id
        where ji.scheme = $1 and ji.value = $2`,
      [scheme, String(districtNumber)],
    );
    const jurisdiction = jurisdictionRows[0];
    if (!jurisdiction) {
      console.warn(`  no jurisdiction for ${scheme}=${districtNumber} (${person.name})`);
      continue;
    }

    const bodyName = chamber === "upper" ? "New York State Senate" : "New York State Assembly";
    const bodyId = await upsertBodyByName(pool, { jurisdictionId: jurisdiction.id, categoryId, name: bodyName, isGovernmental: true });

    const { rows: officialRows } = await pool.query<{ id: string }>(
      `insert into officials (full_name, source_url, origin)
       values ($1, $2, 'import')
       returning id`,
      [person.name, OPENSTATES_BASE],
    );
    const officialId = officialRows[0].id;

    const { rows: seatRows } = await pool.query<{ id: string }>(
      `insert into seats (body_id, title, selection_method, source_url, origin)
       values ($1, $2, 'elected', $3, 'import')
       returning id`,
      [bodyId, `${bodyName.includes("Senate") ? "Senate" : "Assembly"} District ${districtNumber}`, OPENSTATES_BASE],
    );
    await pool.query(
      `insert into roles (seat_id, official_id, source_url, origin) values ($1, $2, $3, 'import')`,
      [seatRows[0].id, officialId, OPENSTATES_BASE],
    );
    matched++;
  }

  console.log(`  loaded ${matched} legislator roles`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
