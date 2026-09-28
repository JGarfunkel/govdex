import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { looksLikeCalendarLink } from "./calendarDetector";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface BoardDetectorConfig {
  district_types: string[];
  hints: string[];
  exclude: string[];
  reject?: string[];
}

interface CommonDetectorConfig {
  reject: string[];
  reject_url: string[];
}

let config: BoardDetectorConfig | null = null;
let rejectUrlRe: RegExp | null = null;

function loadConfig(): BoardDetectorConfig {
  if (!config) {
    const raw = fs.readFileSync(path.resolve(__dirname, "board_detector.yaml"), "utf-8");
    const parsed = yaml.load(raw) as BoardDetectorConfig;
    const commonRaw = fs.readFileSync(path.resolve(__dirname, "detector_common.yaml"), "utf-8");
    const common = yaml.load(commonRaw) as CommonDetectorConfig;
    config = { ...parsed, reject: [...common.reject, ...(parsed.reject ?? [])] };
    const rejectUrlAlternation = common.reject_url.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    rejectUrlRe = new RegExp(`(?:${rejectUrlAlternation})`, "i");
  }
  return config;
}

function getRejectUrlRe(): RegExp {
  loadConfig();
  return rejectUrlRe!;
}

// Built lazily from config.district_types the first time it's needed, then
// cached alongside config itself (loadConfig() only ever reads the yaml once).
let districtRegex: RegExp | null = null;

function getDistrictRegex(): RegExp {
  if (!districtRegex) {
    const alternation = loadConfig()
      .district_types.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    // 1-3 leading words (the district's own name, e.g. "Bedford Hills"), one
    // of the configured types, then the literal word "District" and nothing
    // else — see board_detector.yaml's comment for why this must be a full-
    // text shape match rather than the old "contains 'district' anywhere"
    // substring test (which fired on things like "Congressional District 17").
    districtRegex = new RegExp(`^(?:[\\w.'-]+\\s+){0,3}(?:${alternation})\\s+District$`, "i");
  }
  return districtRegex;
}

export interface BoardGuess {
  name: string;
  // 'district' — a school/fire/sewer/water/etc. district: its own
  // jurisdiction, never a committee of the page it was found on.
  // 'committee' — a plausible committee/board/commission of *this*
  // jurisdiction (the case add-body.ts's --parent is for).
  // 'index' — a directory/hub page listing multiple bodies ("Boards and
  // Commissions", "Boards & Committees"), not any one of them by name.
  kind: "district" | "committee" | "index";
}

function words(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.,:;]+$/, "").toLowerCase());
}

// A trailing parenthetical acronym ("Board of Assessment Review (BAR)") is
// common on real body names and would otherwise defeat the first/last-word
// shape checks below — strip it before tokenizing (only for the shape test;
// the stored guess keeps the acronym).
function stripTrailingParenthetical(text: string): string {
  return text.replace(/\s*\([^()]*\)\s*$/, "").trim();
}

// A site commonly spells a "Board of X" body's own name out with its
// jurisdiction's name and/or type prepended — "Bedford Board of Assessment
// Review", "Bedford Village Board of Assessment Review", "Village of Bedford
// Board of Assessment Review" — none of which is itself first/last-word
// hint-shaped (isBodyShaped would see "bedford"/"review", not "board"), so
// without this they're silently dropped rather than proposed. Stripping the
// jurisdiction's own name (and, when known, its type: City/Village/Town/
// County/State) off the front whenever what's left is a bare "Board of ..."
// normalizes all three spellings down to the same canonical name a
// prefix-free anchor ("Board of Assessment Review") already produces, so
// they dedupe and match isBodyShaped's first-word "board" check identically.
// Deliberately scoped to *this* jurisdiction's actual name (passed in by the
// caller, which knows what jurisdiction the page being crawled belongs to),
// not any capitalized leading words — an arbitrary "<name> Board of X" would
// be too broad and swallow unrelated bodies that merely start with a place
// name.
function stripJurisdictionPrefix(text: string, jurisdictionName?: string | null, jurisdictionType?: string | null): string {
  const name = jurisdictionName?.trim();
  if (!name) return text;
  const escName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefixes = [escName];
  const type = jurisdictionType?.trim();
  if (type) {
    const escType = type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    prefixes.push(`${escName}\\s+${escType}`, `${escType}\\s+of\\s+${escName}`);
  }
  const re = new RegExp(`^(?:${prefixes.join("|")})\\s+(Board\\s+of\\s+.+)$`, "i");
  const m = text.match(re);
  return m ? m[1] : text;
}

// Whether anchor text is shaped like a jurisdiction-internal board/committee
// name rather than a sentence, document title, or a person's title that
// merely mentions one of these words. "Committee"/"Board" are always body-
// naming words; whatever this jurisdiction's board_detector.yaml lists under
// `hints` (Commission, Council, Authority, ...) gets held to the exact same
// standard — first word, last word, or (prefixed by "Advisory") second word.
// A single-word hint used to be matched anywhere in the text via a bare
// substring test, which is what let "council" match inside "Councilman" and
// let a document title like "... Town Council Letter of Transmittal" match
// on "Council" despite the rest of the title being unrelated prose — neither
// "councilman" nor "transmittal" is itself the token "council", so requiring
// the hint word to BE the first or last token (not merely contain it) fixes
// both. "Task Force" is the one two-word hint, so it's checked as the last
// two words instead of a single token.
function isBodyShaped(text: string, hints: string[]): boolean {
  const w = words(stripTrailingParenthetical(text));
  if (w.length === 0) return false;
  const first = w[0];
  const last = w[w.length - 1];
  const lastTwo = w.slice(-2).join(" ");

  const nameWords = ["committee", "board", ...hints.map((h) => h.toLowerCase()).filter((h) => !h.includes(" "))];
  if (nameWords.includes(first) || nameWords.includes(last)) return true;
  if (lastTwo === "task force") return true;
  if (w.length >= 2 && first === "advisory") {
    if (nameWords.includes(w[1])) return true;
    if (w.length >= 3 && `${w[1]} ${w[2]}` === "task force") return true;
  }
  return false;
}

// Whether anchor text is a plural, hub-shaped phrase like "Boards and
// Commissions" or "Boards & Committees" — every word in it a pluralized
// name-word (never a single specific body's name) — rather than a name that
// merely contains one of these words as a substring, the same "text of these
// exact words, not merely containing them" discipline isBodyShaped applies
// to the singular case. This is what a jurisdiction's own "Boards and
// Committees" nav item's anchor text usually looks like when it turns up as
// an ordinary link in the general cascade rather than via cascade.ts's
// dedicated BOARDS_HUB_PATTERN page-level search.
function isIndexShaped(text: string, hints: string[]): boolean {
  const singular = ["committee", "board", ...hints.map((h) => h.toLowerCase()).filter((h) => !h.includes(" "))];
  const plural = new Set(singular.map((w) => (w.endsWith("y") ? w.slice(0, -1) + "ies" : `${w}s`)));
  const parts = stripTrailingParenthetical(text)
    .toLowerCase()
    .split(/\s*(?:,|&|\band\b)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((p) => plural.has(p));
}

// A link ending in .pdf (ignoring query string/fragment) is a document, not
// a body's own page — even when its anchor text is shaped like a body name
// ("Zoning Board of Appeals (PDF)" already catches the text-based case via
// board_detector.yaml's reject list, but plenty of PDFs are linked with the
// body's bare name and no "(PDF)" tell in the text at all).
const PDF_URL = /\.pdf(?:[?#]|$)/i;

// "<...> District Commission" (e.g. "Historic District Commission", "Water
// District Commission") names a commission — the body that governs or
// reviews something for a district, or a district's own governing
// commission — not the district itself, even though "District" appears in
// the text. Checked ahead of the district regex, whose "<type> District"
// shape only matches when the text ends in the bare word "District"; this
// is deliberately independent of the configured `hints`/`district_types`
// lists (unlike isBodyShaped's checks) since it's a fixed naming
// convention, not something a jurisdiction's config should need to opt
// into.
const DISTRICT_COMMISSION_RE = /^(?:[\w.'-]+\s+){0,3}district\s+commission$/i;

// A numeric date embedded in the anchor text ("Planning Board 3/4/2025",
// "Zoning Board of Appeals - 2025-03-04") means this link names one meeting
// of a committee, not the committee itself — a calendar/agenda entry that
// happened to also be body-shaped, not a candidate body to propose.
const NUMERIC_DATE_RE = /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/;

// Anchor text that looks like it names a jurisdiction-internal board,
// committee, or a special district — see board_detector.yaml for why the
// district check runs first and is mutually exclusive with the committee
// guess, and why both stay broad (false positives are cheap; nothing here
// gets created automatically).
export function guessBoard(
  linkText: string,
  url?: string,
  jurisdictionName?: string | null,
  jurisdictionType?: string | null,
): BoardGuess | null {
  const text = stripJurisdictionPrefix(linkText.trim(), jurisdictionName, jurisdictionType);
  if (!text || text.length > 80) return null; // empty, or too long to be a link label naming one body
  if (url && PDF_URL.test(url)) return null;
  // Any calendar-shaped URL (day/month view, .ics feed, Legistar/Granicus
  // calendar, /agendas, /meetings, /events, ...) is a calendar entry, not a
  // body's own page — even when its anchor text names a board, e.g. a
  // meeting-listing calendar whose entries read "Planning Board 3/4/2025".
  // See looksLikeCalendarLink (calendarDetector.ts): recognizing this here,
  // not just via NUMERIC_DATE_RE below, keeps guessBoard from proposing (and
  // crawlSeed.ts from recursively fetching) one candidate per calendar entry.
  if (url && looksLikeCalendarLink(url)) return null;
  if (url && getRejectUrlRe().test(url)) return null;
  const { hints, exclude, reject } = loadConfig();
  const lower = text.toLowerCase();

  if (DISTRICT_COMMISSION_RE.test(stripTrailingParenthetical(text))) {
    return NUMERIC_DATE_RE.test(text) ? null : { name: text, kind: "committee" };
  }
  if (getDistrictRegex().test(stripTrailingParenthetical(text))) return { name: text, kind: "district" };

  // Exact, or a suffix ("Rye Town Council" for the exclude "Town Council") —
  // a site commonly spells its governing body out with the jurisdiction's
  // own name prepended, and listing every jurisdiction's name here isn't
  // viable. Suffix-only (not a bare substring) so this doesn't also swallow
  // an unrelated body whose name happens to contain the excluded phrase.
  if (exclude.some((e) => lower === e.toLowerCase() || lower.endsWith(" " + e.toLowerCase()))) return null;
  if (reject.some((r) => lower.includes(r.toLowerCase()))) return null;

  if (isBodyShaped(text, hints)) {
    return NUMERIC_DATE_RE.test(text) ? null : { name: text, kind: "committee" };
  }
  if (isIndexShaped(text, hints)) return { name: text, kind: "index" };
  return null;
}
