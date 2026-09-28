// Matches anchor text or URL for a jurisdiction's budget page — the
// annual adopted/proposed budget document or its landing page. A standard
// disclosure for a jurisdiction that runs its own government (state,
// county, municipality, school district, fire district — see
// concept_profiles.has_active_government), promoted onto
// jurisdictions.budget_url (the "budget" glyph), not tied to any one board.
//
// Text-first, like agendaDetector.ts: a budget PDF's own URL slug rarely
// says "budget" cleanly (a dated filename, an opaque CMS document id), so
// anchor text is the more reliable signal. The URL check is a fallback for
// when the anchor text is generic ("Learn more", "View", a bare icon).
//
// Word lists/patterns live in budget_detector.yaml (plus detector_common.yaml
// for the reject words shared with boardDetector.ts) rather than inline here
// — see boardDetector.ts's loadConfig for the same pattern.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface BudgetDetectorConfig {
  text_pattern: string;
  reject?: string[];
  url_pattern: string;
}

interface CommonDetectorConfig {
  reject: string[];
  reject_url: string[];
}

interface CompiledConfig {
  textRe: RegExp;
  rejectRe: RegExp;
  urlRe: RegExp;
  rejectUrlRe: RegExp;
}

let config: CompiledConfig | null = null;

function loadConfig(): CompiledConfig {
  if (!config) {
    const raw = fs.readFileSync(path.resolve(__dirname, "budget_detector.yaml"), "utf-8");
    const parsed = yaml.load(raw) as BudgetDetectorConfig;
    const commonRaw = fs.readFileSync(path.resolve(__dirname, "detector_common.yaml"), "utf-8");
    const common = yaml.load(commonRaw) as CommonDetectorConfig;
    const rejectWords = [...common.reject, ...(parsed.reject ?? [])];
    const rejectAlternation = rejectWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*")).join("|");
    const rejectUrlAlternation = common.reject_url.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    config = {
      textRe: new RegExp(parsed.text_pattern, "i"),
      rejectRe: new RegExp(`\\b(?:${rejectAlternation})\\b`, "i"),
      urlRe: new RegExp(parsed.url_pattern, "i"),
      rejectUrlRe: new RegExp(`(?:${rejectUrlAlternation})`, "i"),
    };
  }
  return config;
}

export function looksLikeBudgetLink(url: string, linkText: string | null | undefined): boolean {
  const { textRe, rejectRe, urlRe, rejectUrlRe } = loadConfig();
  if (rejectUrlRe.test(url)) return false;
  const text = (linkText ?? "").trim();
  if (text) {
    if (rejectRe.test(text)) return false;
    if (textRe.test(text)) return true;
  }
  return urlRe.test(url);
}

// A budget landing page's own <title> is "Budget" plus at most one other
// word ("Budget Info", "FY26 Budget") — anything looser than that is too
// easily some other finance page that merely mentions the budget.
const BUDGET_TITLE_SHAPE_RE = /^(?:\S+\s+)?budget(?:\s+\S+)?$/i;

export type BudgetPageVerdict =
  | { kind: "pdf" } // the document itself, not an HTML permalink — see budget_only_pdf friction
  | { kind: "confirmed" } // title is budget-shaped, or at least names the current year
  | { kind: "rejected" }; // fetched, but neither budget-shaped nor naming the current year

// Verifies a link that already looks like a budget link (looksLikeBudgetLink)
// by inspecting the destination page itself, which anchor text/URL alone
// can't tell us: whether it's a PDF (the document, not a permalink page —
// flagged as friction rather than rejected, since a PDF budget is
// still better than none) or, for an HTML page, whether its <title> is
// budget-shaped or at least names the current year (a stale prior-year
// budget page left up after the fact is common enough to reject rather than
// promote to jurisdictions.budget_url).
export async function verifyBudgetPage(
  url: string,
  fetchPage: (url: string) => Promise<{ contentType: string; html: string | null }>,
): Promise<BudgetPageVerdict> {
  if (/\.pdf(?:[?#]|$)/i.test(url)) return { kind: "pdf" };

  const { contentType, html } = await fetchPage(url);
  if (contentType.includes("pdf")) return { kind: "pdf" };
  if (!html) return { kind: "rejected" }; // fetch failed or returned non-HTML, non-PDF content

  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  if (BUDGET_TITLE_SHAPE_RE.test(title)) return { kind: "confirmed" };
  if (title.includes(String(new Date().getFullYear()))) return { kind: "confirmed" };
  return { kind: "rejected" };
}
