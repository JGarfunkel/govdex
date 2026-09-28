// add-body — manually seed a body (a legislative committee, an advisory
// board/commission, etc.) under a jurisdiction, optionally nested under a
// parent body via bodies.parent_body_id. There is no clean statewide
// dataset enumerating every town's boards and committees the way t01 has
// one for municipalities themselves, so — until the spider's board-listing
// detection (see cascade.ts) surfaces candidates — this is how they get
// entered one at a time.
//
// t04-bodies/run.ts already creates one body per jurisdiction with active
// government (the Town Board / County Legislature, default_body_name) — use
// --parent to attach a committee to that existing body by name.
//
// Usage:
//   npx tsx ingestion/tools/add-body.ts "<jurisdiction>" "<body name>" --category=<code>
//     [--parent="<parent body name>"] [--website=<url>] [--committees-url=<url>]
//     [--governmental] [--candidate=<candidate_links id>]
//
// Examples:
//   npx tsx ingestion/tools/add-body.ts "Bethlehem" "Planning Board" --category=official_appointed
//   npx tsx ingestion/tools/add-body.ts "Westchester" "Budget & Appropriations Committee" \
//     --category=official_appointed --parent="County Legislature" --governmental
//
// --candidate=<id> marks that candidate_links row 'promoted' once the body is
// created — the same bookkeeping apps/api's POST /candidates/:id/promote does
// for the UI path, so a spider-found board doesn't sit as status='new'
// forever once a human has acted on it (see ingestion/tools/inspect-jurisdiction.ts
// to find candidate ids worth promoting).
//
// --committees-url=<url> records where THIS body's own committees/sub-boards
// are authoritatively listed (bodies.committees_url) — set it on the
// legislative body for its legislative committees, or on the chief executive
// (category=chief_executive: Governor/County Executive/Mayor, where that
// split exists) for advisory boards; most towns/villages have one combined
// body and everything hangs off it. apps/api's geoPayload surfaces this URL
// as the "authoritative source" link on the Committees/Advisory boards
// sections.
import "dotenv/config";
import { getPool } from "@govdex/db";
import { getBodyCategoryId } from "../lib/identifiers";
import { upsertBodyByName } from "../lib/upsert";

async function findOne(
  pool: ReturnType<typeof getPool>,
  table: "jurisdictions" | "bodies",
  namePattern: string,
  extraWhere?: string,
  extraParam?: string,
): Promise<{ id: string; name: string } | null> {
  const where = extraWhere ? `and ${extraWhere}` : "";
  const exactParams = extraParam ? [namePattern, extraParam] : [namePattern];
  const { rows: exact } = await pool.query<{ id: string; name: string }>(
    `select id, name from ${table} where name ilike $1 ${where}`,
    exactParams,
  );
  if (exact.length === 1) return exact[0];

  const likeParams = extraParam ? [`%${namePattern}%`, extraParam] : [`%${namePattern}%`];
  const { rows: substring } = await pool.query<{ id: string; name: string }>(
    `select id, name from ${table} where name ilike $1 ${where} order by name`,
    likeParams,
  );
  if (substring.length === 0) {
    console.error(`No ${table} matching "${namePattern}"`);
    return null;
  }
  if (substring.length > 1) {
    console.error(`"${namePattern}" matches ${substring.length} ${table} — narrow the pattern:`);
    for (const r of substring) console.error(`  ${r.name} (${r.id})`);
    return null;
  }
  return substring[0];
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
  const [jurisdictionPattern, bodyName] = args;

  const flagValue = (name: string) => flags.find((f) => f.startsWith(`--${name}=`))?.slice(`--${name}=`.length) ?? null;
  const categoryCode = flagValue("category");
  const parentPattern = flagValue("parent");
  const website = flagValue("website");
  const committeesUrl = flagValue("committees-url");
  const governmental = flags.includes("--governmental");
  const candidateId = flagValue("candidate");

  if (!jurisdictionPattern || !bodyName || !categoryCode) {
    console.error(
      'Usage: npx tsx ingestion/tools/add-body.ts "<jurisdiction>" "<body name>" --category=<code> [--parent="<parent body name>"] [--website=<url>] [--committees-url=<url>] [--governmental]',
    );
    console.error(
      "Categories: official_elected, chief_executive, official_appointed, advisory, party_committee, affinity, interest_group",
    );
    process.exit(1);
  }

  const pool = getPool();

  const jurisdiction = await findOne(pool, "jurisdictions", jurisdictionPattern);
  if (!jurisdiction) {
    await pool.end();
    process.exit(1);
  }

  let categoryId: number;
  try {
    categoryId = await getBodyCategoryId(pool, categoryCode);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  }

  if (bodyName.toLowerCase().includes("district")) {
    console.warn(
      `Warning: "${bodyName}" looks like a special district (school/fire/sewer/water/etc.), not a committee of ${jurisdiction.name}.` +
        ` Districts are their own jurisdiction (type_concepts.level='special_district'), often disjoint from or spanning multiple` +
        ` municipalities — modeling one as a body here is usually wrong. Proceeding anyway since this might be a legitimately named` +
        ` committee (e.g. "Water District Advisory Committee" as an actual committee of this town) — double check before trusting it.`,
    );
  }

  let parentBodyId: string | null = null;
  if (parentPattern) {
    const parent = await findOne(pool, "bodies", parentPattern, "jurisdiction_id = $2", jurisdiction.id);
    if (!parent) {
      console.error(`(searched bodies within ${jurisdiction.name} only)`);
      await pool.end();
      process.exit(1);
    }
    parentBodyId = parent.id;
  }

  const id = await upsertBodyByName(pool, {
    jurisdictionId: jurisdiction.id,
    categoryId,
    name: bodyName,
    isGovernmental: governmental,
    website,
    committeesUrl,
    parentBodyId,
  });

  console.log(
    `${bodyName} (${id}) under ${jurisdiction.name}${parentPattern ? ` -> parent body "${parentPattern}"` : ""}, category=${categoryCode}, governmental=${governmental}`,
  );

  if (candidateId) {
    const { rows } = await pool.query<{ status: string }>(`select status from candidate_links where id = $1`, [candidateId]);
    if (!rows[0]) {
      console.warn(`  candidate ${candidateId} not found — body created, but no candidate_links row to mark promoted`);
    } else if (rows[0].status !== "new") {
      console.warn(`  candidate ${candidateId} is already ${rows[0].status} — left as-is`);
    } else {
      await pool.query(`update candidate_links set status = 'promoted', reviewed_at = now() where id = $1`, [candidateId]);
      console.log(`  candidate ${candidateId} marked promoted`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
