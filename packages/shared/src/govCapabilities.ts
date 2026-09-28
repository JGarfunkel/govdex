// The seven broad gov-tech functions a resident would recognize, each with
// known vendors. This is a *grouping* layer over the granular
// product_functions codes (packages/db/schema.sql, seeded in
// packages/db/seed/product_functions.sql, matched by
// ingestion/spider/vendor_detector.yaml against real adoptions) — not a
// replacement for that taxonomy. `functionCodes` rolls each category up onto
// the codes that already exist in the DB today; several plausible codes
// (community_engagement, budget_transparency, code_publishing, ...) are
// referenced by vendor_detector.yaml but not yet seeded there, so
// participation/transparency currently have nothing to roll up and will read
// as "not recorded" until a human seeds those codes and adoptions are
// entered against them.
//
// `color`/`glyph` are presentation-only, consumed by
// apps/web/components/CapabilityGlyphs.tsx on the jurisdiction/body page
// (apps/web/components/EntityPage.tsx) — deliberately left out of the
// subdivisions chart, which is a different, denser view.
//
// `appliesTo` says which kind of body plausibly performs this function: the
// chief executive (the jurisdiction's executive branch) can run all seven —
// it's the one delivering services, running back office systems, publishing
// transparency data, and filing disclosures. A legislative body or advisory
// committee only runs the public-process three: it has a web presence, takes
// input, and runs its own meetings, but doesn't deliver permits or file
// campaign-finance disclosures itself.

export type GovCapabilityScope = "executive" | "legislative";

export interface GovCapabilityProduct {
  name: string;
  description: string;
}

export interface GovCapability {
  id: string;
  label: string;
  description: string;
  color: string;
  glyph: string; // Tabler icon class, e.g. "ti-world" — see local/glyph-spec.md
  appliesTo: readonly GovCapabilityScope[];
  functionCodes: readonly string[]; // product_functions.code values that roll up into this category
  products: readonly GovCapabilityProduct[];
}

const ALL_SCOPES: readonly GovCapabilityScope[] = ["executive", "legislative"];
const EXECUTIVE_ONLY: readonly GovCapabilityScope[] = ["executive"];

export const GOV_CAPABILITIES: readonly GovCapability[] = [
  {
    id: "presence",
    label: "Web presence",
    description:
      "The body's front door on the web: content management, the public website, and directory pages. It is the connective substrate the other functions are delivered through. Assign a tool here when its job is to be the site itself, rather than a specific function the site exposes.",
    color: "#5a686e",
    glyph: "ti-world",
    appliesTo: ALL_SCOPES,
    functionCodes: ["website_cms", "notification"],
    products: [
      { name: "CivicPlus", description: "Municipal website CMS and content platform for local government." },
      { name: "Granicus govAccess (Vision)", description: "Government website design, hosting, and content management." },
      { name: "OpenCities", description: "Granicus CMS focused on accessibility and structured content." },
      { name: "Revize", description: "Website content management built for cities and counties." },
      { name: "ProudCity", description: "Hosted website platform for local government." },
    ],
  },
  {
    id: "participation",
    label: "Participation & input",
    description:
      "Tools whose job is to solicit or structure resident voice: surveys, comment intake, deliberation, and participatory budgeting. The Participatory Governance Framework sits under this category as its selection instrument.",
    color: "#7c3aed",
    glyph: "ti-messages",
    appliesTo: ALL_SCOPES,
    functionCodes: [],
    products: [
      { name: "Zencity", description: "Resident sentiment and community-input analytics platform." },
      { name: "PublicInput", description: "Public engagement and comment-management platform for government." },
      { name: "Polco", description: "Community survey and civic-engagement platform with benchmarking." },
      { name: "Granicus EngagementHQ", description: "Online engagement hub with forums, surveys, and mapping (formerly Bang the Table)." },
      { name: "Decidim", description: "Open-source participatory-democracy platform for proposals and deliberation." },
    ],
  },
  {
    id: "proceedings",
    label: "Legislative & meeting process",
    description:
      "Tools that run the public decision record: agendas, minutes, legislation tracking, and meeting video. Separate from participation and from back office because its defining job is the formal record of how a body decides. The most widely adopted and most scraper-detectable category.",
    color: "#2563eb",
    glyph: "ti-clipboard-list",
    appliesTo: ALL_SCOPES,
    functionCodes: ["agenda_minutes", "video_streaming"],
    products: [
      { name: "BoardDocs", description: "Agenda and meeting management for school boards and local government (Diligent)." },
      { name: "Granicus Legistar", description: "Legislative management for agendas, minutes, and legislation tracking." },
      { name: "PrimeGov", description: "Agenda, meeting, and workflow management platform." },
      { name: "CivicClerk", description: "Agenda and minutes management for local government (CivicPlus)." },
      { name: "Granicus (meeting media)", description: "Meeting video streaming, indexing, and public archive." },
    ],
  },
  {
    id: "services",
    label: "Service delivery & transactions",
    description:
      "Resident- and business-facing transactions: permits, licensing, payments, and non-emergency service requests. The e-government transactional layer.",
    color: "#059669",
    glyph: "ti-forms",
    appliesTo: EXECUTIVE_ONLY,
    functionCodes: ["permitting"],
    products: [
      { name: "Accela", description: "Permitting, licensing, and land-management platform." },
      { name: "OpenGov Permitting & Licensing", description: "Cloud permitting and licensing module (formerly ViewPoint Cloud)." },
      { name: "Tyler EnerGov", description: "Permitting, licensing, and citizen-service platform." },
      { name: "SeeClickFix", description: "311 non-emergency service-request reporting (CivicPlus)." },
      { name: "PayIt", description: "Government payment processing across agencies and services." },
    ],
  },
  {
    id: "operations",
    label: "Operations & back office",
    description:
      "Internal running of the body, with little or no public surface: finance and ERP, HR, GIS, asset and work management, and internal risk, compliance, and audit. Tag audience as internal. Compliance and GRC tools such as KnowRisk live here unless they produce outward-facing disclosure.",
    color: "#6b7280",
    glyph: "ti-settings",
    appliesTo: EXECUTIVE_ONLY,
    functionCodes: ["gis", "crm"],
    products: [
      { name: "Tyler Munis", description: "Municipal ERP for finance, payroll, and HR." },
      { name: "Workday", description: "Enterprise HR and finance, used by larger governments." },
      { name: "Esri ArcGIS", description: "GIS platform for mapping and spatial operations." },
      { name: "Cartegraph", description: "Asset and work-order management (OpenGov)." },
      { name: "KnowRisk", description: "Integrated risk, compliance, and internal-audit GRC (Corprofit)." },
    ],
  },
  {
    id: "transparency",
    label: "Transparency & open data",
    description:
      "Tools whose job is to expose the body's data and records to the public: open-data portals, financial and budget transparency, dashboards, and public-records (FOIL) request handling. This is the Ordinizer's subject matter.",
    color: "#d97706",
    glyph: "ti-chart-bar",
    appliesTo: EXECUTIVE_ONLY,
    functionCodes: [],
    products: [
      { name: "Tyler Data & Insights", description: "Open-data portal platform (formerly Socrata)." },
      { name: "OpenGov Budgeting & Transparency", description: "Budget building and public financial-transparency portal." },
      { name: "ClearGov", description: "Budget and financial-transparency reporting for local government." },
      { name: "NextRequest", description: "Public-records (FOIL/FOIA) request management portal (CivicPlus)." },
      { name: "CKAN", description: "Open-source open-data portal and catalog." },
    ],
  },
  {
    id: "oversight",
    label: "Accountability & oversight",
    description:
      "Public-facing disclosure and watchdog functions, usually mandated: campaign finance, ethics and financial disclosure, lobbying registration, published audits, and procurement transparency. The sparsest category in practice, which is itself a finding worth recording as verified absence.",
    color: "#dc2626",
    glyph: "ti-shield-check",
    appliesTo: EXECUTIVE_ONLY,
    functionCodes: ["procurement"],
    products: [
      { name: "NetFile", description: "Campaign-finance and disclosure e-filing and management." },
      { name: "Tyler Campaign Finance & Disclosure", description: "Campaign-finance, lobbying, and disclosure filing systems." },
      { name: "Bonfire", description: "Public procurement and sourcing transparency (Euna Solutions)." },
      { name: "OpenGov Procurement", description: "Procurement and solicitation management (formerly ProcureNow)." },
    ],
  },
];

// body_categories.code (packages/db/seed/body_categories.sql) -> which scope
// of gov capability the body plausibly runs. party_committee/affinity/
// interest_group are non-governmental groups that don't run any of these
// functions themselves, so they map to no scope.
const BODY_CATEGORY_SCOPES: Readonly<Record<string, GovCapabilityScope>> = {
  chief_executive: "executive",
  official_elected: "legislative",
  official_appointed: "legislative",
  advisory: "legislative",
};

export function scopeForBodyCategory(category: string): GovCapabilityScope | null {
  return BODY_CATEGORY_SCOPES[category] ?? null;
}

export function capabilitiesForScope(scope: GovCapabilityScope): readonly GovCapability[] {
  return GOV_CAPABILITIES.filter((c) => c.appliesTo.includes(scope));
}

const CAPABILITY_BY_FUNCTION_CODE: ReadonlyMap<string, GovCapability> = new Map(
  GOV_CAPABILITIES.flatMap((c) => c.functionCodes.map((code) => [code, c] as const)),
);

// Rolls a product_functions.code (as recorded on a real `adoptions` row) up
// onto its gov-capability category. Returns null for a code with no mapping
// yet (see the module doc comment) — that adoption still exists, it's just
// not reflected in the glyph row until a human maps its code.
export function capabilityForFunctionCode(code: string | null | undefined): GovCapability | null {
  if (!code) return null;
  return CAPABILITY_BY_FUNCTION_CODE.get(code) ?? null;
}
