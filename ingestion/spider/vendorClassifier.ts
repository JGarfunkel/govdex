import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { matchesAtBoundary } from "./urlMatch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface VendorRule {
  match: string | string[];
  vendor: string;
  function: string;
}

interface VendorDetectorConfig {
  rules: VendorRule[];
  ignore_hosts: string[];
}

let config: VendorDetectorConfig | null = null;

function loadConfig(): VendorDetectorConfig {
  if (!config) {
    const raw = fs.readFileSync(path.resolve(__dirname, "vendor_detector.yaml"), "utf-8");
    config = yaml.load(raw) as VendorDetectorConfig;
  }
  return config;
}

export interface VendorMatch {
  vendor: string;
  function: string;
}

export function classifyVendor(url: string): VendorMatch | null {
  const { rules } = loadConfig();
  const lower = url.toLowerCase();
  for (const rule of rules) {
    const patterns = Array.isArray(rule.match) ? rule.match : [rule.match];
    if (patterns.some((p) => matchesAtBoundary(lower, p))) {
      return { vendor: rule.vendor, function: rule.function };
    }
  }
  return null;
}

// True for hosts that should never show up in the "unclassified external
// links" report — CDN/analytics infra plus the social/newsletter domains
// channel_detector.yaml already accounts for as channels, not vendors.
export function isIgnoredHost(url: string): boolean {
  const { ignore_hosts } = loadConfig();
  const lower = url.toLowerCase();
  return ignore_hosts.some((h) => matchesAtBoundary(lower, h));
}
