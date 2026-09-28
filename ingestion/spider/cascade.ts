import * as cheerio from "cheerio";
import { politeFetch } from "./fetcher";
import { normalizeUrl } from "./urlMatch";

export interface CascadeHit {
  url: string;
  rung: "anchors" | "inline_scripts" | "external_scripts";
  // Anchor text, when rung === "anchors" — the only rung with a link label
  // to speak of. Used to guess a board/committee name (see
  // ingestion/spider/boardDetector.ts), not just classify the URL.
  text?: string;
  // True when every occurrence of this URL as an anchor sits inside a
  // persistent nav/menu container rather than the page's own content — see
  // isInNavLikeContainer(). Lets crawlSeed.ts notice the
  // "boards buried in the site menu, not the index page" friction.
  inNav?: boolean;
}

const URL_IN_TEXT = /https?:\/\/[^\s"'<>)]+/g;

// Common CMS authoring bug: an internal nav link is written root-relative
// (e.g. "government/boards/foo.php", meant as "/government/boards/foo.php")
// but missing its leading slash. Resolved against a page that already lives
// in that same directory, it doubles the directory onto itself
// ("/government/boards/government/boards/foo.php") and 404s. Detect the
// doubled prefix and collapse it back to the (working) single copy.
function collapseDoubledDirectory(pathname: string, base: string): string {
  const baseDir = new URL(".", base).pathname;
  if (baseDir === "/") return pathname;
  const doubled = baseDir + baseDir.slice(1);
  return pathname.startsWith(doubled) ? pathname.slice(baseDir.length - 1) : pathname;
}

function absolutize(href: string, base: string): string | null {
  try {
    const resolved = new URL(href, base);
    resolved.pathname = collapseDoubledDirectory(resolved.pathname, base);
    return normalizeUrl(resolved.toString());
  } catch {
    return null;
  }
}

const NAV_LIKE_RE = /\b(nav|menu|sidebar|accordion)/i;
const MAX_ANCESTOR_HOPS = 12; // deep enough for any real template; stops runaway walks

// Card-style links commonly wrap an image, a generic call-to-action, and the
// item's own name in separate child elements, all inside one <a> (e.g. a
// Webflow collection card: an image div, a "Learn More" button div, and a
// ".collection-card-title" div). A plain $(el).text() concatenates all of it
// with no separator ("Learn MoreAffordable Housing Board"), which defeats
// guessBoard's word-shape checks in boardDetector.ts. Matched against the
// *trimmed* leaf text (not the raw text, which may carry stray whitespace).
const CTA_TEXT_RE = /^(learn more|read more|view more|see more|click here|more info(?:rmation)?|details?)$/i;

// Collects each leaf element's own text separately and drops generic CTA
// boilerplate before rejoining, so a card link's actual name-bearing text
// (its most specific/deepest element) survives instead of being buried in
// the concatenation. Falls back to the plain (still trimmed) text when no
// leaf survives the CTA filter, e.g. for ordinary single-text-node anchors.
function anchorText($: cheerio.CheerioAPI, el: unknown): string {
  const node = $(el as never);
  const leaves = node.find("*").addBack().filter((_, n) => $(n).children().length === 0);
  const parts = leaves
    .map((_, n) => $(n).text().trim())
    .get()
    .filter((t) => t && !CTA_TEXT_RE.test(t));
  return parts.length > 0 ? parts.join(" ") : node.text().trim();
}

// A CivicPlus-style department page often repeats its whole board/committee
// list a second time as a persistent left-hand accordion menu (class names
// like "sideNavLi"/"navMenuItem") — the same links, but as site chrome, not
// page content. Walking up from an anchor to check for a nav/aside tag or a
// nav-ish class/id is how crawlSeed.ts tells "this board is only reachable
// via the menu" (the friction) from "this board is listed on its own
// index page" (an anchor also found outside any such container).
function isInNavLikeContainer($: cheerio.CheerioAPI, el: unknown): boolean {
  let node = $(el as never);
  for (let hop = 0; hop < MAX_ANCESTOR_HOPS && node.length; hop++) {
    const tag = (node.prop("tagName") as string | undefined)?.toLowerCase();
    if (tag === "nav" || tag === "aside") return true;
    const cls = node.attr("class") ?? "";
    const id = node.attr("id") ?? "";
    if (NAV_LIKE_RE.test(cls) || NAV_LIKE_RE.test(id)) return true;
    node = node.parent();
  }
  return false;
}

// The cascade: parse anchors first, then scan inline scripts, then fetch
// external scripts, firing each rung only when the prior comes up empty, and
// recording which rung produced each hit as a discoverability signal. Avoids
// headless Chrome — social/newsletter links usually sit in plain anchors, so
// rung 1 catches most of them.
export async function runCascade(pageUrl: string, html: string): Promise<CascadeHit[]> {
  const $ = cheerio.load(html);

  const anchorHits: CascadeHit[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = absolutize(href, pageUrl);
    if (abs && /^https?:/.test(abs))
      anchorHits.push({ url: abs, rung: "anchors", text: anchorText($, el), inNav: isInNavLikeContainer($, el) });
  });
  if (anchorHits.length > 0) return dedupe(anchorHits);

  const inlineHits: CascadeHit[] = [];
  $("script:not([src])").each((_, el) => {
    const text = $(el).html() ?? "";
    for (const match of text.matchAll(URL_IN_TEXT)) {
      inlineHits.push({ url: normalizeUrl(match[0]), rung: "inline_scripts" });
    }
  });
  if (inlineHits.length > 0) return dedupe(inlineHits);

  const externalSrcs = $("script[src]")
    .map((_, el) => $(el).attr("src"))
    .get()
    .map((src) => absolutize(src!, pageUrl))
    .filter((u): u is string => !!u)
    .slice(0, 5); // politeness cap: don't fetch every external script on a page

  const externalHits: CascadeHit[] = [];
  for (const src of externalSrcs) {
    const text = await politeFetch(src);
    if (!text) continue;
    for (const match of text.matchAll(URL_IN_TEXT)) {
      externalHits.push({ url: normalizeUrl(match[0]), rung: "external_scripts" });
    }
  }
  return dedupe(externalHits);
}

// Keeps the first occurrence of each URL (for its text/rung), but ANDs
// inNav across every occurrence — a link repeated once in page content and
// once in the site menu is not nav-only, regardless of which copy the
// document happens to place first.
function dedupe(hits: CascadeHit[]): CascadeHit[] {
  const byUrl = new Map<string, CascadeHit>();
  for (const h of hits) {
    const prior = byUrl.get(h.url);
    if (!prior) {
      byUrl.set(h.url, { ...h });
    } else if (prior.inNav && !h.inNav) {
      prior.inNav = false;
    }
  }
  return [...byUrl.values()];
}

// One hop to a hub page, if the seed page links to one whose anchor text
// matches. Shared by the "Connect"/"Get Involved" hub (social/newsletter
// channels), the "Boards & Committees" hub (committee names, see
// boardDetector.ts), and the generic "Government" hub — same one-hop-only
// politeness budget for all three.
//
// Most municipal nav is written root/path-relative ("/203/Boards-Committees"),
// not absolute — so the href is checked for an http(s) scheme only *after*
// resolving it against the page URL, never before. Checking the raw href
// first (as this used to) rejects nearly every real nav link.
function findLinkByText(pageUrl: string, html: string, pattern: RegExp): string | null {
  const $ = cheerio.load(html);
  let found: string | null = null;
  $("a[href]").each((_, el) => {
    if (found) return;
    const text = $(el).text();
    const href = $(el).attr("href");
    if (!href || !pattern.test(text)) return;
    const abs = absolutize(href, pageUrl);
    if (abs && /^https?:/i.test(abs)) found = abs;
  });
  return found;
}

const HUB_LINK_PATTERN = /connect|get.?involved|contact|social/i;
const BOARDS_HUB_PATTERN = /\bboards?\b|\bcommittees?\b|\bcommissions?\b/i;
// A CivicPlus-style top-level "Government" nav item is often the only path
// to the boards hub — its own page body re-lists its child pages (including
// "Boards & Committees"), even when the homepage's mega-menu markup for that
// flyout is populated client-side and invisible to a plain HTML fetch.
const GOV_HUB_PATTERN = /\bgovernment\b/i;

export function findHubLink(pageUrl: string, html: string): string | null {
  return findLinkByText(pageUrl, html, HUB_LINK_PATTERN);
}

export function findBoardsHubLink(pageUrl: string, html: string): string | null {
  return findLinkByText(pageUrl, html, BOARDS_HUB_PATTERN);
}

export function findGovHubLink(pageUrl: string, html: string): string | null {
  return findLinkByText(pageUrl, html, GOV_HUB_PATTERN);
}

// See isInNavLikeContainer's comment above for the "menu items repeated as
// page content" half of the CivicPlus nav problem — this is the other half:
// a CivicPlus flyout/accordion submenu's items are commonly rendered
// client-side from a JSON... in practice HTML... endpoint the page's own
// inline script points at (a global `urlToGetHiddenMenus` assignment),
// invisible to a plain HTML fetch + cheerio parse in the first place, no
// matter how the DOM is walked. One request — from the seed page only, since
// every page's own copy of this script returns the same site-wide menu
// tree, not just that page's own submenu — turns up boards/committees this
// crawler would otherwise never see at all.
const HIDDEN_SUBMENU_URL_RE = /urlToGetHiddenMenus\s*=\s*['"]([^'"]+)['"]/;

export async function fetchHiddenSubmenuPage(pageUrl: string, html: string): Promise<{ url: string; html: string } | null> {
  const match = HIDDEN_SUBMENU_URL_RE.exec(html);
  if (!match) return null;
  const url = absolutize(match[1], pageUrl);
  if (!url) return null;
  const menuHtml = await politeFetch(url);
  if (!menuHtml) return null;
  // Alongside each real child item, the response repeats its own parent
  // item's link a second time as an "Open the <em>X</em> page" anchor with
  // unusable anchor text ("open"/"page" aren't board-shaped — see
  // guessBoard, boardDetector.ts) — drop those rather than let dedupe()
  // pick one of the two copies of the same URL arbitrarily.
  const $ = cheerio.load(menuHtml);
  $("a.openThePageLink").remove();
  return { url, html: $.html() };
}
