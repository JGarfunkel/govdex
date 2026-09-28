// Lightweight heuristic, unlike classifier.ts's yaml-driven rules — a
// handful of URL shapes cover the common cases (Google/Outlook calendar
// embeds, iCal feeds, Legistar/Granicus meeting calendars, plain
// "/calendar" or "/agendas" paths). Short enough not to need its own config
// file yet; promote to a yaml file like channel_detector.yaml if this grows.
const CALENDAR_PATTERNS: RegExp[] = [
  /calendar\.google\.com/i,
  /outlook\.office(?:365)?\.com\/calendar/i,
  /\.ics(?:[?#]|$)/i,
  /legistar\.com\/calendar/i,
  /granicus\.com\/viewpublisher/i,
  /\/calendars?(?:\.\w+)?(?:[/?#]|$)/i,
  /\/agendas?(?:[/?#]|$)/i,
  /\/meetings?(?:[/?#]|$)/i,
  // A single event's own detail page ($HOST/event/123-open-house) — not a
  // body's meeting calendar, but still a dated/events-shaped page rather
  // than a board, vendor, or channel link.
  /\/events?(?:[/?#]|$)/i,
];

export function looksLikeCalendarLink(url: string): boolean {
  return CALENDAR_PATTERNS.some((pattern) => pattern.test(url));
}

// Any link into a jurisdiction's Legistar instance (an InsiteView page, a
// MeetingDetail permalink, even the bare host) is usually recognized as a
// vendor link, not a calendar one — CALENDAR_PATTERNS' legistar.com/calendar
// only matches an anchor that already points at the calendar itself, which
// most Legistar links found on a site don't. But every Legistar instance
// serves its calendar at the same predictable path off the bare host, so
// once any legistar.com link is found, that calendar can be guessed directly
// rather than waiting to stumble on a page that happens to link it. Callers
// should still confirm the guess resolves (HTTP 200) before proposing it —
// see crawlSeed.ts's checkLegistarCalendar.
export function guessLegistarCalendarUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(?:^|\.)legistar\.com$/i.test(parsed.hostname)) return null;
  return `${parsed.origin}/Calendar.aspx`;
}

// A municipal calendar is usually one page filtered/paginated a dozen ways
// ($HOST/calendar/2024-09, /calendar/month, /calendar/list?category=...) —
// every variant is the same calendar, so before it's compared or stored,
// collapse the URL back to the bare $HOST/calendar/ index rather than
// proposing (and later re-crawling) one candidate per filter/page variant.
//
// CivicPlus sites (whiteplainsny.gov, scarsdale.com, ...) serve one shared
// calendar.aspx and filter it per board via a category/term query param
// (?CID=14, ?TID=30) — the Boards & Committees page links out to one such
// filtered URL per board. Left uncollapsed, each board's link would
// canonicalize to a different target_url and get proposed as its own
// "calendar", when it's really the same site-wide calendar filtered to one
// board. Whatever /calendar(s)/... looks like — a path segment, a query
// string, an .aspx extension, or all three — only the host + bare
// calendar path is kept; every other /calendar/* variant collapses into it.
const CALENDAR_PREFIX_RE = /^(.*\/calendars?)(\.\w+)?(?:[/?#].*)?$/i;

export function canonicalizeCalendarLink(url: string): string {
  const match = CALENDAR_PREFIX_RE.exec(url);
  if (!match) return url;
  const [, base, extension] = match;
  return extension ? base + extension : base + "/";
}
