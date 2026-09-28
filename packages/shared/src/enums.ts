// TS mirrors of the enums defined in packages/db/schema.sql. That file is the
// source of truth — if you add/rename a Postgres enum value, update both.

export const VERIFICATION_STATUSES = [
  "unverified",
  "source_cited",
  "scribe_verified",
  "official_confirmed",
  "disputed",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const ORIGIN_KINDS = ["import", "manual"] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

export const EDIT_TIERS = ["scribe", "lead", "editor", "admin"] as const;
export type EditTier = (typeof EDIT_TIERS)[number];

export const RELATION_TYPES = ["within", "overlaps", "coextensive"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export const COVERAGE_KINDS = ["full", "partial"] as const;
export type CoverageKind = (typeof COVERAGE_KINDS)[number];

export const SELECTION_METHODS = ["elected", "appointed", "hired", "ex_officio"] as const;
export type SelectionMethod = (typeof SELECTION_METHODS)[number];

export const GLOBAL_ROLES = ["admin", "editor", "scribe", "official", "viewer"] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const ASSIGNMENT_SCOPES = ["lead", "contributor"] as const;
export type AssignmentScope = (typeof ASSIGNMENT_SCOPES)[number];

export const REVISION_STATUSES = ["proposed", "accepted", "rejected"] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const REVISION_OPS = ["insert", "update", "delete"] as const;
export type RevisionOp = (typeof REVISION_OPS)[number];

// B=broadcast (public, comments on), C=community (member-to-member)
export const CHANNEL_KINDS = ["broadcast", "community"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const CHANNEL_STATUSES = ["present", "absent", "unknown"] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

// Recurring bad practices found in an entity's own web presence — see
// frictions in packages/db/schema.sql.
export const FRICTION_TYPES = [
  "robots_txt_excludes_crawler",
  "robots_txt_discriminatory",
  "api_inadequate",
  "index_in_menu_not_page",
  "budget_only_pdf",
  "website_com_tld",
  "crawler_blocked",
  "crawler_blocked_secondary",
] as const;
export type FrictionType = (typeof FRICTION_TYPES)[number];

// Types a scribe can file directly — auto-detected types (robots_txt_*,
// crawler_blocked*) are only ever written by ingestion/spider/fetcher.ts; a
// manual report of one would just be duplicating what the spider already
// checks on every crawl.
export const MANUAL_FRICTION_TYPES = ["api_inadequate", "index_in_menu_not_page"] as const;
export type ManualFrictionType = (typeof MANUAL_FRICTION_TYPES)[number];

export const FRICTION_STATUSES = ["new", "confirmed", "resolved", "dismissed"] as const;
export type FrictionStatus = (typeof FRICTION_STATUSES)[number];

export const FRICTION_SEVERITIES = ["normal", "severe"] as const;
export type FrictionSeverity = (typeof FRICTION_SEVERITIES)[number];

// crawler_blocked means the jurisdiction's own prime seed page is bot-
// blocked — this jurisdiction's data can't be kept in sync by the spider at
// all (a bot-management layer intercepts it even though the site's own
// robots.txt permits the crawl) — severe enough to surface at the
// jurisdiction level rather than only inside its Friction list. See
// apps/api/src/lib/geoPayload.ts's hasSevereFriction.
// crawler_blocked_secondary is the same bot-management block, but on some
// other page found while crawling (a hub page, a recursed board sub-page, an
// affiliated vendor host, ...) rather than the seed page itself — the
// jurisdiction's core presence is still reachable, so this is a lesser
// finding, "normal" severity like everything else. Unrecognized pattern_type
// values (the DB column is free-form, see migration 0009) also default to
// "normal".
const SEVERE_FRICTION_TYPES: ReadonlySet<string> = new Set<FrictionType>(["crawler_blocked"]);

export function frictionSeverity(patternType: string): FrictionSeverity {
  return SEVERE_FRICTION_TYPES.has(patternType) ? "severe" : "normal";
}
