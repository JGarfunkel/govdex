// seed-website — set the seed website URL for one jurisdiction (or one of
// its bodies), the URL `ingestion/spider/run.ts` starts crawling from. Only
// jurisdictions.website is ever read by the spider today (crawlSeed always
// runs with sourceBodyId=null in main()) — --body exists for completeness
// with inspect-jurisdiction.ts's output, not because the spider uses it yet.
//
// Follows the same guard as ingestion/lib/upsert.ts: a row a scribe has
// touched (origin='manual') is never clobbered by ingestion tooling. Pass
// --force to override that guard for a one-off correction.
//
// Usage:
//   npx tsx ingestion/tools/seed-website.ts "<jurisdiction name>" <url>
//   npx tsx ingestion/tools/seed-website.ts "<jurisdiction name>" <url> --body="<body name>"
//   npx tsx ingestion/tools/seed-website.ts "<jurisdiction name>" <url> --force
import "dotenv/config";
import { getPool } from "@govdex/db";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
  const [namePattern, url] = args;
  const force = flags.includes("--force");
  const bodyFlag = flags.find((f) => f.startsWith("--body="));
  const bodyName = bodyFlag ? bodyFlag.slice("--body=".length) : null;

  if (!namePattern || !url) {
    console.error('Usage: npx tsx ingestion/tools/seed-website.ts "<jurisdiction name>" <url> [--body="<body name>"] [--force]');
    process.exit(1);
  }
  try {
    new URL(url);
  } catch {
    console.error(`"${url}" doesn't look like a valid URL`);
    process.exit(1);
  }

  const pool = getPool();

  // Exact (case-insensitive) match wins outright, so "Bronx" doesn't get
  // stuck disambiguating against "Bronxville". Otherwise fall back to a
  // substring search and require the caller to narrow it themselves.
  const { rows: exact } = await pool.query<{ id: string; name: string; website: string | null; origin: string }>(
    `select id, name, website, origin from jurisdictions where name ilike $1`,
    [namePattern],
  );
  const matches = exact.length === 1
    ? exact
    : (await pool.query<{ id: string; name: string; website: string | null; origin: string }>(
        `select id, name, website, origin from jurisdictions where name ilike $1 order by name`,
        [`%${namePattern}%`],
      )).rows;

  if (matches.length === 0) {
    console.error(`No jurisdictions matching "${namePattern}"`);
    await pool.end();
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`"${namePattern}" matches ${matches.length} jurisdictions — narrow the pattern:`);
    for (const m of matches) console.error(`  ${m.name} (${m.id})`);
    await pool.end();
    process.exit(1);
  }

  const jurisdiction = matches[0];

  if (bodyName) {
    const { rows: bodyMatches } = await pool.query<{ id: string; name: string; website: string | null; origin: string }>(
      `select id, name, website, origin from bodies where jurisdiction_id = $1 and name ilike $2`,
      [jurisdiction.id, `%${bodyName}%`],
    );
    if (bodyMatches.length !== 1) {
      console.error(`"${bodyName}" matches ${bodyMatches.length} bodies under ${jurisdiction.name} — expected exactly 1`);
      for (const b of bodyMatches) console.error(`  ${b.name} (${b.id})`);
      await pool.end();
      process.exit(1);
    }
    const body = bodyMatches[0];
    if (body.origin !== "import" && !force) {
      console.error(`${body.name} has origin='${body.origin}' (scribe-edited) — refusing to overwrite. Pass --force to override.`);
      await pool.end();
      process.exit(1);
    }
    await pool.query(`update bodies set website = $2 where id = $1`, [body.id, url]);
    console.log(`Set ${jurisdiction.name} / ${body.name}.website = ${url} (was: ${body.website ?? "(none)"})`);
    await pool.end();
    return;
  }

  if (jurisdiction.origin !== "import" && !force) {
    console.error(`${jurisdiction.name} has origin='${jurisdiction.origin}' (scribe-edited) — refusing to overwrite. Pass --force to override.`);
    await pool.end();
    process.exit(1);
  }
  await pool.query(`update jurisdictions set website = $2 where id = $1`, [jurisdiction.id, url]);
  console.log(`Set ${jurisdiction.name}.website = ${url} (was: ${jurisdiction.website ?? "(none)"})`);
  console.log(`Run: npm run govdex:spider -- --like="${jurisdiction.name}" to crawl it now.`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
