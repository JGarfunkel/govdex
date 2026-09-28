// Recognizes a soft-404: a page that answers HTTP 200 but whose own
// <title> says the content is gone (a CMS "page not found" template, a
// parked/expired domain, a suspended host) — invisible to an HTTP-status-only
// check like the one pruneDeadCandidates.ts otherwise does. Pattern lives in
// dead_page_detector.yaml rather than inline here, same pattern as
// budgetDetector.ts's loadConfig.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface DeadPageDetectorConfig {
  title_pattern: string;
}

let titleRe: RegExp | null = null;

function loadConfig(): RegExp {
  if (!titleRe) {
    const raw = fs.readFileSync(path.resolve(__dirname, "dead_page_detector.yaml"), "utf-8");
    const parsed = yaml.load(raw) as DeadPageDetectorConfig;
    titleRe = new RegExp(parsed.title_pattern, "i");
  }
  return titleRe;
}

export function extractTitle(html: string): string {
  return (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "").trim();
}

export function looksLikeDeadPageTitle(title: string): boolean {
  if (!title) return false;
  return loadConfig().test(title);
}
