// Mirrors apps/api/src/lib/geoPayload.ts's response shape. Duplicated rather
// than imported (apps/web and apps/api are separate packages, same as the
// existing per-page interfaces in jurisdictions/[id]/page.tsx etc.).

// Whether a section's "authoritative source" link points at a plain web page
// (globe glyph) or a machine-queryable feed like a Legistar/ArcGIS/Socrata
// endpoint (brackets glyph) — see apps/api/src/lib/geoPayload.ts's
// classifySourceKind for how the API infers this from the URL shape.
export type SourceKind = "url" | "api";

export interface SourceLink {
  url: string;
  kind: SourceKind;
}

export interface ChannelInfo {
  id: string;
  kind: string;
  status: string;
  platform: string | null;
  url: string | null;
}

export interface SeatInfo {
  id: string;
  title: string;
  officialId: string | null;
  officialName: string | null;
}

export interface AdoptionInfo {
  id: string;
  productName: string;
  functionCode: string | null;
  instanceUrl: string | null;
}

// One adoption for the page-level Adoptions card: bodyName is null when the
// jurisdiction itself is the adopter (the common case).
export interface AdoptionDetail extends AdoptionInfo {
  vendor: string;
  bodyId: string | null;
  bodyName: string | null;
}

export interface BodyInfo {
  id: string;
  name: string;
  category: string;
  isGovernmental: boolean;
  website: string | null;
  email: string | null;
  agendaUrl: string | null;
  minutesUrl: string | null;
  channels: ChannelInfo[];
  seats: SeatInfo[];
  adoptions: AdoptionInfo[];
}

// Where a scribe edit to this entity's website/email/channel glyphs should
// write: its governing body when one exists (channels live there), else the
// jurisdiction row itself (website only — jurisdictions has no email/channels).
export interface EditTarget {
  table: "bodies" | "jurisdictions";
  id: string;
}

export interface EntityRef {
  id: string;
  name: string;
  concept: string;
  localName: string | null;
  slug: string | null;
  // Path below the page's basePath when it isn't just `slug` (a major city
  // on the state page: `westchester/yonkers`). Null = use `slug`.
  relativePath?: string | null;
  website: string | null;
  budgetUrl?: string | null;
  email: string | null;
  channels: ChannelInfo[];
  editTarget: EditTarget;
  updatedAt: string;
  hasSevereFriction: boolean;
}

export interface LinkedEntityRef extends EntityRef {
  relation: string;
  coverage: string;
}

export interface SubdivisionSection {
  label: string;
  entities: EntityRef[];
  source: SourceLink | null;
}

export interface CandidateDocumentInfo {
  id: string;
  title: string | null;
  targetUrl: string;
  discoveredAt: string;
  cached: boolean;
}

// Mirrors FrictionSeverity in packages/shared/src/enums.ts.
export type FrictionSeverity = "normal" | "severe";

export interface FrictionInfo {
  id: string;
  patternType: string;
  severity: FrictionSeverity;
  status: string;
  pageUrl: string;
  summary: string;
  detail: string | null;
  detectedAt: string;
}

export interface GeoPayload {
  jurisdiction: {
    id: string;
    name: string;
    concept: string;
    localName: string | null;
    localAbbrev: string | null;
    slug: string | null;
    website: string | null;
    policyUrl: string | null;
    budgetUrl: string | null;
    calendarUrl: string | null;
    hasActiveGovernment: boolean;
    hasSevereFriction: boolean;
    verification: string;
    origin: string;
    updatedAt: string;
  };
  adoptions: AdoptionDetail[];
  chiefExecutive: BodyInfo[];
  governingBody: BodyInfo[];
  legislativeDistricts: { seats: SeatInfo[]; districts: EntityRef[] };
  legislativeDistrictsSource: SourceLink | null;
  // Null hides the "Legislative districts & seats" section entirely.
  legislativeDistrictsLabel: string | null;
  committees: BodyInfo[];
  committeesSource: SourceLink | null;
  // Null hides the "Committees" section entirely.
  committeesLabel: string | null;
  advisoryBoards: BodyInfo[];
  advisoryBoardsSource: SourceLink | null;
  subdivisions: EntityRef[];
  subdivisionsSource: SourceLink | null;
  // Null hides the "Subdivisions" section entirely (e.g. city/town/village,
  // which never have any).
  subdivisionsLabel: string | null;
  // Extra sections (e.g. "Major Cities") pulled out of subdivisions by name.
  additionalSubdivisions: SubdivisionSection[];
  linkedEntities: LinkedEntityRef[];
  candidateDocuments: CandidateDocumentInfo[];
  frictions: FrictionInfo[];
}
