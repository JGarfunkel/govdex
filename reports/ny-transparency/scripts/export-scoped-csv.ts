// One-time migration: fetches the *current* wide-format sheet (city_/state_
// prefixed columns) and re-exports it as a long/scoped CSV — one row per
// (domain, metric, scope) — matching the new TransparencyRow shape in
// lib/types.ts. Paste the output into a new sheet tab, then point
// lib/csv-source.ts at that tab's gid.
//
// Run with: npx tsx ny-transparency/scripts/export-scoped-csv.ts [output-path]

import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { fetchCsv } from "../lib/csv-source";

const SCOPED_COLUMNS = [
  "domain",
  "metric",
  "scope",
  "exists",
  "dataset_url",
  "dashboard_url",
  "dashboard_name",
  "provider",
  "source",
  "format",
  "granularity",
  "range",
  "cadence",
  "lag",
  "legal_basis",
  "notes",
  "tune",
  "who_can_tune",
] as const;

type ScopedRecord = Record<(typeof SCOPED_COLUMNS)[number], string>;

function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(records: ScopedRecord[]): string {
  const lines = [SCOPED_COLUMNS.join(",")];
  for (const record of records) {
    lines.push(SCOPED_COLUMNS.map((col) => csvField(record[col] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

function wideRowToScopedRecords(r: Record<string, string>): ScopedRecord[] {
  const domain = r.domain ?? "";
  const metric = r.metric ?? "";
  const tune = r.tune ?? "";
  const whoCanTune = r.who_can_tune ?? "";

  return [
    {
      domain,
      metric,
      scope: "New York City",
      exists: r.city_exists ?? "",
      dataset_url: r.city_url ?? "",
      dashboard_url: r.city_dashboard_url ?? "",
      dashboard_name: r.city_dashboard_name ?? "",
      provider: r.city_provider ?? "",
      source: r.city_source ?? "",
      format: r.city_format ?? "",
      granularity: r.city_granularity ?? "",
      range: r.city_range ?? "",
      cadence: r.city_cadence ?? "",
      lag: r.city_lag ?? "",
      legal_basis: r.city_legal_basis ?? "",
      notes: r.city_notes ?? "",
      tune,
      who_can_tune: whoCanTune,
    },
    {
      domain,
      metric,
      scope: "New York State",
      exists: r.state_exists ?? "",
      dataset_url: r.state_dataset_url ?? "",
      dashboard_url: r.state_dashboard_url ?? "",
      dashboard_name: r.state_dashboard_name ?? "",
      provider: r.state_provider ?? "",
      source: r.state_source ?? "",
      format: r.state_format ?? "",
      granularity: r.state_granularity ?? "",
      range: r.state_range ?? "",
      cadence: r.state_cadence ?? "",
      lag: r.state_lag ?? "",
      legal_basis: r.state_legal_basis ?? "",
      notes: r.state_notes ?? "",
      tune,
      who_can_tune: whoCanTune,
    },
  ];
}

async function main() {
  const outPath = path.resolve(
    process.cwd(),
    process.argv[2] || "data/ny-transparency/transparency-scoped-export.csv",
  );

  const raw = await fetchCsv();
  const wideRecords: Record<string, string>[] = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const scopedRecords = wideRecords
    .filter((r) => (r.domain ?? "").trim() !== "")
    .flatMap(wideRowToScopedRecords);

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, toCsv(scopedRecords), "utf-8");

  console.log(`Wrote ${scopedRecords.length} scoped rows to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
