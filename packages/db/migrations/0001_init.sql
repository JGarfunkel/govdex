-- ============================================================================
-- Migration 0001_init — identical to ../schema.sql, the canonical source of
-- truth, collapsing what were formerly migrations 0001-0018 (candidate_links
-- title/index type, frictions, jurisdiction resource URLs, body agenda/
-- minutes URLs, the channel_kind announcement drop, body uniqueness, body
-- topics/types) now that the schema has stabilized. Keep both in sync when
-- the schema changes; don't hand-edit just one. Applied via
-- `npm run govdex:db:migrate` (see src/migrate.ts), which tracks applied
-- files in a schema_migrations table. Later schema changes land as new
-- numbered files (0002_*.sql, ...) here, never as edits to this file.
-- ============================================================================
-- ============================================================================
-- NY Civic Transparency Database — schema v0.1
-- Postgres 13+ (uses gen_random_uuid). PostGIS optional; see final section.
--
-- Design notes:
--   * Jurisdiction = bounded area of authority (geographic only).
--   * Body = a group that governs/represents/organizes for a jurisdiction.
--   * Seats persist; roles (occupancies) are the person-in-seat over dates.
--   * Every substantive row carries provenance + a verification status.
--   * "Verified absence" is a value, never a blank. Blank = not yet checked.
--   * Relation graph does double duty: geographic model + scribe edit scope.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Enums (small, stable sets only). Growing sets use lookup tables instead.
-- ---------------------------------------------------------------------------
create type verification_status as enum
  ('unverified','source_cited','scribe_verified','official_confirmed','disputed');

create type origin_kind      as enum ('import','manual');
create type contract_term    as enum ('annual','multi_year');
create type edit_tier        as enum ('scribe','lead','editor','admin');  -- authority ladder
create type relation_type    as enum ('within','overlaps','coextensive');
create type coverage_kind    as enum ('full','partial');
create type selection_method as enum ('elected','appointed','hired','ex_officio');
create type global_role      as enum ('admin','editor','scribe','official','viewer');
create type assignment_scope as enum ('lead','contributor');
create type revision_status  as enum ('proposed','accepted','rejected');
create type revision_op      as enum ('insert','update','delete');

-- Channel kind: B=broadcast (public, comments), C=community (member-to-member).
-- Stored as words so the DB is self-documenting; surface the B/C shorthand in
-- the UI.
create type channel_kind   as enum ('broadcast','community');
create type channel_status as enum ('present','absent','unknown');

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------------------
-- Lookup tables (seeded by admins; extended as scribes surface new types)
--
-- Jurisdiction typing is split so state-specific vocabulary stays out of the
-- schema:
--   type_concepts    - portable, cross-state kinds (educational_region, county…)
--   profiles         - a governance context, a US state to begin with
--   concept_profiles - how one profile names and configures each concept
-- New York's names (BOCES, Section/NYSPHSAA) and facts (active county government)
-- live in a US-NY locale pack. A second state ships its own pack and reuses the
-- same concepts.
-- ---------------------------------------------------------------------------
create table type_concepts (
  id          smallint generated always as identity primary key,
  code        text not null unique,      -- portable: 'county','educational_region'…
  level       text not null
    check (level in ('state','regional','county','municipal','sub_municipal','special_district')),
  description text
);

create table profiles (
  id     smallint generated always as identity primary key,
  code   text not null unique,           -- 'US-NY'
  name   text not null,                  -- 'New York'
  config jsonb not null default '{}'      -- state-wide switches and counts
);

create table concept_profiles (
  id                    smallint generated always as identity primary key,
  profile_id            smallint not null references profiles(id) on delete cascade,
  concept_id            smallint not null references type_concepts(id) on delete cascade,
  local_name            text not null,   -- 'BOCES','Section','Town'
  local_abbrev          text,            -- 'AD','SD','CD'
  parent_org_name       text,            -- 'NYSPHSAA' for the scholastic athletic region
  has_active_government boolean not null default false,  -- does t04 derive a governing body?
  default_body_name     text,            -- 'Town Board','Board of Education'
  config                jsonb not null default '{}',
  unique (profile_id, concept_id)
);

create table body_categories (
  id    smallint generated always as identity primary key,
  code  text not null unique,            -- 'official_elected','official_appointed',
  label text not null                    -- 'advisory','party_committee','affinity','interest_group'
);

-- A body's specific function (Town Planning Board vs. Town Board itself),
-- distinct from the broad body_categories code above. Nullable: most bodies
-- (affinity groups, party committees, one-off boards) have no type-level
-- mandate defaults and stay untyped. Backs body_type_topic below.
create table body_types (
  id          smallint generated always as identity primary key,
  code        text not null unique,        -- 'town_planning_board','town_zba','conservation_board'…
  label       text not null,
  description text
);

-- Proposed/verified/rejected. A lookup table rather than a native enum (the
-- enums section above reserves those for closed sets the app interprets
-- internally) because this vocabulary is served to the frontend as data the
-- same way type_concepts/body_categories are, and because a future
-- people/officials extraction pass should reuse this same table rather than
-- growing its own status enum. Created here (ahead of bodies) because
-- bodies.body_type_status below references it.
create table assertion_status (
  id    text primary key,  -- proposed | verified | rejected
  label text not null
);

create table product_functions (
  id    smallint generated always as identity primary key,
  code  text not null unique,            -- 'agenda_minutes','website_cms','permitting',
  label text not null                    -- 'gis','notification','video_streaming','crm'…
);

-- ---------------------------------------------------------------------------
-- Users (base identity; scribe and official are capabilities on top)
-- ---------------------------------------------------------------------------
create table users (
  id           uuid primary key default gen_random_uuid(),
  firebase_uid text unique,             -- Firebase Auth subject; null for import-created stubs
  email        text not null unique,
  display_name text,
  global_role  global_role not null default 'viewer',
  official_id  uuid,                     -- FK added after officials exists
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_users_updated before update on users
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Officials (person-level only; no role facts here)
-- ---------------------------------------------------------------------------
create table officials (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  photo_url  text,
  short_bio  text,
  -- provenance
  source_url   text,
  verification verification_status not null default 'unverified',
  verified_by  uuid references users(id),
  verified_at  timestamptz,
  origin       origin_kind not null default 'manual',
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now()
);

alter table users
  add constraint fk_users_official
  foreign key (official_id) references officials(id);

-- ---------------------------------------------------------------------------
-- Jurisdictions (bounded areas of authority)
-- ---------------------------------------------------------------------------
create table jurisdictions (
  id         uuid primary key default gen_random_uuid(),
  ocd_id     text unique,               -- Open Civic Data division id, preferred
  name       text not null,
  profile_id smallint not null references profiles(id),
  concept_id smallint not null references type_concepts(id),
  website    text,
  -- Authoritative page publishing this jurisdiction's code/local laws (a
  -- Municode/eCode360 instance, most commonly) — see bodies.committees_url
  -- below for the analogous pattern. Promoted from a candidate_links vendor
  -- hit with guessed_function='code_publishing' once a human confirms it.
  policy_url text,
  -- Authoritative page publishing this jurisdiction's budget (adopted/
  -- proposed budget documents) — the "budget" glyph on EntityPage, same
  -- pattern as policy_url above. Only meaningful for a jurisdiction whose
  -- concept_profiles row has has_active_government=true — the budget
  -- belongs to a jurisdiction that runs its own government, not to a
  -- district that just elects a member to a larger body.
  budget_url text,
  -- General open-data catalog endpoint for this jurisdiction -- whichever of
  -- Socrata/Tyler, ArcGIS Online, or data.gov's CKAN catalog scored highest
  -- identity match, found via the off-domain platform registries (never the
  -- jurisdiction's own site) probed by ingestion/tools/probe-civic-apis.ts.
  -- Jurisdiction-level, not tied to any one body.
  open_data_api_url text,
  -- Legistar/Granicus API base for this jurisdiction, e.g.
  -- https://webapi.legistar.com/v1/<slug>. Its /Bodies endpoint lists
  -- boards/committees and its /Persons + /OfficeRecords endpoints list
  -- current seat holders -- source for the "boards" and "seats" listings,
  -- distinct from open_data_api_url since Legistar's schema has no general
  -- dataset-catalog analogue. Also from probe-civic-apis.ts.
  legistar_api_url text,
  -- Jurisdiction-wide meeting/agenda calendar link (e.g. a Granicus/Legistar
  -- calendar or a general "Meetings" page not tied to one body) -- the
  -- "calendar" glyph, mirroring policy_url/budget_url above. Promoted from a
  -- candidate_links row with link_type='calendar' once a human confirms it.
  calendar_url text,
  -- Seed page for this jurisdiction's legislative districts (a county's
  -- "find your legislator"/district-map page, or a state chamber's district
  -- roster) -- mirrors policy_url/budget_url/calendar_url above. Recorded
  -- before any district/seat/committee rows exist so it can be queued as a
  -- crawl_jobs seed (see propose.ts) for the spider to find them. Preferred
  -- over a district row's own jurisdiction_relations.source_url by
  -- geoPayload.ts's legislativeDistrictsSource once both exist.
  legislative_districts_url text,
  attributes jsonb not null default '{}',
  -- geometry added in the PostGIS section below (nullable, v1 optional)
  -- provenance
  source_url   text,
  verification verification_status not null default 'unverified',
  verified_by  uuid references users(id),
  verified_at  timestamptz,
  origin       origin_kind not null default 'manual',
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now()
);

-- External identifiers: one row per (scheme,value). This is how imports match
-- and dedupe against 55k6-h6qq, Census GEOIDs, SEDREF/BEDS, SWIS, GNIS, etc.
create table jurisdiction_identifiers (
  id              uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions(id) on delete cascade,
  scheme          text not null,        -- 'ocd','swis','gnis','census_geoid','fips','beds'…
  value           text not null,
  source_url      text,
  verification    verification_status not null default 'unverified',
  verified_by     uuid references users(id),
  verified_at     timestamptz,
  origin          origin_kind not null default 'manual',
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_by      uuid references users(id),
  updated_at      timestamptz not null default now(),
  unique (scheme, value)
);

-- Relations. 'within' is directional (from is inside to). 'overlaps' and
-- 'coextensive' are symmetric; store once, query both directions.
create table jurisdiction_relations (
  id       uuid primary key default gen_random_uuid(),
  from_id  uuid not null references jurisdictions(id) on delete cascade,
  to_id    uuid not null references jurisdictions(id) on delete cascade,
  relation relation_type not null,
  coverage coverage_kind not null default 'full',  -- 'partial' = split municipality
  source_url   text,
  verification verification_status not null default 'unverified',
  verified_by  uuid references users(id),
  verified_at  timestamptz,
  origin       origin_kind not null default 'manual',
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now(),
  check (from_id <> to_id),
  unique (from_id, to_id, relation)
);

-- ---------------------------------------------------------------------------
-- Bodies (groups attached to a jurisdiction)
-- ---------------------------------------------------------------------------
create table bodies (
  id              uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions(id) on delete cascade,
  category_id     smallint not null references body_categories(id),
  name            text not null,
  is_governmental boolean not null default false,
  oml_applies     boolean,              -- Open Meetings Law §103(e); null = unknown
  website         text,
  -- Authoritative page listing this body's committees/sub-bodies (a "Boards &
  -- Committees" hub, a Granicus/Legistar committee index, etc.) — distinct
  -- from `website` since the listing often lives elsewhere, sometimes on a
  -- vendor's own host (see ingestion/spider/affiliation.ts). The spider only
  -- ever proposes candidates here via candidate_links; this is set once a
  -- human has confirmed the URL is the authoritative one for this body.
  -- Legislative committees belong on the legislative body (Town Board,
  -- County Legislature); advisory boards/commissions belong on the chief
  -- executive (category_id -> body_categories.code = 'chief_executive':
  -- Governor, County Executive, Mayor) where that split exists (cities; most
  -- towns/villages have one combined body and everything hangs off it) —
  -- see also parent_body_id.
  committees_url  text,
  -- This body's own meeting-record pages — the "agenda"/"minutes" glyphs on
  -- ChannelGlyphs. Distinct from committees_url (an index of sub-bodies) and
  -- from candidate_links.link_type='calendar' (jurisdiction-wide, not tied
  -- to one body). Populated by promoting a candidate_links row matched to
  -- this body by name — see ingestion/spider/agendaDetector.ts.
  agenda_url      text,
  minutes_url     text,
  email           text,
  meeting_cadence text,
  attributes      jsonb not null default '{}',
  -- Null = a jurisdiction-level body (a Town Board, a County Legislature).
  -- Set = a committee of that other body (a Legislature's Budget &
  -- Appropriations Committee) — same jurisdiction_id as its parent, always;
  -- this column carries the sub-body relationship, not a separate scope.
  -- Standalone advisory boards/commissions (Planning Board, ZBA) are their
  -- own jurisdiction-level bodies and leave this null too — only committees
  -- *of* another body use it.
  parent_body_id  uuid references bodies(id) on delete cascade,
  -- This body's specific function, when it maps to a known type — see
  -- body_types above and body_type_topic below. Null for bodies with no
  -- type-level mandate defaults.
  body_type_id    smallint references body_types(id),
  -- Provenance for body_type_id, mirroring verification_status below since a
  -- wrong type silently pulls in the wrong statute-derived mandates via
  -- body_type_topic. A rule-based name match (unambiguous, e.g. "Planning
  -- Board") is written 'verified' directly; an AI-proposed type (the
  -- fallback for names a rule can't decide) is written 'proposed' and needs
  -- scribe review, same gate as body_topic.
  body_type_status       text references assertion_status(id),
  body_type_confidence   numeric(3,2),   -- null for rule-based/scribe-set
  body_type_source_url   text,
  body_type_extracted_by text,           -- 'rule:<code>' | 'model:<model-id>:<prompt-version>' | 'scribe:<uid>'
  body_type_reviewed_by  uuid references users(id),
  body_type_reviewed_at  timestamptz,
  source_url   text,
  verification verification_status not null default 'unverified',
  verified_by  uuid references users(id),
  verified_at  timestamptz,
  origin       origin_kind not null default 'manual',
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now(),
  check (parent_body_id is null or parent_body_id <> id),
  unique (id, jurisdiction_id)   -- target of adoptions' composite FK
);
create index idx_bodies_parent on bodies(parent_body_id) where parent_body_id is not null;
-- Case/whitespace-insensitive uniqueness per jurisdiction (and per parent,
-- for committees of a body) — backs up upsertBodyByName's matching so two
-- ingestion paths, or a re-run after an upstream name tweak, can't silently
-- create a second row for the same board. See ingestion/tools/dedupe-bodies.ts.
create unique index idx_bodies_unique_name_top
  on bodies (jurisdiction_id, lower(trim(name)))
  where parent_body_id is null;
create unique index idx_bodies_unique_name_child
  on bodies (jurisdiction_id, parent_body_id, lower(trim(name)))
  where parent_body_id is not null;
create index idx_bodies_type on bodies(body_type_id) where body_type_id is not null;

-- ---------------------------------------------------------------------------
-- Topics and roles: what each body is responsible for (its mandate topics)
-- and what it does with each one (decides/advises/administers/…). See
-- local/enhancement_topics_and_roles.md for the design. Two levels of
-- vocabulary (topic domains > topics) plus the small vocabularies around it
-- use text ids rather than the smallint-identity convention above:
-- topic_id/role_id/basis_id are values an AI extraction pass (see
-- ingestion/t0?-body-topics, when it exists) emits directly in structured
-- tool-use output, so a human-readable id ('advises','environment.wetlands')
-- is directly usable where a model would otherwise need an extra lookup.
-- ---------------------------------------------------------------------------
create table topic (
  id          text primary key,          -- 'environment.wetlands'
  parent_id   text references topic(id), -- null for domains
  label       text not null,
  description text,
  sort_order  int not null default 0,
  active      boolean not null default true
);
create index idx_topic_parent on topic(parent_id) where parent_id is not null;

-- Locale-specific topic names are deliberately not modeled: the starter
-- vocabulary is plain English and no locale pack needs to relabel it yet. If
-- one does, mirror the jurisdictions locale pattern (packages/shared/src/conf/
-- <state>.yaml + ingestion/tools/seed-profile.ts), not a bespoke table here.

create table topic_role (
  id          text primary key,  -- decides | advises | administers | enforces | hears_appeals | funds
  label       text not null,
  description text not null,
  sort_order  int not null default 0
);

create table topic_basis (
  id    text primary key,  -- statute | charter | ordinance | bylaws | website | observed
  label text not null
);

-- Type-level defaults: many mandates come from state law and apply to every
-- body of a type in a given locale — store once, not per body.
create table body_type_topic (
  body_type_id smallint not null references body_types(id),
  topic_id     text not null references topic(id),
  role_id      text not null references topic_role(id),
  basis_id     text not null references topic_basis(id),
  citation     text,        -- e.g. statute section
  profile_id   smallint not null references profiles(id),  -- defaults are locale-specific
  primary key (body_type_id, topic_id, role_id, profile_id)
);

-- Per-body assertions — human-entered or AI-proposed. status_id gates public
-- visibility: only 'verified' rows feed body_topic_effective below.
create table body_topic (
  id                bigserial primary key,
  body_id           uuid not null references bodies(id) on delete cascade,
  topic_id          text not null references topic(id),
  role_id           text not null references topic_role(id),
  basis_id          text not null references topic_basis(id),
  status_id         text not null references assertion_status(id) default 'proposed',
  overrides_default boolean not null default false, -- true when this changes (not just excludes) a type default
  excluded          boolean not null default false,  -- true = verified that this body does NOT hold this topic/role
  source_url        text,
  evidence_text     text,       -- verbatim excerpt supporting the assertion
  citation          text,
  confidence        numeric(3,2),  -- null for human-entered rows
  extracted_by      text,       -- 'scribe:<uid>' or 'model:<model-id>:<prompt-version>'
  reviewed_by       uuid references users(id),
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (body_id, topic_id, role_id, status_id)
);
create index idx_body_topic_body   on body_topic(body_id);
create index idx_body_topic_status on body_topic(status_id);

-- Verified absence by jurisdiction. "No body in this town covers trees" is a
-- finding, stored separately from "not yet checked" (blank).
create table jurisdiction_topic_finding (
  jurisdiction_id uuid not null references jurisdictions(id) on delete cascade,
  topic_id        text not null references topic(id),
  finding         text not null check (finding in ('none_found')),
  verified_by     uuid not null references users(id),
  verified_at     timestamptz not null default now(),
  notes           text,
  primary key (jurisdiction_id, topic_id)
);

-- Resolved view: type defaults + verified per-body rows, per-body wins. A
-- verified body_topic row for a given (body, topic, role) always supersedes
-- the matching type default, whether it's a straight exclusion (excluded =
-- true, nothing shown) or a body-specific override (overrides_default = true,
-- e.g. a different citation) — a per-body verified fact is always more
-- specific than a locale-wide default. Proposed and rejected rows never
-- appear here.
create view body_topic_effective as
select
  b.id              as body_id,
  btt.topic_id,
  btt.role_id,
  btt.basis_id,
  btt.citation,
  null::bigint      as body_topic_id,
  null::text        as source_url,
  null::text        as evidence_text,
  null::numeric(3,2) as confidence,
  'default'::text   as source
from bodies b
join jurisdictions j on j.id = b.jurisdiction_id
join body_type_topic btt
  on btt.body_type_id = b.body_type_id
 and btt.profile_id = j.profile_id
where b.body_type_id is not null
  and not exists (
    select 1 from body_topic bt
    where bt.body_id = b.id
      and bt.topic_id = btt.topic_id
      and bt.role_id = btt.role_id
      and bt.status_id = 'verified'
  )

union all

select
  bt.body_id,
  bt.topic_id,
  bt.role_id,
  bt.basis_id,
  bt.citation,
  bt.id             as body_topic_id,
  bt.source_url,
  bt.evidence_text,
  bt.confidence,
  'body'::text      as source
from body_topic bt
where bt.status_id = 'verified'
  and not bt.excluded;

-- ---------------------------------------------------------------------------
-- Seats (durable positions; carry term length + cadence + office contact)
-- ---------------------------------------------------------------------------
create table seats (
  id                uuid primary key default gen_random_uuid(),
  body_id           uuid not null references bodies(id) on delete cascade,
  title             text not null,       -- 'Supervisor','Ward 3 Councilmember','Town Administrator'
  selection_method  selection_method not null,
  allows_co_holder  boolean not null default false,  -- true = up to two joint holders
  term_length_years smallint,
  election_cadence  text,                -- free text: 'every 2 yrs, odd years'
  office_email      text,                -- survives turnover: supervisor@town.gov
  office_website    text,
  notes             text,
  source_url   text,
  verification verification_status not null default 'unverified',
  verified_by  uuid references users(id),
  verified_at  timestamptz,
  origin       origin_kind not null default 'manual',
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now()
);

-- Roles = occupancies. end_date null means current.
create table roles (
  id             uuid primary key default gen_random_uuid(),
  seat_id        uuid not null references seats(id) on delete cascade,
  official_id    uuid not null references officials(id) on delete restrict,
  start_date     date,
  end_date       date,                  -- null = current holder
  personal_email text,
  personal_website text,
  source_url   text,
  verification verification_status not null default 'unverified',
  verified_by  uuid references users(id),
  verified_at  timestamptz,
  origin       origin_kind not null default 'manual',
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now()
);
-- Current-holder capacity per seat: one, or two when allows_co_holder is set.
-- The boolean caps the exception at two by construction — co-presidencies are the
-- only joint office that occurs, and never exceed two. Model multi-member boards
-- (at-large councils) as N distinct single-holder seats, not as co-holders.
-- A trigger replaces a partial unique index because the limit is now data-driven.
create or replace function enforce_seat_capacity() returns trigger
language plpgsql as $$
declare cap int; cur int;
begin
  if new.end_date is not null then
    return new;                          -- past occupancies are unconstrained
  end if;
  select case when allows_co_holder then 2 else 1 end
    into cap
    from seats where id = new.seat_id
    for update;                          -- lock the seat: serialize concurrent inserts
  select count(*) into cur
    from roles
    where seat_id = new.seat_id
      and end_date is null
      and id is distinct from new.id;    -- exclude the row itself on UPDATE
  if cur + 1 > cap then
    raise exception 'seat % already has % current holder(s); capacity is %',
      new.seat_id, cur, cap using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_roles_capacity
  before insert or update on roles
  for each row execute function enforce_seat_capacity();

-- ---------------------------------------------------------------------------
-- Channels (many-to-one with bodies). Records presence AND verified absence.
-- ---------------------------------------------------------------------------
create table channels (
  id        uuid primary key default gen_random_uuid(),
  body_id   uuid not null references bodies(id) on delete cascade,
  kind      channel_kind not null,
  status    channel_status not null default 'unknown',  -- present|absent|unknown
  platform  text,                        -- 'facebook_page','newsletter','slack','discord'…
  url       text,                        -- null when status='absent'
  source_url   text,
  verification verification_status not null default 'unverified',
  verified_by  uuid references users(id),
  verified_at  timestamptz,
  origin       origin_kind not null default 'manual',
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now(),
  check (status <> 'present' or url is not null)  -- present must have a url
);

-- ---------------------------------------------------------------------------
-- Products + adoptions (your Tools / BodyTools). The adoption row is the dataset.
-- ---------------------------------------------------------------------------
create table products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,             -- 'BoardDocs','Granicus','CivicPlus','Slack'
  vendor      text,
  function_id smallint references product_functions(id),
  website     text,
  source_url   text,
  verification verification_status not null default 'unverified',
  verified_by  uuid references users(id),
  verified_at  timestamptz,
  origin       origin_kind not null default 'manual',
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now(),
  unique (name, vendor)
);

-- One row per actual contract/license agreement. Kept separate from adoptions
-- because a single contract (a BOCES co-op purchase, a county-wide deal) can
-- cover many bodies at once; the holder need not be the adopting body itself.
create table contracts (
  id                     uuid primary key default gen_random_uuid(),
  product_id             uuid not null references products(id) on delete restrict,
  holder_jurisdiction_id uuid not null references jurisdictions(id) on delete restrict,
  contract_number        text,
  term                   contract_term,
  start_date             date,
  expires_date           date,
  annual_cost            numeric(12,2),   -- USD
  seats                  integer,         -- fixed seat count, if the contract caps one
  source_url   text,
  verification verification_status not null default 'unverified',
  verified_by  uuid references users(id),
  verified_at  timestamptz,
  origin       origin_kind not null default 'manual',
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now()
);

-- An adoption belongs to the jurisdiction that licenses the product; body_id is
-- optional, for one body running its own tool (a planning board's permit
-- tracker). The composite FK keeps a body within its adoption's jurisdiction.
create table adoptions (
  id            uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions(id) on delete cascade,
  body_id       uuid,
  product_id    uuid not null references products(id) on delete restrict,
  contract_id   uuid references contracts(id) on delete set null,
  instance_url  text,                    -- the body's actual install
  first_observed date,
  source_url   text,
  verification verification_status not null default 'unverified',
  verified_by  uuid references users(id),
  verified_at  timestamptz,
  origin       origin_kind not null default 'manual',
  created_by   uuid references users(id),
  created_at   timestamptz not null default now(),
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now(),
  foreign key (body_id, jurisdiction_id) references bodies(id, jurisdiction_id) on delete cascade
);
create unique index adoptions_jurisdiction_product_key
  on adoptions (jurisdiction_id, product_id) where body_id is null;
create unique index adoptions_body_product_key
  on adoptions (body_id, product_id) where body_id is not null;

-- ---------------------------------------------------------------------------
-- Scribe assignments + revision log
-- ---------------------------------------------------------------------------
create table scribe_assignments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  jurisdiction_id uuid not null references jurisdictions(id) on delete cascade,
  scope           assignment_scope not null default 'contributor',
  assigned_at     timestamptz not null default now(),
  unique (user_id, jurisdiction_id)
);

-- Append-only. Contributor edits land as 'proposed'; a lead/editor accepts.
-- This is history, rollback, and moderation queue in one table.
create table revisions (
  id          uuid primary key default gen_random_uuid(),
  table_name  text not null,
  record_id   uuid not null,
  op          revision_op not null,
  diff        jsonb not null,
  source_url  text,
  status      revision_status not null default 'proposed',
  changed_by  uuid references users(id),
  changed_at  timestamptz not null default now(),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz
);

create type crawl_job_status as enum ('queued','running','done','error');

-- Background crawl jobs. Queued by apps/api's propose route whenever a
-- scribe sets/changes a jurisdiction's or body's website through the
-- EditableGlyph UI, and picked up one at a time by ingestion/spider/worker.ts
-- (a separate long-running process — deliberately not run in the API's own
-- process, since a crawl hits real third-party sites and can be slow). Gives
-- the web UI something to poll right after a website edit ("checking for
-- related info…") instead of only the next scheduled `npm run govdex:spider`
-- batch pass eventually finding things.
create table crawl_jobs (
  id               uuid primary key default gen_random_uuid(),
  jurisdiction_id  uuid references jurisdictions(id) on delete cascade,
  body_id          uuid references bodies(id) on delete cascade,  -- null = jurisdiction-level seed
  seed_url         text not null,
  status           crawl_job_status not null default 'queued',
  candidates_found integer not null default 0,
  error            text,
  queued_by        uuid references users(id),
  queued_at        timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);
create index idx_crawl_jobs_status       on crawl_jobs(status);
create index idx_crawl_jobs_jurisdiction on crawl_jobs(jurisdiction_id);
create index idx_crawl_jobs_body         on crawl_jobs(body_id) where body_id is not null;

-- Staging queue for spider output (channel, board, and now also
-- calendar/vendor discovery — see link_type). Machine-written, then triaged
-- by a scribe who promotes a row into a real channel/body via the normal
-- permission-checked write path. Never writes channel status='absent' —
-- "spider found none" is weaker than "human verified none," so absence stays
-- unknown until a person confirms it. Every row should be a real document
-- (a page, profile, or feed a scribe can open and judge) — never a mailto:
-- address or a "share this page" widget link (facebook.com/sharer,
-- twitter.com/share, etc.), neither of which is a destination to promote.
create table candidate_links (
  id                uuid primary key default gen_random_uuid(),
  jurisdiction_id   uuid references jurisdictions(id) on delete cascade,  -- for triage scope
  source_body_id    uuid references bodies(id) on delete set null,        -- whose site we crawled
  crawl_job_id      uuid references crawl_jobs(id) on delete set null,    -- which run found this, if any
  found_on_url      text not null,      -- page the link appeared on
  target_url        text not null,      -- the discovered link
  -- Anchor text captured at crawl time, not fetched from target_url itself —
  -- many targets are PDFs/other non-HTML documents with no <title> tag, so
  -- the link text that pointed at them is the only reliable label available.
  title             text,
  -- 'channel' (social/community, see guessed_kind/guessed_platform),
  -- 'board'/'district' (see guessed_body_name/guessed_jurisdiction_name),
  -- 'calendar' (a meeting/agenda calendar link),
  -- 'vendor' (a GovTech SaaS site, see guessed_vendor/guessed_function),
  -- 'index' (a directory/listing page — e.g. a "Boards & Committees" hub —
  -- rather than a single body; not promotable, kept so a scribe or a later
  -- crawl can revisit it as a seed, see ingestion/spider/run.ts's --url).
  -- 'agenda'/'minutes'/'agenda_minutes' (a meeting-record page matched by
  -- name to an existing body — see guessed_target_body_id below and
  -- ingestion/spider/agendaDetector.ts).
  -- 'api' (a civic-data platform API confirmed/suspected for this
  -- jurisdiction by ingestion/tools/probe-civic-apis.ts -- see
  -- guessed_vendor/guessed_function below and jurisdictions.open_data_api_url
  -- / legistar_api_url).
  link_type         text not null default 'channel'
    check (link_type in ('channel','board','district','calendar','vendor','index','agenda','minutes','agenda_minutes','budget','api')),
  guessed_platform  text,               -- 'facebook_group','substack','discord'…
  guessed_kind      channel_kind,       -- classifier's B/C guess (nullable)
  guessed_body_name text,               -- set when the link looks like an affiliated group
  -- Set instead of guessed_body_name when the name contains "district"
  -- (school/fire/sewer/water/etc.) — these are their own jurisdictions
  -- (type_concepts.level='special_district'), commonly disjoint from or
  -- spanning multiple municipalities, never a committee of the jurisdiction
  -- whose page they were found on. Never promote one via add-body.ts;
  -- model it as a jurisdiction + jurisdiction_relations instead, ideally
  -- sourced from the state's authoritative district list, not this guess.
  guessed_jurisdiction_name text,
  guessed_vendor    text,               -- 'Granicus','CivicPlus','BoardDocs'… (link_type='vendor'/'api')
  -- product_functions.code guess (link_type='vendor'); for link_type='api'
  -- this is 'open_data' (Socrata/ArcGIS/data.gov -> open_data_api_url) or
  -- 'legistar' (-> legistar_api_url) — see probe-civic-apis.ts.
  guessed_function  text,
  -- Which existing body this meeting-record page was matched to by name —
  -- distinct from source_body_id, which is whose page the link was *found
  -- on* (provenance), not which body it's *about* (link_type='agenda'/
  -- 'minutes'/'agenda_minutes').
  guessed_target_body_id uuid references bodies(id) on delete set null,
  status            text not null default 'new'
    check (status in ('new','promoted','rejected','duplicate')),
  discovered_at     timestamptz not null default now(),
  reviewed_by       uuid references users(id),
  reviewed_at       timestamptz,
  unique (jurisdiction_id, target_url)
);
create index idx_candidate_status on candidate_links(status);
create index idx_candidate_jur    on candidate_links(jurisdiction_id);
create index idx_candidate_type   on candidate_links(link_type);

-- ---------------------------------------------------------------------------
-- Friction — recurring bad practices found in an entity's own web
-- presence (robots.txt excluding this crawler, no adequate machine-readable
-- API, an index of things like committees buried in a menu instead of given
-- its own page, etc.), shown to the public on that entity's EntityPage. Same
-- machine-proposes/human-triages shape as candidate_links above:
-- ingestion/spider/fetcher.ts writes status='new' rows when it detects one
-- automatically (currently robots.txt exclusion only); a scribe reviews and
-- moves a row to 'confirmed' or 'dismissed' (false positive). A scribe can
-- also file a row directly for a judgment call the spider can't make on its
-- own (e.g. "this API is inadequate") — those start at 'confirmed' since a
-- human already judged them, with created_by set (null created_by =
-- spider-detected).
-- ---------------------------------------------------------------------------
create table frictions (
  id              uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid references jurisdictions(id) on delete cascade,  -- for triage scope; see candidate_links' note
  body_id         uuid references bodies(id) on delete cascade,        -- null = the jurisdiction's own site
  crawl_job_id    uuid references crawl_jobs(id) on delete set null,   -- which run found this, if spider-detected
  pattern_type    text not null,        -- free-form; known values enumerated in packages/shared/src/enums.ts, not enforced here — see migration 0009
  status          text not null default 'new'
    check (status in ('new','confirmed','resolved','dismissed')),
  page_url        text not null,      -- the page/resource the finding is about (an origin's robots.txt, a body's API root…)
  summary         text not null,      -- short human-readable statement, shown on EntityPage
  detail          text,               -- supporting evidence: which URL triggered it, notes, etc.
  source_url      text,               -- citation for a manually-entered finding
  detected_at     timestamptz not null default now(),
  resolved_at     timestamptz,
  created_by      uuid references users(id),   -- null = spider-detected
  reviewed_by     uuid references users(id),
  reviewed_at     timestamptz,
  unique (jurisdiction_id, pattern_type, page_url)
);
create index idx_frictions_status on frictions(status);
create index idx_frictions_jur    on frictions(jurisdiction_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers on all substantive tables
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'officials','jurisdictions','jurisdiction_identifiers','jurisdiction_relations',
    'bodies','seats','roles','channels','products','contracts','adoptions'
  ] loop
    execute format(
      'create trigger trg_%1$s_updated before update on %1$I
       for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index idx_jur_concept         on jurisdictions(concept_id);
create index idx_jur_profile         on jurisdictions(profile_id);
create index idx_jurid_jur           on jurisdiction_identifiers(jurisdiction_id);
create index idx_rel_to              on jurisdiction_relations(to_id, relation);
create index idx_rel_from            on jurisdiction_relations(from_id, relation);
create index idx_bodies_jur          on bodies(jurisdiction_id);
create index idx_bodies_cat          on bodies(category_id);
create index idx_seats_body          on seats(body_id);
create index idx_roles_seat          on roles(seat_id);
create index idx_roles_official      on roles(official_id);
create index idx_channels_body       on channels(body_id);
create index idx_adoptions_body      on adoptions(body_id);
create index idx_adoptions_jurisdiction on adoptions(jurisdiction_id);
create index idx_adoptions_product   on adoptions(product_id);
create index idx_adoptions_contract  on adoptions(contract_id);
create index idx_contracts_product   on contracts(product_id);
create index idx_contracts_holder    on contracts(holder_jurisdiction_id);
create index idx_scribe_user         on scribe_assignments(user_id);
create index idx_scribe_jur          on scribe_assignments(jurisdiction_id);
create index idx_revisions_target    on revisions(table_name, record_id);
create index idx_revisions_status    on revisions(status);
create index idx_jur_attrs           on jurisdictions using gin (attributes);

-- Resolve a jurisdiction's local type name and governance config from its profile.
-- The app reads this instead of the raw concept code, so NY sees 'BOCES' where a
-- generic client sees 'educational_region'. t04 reads has_active_government and
-- default_body_name from here to decide whether to derive a governing body.
create view jurisdiction_profile_view as
  select j.id as jurisdiction_id,
         p.code  as profile_code,
         tc.code as concept,
         cp.local_name, cp.local_abbrev, cp.parent_org_name,
         cp.has_active_government, cp.default_body_name
  from jurisdictions j
  join profiles p       on p.id  = j.profile_id
  join type_concepts tc on tc.id = j.concept_id
  left join concept_profiles cp
         on cp.profile_id = j.profile_id and cp.concept_id = j.concept_id;

-- ---------------------------------------------------------------------------
-- Scribe edit scope
--   Editable set = assigned jurisdiction
--                + every jurisdiction WITHIN it, at any depth (state -> county
--                  -> town -> village; the 'within' chain is followed fully)
--                + jurisdictions that OVERLAP or are COEXTENSIVE with the
--                  assigned jurisdiction or any of those descendants (linked
--                  districts: school, legislative, ...)
--   Downward only, never upward. Overlaps are one hop: a linked district's own
--   children and overlaps are not pulled in.
-- ---------------------------------------------------------------------------
create or replace function scribe_editable_jurisdictions(p_user uuid)
returns table (jurisdiction_id uuid, grant_reason text)
language sql stable as $$
  with recursive assigned as (
    select sa.jurisdiction_id as jid from scribe_assignments sa where sa.user_id = p_user
  ),
  -- assigned + all descendants. UNION (not UNION ALL) drops repeats, so a
  -- bad cyclic 'within' edge terminates instead of looping.
  tree(jid) as (
    select jid from assigned
    union
    select r.from_id
      from jurisdiction_relations r
      join tree t on r.to_id = t.jid
     where r.relation = 'within'
  ),
  linked as (
    -- overlaps / coextensive are symmetric: catch both stored directions
    select r.to_id as jid
      from jurisdiction_relations r
      join tree t on r.from_id = t.jid
     where r.relation in ('overlaps','coextensive')
    union
    select r.from_id
      from jurisdiction_relations r
      join tree t on r.to_id = t.jid
     where r.relation in ('overlaps','coextensive')
  )
  select jid, 'assigned' from assigned
  union
  select jid, 'within_assigned' from tree
   where jid not in (select jid from assigned)
  union
  select jid, 'overlaps_assigned' from linked
   where jid not in (select jid from tree);
$$;

-- Convenience: may this user edit rows attached to this jurisdiction?
create or replace function scribe_can_edit(p_user uuid, p_jur uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from scribe_editable_jurisdictions(p_user)
    where jurisdiction_id = p_jur
  );
$$;

-- ============================================================================
-- Field-level edit permissions
--
-- Model: default-open, explicitly-restricted. Any scribe with scope over a
-- row's jurisdiction may edit its ordinary fields. A short list of fields and
-- tables is raised above that, because a wrong edit there has blast radius
-- beyond the row: relations rescope other scribes, identifiers break import
-- matching, geometry misroutes address lookups, global_role escalates privilege.
--
-- The policy is data (field_policies), so the UI and the DB read one source.
-- Enforcement is two layers: the app checks before writing (and greys locked
-- fields), and a trigger backstops direct writes. The trigger reads the acting
-- user from a per-transaction GUC the server must set:  SET LOCAL app.user_id.
-- Writes with no app.user_id set (imports, migrations) are not user-driven and
-- pass through — keep that path server-only.
-- ============================================================================

create table field_policies (
  id            smallint generated always as identity primary key,
  table_name    text not null,
  column_name   text,                    -- null = the whole table (a floor for every column + insert/delete)
  required_tier edit_tier not null,
  note          text,
  unique (table_name, column_name)
);
-- one whole-table policy per table (composite unique above treats nulls as distinct)
create unique index field_policies_table_floor
  on field_policies(table_name) where column_name is null;

insert into field_policies (table_name, column_name, required_tier, note) values
  ('jurisdiction_relations',   null,          'admin',  'Relations rescope every scribe; admin only.'),
  ('jurisdiction_identifiers', null,          'editor', 'External keys drive import matching and dedup.'),
  ('products',                 null,          'editor', 'Global reference catalog; adoptions stay scribe-tier.'),
  ('jurisdictions',            'geometry',    'editor', 'Backs address resolution.'),
  ('jurisdictions',            'ocd_id',      'editor', 'Canonical division identity.'),
  ('users',                    'global_role', 'admin',  'Privilege escalation.');
-- Provenance columns (verification/verified_by/verified_at -> lead; origin -> admin)
-- are defaulted in required_tier() rather than seeded per table. This is what
-- stops a contributor from stamping their own edit as verified.

create or replace function tier_rank(t edit_tier) returns int
language sql immutable as $$
  select case t when 'scribe' then 1 when 'lead' then 2
                when 'editor' then 3 when 'admin' then 4 end;
$$;

-- Best tier a user holds anywhere (for tables not anchored to one jurisdiction).
create or replace function base_tier(p_user uuid) returns edit_tier
language sql stable as $$
  select case
    when u.global_role = 'admin'  then 'admin'::edit_tier
    when u.global_role = 'editor' then 'editor'::edit_tier
    when exists (select 1 from scribe_assignments sa where sa.user_id = p_user)
                                  then 'scribe'::edit_tier
    else null
  end
  from users u where u.id = p_user;
$$;

-- p_jur and every jurisdiction above it via 'within' (walks up a short chain;
-- UNION terminates on cycles).
create or replace function jurisdiction_self_and_ancestors(p_jur uuid)
returns table (jurisdiction_id uuid)
language sql stable as $$
  with recursive up(jid) as (
    select p_jur
    union
    select r.to_id
      from jurisdiction_relations r
      join up on r.from_id = up.jid
     where r.relation = 'within'
  )
  select jid from up;
$$;

-- Tier a user holds for a specific jurisdiction. Lead comes only from an
-- assigned jurisdiction or one anywhere below it; linked districts
-- (overlaps/coextensive) grant scribe tier only.
create or replace function user_edit_tier(p_user uuid, p_jur uuid) returns edit_tier
language sql stable as $$
  select case
    when u.global_role = 'admin'  then 'admin'::edit_tier
    when u.global_role = 'editor' then 'editor'::edit_tier
    when p_jur is not null and exists (
        select 1 from scribe_assignments sa
        where sa.user_id = p_user and sa.scope = 'lead'
          and sa.jurisdiction_id in (select jurisdiction_id from jurisdiction_self_and_ancestors(p_jur)))
                                  then 'lead'::edit_tier
    when p_jur is not null and exists (
        select 1 from scribe_editable_jurisdictions(p_user) e
        where e.jurisdiction_id = p_jur)
                                  then 'scribe'::edit_tier
    else null
  end
  from users u where u.id = p_user;
$$;

-- Required tier for a column: the stricter of the table floor and the column rule.
create or replace function required_tier(p_table text, p_col text) returns edit_tier
language sql stable as $$
  select (array['scribe','lead','editor','admin']::edit_tier[])[
    greatest(
      tier_rank(coalesce(
        (select required_tier from field_policies
          where table_name = p_table and column_name is null), 'scribe')),
      tier_rank(coalesce(
        (select required_tier from field_policies
          where table_name = p_table and column_name = p_col),
        case when p_col in ('verification','verified_by','verified_at') then 'lead'::edit_tier
             when p_col = 'origin'                                      then 'admin'::edit_tier
             else 'scribe'::edit_tier end))
    )];
$$;

-- Walk a row to its owning jurisdiction (null for jurisdiction-free tables).
create or replace function row_jurisdiction(p_table text, p_row jsonb) returns uuid
language sql stable as $$
  select case p_table
    when 'jurisdictions'            then (p_row->>'id')::uuid
    when 'jurisdiction_identifiers' then (p_row->>'jurisdiction_id')::uuid
    when 'bodies'                   then (p_row->>'jurisdiction_id')::uuid
    when 'seats'    then (select jurisdiction_id from bodies where id = (p_row->>'body_id')::uuid)
    when 'channels' then (select jurisdiction_id from bodies where id = (p_row->>'body_id')::uuid)
    when 'adoptions'then (p_row->>'jurisdiction_id')::uuid
    when 'contracts'then (p_row->>'holder_jurisdiction_id')::uuid
    when 'roles'    then (select b.jurisdiction_id from seats s
                          join bodies b on b.id = s.body_id
                          where s.id = (p_row->>'seat_id')::uuid)
    else null
  end;
$$;

create or replace function can_edit_field(
  p_user uuid, p_table text, p_col text, p_jur uuid) returns boolean
language sql stable as $$
  select coalesce(tier_rank(
    case when p_table in ('jurisdiction_relations','products','officials')
         then base_tier(p_user)                 -- not anchored to one jurisdiction
         else user_edit_tier(p_user, p_jur) end
  ), 0) >= tier_rank(required_tier(p_table, p_col));
$$;

-- Backstop trigger: rejects direct writes below the required tier. Skips when
-- no app.user_id is set (server-run imports/migrations).
create or replace function enforce_field_policies() returns trigger
language plpgsql as $$
declare
  v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  v_jur  uuid;
  v_key  text;
  v_new  jsonb;
  v_old  jsonb;
begin
  if v_user is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    v_jur := row_jurisdiction(tg_table_name, to_jsonb(old));
    if not can_edit_field(v_user, tg_table_name, null, v_jur) then
      raise exception 'user % may not delete from %', v_user, tg_table_name
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  v_new := to_jsonb(new);
  v_jur := row_jurisdiction(tg_table_name, v_new);

  if tg_op = 'INSERT' then
    if not can_edit_field(v_user, tg_table_name, null, v_jur) then
      raise exception 'user % may not create rows in %', v_user, tg_table_name
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  v_old := to_jsonb(old);
  for v_key in select jsonb_object_keys(v_new) loop
    if v_new -> v_key is distinct from v_old -> v_key then
      if not can_edit_field(v_user, tg_table_name, v_key, v_jur) then
        raise exception 'user % may not edit %.%', v_user, tg_table_name, v_key
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end loop;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'jurisdictions','jurisdiction_identifiers','jurisdiction_relations',
    'bodies','seats','roles','channels','products','contracts','adoptions','officials'
  ] loop
    execute format(
      'create trigger trg_%1$s_fieldperm
       before insert or update or delete on %1$I
       for each row execute function enforce_field_policies()', t);
  end loop;
end $$;

-- users is deliberately off the generic trigger (account self-edits are an auth
-- concern, not a scribe-data concern). Guard only the escalation vector.
create or replace function guard_user_role() returns trigger
language plpgsql as $$
declare v_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
begin
  if v_user is null then return new; end if;
  if new.global_role is distinct from old.global_role
     and coalesce((select global_role from users where id = v_user), 'viewer') <> 'admin' then
    raise exception 'only admins may change global_role'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger trg_users_roleguard
  before update on users
  for each row execute function guard_user_role();

-- Any user-driven write (app.user_id set) marks the row human-owned. Imports run
-- with no app.user_id, so their rows stay origin='import'. Re-import upserts guard
-- with WHERE origin='import', so a refresh never overwrites a row a scribe touched.
-- Fires after the field-permission check (trg_*_fieldperm) by name ordering, so the
-- forced origin change is never seen as a user-attempted edit.
create or replace function stamp_origin() returns trigger
language plpgsql as $$
begin
  if nullif(current_setting('app.user_id', true), '') is not null then
    new.origin := 'manual';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'jurisdictions','jurisdiction_identifiers','jurisdiction_relations',
    'bodies','seats','roles','channels','products','contracts','adoptions','officials'
  ] loop
    execute format(
      'create trigger trg_%1$s_origin
       before insert or update on %1$I
       for each row execute function stamp_origin()', t);
  end loop;
end $$;

-- ============================================================================
-- PostGIS section — run only after: create extension postgis;
-- Boundaries back the address-lookup path (point-in-polygon → every covering
-- jurisdiction, including overlapping districts the relation graph approximates).
-- ============================================================================
-- alter table jurisdictions add column geometry geometry(MultiPolygon, 4326);
-- create index idx_jur_geom on jurisdictions using gist (geometry);
--
-- -- address resolution once geometry is populated:
-- -- select j.* from jurisdictions j
-- --   where st_contains(j.geometry, st_setsrid(st_makepoint($lng,$lat),4326));