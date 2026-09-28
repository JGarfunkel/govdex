import { readSnapshot } from "./cache-io";
import { assessRow } from "./grading/assess";
import { buildDomainEntries, type CategoryGroup } from "./grading/build-domains";
import type { AssessedRow } from "./types";

export function getAssessedRows(): { rows: AssessedRow[]; fetchedAt: string | null } {
  const snapshot = readSnapshot();
  if (!snapshot) return { rows: [], fetchedAt: null };

  const rows: AssessedRow[] = snapshot.rows.map((row) => ({
    row,
    assessment: assessRow(row),
  }));

  return { rows, fetchedAt: snapshot.fetchedAt };
}

export function getDomainGroups(): { groups: CategoryGroup[]; fetchedAt: string | null } {
  const { rows, fetchedAt } = getAssessedRows();
  return { groups: buildDomainEntries(rows), fetchedAt };
}
