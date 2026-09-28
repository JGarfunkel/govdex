// Cadence/lag parsing for the §8.3 relation determinant (scorecard-spec.md).
// Order matters: more specific tokens (biweekly, semiannual, biennial) must be
// checked before the substrings they contain (weekly, annual).

const CADENCE_TOKENS: [RegExp, number][] = [
  [/real[\s-]?time|\blive\b/, 0],
  [/\bdaily\b/, 1],
  [/\bbiweekly\b/, 14],
  [/\bweekly\b/, 7],
  [/\bmonthly\b/, 30],
  [/\bquarterly\b/, 91],
  [/semi[\s-]?annual/, 182],
  [/\bbiennial\b/, 730],
  [/\bannual\b|\byearly\b/, 365],
];

const CYCLE_YEARS = /(\d+)\s*-?\s*(?:yr|year)s?\b/;

export function cadenceDays(label: string): number | null {
  const t = label.trim().toLowerCase();
  if (!t) return null;

  for (const [pattern, days] of CADENCE_TOKENS) {
    if (pattern.test(t)) return days;
  }

  const cycle = t.match(CYCLE_YEARS);
  if (cycle) return Number(cycle[1]) * 365;

  return null;
}

const LAG_PATTERN = /(\d+)\s*\+?\s*(day|week|month|year)/;
const LAG_UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };

export function lagDays(label: string): number | null {
  const t = label.trim().toLowerCase();
  if (!t) return null;

  const match = t.match(LAG_PATTERN);
  if (!match) return null;

  return Number(match[1]) * LAG_UNIT_DAYS[match[2]];
}
