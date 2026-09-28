// Matches anchor text like "Parks Committee Meeting Minutes" or "Zoning
// Board Agendas & Minutes" against a jurisdiction's already-known bodies, so
// the link can be proposed as *that body's* agenda_url/minutes_url rather
// than dropped — see bodies.agenda_url/minutes_url in schema.sql.
//
// Deliberately narrower than boardDetector.ts's guessBoard: a wrong board
// guess just proposes a body a scribe declines to create, but a wrong match
// here would overwrite a *different, already-real* body's meeting-record
// link, so this only fires on an exact (normalized) name match — no fuzzy
// substring/token-overlap matching. A text with no prefix at all (a bare
// "Agenda" link with no body name in its own anchor text) is out of scope
// here; that needs page-context (which body's subpage it was found on)
// tracking crawlSeed.ts doesn't do yet.

export interface AgendaMatch {
  recordKind: "agenda" | "minutes" | "agenda_minutes";
  bodyId: string;
  bodyName: string;
}

// Captures the body-name prefix and the trailing "(meeting) agenda(s)
// (& minutes)" / "minutes" phrase that names the record kind.
const RECORD_SUFFIX_RE = /^(.+?)\s+(?:meeting\s+)?(agendas?(?:\s*(?:&|and)\s*minutes)?|minutes)\s*$/i;

export function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s*\([^()]*\)\s*$/, "") // trailing parenthetical, e.g. "(BAR)"
    .replace(/[.,:;]+$/, "")
    .replace(/\s+/g, " ");
}

export function guessAgendaMatch(linkText: string, knownBodies: { id: string; name: string }[]): AgendaMatch | null {
  const text = linkText.trim();
  if (!text || text.length > 100 || knownBodies.length === 0) return null;

  const match = RECORD_SUFFIX_RE.exec(text);
  if (!match) return null;

  const prefix = normalize(match[1]);
  if (!prefix) return null;

  const body = knownBodies.find((b) => normalize(b.name) === prefix);
  if (!body) return null;

  const suffix = match[2].toLowerCase();
  const hasAgenda = /agenda/.test(suffix);
  const hasMinutes = /minutes/.test(suffix);
  const recordKind: AgendaMatch["recordKind"] = hasAgenda && hasMinutes ? "agenda_minutes" : hasAgenda ? "agenda" : "minutes";

  return { recordKind, bodyId: body.id, bodyName: body.name };
}
