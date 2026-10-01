// nces-websites — for one state, match NCES CCD districts to our
// school_district jurisdictions by name, store the NCES LEAID as an identifier,
// and fill in jurisdictions.website. See ingestion/lib/ncesWebsites.ts.
//
// Usage:
//   npx tsx ingestion/tools/nces-websites.ts <state> [--dry-run] [--overwrite] [--csv=<path>] [--verbose]
import "dotenv/config";
import { getPool } from "@govdex/db";
import { applyNcesWebsites, DEFAULT_NCES_CSV } from "../lib/ncesWebsites";

async function main() {
  const args = process.argv.slice(2);
  const state = args.find((a) => !a.startsWith("--"));
  const flag = (n: string) => args.includes(`--${n}`);
  const csv = args.find((a) => a.startsWith("--csv="))?.slice(6) ?? DEFAULT_NCES_CSV;
  if (!state) {
    console.error("Usage: npx tsx ingestion/tools/nces-websites.ts <state> [--dry-run] [--overwrite] [--csv=<path>] [--verbose]");
    process.exit(1);
  }
  const pool = getPool();
  const r = await applyNcesWebsites(pool, state, csv, { dryRun: flag("dry-run"), overwrite: flag("overwrite") });
  const by = (h: string) => r.matches.filter((m) => m.how === h).length;
  console.log(
    `${state.toUpperCase()}: ${r.matches.length} matched (identifier ${by("identifier")}, exact ${by("exact")}, normalized ${by("normalized")}), ` +
      `${r.ambiguous.length} ambiguous, ${r.unmatchedNces.length} NCES-only, ${r.unmatchedDb.length} DB-only`,
  );
  console.log(flag("dry-run") ? "  dry run — nothing written" : `  wrote ${r.websitesWritten} websites, ${r.identifiersAdded} identifiers; ${r.skippedManual} scribe-edited rows left alone`);
  console.log(`  matched but no website in NCES: ${r.matches.filter((m) => !m.nces.website).length}`);
  if (flag("verbose")) {
    for (const m of r.matches.filter((m) => m.how === "normalized")) console.log(`  ~ ${m.nces.name}  =>  ${m.db.name}`);
    for (const a of r.ambiguous) console.log(`  ? ${a.nces.name}  =>  ${a.candidates.map((c) => c.name).join(" | ")}`);
    for (const n of r.unmatchedNces) console.log(`  NCES-only: ${n.name} (${n.city})`);
    for (const d of r.unmatchedDb) console.log(`  DB-only: ${d.name}`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
