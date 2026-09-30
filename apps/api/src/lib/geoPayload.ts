import type { Pool } from "pg";
import { frictionSeverity, type FrictionSeverity } from "@govdex/shared";
import { additionalSubdivisionSections, governanceForConcept, loadStateProfile, subdivisionsForConcept } from "@govdex/shared/src/conf/profile";
import { hasCachedPage } from "../../../../ingestion/spider/cache";

// Legislative/judicial numbered districts (AD/SD/CD/JD) are `within`-children
// of the state jurisdiction, same as counties, but get their own accordion
// section ("legislative districts") instead of showing up in "subdivisions".
const DISTRICT_CONCEPTS = [
  "state_house_district",
  "state_senate_district",
  "us_house_district",
  "judicial_region",
];

// Where a section's "authoritative source" link points: a plain web page
// (globe glyph) vs. a machine-queryable feed like a Legistar/ArcGIS/Socrata
// endpoint (brackets glyph). Heuristic only — the schema has no source_type
// column, so this is inferred from the URL shape at read time rather than
// stored.
export type SourceKind = "url" | "api";

export interface SourceLink {
  url: string;
  kind: SourceKind;
}

function classifySourceKind(url: string): SourceKind {
  let host = "";
  let path = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname.toLowerCase();
  } catch {
    return "url";
  }
  if (host.startsWith("api.") || host.startsWith("webapi.")) return "api";
  if (path.includes("/api/") || path.includes("/rest/services/") || path.includes("/odata/")) return "api";
  if (path.includes("mapserver") || path.includes("featureserver")) return "api";
  if (path.endsWith(".json") || path.endsWith(".geojson") || path.endsWith(".xml")) return "api";
  return "url";
}

function toSourceLink(url: string | null | undefined): SourceLink | null {
  return url ? { url, kind: classifySourceKind(url) } : null;
}

// Picks the first non-null URL among a batch of rows that were imported/
// verified together (a county's towns, a state's districts) — in practice
// one ingestion run shares one source, so the first hit represents the batch.
function firstSourceLink(urls: (string | null | undefined)[]): SourceLink | null {
  for (const url of urls) {
    const link = toSourceLink(url);
    if (link) return link;
  }
  return null;
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

// One adoption for the page-level Adoptions card: body is null when the
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

// Internal-only shape while we still need parentBodyId to split governing
// bodies from their committees, category to split off the chief executive,
// and committeesUrl to derive each section's source link; never returned
// from loadEntityPayload as-is (see toBodyInfo).
interface BodyInfoInternal extends BodyInfo {
  parentBodyId: string | null;
  committeesUrl: string | null;
  sourceUrl: string | null;
}

function toBodyInfo(b: BodyInfoInternal): BodyInfo {
  return {
    id: b.id,
    name: b.name,
    category: b.category,
    isGovernmental: b.isGovernmental,
    website: b.website,
    email: b.email,
    agendaUrl: b.agendaUrl,
    minutesUrl: b.minutesUrl,
    channels: b.channels,
    seats: b.seats,
    adoptions: b.adoptions,
  };
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
  // listed on the state page: `westchester/yonkers`). Null = use `slug`.
  relativePath: string | null;
  website: string | null;
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
  // Null hides the "Legislative districts & seats" section entirely — a
  // governance form with no standing committees (council-manager) elects
  // its body at-large too, so this shares governanceForConcept's
  // legislative_committees flag. See packages/shared/src/conf/ny.yaml.
  legislativeDistrictsLabel: string | null;
  committees: BodyInfo[];
  committeesSource: SourceLink | null;
  // Null hides the "Committees" section entirely — see
  // concepts.*.legislative_committees/committees_label and `governance` in
  // ny.yaml.
  committeesLabel: string | null;
  advisoryBoards: BodyInfo[];
  advisoryBoardsSource: SourceLink | null;
  subdivisions: EntityRef[];
  subdivisionsSource: SourceLink | null;
  // Null hides the "Subdivisions" section entirely (e.g. city/town/village,
  // which never have any) — see packages/shared/src/conf/ny.yaml's
  // concepts.*.subdivisions.
  subdivisionsLabel: string | null;
  // Extra sections (e.g. "Major Cities") pulled out of subdivisions by name
  // — see concepts.*.additional_subdivisions in ny.yaml. Empty for concepts
  // that don't configure any.
  additionalSubdivisions: SubdivisionSection[];
  linkedEntities: LinkedEntityRef[];
  candidateDocuments: CandidateDocumentInfo[];
  frictions: FrictionInfo[];
}

// Every body belonging to this jurisdiction, with its seats/current-electeds
// and channels attached. One shared fetch — governingBody/committees/
// advisoryBoards below are just filters over the same rows.
async function loadBodies(pool: Pool, jurisdictionId: string): Promise<BodyInfoInternal[]> {
  const { rows: bodies } = await pool.query<{
    id: string;
    name: string;
    category: string;
    is_governmental: boolean;
    website: string | null;
    email: string | null;
    agenda_url: string | null;
    minutes_url: string | null;
    parent_body_id: string | null;
    committees_url: string | null;
    source_url: string | null;
  }>(
    `select b.id, b.name, bc.code as category, b.is_governmental, b.website, b.email, b.agenda_url, b.minutes_url,
            b.parent_body_id, b.committees_url, b.source_url
       from bodies b
       join body_categories bc on bc.id = b.category_id
      where b.jurisdiction_id = $1
      order by b.name`,
    [jurisdictionId],
  );
  if (bodies.length === 0) return [];

  const bodyIds = bodies.map((b) => b.id);
  const { rows: seats } = await pool.query<{
    body_id: string;
    id: string;
    title: string;
    current_official_id: string | null;
    current_official_name: string | null;
  }>(
    `select s.body_id, s.id, s.title,
            r.official_id as current_official_id, o.full_name as current_official_name
       from seats s
       left join roles r on r.seat_id = s.id and r.end_date is null
       left join officials o on o.id = r.official_id
      where s.body_id = any($1)
      order by s.title`,
    [bodyIds],
  );
  const { rows: channels } = await pool.query<{ body_id: string } & ChannelInfo>(
    `select body_id, id, kind, status, platform, url from channels where body_id = any($1) order by kind`,
    [bodyIds],
  );
  const { rows: adoptions } = await pool.query<{
    body_id: string | null;
    id: string;
    product_name: string;
    function_code: string | null;
    instance_url: string | null;
  }>(
    `select a.body_id, a.id, p.name as product_name, pf.code as function_code, a.instance_url
       from adoptions a
       join products p on p.id = a.product_id
       left join product_functions pf on pf.id = p.function_id
      where a.jurisdiction_id = $1`,
    [jurisdictionId],
  );
  // A jurisdiction-level adoption (body_id null — the jurisdiction licenses
  // it) is shown on the executive and governing bodies, the top-level bodies
  // that actually run the jurisdiction's tooling; body-level adoptions stay
  // on their own body.
  const isTopLevelOperator = (b: (typeof bodies)[number]) =>
    !b.parent_body_id && (b.category === "chief_executive" || b.is_governmental);

  return bodies.map((b) => ({
    id: b.id,
    name: b.name,
    category: b.category,
    isGovernmental: b.is_governmental,
    website: b.website,
    email: b.email,
    agendaUrl: b.agenda_url,
    minutesUrl: b.minutes_url,
    parentBodyId: b.parent_body_id,
    committeesUrl: b.committees_url,
    sourceUrl: b.source_url,
    channels: channels.filter((c) => c.body_id === b.id).map(({ body_id: _body_id, ...c }) => c),
    seats: seats
      .filter((s) => s.body_id === b.id)
      .map((s) => ({ id: s.id, title: s.title, officialId: s.current_official_id, officialName: s.current_official_name })),
    adoptions: adoptions
      .filter((a) => (a.body_id === null ? isTopLevelOperator(b) : a.body_id === b.id))
      .map((a) => ({ id: a.id, productName: a.product_name, functionCode: a.function_code, instanceUrl: a.instance_url })),
  }));
}

// Attaches each jurisdiction's governing body (if any) as its contact/glyph
// info — website falls back to the jurisdiction's own `website` column when
// there is no governing body or the body has none set.
// Finds jurisdictions by exact name among `rootId`'s descendants (`within`
// chain, max 3 hops: state -> county -> town -> village). Names aren't unique
// (Rochester is both a city in Monroe and a town in Ulster), so per name the
// city wins, then the shallowest match. Rows come back in `names` order.
//
// Each row also carries `relative_path`, its URL path below the root
// (`westchester/yonkers`): a direct child is just its own slug; anything
// deeper is prefixed with its top-level ancestor's slug (the county), since
// villages are routed as peers of their town under the county, not nested
// under it (see the slug-scope note on withinChildren below).
//
// The lookup is stable between ingestion runs, so results are cached in
// memory per root+names for NAMED_DESCENDANTS_TTL_MS.
type NamedDescendantRow = {
  jurisdiction_id: string;
  name: string;
  concept: string;
  local_name: string | null;
  slug: string | null;
  website: string | null;
  updated_at: Date;
  relation_source_url: string | null;
  relative_path: string | null;
};
const NAMED_DESCENDANTS_TTL_MS = 10 * 60 * 1000;
const namedDescendantsCache = new Map<string, { at: number; rows: NamedDescendantRow[] }>();

async function loadNamedDescendants(pool: Pool, rootId: string, names: string[]): Promise<NamedDescendantRow[]> {
  if (names.length === 0) return [];
  const cacheKey = `${rootId}|${names.join("|")}`;
  const hit = namedDescendantsCache.get(cacheKey);
  if (hit && Date.now() - hit.at < NAMED_DESCENDANTS_TTL_MS) return hit.rows;
  const { rows } = await pool.query<NamedDescendantRow>(
    `with recursive d(id, depth, source_url, top_slug) as (
       select r.from_id, 1, r.source_url, j.attributes->>'slug'
         from jurisdiction_relations r join jurisdictions j on j.id = r.from_id
        where r.to_id = $1 and r.relation = 'within'
       union
       select r.from_id, d.depth + 1, r.source_url, d.top_slug
         from jurisdiction_relations r join d on r.to_id = d.id
        where r.relation = 'within' and d.depth < 3
     )
     select distinct on (j.name) j.id as jurisdiction_id, j.name, tc.code as concept, cp.local_name,
            j.attributes->>'slug' as slug, j.website, j.updated_at, d.source_url as relation_source_url,
            case when j.attributes->>'slug' is null then null
                 when d.depth = 1 or d.top_slug is null then j.attributes->>'slug'
                 else d.top_slug || '/' || (j.attributes->>'slug') end as relative_path
       from d
       join jurisdictions j on j.id = d.id
       join type_concepts tc on tc.id = j.concept_id
       left join concept_profiles cp on cp.profile_id = j.profile_id and cp.concept_id = j.concept_id
      where j.name = any($2)
      order by j.name, (tc.code = 'city') desc, d.depth`,
    [rootId, names],
  );
  const sorted = rows.sort((x, y) => names.indexOf(x.name) - names.indexOf(y.name));
  namedDescendantsCache.set(cacheKey, { at: Date.now(), rows: sorted });
  return sorted;
}

async function attachEntityChannels(
  pool: Pool,
  rows: {
    jurisdiction_id: string;
    name: string;
    concept: string;
    local_name: string | null;
    slug: string | null;
    website: string | null;
    updated_at: Date;
    relative_path?: string | null;
  }[],
): Promise<EntityRef[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.jurisdiction_id);
  const { rows: govBodies } = await pool.query<{
    jurisdiction_id: string;
    id: string;
    website: string | null;
    email: string | null;
    updated_at: Date;
  }>(
    `select jurisdiction_id, id, website, email, updated_at
       from bodies
      where jurisdiction_id = any($1) and parent_body_id is null and is_governmental
      order by created_at`,
    [ids],
  );
  const bodyByJurisdiction = new Map<string, { id: string; website: string | null; email: string | null; updated_at: Date }>();
  // A jurisdiction can have more than one top-level governmental body (e.g. a
  // county's Executive alongside its Legislature) — the row's website/email
  // display still picks just the first (by created_at), but "last updated"
  // should reflect whichever of them was actually touched most recently.
  const maxBodyUpdatedAt = new Map<string, Date>();
  for (const b of govBodies) {
    if (!bodyByJurisdiction.has(b.jurisdiction_id)) bodyByJurisdiction.set(b.jurisdiction_id, b);
    const current = maxBodyUpdatedAt.get(b.jurisdiction_id);
    if (!current || b.updated_at > current) maxBodyUpdatedAt.set(b.jurisdiction_id, b.updated_at);
  }
  const bodyIds = Array.from(bodyByJurisdiction.values()).map((b) => b.id);
  const { rows: channels } =
    bodyIds.length === 0
      ? { rows: [] as ({ body_id: string } & ChannelInfo)[] }
      : await pool.query<{ body_id: string } & ChannelInfo>(
          `select body_id, id, kind, status, platform, url from channels where body_id = any($1) order by kind`,
          [bodyIds],
        );

  // Same open (new/confirmed) frictions this jurisdiction's own EntityPage
  // surfaces at jurisdiction.hasSevereFriction (see loadFriction below), but
  // batched across every row here so each child's ⚠ glyph in EntityList
  // reflects its own open findings rather than the parent's.
  const { rows: friction } = await pool.query<{ jurisdiction_id: string; pattern_type: string }>(
    `select jurisdiction_id, pattern_type from frictions
      where jurisdiction_id = any($1) and status in ('new', 'confirmed')`,
    [ids],
  );
  const severeFrictionIds = new Set(
    friction.filter((f) => frictionSeverity(f.pattern_type) === "severe").map((f) => f.jurisdiction_id),
  );

  return rows.map((r) => {
    const body = bodyByJurisdiction.get(r.jurisdiction_id);
    return {
      id: r.jurisdiction_id,
      name: r.name,
      concept: r.concept,
      localName: r.local_name,
      slug: r.slug,
      relativePath: r.relative_path ?? null,
      website: body?.website ?? r.website,
      email: body?.email ?? null,
      channels: body ? channels.filter((c) => c.body_id === body.id).map(({ body_id: _body_id, ...c }) => c) : [],
      editTarget: body ? { table: "bodies", id: body.id } : { table: "jurisdictions", id: r.jurisdiction_id },
      updatedAt: (() => {
        const maxBody = maxBodyUpdatedAt.get(r.jurisdiction_id);
        return (maxBody && maxBody > r.updated_at ? maxBody : r.updated_at).toISOString();
      })(),
      hasSevereFriction: severeFrictionIds.has(r.jurisdiction_id),
    };
  });
}

export async function findStateJurisdictionBySlug(pool: Pool, slug: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `select j.id
       from jurisdictions j
       join type_concepts tc on tc.id = j.concept_id
      where tc.code = 'state' and j.attributes->>'slug' = $1
      limit 1`,
    [slug],
  );
  return rows[0]?.id ?? null;
}

export async function findChildJurisdictionBySlug(pool: Pool, parentId: string, slug: string): Promise<string | null> {
  // Direct `within`-child first (covers every case except villages, which
  // are routed as peers of their town — see the "subdivisions" query above).
  const { rows } = await pool.query<{ id: string }>(
    `select r.from_id as id
       from jurisdiction_relations r
       join jurisdictions j on j.id = r.from_id
      where r.to_id = $1 and r.relation = 'within' and j.attributes->>'slug' = $2
      limit 1`,
    [parentId, slug],
  );
  if (rows[0]) return rows[0].id;

  const { rows: villageRows } = await pool.query<{ id: string }>(
    `select v.id
       from jurisdiction_relations r1
       join jurisdictions v on v.id = r1.from_id
       join type_concepts vtc on vtc.id = v.concept_id
       join jurisdiction_relations r2 on r2.from_id = r1.to_id and r2.relation = 'within'
      where r1.relation = 'within' and vtc.code = 'village' and r2.to_id = $1 and v.attributes->>'slug' = $2
      limit 1`,
    [parentId, slug],
  );
  return villageRows[0]?.id ?? null;
}

// Spider-discovered links for this jurisdiction, shown as a read-only
// "crawled documents" card — excludes 'rejected' (false positives) and
// 'duplicate' (already known some other way) so the card reflects live,
// unreviewed-or-promoted finds only. See candidate_links in schema.sql.
async function loadCandidateDocuments(pool: Pool, jurisdictionId: string): Promise<CandidateDocumentInfo[]> {
  const { rows } = await pool.query<{
    id: string;
    title: string | null;
    target_url: string;
    discovered_at: Date;
  }>(
    `select id, title, target_url, discovered_at
       from candidate_links
      where jurisdiction_id = $1 and status in ('new', 'promoted')
      order by discovered_at desc`,
    [jurisdictionId],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    targetUrl: r.target_url,
    discoveredAt: r.discovered_at.toISOString(),
    cached: hasCachedPage(r.target_url),
  }));
}

// Open findings about this jurisdiction's own web presence, shown to the
// public on EntityPage — excludes 'dismissed' (false positives) and
// 'resolved' (fixed; not a current problem) so the section reflects what's
// actually wrong right now. See frictions in schema.sql.
async function loadFriction(pool: Pool, jurisdictionId: string): Promise<FrictionInfo[]> {
  const { rows } = await pool.query<{
    id: string;
    pattern_type: string;
    status: string;
    page_url: string;
    summary: string;
    detail: string | null;
    detected_at: Date;
  }>(
    `select id, pattern_type, status, page_url, summary, detail, detected_at
       from frictions
      where jurisdiction_id = $1 and status in ('new', 'confirmed')
      order by detected_at desc`,
    [jurisdictionId],
  );
  return rows.map((r) => ({
    id: r.id,
    patternType: r.pattern_type,
    severity: frictionSeverity(r.pattern_type),
    status: r.status,
    pageUrl: r.page_url,
    summary: r.summary,
    detail: r.detail,
    detectedAt: r.detected_at.toISOString(),
  }));
}

async function loadAdoptions(pool: Pool, jurisdictionId: string): Promise<AdoptionDetail[]> {
  const { rows } = await pool.query<{
    id: string;
    product_name: string;
    vendor: string;
    function_code: string | null;
    instance_url: string | null;
    body_id: string | null;
    body_name: string | null;
  }>(
    `select a.id, p.name as product_name, p.vendor, pf.code as function_code, a.instance_url,
            a.body_id, b.name as body_name
       from adoptions a
       join products p on p.id = a.product_id
       left join product_functions pf on pf.id = p.function_id
       left join bodies b on b.id = a.body_id
      where a.jurisdiction_id = $1
      order by (a.body_id is not null), p.name`,
    [jurisdictionId],
  );
  return rows.map((r) => ({
    id: r.id,
    productName: r.product_name,
    vendor: r.vendor,
    functionCode: r.function_code,
    instanceUrl: r.instance_url,
    bodyId: r.body_id,
    bodyName: r.body_name,
  }));
}

export async function loadEntityPayload(pool: Pool, jurisdictionId: string): Promise<GeoPayload | null> {
  const { rows: jurRows } = await pool.query<{
    id: string;
    name: string;
    website: string | null;
    policy_url: string | null;
    budget_url: string | null;
    calendar_url: string | null;
    legislative_districts_url: string | null;
    verification: string;
    origin: string;
    concept: string;
    local_name: string | null;
    local_abbrev: string | null;
    slug: string | null;
    updated_at: Date;
    has_active_government: boolean | null;
    profile_code: string;
  }>(
    `select j.id, j.name, j.website, j.policy_url, j.budget_url, j.calendar_url, j.legislative_districts_url, j.verification, j.origin,
            tc.code as concept, cp.local_name, cp.local_abbrev,
            j.attributes->>'slug' as slug, j.updated_at, cp.has_active_government, p.code as profile_code
       from jurisdictions j
       join type_concepts tc on tc.id = j.concept_id
       join profiles p on p.id = j.profile_id
       left join concept_profiles cp on cp.profile_id = j.profile_id and cp.concept_id = j.concept_id
      where j.id = $1`,
    [jurisdictionId],
  );
  const jurisdiction = jurRows[0];
  if (!jurisdiction) return null;

  // "Last updated" should reflect its top-level governmental bodies too (a
  // county's Executive and/or Legislature) — their website/email/channels
  // are what's actually shown and edited most often (see attachEntityChannels
  // below), while the jurisdictions row itself only changes when its own
  // website/policy_url/budget_url/name are edited.
  const { rows: govBodyMaxRows } = await pool.query<{ max_updated_at: Date | null }>(
    `select max(updated_at) as max_updated_at from bodies
      where jurisdiction_id = $1 and parent_body_id is null and is_governmental`,
    [jurisdictionId],
  );
  const govBodyMaxUpdatedAt = govBodyMaxRows[0]?.max_updated_at ?? null;
  const jurisdictionUpdatedAt =
    govBodyMaxUpdatedAt && govBodyMaxUpdatedAt > jurisdiction.updated_at ? govBodyMaxUpdatedAt : jurisdiction.updated_at;

  const allBodies = await loadBodies(pool, jurisdictionId);
  // The chief executive (Governor/County Executive/Mayor) is its own
  // top-level governmental body, split out from the legislative one it'd
  // otherwise be lumped into under "governing body" — see body_categories
  // seed and schema.sql's note on bodies.committees_url for why the split
  // matters (legislative committees vs. advisory boards hang off different
  // parents).
  const chiefExecutiveInternal = allBodies.filter((b) => b.category === "chief_executive" && !b.parentBodyId);
  const chiefExecutiveIds = new Set(chiefExecutiveInternal.map((b) => b.id));
  const governingBodyInternal = allBodies.filter((b) => b.isGovernmental && !b.parentBodyId && b.category !== "chief_executive");
  const governingBodyIds = new Set(governingBodyInternal.map((b) => b.id));
  const committeesInternal = allBodies.filter((b) => b.parentBodyId && governingBodyIds.has(b.parentBodyId));
  const advisoryBoardsInternal = allBodies.filter(
    (b) => b.category === "advisory" && (!b.parentBodyId || chiefExecutiveIds.has(b.parentBodyId)),
  );
  // Prefer a body's curated committees_url (a human-confirmed "boards &
  // committees" hub) over its own source_url (e.g. the Legistar API endpoint
  // a bulk import like ingestion/tools/legistar-bodies.ts wrote) — but fall
  // back to the latter so a section still cites its source when the items in
  // it came straight from an API import with no curated hub page set.
  const committeesSource = firstSourceLink([
    ...governingBodyInternal.map((b) => b.committeesUrl),
    ...committeesInternal.map((b) => b.sourceUrl),
  ]);
  const advisoryBoardsSource = firstSourceLink([
    ...chiefExecutiveInternal.map((b) => b.committeesUrl),
    ...advisoryBoardsInternal.map((b) => b.sourceUrl),
  ]);

  const { rows: withinChildren } = await pool.query<{
    jurisdiction_id: string;
    name: string;
    concept: string;
    local_name: string | null;
    slug: string | null;
    website: string | null;
    updated_at: Date;
    relation_source_url: string | null;
  }>(
    // Villages are legally `within` their town, but are routed as peers of
    // their town under the same county (Village of Ossining / Town of
    // Ossining share one URL depth) rather than nested a 4th segment deep —
    // see ingestion/t06-slugs/run.ts for the matching slug-scope logic. So a
    // town's own subdivisions are always empty (its only within-children are
    // villages, surfaced here one level up instead), and a county's
    // subdivisions include both its direct town/city children and its towns'
    // villages. relation_source_url carries each row's own provenance
    // (jurisdiction_relations.source_url) — for villages that's their own
    // within-town relation (r1), not the town's within-county one (r2).
    `select r.from_id as jurisdiction_id, j.name, tc.code as concept, cp.local_name,
            j.attributes->>'slug' as slug, j.website, j.updated_at, r.source_url as relation_source_url
       from jurisdiction_relations r
       join jurisdictions j on j.id = r.from_id
       join type_concepts tc on tc.id = j.concept_id
       left join concept_profiles cp on cp.profile_id = j.profile_id and cp.concept_id = j.concept_id
      where r.to_id = $1 and r.relation = 'within' and tc.code <> 'village'
     union all
     select v.id as jurisdiction_id, v.name, vtc.code as concept, vcp.local_name,
            v.attributes->>'slug' as slug, v.website, v.updated_at, r1.source_url as relation_source_url
       from jurisdiction_relations r1
       join jurisdictions v on v.id = r1.from_id
       join type_concepts vtc on vtc.id = v.concept_id
       left join concept_profiles vcp on vcp.profile_id = v.profile_id and vcp.concept_id = v.concept_id
       join jurisdiction_relations r2 on r2.from_id = r1.to_id and r2.relation = 'within'
      where r1.relation = 'within' and vtc.code = 'village' and r2.to_id = $1
      order by name`,
    [jurisdictionId],
  );
  const districtRows = withinChildren.filter((r) => DISTRICT_CONCEPTS.includes(r.concept));
  const allSubdivisionRows = withinChildren.filter((r) => !DISTRICT_CONCEPTS.includes(r.concept));
  // Prefer the jurisdiction's own curated seed page (legislative_districts_url
  // -- also the one a scribe edits via the section's source glyph, and the
  // one crawled for district/seat/committee finds) over a district row's own
  // relation source_url, same precedence as committeesSource above.
  const legislativeDistrictsSource = firstSourceLink([jurisdiction.legislative_districts_url, ...districtRows.map((r) => r.relation_source_url)]);

  // The locale pack comes from the jurisdiction's own `profiles` row
  // (US-MA -> ma.yaml), so every state gets its own governance and labels.
  const stateProfile = loadStateProfile(jurisdiction.profile_code.replace(/^US-/, "").toLowerCase());
  const subdivisionsConfig = subdivisionsForConcept(stateProfile, jurisdiction.concept);
  // Extra sections (e.g. "Major Cities") surface specific named jurisdictions
  // on this page even when they aren't direct within-children — Buffalo sits
  // within Erie County, not the state. They're looked up by name among this
  // jurisdiction's descendants (up to 3 `within` hops) and removed from the
  // main subdivisions list if they happen to be direct children (NYC).
  const additionalSections = additionalSubdivisionSections(stateProfile, jurisdiction.concept);
  const additionalNames = Array.from(new Set(additionalSections.flatMap((s) => s.names)));
  const additionalRows = await loadNamedDescendants(pool, jurisdictionId, additionalNames);
  const additionalIds = new Set(additionalRows.map((r) => r.jurisdiction_id));
  const subdivisionRows = allSubdivisionRows.filter((r) => !additionalIds.has(r.jurisdiction_id));
  const subdivisionsSource = firstSourceLink(subdivisionRows.map((r) => r.relation_source_url));

  // A concept whose governance form has no standing committees (a
  // council-manager town/village board) elects its members at-large too, not
  // by district — the same governance fact gates both the "Committees" and
  // "Legislative districts & seats" sections. A concept with no governance
  // config at all (state, school_district, ...) defaults to showing both,
  // same as before this was configurable.
  const governance = governanceForConcept(stateProfile, jurisdiction.concept, jurisdiction.name);
  const showLegislativeStructure = governance?.legislative_committees ?? true;
  const committeesLabel = showLegislativeStructure ? (governance?.committees_label ?? "Committees") : null;
  const legislativeDistrictsLabel = showLegislativeStructure ? "Legislative districts & seats" : null;

  const { rows: overlapRows } = await pool.query<{
    jurisdiction_id: string;
    name: string;
    concept: string;
    local_name: string | null;
    slug: string | null;
    website: string | null;
    updated_at: Date;
    relation: string;
    coverage: string;
  }>(
    `select case when r.from_id = $1 then r.to_id else r.from_id end as jurisdiction_id,
            j.name, tc.code as concept, cp.local_name, j.attributes->>'slug' as slug, j.website, j.updated_at,
            r.relation, r.coverage
       from jurisdiction_relations r
       join jurisdictions j on j.id = (case when r.from_id = $1 then r.to_id else r.from_id end)
       join type_concepts tc on tc.id = j.concept_id
       left join concept_profiles cp on cp.profile_id = j.profile_id and cp.concept_id = j.concept_id
      where (r.from_id = $1 or r.to_id = $1) and r.relation in ('overlaps', 'coextensive')
      order by j.name`,
    [jurisdictionId],
  );

  const [subdivisions, additionalSubdivisionEntities, districts, linkedBase, candidateDocuments, frictions, adoptions] = await Promise.all([
    attachEntityChannels(pool, subdivisionRows),
    Promise.all(additionalSections.map((s) => attachEntityChannels(pool, additionalRows.filter((r) => s.names.includes(r.name))))),
    attachEntityChannels(pool, districtRows),
    attachEntityChannels(pool, overlapRows),
    loadCandidateDocuments(pool, jurisdictionId),
    loadFriction(pool, jurisdictionId),
    loadAdoptions(pool, jurisdictionId),
  ]);
  const additionalSubdivisions: SubdivisionSection[] = additionalSections.map((s, i) => ({
    label: s.label,
    entities: additionalSubdivisionEntities[i],
    source: firstSourceLink(additionalRows.filter((r) => s.names.includes(r.name)).map((r) => r.relation_source_url)),
  }));
  const linkedEntities: LinkedEntityRef[] = linkedBase.map((entity, i) => ({
    ...entity,
    relation: overlapRows[i].relation,
    coverage: overlapRows[i].coverage,
  }));

  // A jurisdiction's own "legislative districts" seats are its governing
  // body's seats (e.g. County Legislature's District 1..N seats). The state
  // additionally lists AD/SD/CD/JD as separate district jurisdictions.
  const seats = governingBodyInternal.flatMap((b) => b.seats);

  return {
    jurisdiction: {
      id: jurisdiction.id,
      name: jurisdiction.name,
      concept: jurisdiction.concept,
      localName: jurisdiction.local_name,
      localAbbrev: jurisdiction.local_abbrev,
      slug: jurisdiction.slug,
      website: jurisdiction.website,
      policyUrl: jurisdiction.policy_url,
      budgetUrl: jurisdiction.budget_url,
      calendarUrl: jurisdiction.calendar_url,
      hasActiveGovernment: jurisdiction.has_active_government ?? false,
      hasSevereFriction: frictions.some((a) => a.severity === "severe"),
      verification: jurisdiction.verification,
      origin: jurisdiction.origin,
      updatedAt: jurisdictionUpdatedAt.toISOString(),
    },
    adoptions,
    chiefExecutive: chiefExecutiveInternal.map(toBodyInfo),
    governingBody: governingBodyInternal.map(toBodyInfo),
    legislativeDistricts: { seats, districts },
    legislativeDistrictsSource,
    legislativeDistrictsLabel,
    committees: committeesInternal.map(toBodyInfo),
    committeesSource,
    committeesLabel,
    advisoryBoards: advisoryBoardsInternal.map(toBodyInfo),
    advisoryBoardsSource,
    subdivisions,
    subdivisionsSource,
    subdivisionsLabel: subdivisionsConfig.show ? subdivisionsConfig.label : null,
    additionalSubdivisions,
    linkedEntities,
    candidateDocuments,
    frictions,
  };
}
