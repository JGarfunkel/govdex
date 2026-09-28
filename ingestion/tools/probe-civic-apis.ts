// probe-civic-apis — for one jurisdiction (by name pattern) or every
// jurisdiction missing both open_data_api_url and legistar_api_url, probe
// the off-domain civic-data platform registries (Socrata, ArcGIS, Legistar,
// data.gov CKAN, crt.sh) via ingestion/lib/civicApiProbe.ts and file each hit
// as a candidate_links row (link_type='api') for a scribe to review.
//
// Like every other detector in this codebase (budgetDetector.ts,
// agendaDetector.ts, vendor_detector.yaml), this never writes to
// jurisdictions directly — even a 'confirmed' hit still goes through
// candidate_links so a human promotes it via POST /candidates/:id/promote
// (apps/web/components/SpiderCandidates.tsx / apps/api's candidates route).
// crt.sh subdomain hints are logged only, not filed — they're explicitly a
// hint, not a URL to promote (see probeCertTransparency's doc comment).
//
// Usage:
//   npx tsx ingestion/tools/probe-civic-apis.ts "<name pattern>"
//   npx tsx ingestion/tools/probe-civic-apis.ts --all [--limit=200]
//   npx tsx ingestion/tools/probe-civic-apis.ts "<name pattern>" --dry-run
//   npx tsx ingestion/tools/probe-civic-apis.ts "<name pattern>" --verbose
//
// --verbose prints every URL queried (including candidate ArcGIS/Legistar
// slugs that miss), not just the ones that end up as a hit — useful for
// seeing why a jurisdiction came back with nothing.
import "dotenv/config";
import { getPool } from "@govdex/db";
import { loadSocrataDomains, probeEntity, type PlatformHit } from "../lib/civicApiProbe";

interface JurisdictionRow {
  id: string;
  name: string;
  website: string | null;
  open_data_api_url: string | null;
  legistar_api_url: string | null;
}

function domainOf(website: string | null): string | undefined {
  if (!website) return undefined;
  try {
    return new URL(website.includes("://") ? website : `https://${website}`).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

// Maps a found platform hit onto which jurisdiction column it's a candidate
// for, and the guessed_function label SpiderCandidates.tsx keys off of.
function targetColumn(platform: PlatformHit["platform"]): { column: "open_data_api_url" | "legistar_api_url"; guessedFunction: "open_data" | "legistar" } | null {
  if (platform === "socrata" || platform === "arcgis" || platform === "datagov") {
    return { column: "open_data_api_url", guessedFunction: "open_data" };
  }
  if (platform === "legistar") return { column: "legistar_api_url", guessedFunction: "legistar" };
  return null; // 'crt' is a hint only, never promoted
}

const PLATFORM_LABEL: Record<PlatformHit["platform"], string> = {
  socrata: "Socrata",
  arcgis: "ArcGIS",
  legistar: "Legistar",
  datagov: "data.gov CKAN",
  crt: "crt.sh",
};

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
  const namePattern = args[0] ?? null;
  const all = flags.includes("--all");
  const dryRun = flags.includes("--dry-run");
  const verbose = flags.includes("--verbose");
  const limitFlag = flags.find((f) => f.startsWith("--limit="))?.slice("--limit=".length);
  const limit = limitFlag ? Number(limitFlag) : 200;

  if (!namePattern && !all) {
    console.error(
      "Usage:\n" +
        '  npx tsx ingestion/tools/probe-civic-apis.ts "<name pattern>" [--dry-run] [--verbose]\n' +
        "  npx tsx ingestion/tools/probe-civic-apis.ts --all [--limit=200] [--dry-run] [--verbose]",
    );
    process.exit(1);
  }

  const onRequest = verbose ? (url: string) => console.log(`    -> ${url}`) : undefined;

  const pool = getPool();

  const { rows: jurisdictions } = await pool.query<JurisdictionRow>(
    all
      ? `select id, name, website, open_data_api_url, legistar_api_url
           from jurisdictions
          where open_data_api_url is null and legistar_api_url is null
          order by name
          limit $1`
      : `select id, name, website, open_data_api_url, legistar_api_url
           from jurisdictions
          where name ilike $1
          order by name`,
    all ? [limit] : [`%${namePattern}%`],
  );

  if (jurisdictions.length === 0) {
    console.log(all ? "No jurisdictions missing both API columns." : `No jurisdictions matching "${namePattern}"`);
    await pool.end();
    return;
  }

  console.log(`Probing ${jurisdictions.length} jurisdiction(s)...`);
  const ctx = { socrataDomains: await loadSocrataDomains(onRequest), onRequest };

  let filed = 0;
  let skippedExisting = 0;

  for (const j of jurisdictions) {
    const domain = domainOf(j.website);
    if (verbose) console.log(`  ${j.name} (domain: ${domain ?? "none"}):`);
    const result = await probeEntity({ name: j.name, domain }, ctx);
    if (result.hits.length === 0) {
      console.log(`  ${j.name}: no hits`);
      continue;
    }

    for (const hit of result.hits) {
      if (hit.platform === "crt") {
        if (hit.subdomains?.length) console.log(`  ${j.name}: crt.sh hint — ${hit.subdomains.join(", ")}`);
        continue;
      }
      const target = targetColumn(hit.platform);
      if (!target || !hit.api) continue;

      if (target.column === "open_data_api_url" && j.open_data_api_url) {
        skippedExisting++;
        continue;
      }
      if (target.column === "legistar_api_url" && j.legistar_api_url) {
        skippedExisting++;
        continue;
      }

      const title = `${PLATFORM_LABEL[hit.platform]} API (${hit.status}, score ${hit.score ?? "?"})`;
      console.log(`  ${j.name}: ${title} -> ${hit.api}`);
      if (dryRun) continue;

      const { rowCount } = await pool.query(
        `insert into candidate_links
           (jurisdiction_id, found_on_url, target_url, link_type, title, guessed_vendor, guessed_function, status)
         values ($1, $2, $3, 'api', $4, $5, $6, 'new')
         on conflict (jurisdiction_id, target_url) do nothing`,
        [j.id, hit.endpoint ?? hit.api, hit.api, title, PLATFORM_LABEL[hit.platform], target.guessedFunction],
      );
      if (rowCount) filed++;
    }
  }

  console.log(
    `\n${filed} candidate(s) filed${dryRun ? " (dry run — nothing written)" : ""}, ${skippedExisting} skipped (column already set).`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
