// legistar-bodies — pull a jurisdiction's full board/committee roster
// straight from Legistar's public web API and write it into `bodies` with
// verification='source_cited'. Unlike the spider's candidate_links guesses
// (a text match on an anchor label, always requiring human promotion), this
// is the jurisdiction's own system of record for which bodies exist — no
// robots.txt restriction on webapi.legistar.com either, so no crawl-
// politeness concern (see the "granicus.com/boards" case in
// ingestion/spider/ — that one's HTML is blocked; the Legistar API isn't).
//
// The client "slug" Legistar keys the API by is just the subdomain of a
// jurisdiction's public Legistar site (https://<slug>.legistar.com) — found
// automatically from an existing candidate_links row pointing at
// *.legistar.com (already recognized as a vendor in vendor_detector.yaml),
// or pass --slug explicitly if the spider hasn't found that link yet.
//
// Usage:
//   npx tsx ingestion/tools/legistar-bodies.ts "<jurisdiction>" [--slug=<client>] [--dry-run]
//
// Examples:
//   npx tsx ingestion/tools/legistar-bodies.ts "Westchester"
//   npx tsx ingestion/tools/legistar-bodies.ts "Westchester" --slug=westchestercountynyexec --dry-run
import "dotenv/config";
import { getPool } from "@govdex/db";
import { executiveTitles, loadStateProfile } from "@govdex/shared/src/conf/profile";
import { getBodyCategoryId } from "../lib/identifiers";
import { upsertBodyByName } from "../lib/upsert";

interface LegistarBody {
  BodyId: number;
  BodyName: string;
  BodyTypeName: string;
  BodyActiveFlag: number;
}

// Legistar's own "type" taxonomy classifies a body by its role in ITS
// meeting/agenda system, not by our body_categories — map the ones we've
// seen; anything else falls back to 'advisory' (governmental=false) so it's
// at least captured, with a warning so a human can correct it.
const TYPE_TO_CATEGORY: Record<string, { category: string; governmental: boolean }> = {
  "Primary Legislative Body": { category: "official_elected", governmental: true },
  Department: { category: "official_appointed", governmental: true },
  "Boards or Commission": { category: "advisory", governmental: false },
};

// Some jurisdictions run a separate Legistar instance for the chief
// executive's office (Westchester's is westchestercountynyexec.legistar.com)
// — there, Legistar's own "Primary Legislative Body" type names the
// executive, not a legislature, so a name match overrides the type-based
// mapping above. Titles come from each concept's executive_title in
// packages/shared/src/conf/ny.yaml; a second state's locale pack extends
// this list with its own titles.
const chiefExecutiveTitleAlternation = [...new Set(executiveTitles(loadStateProfile("ny")).map((title) => title.toLowerCase()))].join(
  "|",
);
const CHIEF_EXECUTIVE_NAME = new RegExp(`^(?:office of the )?(${chiefExecutiveTitleAlternation})$`, "i");

function legistarSlugFromUrl(url: string): string | null {
  try {
    const match = new URL(url).hostname.match(/^([a-z0-9-]+)\.legistar\.com$/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function findJurisdiction(pool: ReturnType<typeof getPool>, pattern: string): Promise<{ id: string; name: string }> {
  const { rows: exact } = await pool.query<{ id: string; name: string }>(`select id, name from jurisdictions where name ilike $1`, [
    pattern,
  ]);
  if (exact.length === 1) return exact[0];

  const { rows: substring } = await pool.query<{ id: string; name: string }>(
    `select id, name from jurisdictions where name ilike $1 order by name`,
    [`%${pattern}%`],
  );
  if (substring.length !== 1) {
    console.error(`"${pattern}" matches ${substring.length} jurisdiction(s) — narrow the pattern:`);
    for (const r of substring) console.error(`  ${r.name} (${r.id})`);
    process.exit(1);
  }
  return substring[0];
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
  const jurisdictionPattern = args[0];
  const flagValue = (name: string) => flags.find((f) => f.startsWith(`--${name}=`))?.slice(`--${name}=`.length) ?? null;
  const explicitSlug = flagValue("slug");
  const dryRun = flags.includes("--dry-run");

  if (!jurisdictionPattern) {
    console.error('Usage: npx tsx ingestion/tools/legistar-bodies.ts "<jurisdiction>" [--slug=<client>] [--dry-run]');
    process.exit(1);
  }

  const pool = getPool();
  const jurisdiction = await findJurisdiction(pool, jurisdictionPattern);

  let slug = explicitSlug;
  if (!slug) {
    const { rows } = await pool.query<{ target_url: string }>(
      `select target_url from candidate_links
        where jurisdiction_id = $1 and target_url ilike '%.legistar.com%'
        order by discovered_at desc limit 1`,
      [jurisdiction.id],
    );
    slug = rows[0] ? legistarSlugFromUrl(rows[0].target_url) : null;
  }
  if (!slug) {
    console.error(
      `Could not find a legistar.com client slug for ${jurisdiction.name} (no candidate_links pointing at *.legistar.com yet) —` +
        ` pass --slug=<client>, the subdomain of that jurisdiction's public Legistar site (https://<client>.legistar.com)`,
    );
    await pool.end();
    process.exit(1);
  }

  const apiUrl = `https://webapi.legistar.com/v1/${slug}/bodies`;
  console.log(`Fetching ${apiUrl}`);
  const res = await fetch(apiUrl);
  if (!res.ok) {
    console.error(`Legistar API returned ${res.status} for slug "${slug}" — is that the right client?`);
    await pool.end();
    process.exit(1);
  }
  const bodies = (await res.json()) as LegistarBody[];

  const categoryIds = new Map<string, number>();
  for (const { category } of Object.values(TYPE_TO_CATEGORY)) {
    if (!categoryIds.has(category)) categoryIds.set(category, await getBodyCategoryId(pool, category));
  }
  categoryIds.set("advisory", categoryIds.get("advisory") ?? (await getBodyCategoryId(pool, "advisory")));
  categoryIds.set("chief_executive", await getBodyCategoryId(pool, "chief_executive"));

  let written = 0;
  let skipped = 0;
  for (const b of bodies) {
    if (!b.BodyActiveFlag) {
      skipped++;
      continue;
    }
    // Legistar admins sometimes leave internal test/placeholder groupings
    // behind under an ad hoc "type" like "Advisory Boards G1" — not real
    // public bodies, so skip anything tagged that way.
    if (b.BodyTypeName.includes("G1")) {
      console.warn(`  skipping "${b.BodyName}" (type "${b.BodyTypeName}" looks like an internal placeholder, not a real body)`);
      skipped++;
      continue;
    }

    const isChiefExecutive = CHIEF_EXECUTIVE_NAME.test(b.BodyName.trim());
    const mapping = TYPE_TO_CATEGORY[b.BodyTypeName];
    if (!mapping && !isChiefExecutive) {
      console.warn(`  unrecognized Legistar body type "${b.BodyTypeName}" for "${b.BodyName}" — defaulting to advisory`);
    }
    const { category, governmental } = isChiefExecutive
      ? { category: "chief_executive", governmental: true }
      : (mapping ?? { category: "advisory", governmental: false });
    // The chief executive's own bodies endpoint doubles as "where this
    // body's boards/commissions are authoritatively listed" — feeds the
    // Advisory boards section's source link (see apps/api/src/lib/geoPayload.ts).
    const committeesUrl = isChiefExecutive ? apiUrl : null;

    if (dryRun) {
      console.log(`  [dry-run] ${b.BodyName} (${b.BodyTypeName} -> ${category}, governmental=${governmental})`);
      written++;
      continue;
    }

    await upsertBodyByName(pool, {
      jurisdictionId: jurisdiction.id,
      categoryId: categoryIds.get(category)!,
      name: b.BodyName,
      isGovernmental: governmental,
      committeesUrl,
      sourceUrl: apiUrl,
      verification: "source_cited",
    });
    written++;
  }

  console.log(`${dryRun ? "Would write" : "Wrote"} ${written} bodies for ${jurisdiction.name} (slug=${slug}), skipped ${skipped}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
