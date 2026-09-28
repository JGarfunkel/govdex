import type { AssessedRow, DomainEntry } from "../types";
import { isThirdPartyProvider } from "../provider";
import { computeAdequacy, computeRelation, isStateInadequate } from "./relation";

export interface CategoryGroup {
  category: string;
  entries: DomainEntry[];
}

interface PendingEntry {
  city?: AssessedRow;
  state?: AssessedRow;
  thirdParty: AssessedRow[];
  reviewFlags: string[];
}

// A second row landing on an already-filled government slot used to
// silently overwrite the first one (lost data, no trace). Now it's flagged
// and the first-seen row wins instead — deterministic, and visible via
// reviewFlags rather than depending on sheet row order.
function assignGovernmentRow(pending: PendingEntry, slot: "city" | "state", scopeLabel: string, ar: AssessedRow): void {
  const existing = pending[slot];
  if (existing) {
    const existingSource = existing.row.source || existing.row.dashboard_name || "an earlier row";
    const newSource = ar.row.source || ar.row.dashboard_name || "another row";
    pending.reviewFlags.push(
      `duplicate ${scopeLabel} row for this metric — keeping "${existingSource}", ignoring "${newSource}"`,
    );
    return;
  }
  pending[slot] = ar;
}

export function buildDomainEntries(rows: AssessedRow[]): CategoryGroup[] {
  const categories = new Map<string, Map<string, PendingEntry>>();

  for (const ar of rows) {
    const category = ar.row.domain || "Other";
    const domain = ar.row.metric || "Other";
    if (!categories.has(category)) categories.set(category, new Map());
    const domains = categories.get(category)!;
    if (!domains.has(domain)) domains.set(domain, { thirdParty: [], reviewFlags: [] });
    const pending = domains.get(domain)!;

    if (isThirdPartyProvider(ar.row.provider)) {
      pending.thirdParty.push(ar);
    } else if (ar.row.scope === "New York City") {
      assignGovernmentRow(pending, "city", "New York City", ar);
    } else if (ar.row.scope === "New York State") {
      assignGovernmentRow(pending, "state", "New York State", ar);
    }
  }

  return Array.from(categories.entries()).map(([category, domains]) => ({
    category,
    entries: Array.from(domains.entries()).map(([domain, { city, state, thirdParty, reviewFlags }]) => {
      if (!city && !state && thirdParty.length === 0) {
        return {
          category,
          domain,
          city,
          state,
          thirdParty,
          thirdPartySource: null,
          relation: null,
          adequacy: null,
          reviewFlags,
          stateInadequate: false,
        };
      }

      const computed = computeRelation(city, state, thirdParty);
      const adequacy = computeAdequacy(computed.relation, city, state);
      return {
        category,
        domain,
        city,
        state,
        thirdParty,
        thirdPartySource: computed.thirdPartySource,
        relation: computed.relation,
        adequacy,
        reviewFlags: [...reviewFlags, ...computed.reviewFlags],
        stateInadequate: isStateInadequate(computed.relation, adequacy),
      };
    }),
  }));
}
