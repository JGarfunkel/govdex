import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { matchesAtBoundary } from "./urlMatch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Rule {
  match: string | string[];
  kind: string;
  platform: string;
}

interface DetectorConfig {
  rules: Rule[];
  affiliation_hints: { text_contains: string[] }[];
}

let config: DetectorConfig | null = null;

function loadConfig(): DetectorConfig {
  if (!config) {
    const raw = fs.readFileSync(path.resolve(__dirname, "channel_detector.yaml"), "utf-8");
    config = yaml.load(raw) as DetectorConfig;
  }
  return config;
}

export interface Classification {
  kind: string | null;
  platform: string | null;
}

// "Share this page" widget links point at facebook.com/twitter.com/etc, so
// the domain rules below would otherwise mistake them for the town's own
// social channel — they're a page's outbound share button, not an account.
const SHARE_WIDGET_RE =
  /(facebook\.com\/(sharer|share)|(twitter|x)\.com\/(home\?status=|intent\/tweet|share\b)|linkedin\.com\/(shareArticle|sharing\/share-offsite)|pinterest\.com\/pin\/create|reddit\.com\/submit|api\.whatsapp\.com\/send)/i;

export function classifyLink(url: string): Classification {
  if (SHARE_WIDGET_RE.test(url)) return { kind: null, platform: null };
  const { rules } = loadConfig();
  const lower = url.toLowerCase();
  for (const rule of rules) {
    const patterns = Array.isArray(rule.match) ? rule.match : [rule.match];
    if (patterns.some((p) => matchesAtBoundary(lower, p))) {
      return { kind: rule.kind, platform: rule.platform };
    }
  }
  return { kind: null, platform: null };
}

// Platforms whose URL path carries a human-readable account handle worth
// checking against the jurisdiction's own name — invite-link platforms
// (discord/slack) and newsletter slugs don't have this "profile name" shape,
// so they're left unchecked.
const PROFILE_NAME_PLATFORMS = new Set(["facebook_page", "facebook_group", "twitter", "instagram", "youtube"]);

// Municipal type words that legitimately appear in a town's own handle
// alongside its name (e.g. "TownOfBedfordNY", "VillageOfScarsdale").
const MUNICIPAL_TYPE_TOKENS = new Set(["city", "town", "village", "township", "county", "borough", "hamlet"]);
const CONNECTOR_TOKENS = new Set(["of", "the"]);

// A separate department's own account (fire, police) — never the
// municipality's general channel — regardless of what else the handle says.
const REJECT_HANDLE_SUBSTRINGS = ["firedept", "police"];

// Path segments that name a platform feature, not the account handle itself
// (facebook.com/groups/NAME, youtube.com/channel/ID, ...).
const NON_HANDLE_SEGMENTS = new Set(["groups", "channel", "c", "user", "pages"]);

function splitTokens(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // split camelCase, when present
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

// Handles are often concatenated with no separators at all, in either casing
// ("TownOfBedford", "townofbedford") — camelCase-splitting alone misses the
// all-lowercase case (a lowercase "of" glued to the word before it leaves no
// case boundary to split on). Instead of guessing at word breaks, check
// whether the handle can be built entirely out of the allowed vocabulary by
// concatenation — a classic word-break/segmentation check.
function canSegmentFromVocab(s: string, vocab: Set<string>): boolean {
  const n = s.length;
  if (n === 0) return false;
  const reachable = new Array<boolean>(n + 1).fill(false);
  reachable[0] = true;
  for (let end = 1; end <= n; end++) {
    for (let start = end - 1; start >= 0; start--) {
      if (reachable[start] && vocab.has(s.slice(start, end))) {
        reachable[end] = true;
        break;
      }
    }
  }
  return reachable[n];
}

function extractHandle(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    const clean = segments[i].replace(/^@/, "");
    if (!clean) continue;
    // youtube.com/channel/UC... — an opaque platform-assigned ID, not a
    // human-chosen name, so there's nothing to check the next segment for.
    if (clean.toLowerCase() === "channel") return null;
    if (NON_HANDLE_SEGMENTS.has(clean.toLowerCase())) continue;
    return clean;
  }
  return null;
}

// A social link is only worth proposing as *this* jurisdiction's own channel
// when its account handle is built from the jurisdiction's own name (plus a
// city/town/village-type word and "of"/"the") — otherwise it's very likely
// someone else's account the page happens to link out to (a mayor's personal
// page, a neighboring town, an unrelated group). Always rejects a separate
// department's own account (fire, police), even if the handle also names the
// jurisdiction.
export function isMunicipalSocialProfile(
  url: string,
  platform: string | null,
  jurisdictionName: string | null,
): boolean {
  if (!platform || !PROFILE_NAME_PLATFORMS.has(platform)) return true;
  const handle = extractHandle(url);
  if (!handle) return true; // nothing to check — don't block on absent info
  const lowerHandle = handle.toLowerCase();
  if (REJECT_HANDLE_SUBSTRINGS.some((s) => lowerHandle.includes(s))) return false;
  if (!jurisdictionName) return true;

  const vocab = new Set([...splitTokens(jurisdictionName), ...MUNICIPAL_TYPE_TOKENS, ...CONNECTOR_TOKENS]);
  const cleanedHandle = lowerHandle.replace(/[^a-z0-9]/g, "");
  return canSegmentFromVocab(cleanedHandle, vocab);
}

// Stricter than isMunicipalSocialProfile: true only when the URL itself
// carries a handle built from the jurisdiction's name (e.g.
// "youtube.com/@VillageOfArdsley"), not merely "nothing to check" — an
// opaque "youtube.com/channel/UC..." ID passes isMunicipalSocialProfile (no
// handle to reject) but isn't *named* for the jurisdiction. Used by
// crawlSeed.ts to pick which of several youtube-shaped links to keep as the
// one candidate channel when a page links to more than one.
export function handleNamesJurisdiction(url: string, jurisdictionName: string | null): boolean {
  if (!jurisdictionName) return false;
  const handle = extractHandle(url);
  if (!handle) return false;
  const vocab = new Set([...splitTokens(jurisdictionName), ...MUNICIPAL_TYPE_TOKENS, ...CONNECTOR_TOKENS]);
  const cleanedHandle = handle.toLowerCase().replace(/[^a-z0-9]/g, "");
  return canSegmentFromVocab(cleanedHandle, vocab);
}

// The account name for a channel candidate's "platform: AccountName" title —
// same handle extractHandle() computes for jurisdiction-name checking, plus
// the newsletter platform's subdomain form. Invite-link platforms
// (discord/slack) and non-Substack mailing-list hosts (Mailchimp,
// Constant Contact, ...) have no human-readable name in the URL, so they
// come back null and the title falls back to the platform alone.
export function extractAccountName(url: string, platform: string | null): string | null {
  if (platform === "newsletter") return extractSubstackAccountName(url);
  if (!platform || !PROFILE_NAME_PLATFORMS.has(platform)) return null;
  return extractHandle(url);
}

function extractSubstackAccountName(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const suffix = ".substack.com";
  if (!host.endsWith(suffix)) return null;
  return host.slice(0, -suffix.length) || null;
}

// A link's anchor text looks like it names a related group, not a channel —
// candidate for guessed_body_name rather than a channel classification.
export function guessAffiliationName(linkText: string): string | null {
  const { affiliation_hints } = loadConfig();
  for (const hint of affiliation_hints) {
    if (hint.text_contains.some((needle) => linkText.includes(needle))) {
      return linkText.trim();
    }
  }
  return null;
}
