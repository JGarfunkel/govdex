// Tab-separated text with a header row -> one object per row. `nullValues`
// (e.g. CDE's "No Data") and empty cells become null.
export function parseTsv(text: string, nullValues: string[] = []): Record<string, string | null>[] {
  const nulls = new Set(nullValues);
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: Record<string, string | null> = {};
    header.forEach((h, i) => {
      const c = (cells[i] ?? "").trim();
      row[h] = c === "" || nulls.has(c) ? null : c;
    });
    return row;
  });
}
