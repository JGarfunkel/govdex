import { classifyVendor } from "./vendorClassifier";

// GovTech SaaS platforms host one subdomain per client (e.g.
// "westchestercountynyexec.granicus.com") rather than a shared multi-tenant
// path — so a link there is almost always still *this* jurisdiction's own
// presence, not an unrelated site, once its hostname names the jurisdiction.
// Strip words that would otherwise mask that match (a link host rarely
// spells out "county"/"town of").
const JURISDICTION_STOPWORDS = /\b(county|city|town|village|township|of|the)\b/gi;

function normalize(name: string): string {
  return name.replace(JURISDICTION_STOPWORDS, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

// True when a cross-domain link is very likely still this jurisdiction's own
// site rather than an unrelated one worth ignoring (or treating as another
// jurisdiction's territory): it's on a known GovTech vendor domain (see
// vendor_detector.yaml) *and* the jurisdiction's own name shows up in the
// hostname. Used to let the spider follow a vendor-hosted hub (e.g. a
// Granicus "boards" listing) it would otherwise skip as off-site.
export function isAffiliatedVendorHost(url: string, jurisdictionName: string): boolean {
  if (!classifyVendor(url)) return false;
  const needle = normalize(jurisdictionName);
  if (!needle) return false;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return normalize(hostname).includes(needle);
}
