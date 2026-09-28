# Civic Stack Index

  a civic-transparency database, server, and crawler:
  who governs each jurisdiction, what bodies exist, who sits in which seat,
  and how present/absent that body's public communication and records are.

## Components

### 1. Database (`packages/db`)

Postgres (13+, PostGIS optional/pending — see the schema's final section).
`packages/db/schema.sql` is the source of truth; `packages/db/migrations/`
holds incremental changes applied on top of it via
`npx tsx packages/db/src/migrate.ts` (`govdex:db:migrate`). Seed data
(`packages/db/seed/`) fills the lookup tables — concepts, body categories,
product functions, and the `US-NY` profile pack — via `npm run govdex:seed`.

Local Postgres runs via `infra/docker-compose.yml` (`govdex:db:up`/`:down`).

Design principles baked into the schema (see the header comment in
`schema.sql` for the full list):

- **Jurisdiction = bounded area of authority. Body = a group that governs it.**
  Kept as separate tables on purpose — see the data dictionary below.
- **Provenance on every substantive row**: `source_url`, `verification`,
  `verified_by`/`verified_at`, `origin` (`import` vs `manual`), and
  `created_by`/`updated_by`. Nothing is asserted without a trail.
- **Verified absence is a value, never a blank.** A blank field means
  "not yet checked"; e.g. `channels.status = 'absent'` means a human
  confirmed the body has no such channel.
- **The relation graph does double duty**: it's both the geographic model
  (`jurisdiction_relations`: within/overlaps/coextensive) and the scope that
  determines what a scribe (volunteer editor) is allowed to edit.
- **Field-level permissions live in the database**, not the app
  (`field_policies`, `can_edit_field`, enforced by a trigger). The app
  should never reimplement an edit rule the database already owns.

### 2. Server (`apps/api` + `apps/web`, mounted by `server/`)

- `apps/api` — an Express API (routers in `apps/api/src/routes/`) exposing
  jurisdictions, bodies, candidate links, revisions, the scribe queue, crawl
  jobs, geo-resolution, and friction. Assembled by `apps/api/src/router.ts`
  and mounted at `/api/stack` by `server/routes.ts`. Auth is Firebase-based
  (`apps/api/src/auth.ts`); every user-driven write runs inside `withUser`
  (`apps/api/src/withUser.ts`), which sets the `app.user_id` Postgres GUC that
  the field-permission triggers read.
- `apps/web` — a Next.js app (jurisdiction/body pages, the scribe editing UI,
  address resolution) mounted by `server/govdex.ts` at a two-letter state (or
  DC/territory) postal code, e.g. `/ny`. Key
  components: `EntityPage.tsx` (a jurisdiction or body's public page),
  `ChannelGlyphs.tsx` / `CapabilityGlyphs.tsx` (the glyph rows described
  below), `ScribeForm.tsx` / `EditableGlyph.tsx` (in-place editing),
  `SpiderCandidates.tsx` (triaging crawler output into real rows).

Both share one Postgres pool and one root process — deliberately: GovDex is
folded into the existing site rather than stood up as a separate service.

### 3. Crawler (`ingestion/`)

Two kinds of work live here:

- **`t00`–`t06`: one-time/periodic batch imports**, run roughly in order,
  each a `npx tsx ingestion/tNN-.../run.ts` script (see `package.json`'s
  `govdex:t0*` scripts): lookups, jurisdictions, school districts, BOCES, NYC
  special case, inter-jurisdiction relations, PostGIS boundaries, derived
  governing bodies, state legislators, and slug generation. These write with
  `origin='import'` and never set `app.user_id` — see `AGENTS.md`.
- **The spider (`ingestion/spider/`)**: an ongoing crawler that, given a
  jurisdiction or body's website as a seed, follows links and classifies what
  it finds — social/community channels, sub-boards, meeting calendars,
  agenda/minutes pages, GovTech vendor products, and friction signals
  (e.g. `robots.txt` excluding the crawler). It never asserts a fact
  directly into the real tables; it only ever writes to the staging table
  `candidate_links` (or `frictions`, `status='new'`), which a human scribe
  then promotes or rejects. `ingestion/spider/worker.ts` is a long-running
  process that drains `crawl_jobs`, queued whenever a scribe sets or changes
  a website through the web UI.

Run order for a fresh environment: `govdex:db:up` → `govdex:db:migrate` →
`govdex:seed` → `govdex:t01`/`t01b`/`t01c`/`t01d`/`t02` → `govdex:t04` →
`govdex:t06:slugs` → (optionally) `govdex:spider` / `govdex:crawl-worker`.

## Data dictionary

### Jurisdictions

A **jurisdiction** is a bounded area of authority — geography only, no
notion of who governs it. Examples: New York State, Westchester County, the
Town of Bethlehem, the Village of Scarsdale, a school district, a BOCES
region, a state Assembly district.

- `profile_id` + `concept_id` give its type: `concept_id` points at a
  portable, cross-state `type_concepts` row (`county`, `town`,
  `school_district`, `educational_region`, …); `profile_id` points at a
  state pack (`US-NY` today) that supplies the local name for that concept
  via `concept_profiles` (e.g. NY's `educational_region` is locally named
  "BOCES"). This split keeps NY-specific vocabulary out of the schema so a
  second state can reuse the same concepts under its own names.
- `jurisdiction_identifiers` holds external keys (OCD id, Census GEOID,
  SWIS, GNIS, FIPS, BEDS, …), one row per `(scheme, value)`. Imports match
  and dedupe on these — **never on name**.
- `jurisdiction_relations` is the geography graph: `within` (directional —
  a town within a county), `overlaps`/`coextensive` (symmetric — a school
  district that crosses town lines). This graph is reused, unmodified, as
  the basis for scribe edit scope (`scribe_editable_jurisdictions()`).
- `policy_url` / `budget_url` are authoritative-source links for a
  jurisdiction's code-of-laws (Municode/eCode360-style) and its
  budget documents, promoted from a `candidate_links` hit once a human
  confirms it. `budget_url` is only meaningful where
  `concept_profiles.has_active_government = true`.

### Bodies

A **body** is a group that governs, represents, or organizes *for* a
jurisdiction — always attached to exactly one `jurisdiction_id`. Splitting
jurisdiction from body is what lets one jurisdiction have several bodies
(a Town Board, a Planning Board, a Zoning Board of Appeals) and lets a body
be non-governmental (a party committee) while still hanging off a place.

- `category_id` → `body_categories`: `official_elected`, `chief_executive`
  (the single executive office — Governor/County Executive/Mayor, split out
  where that split exists), `official_appointed`, `advisory`,
  `party_committee`, `affinity`, `interest_group`. The last three are the
  current, partial home for **non-governmental groups** — see "Third-party
  groups" below.
- `is_governmental` / `oml_applies` record whether NY's Open Meetings Law
  (§103(e)) applies.
- `parent_body_id` links a committee to the body it's a committee *of*
  (same `jurisdiction_id` as its parent). Standalone advisory boards
  (Planning Board, ZBA) are their own jurisdiction-level bodies and leave
  this null.
- `committees_url` / `agenda_url` / `minutes_url` are, like `policy_url`
  above, authoritative-source links promoted from `candidate_links`, shown
  as glyphs on the body's `EntityPage`.

### Seats and roles

**Seats persist; roles are the person-in-seat over time.** A seat is a
durable position (`Supervisor`, `Ward 3 Councilmember`) with a selection
method (`elected`/`appointed`/`hired`/`ex_officio`), term length, and an
office contact that survives turnover. A **role** is one official's
occupancy of a seat between a start and (nullable = current) end date.
`allows_co_holder` permits up to two simultaneous holders (co-presidencies);
everything else — an at-large council — is modeled as N distinct
single-holder seats, never as co-holders.

**Officials** are person-level only (name, photo, bio) — no role facts live
there, so the same person's history across multiple seats stays coherent.

### Resources and Channels

An entity makes available **Resources** — Rules, Budget, Projects, Meetings,
Directory — and uses **Channels** to communicate; both are delivered via its
**Capabilities**. See `data-dictionary.md` for the full Entity × Resource
matrix; this section covers how each maps onto the schema.

A **channel** is a body's outward communication surface — a Facebook page,
a newsletter, a Discord server. `channels` is many-to-one with `bodies` and
records presence *and verified absence* (`status`: `present`/`absent`/
`unknown`) — the spider is only ever allowed to leave a row at `unknown`;
only a human scribe can assert `absent`.

`kind` classifies a channel by communication direction, currently two
values, informally shorthanded B/C:

| kind | shorthand | meaning |
|---|---|---|
| `broadcast` | B | public, one-way or with comments enabled (a Facebook page, a newsletter) |
| `community` | C | member-to-member (a Discord/Slack, a private Facebook group) |

**Resources**, labeled **Key Resources** in the UI, are the standalone
authoritative documents/records an entity makes available — `budget_url`,
`policy_url` (Rules), `agenda_url`/`minutes_url` (Meetings), the
calendar-type `candidate_links`, and (once modeled) capital Projects and a
Directory. Each is a single record, not a communication surface with an
interactivity level, which is why they don't fold into `channels`' B/C
axis. In the UI, `ResourceGlyphs` renders this set (website, calendar,
agenda, minutes, policy) and `ChannelGlyphs` renders email plus the social
platforms — split components so the code names track the data-dictionary
split, even though both still render as glyph rows on the same entity card.
The underlying field names — `policy_url`, `budget_url`, `agenda_url`,
`minutes_url`, `committees_url`, and `candidate_links.link_type`'s enum
(`calendar`, `vendor`, `agenda`, `minutes`, `budget`, `index`, ...) — are
unchanged; "Resources" is the collection name, not a rename of each field.

### Candidate links (crawler staging)

`candidate_links` is the spider's only write target for anything it thinks
it found — a channel, a board, a district, a calendar, a vendor product, an
agenda/minutes page, a directory/index page, or a budget page
(`link_type`). Each row carries the page it was found on, the URL it
points to, a guessed classification, and a `status`
(`new`/`promoted`/`rejected`/`duplicate`). A scribe reviews `new` rows in
`apps/web/app/scribe/candidates` and promotes the ones that check out into
real `channels`/`bodies`/`jurisdictions` rows, or rejects the rest. Machine
output is never trusted enough to write a real fact directly.

### Products, contracts, adoptions

A **product** is a GovTech vendor tool (BoardDocs, Granicus, CivicPlus,
Slack, …), tagged with a `product_functions` code (`agenda_minutes`,
`website_cms`, `permitting`, `gis`, `notification`, `video_streaming`,
`crm`). A **contract** is one purchase/license agreement, kept separate
from adoptions because one contract (a BOCES co-op deal, a county-wide
license) can cover many bodies. An **adoption** is the fact "this body uses
this product" (optionally under a contract), one row per
`(body_id, product_id)`. `packages/shared/src/govCapabilities.ts` rolls the
granular `product_functions` codes up into seven resident-recognizable
categories (web presence, participation, meeting process, service delivery,
back office, transparency, oversight) shown as glyphs on `EntityPage`.

### Scribes, revisions, and permissions

- A **scribe** is a volunteer editor `scribe_assignments` links to a
  jurisdiction, with `scope` = `lead` or `contributor`. Editable scope
  extends from that assignment one hop outward — children (`within`) and
  overlapping/coextensive jurisdictions — never upward, never transitively
  further.
- Every substantive edit lands in `revisions` (append-only: table, record,
  op, diff, who, when, status) — this is history, rollback, and the
  moderation queue in one table. A contributor's edit lands `proposed`; a
  lead/editor accepts or rejects it.
- `field_policies` + the `edit_tier` ladder (`scribe` < `lead` < `editor` <
  `admin`) set, per table and optionally per column, the minimum tier
  required to write it — enforced both in the app and by a Postgres
  trigger (`enforce_field_policies`) so a direct write can't bypass it.

### Friction

Recurring bad practices found in an entity's own web presence — e.g.
`robots.txt` blocking this crawler, no adequate machine-readable API, a
committee list buried in a menu instead of given its own page. Same
machine-proposes/human-triages shape as `candidate_links`: the spider files
`status='new'` rows for what it can detect automatically; a scribe can also
file one directly for a judgment call the spider can't make, confirmed
(`status='confirmed'`) on entry since a human already made the call.

## Roadmap: third-party groups

Today, every `body` hangs off exactly one `jurisdiction_id`, and
`body_categories` already has room for non-governmental groups
(`party_committee`, `affinity`, `interest_group`) — but nothing yet models
what's specific to them. Planned expansion, not yet built:

- **Parties** — county/state party committees, which may not map cleanly
  onto a single jurisdiction's boundary the way a Town Board does, and
  which can have their own **representation boards** (a county committee
  seated by election-district representatives) — a structure `seats`/`roles`
  can likely express, but the seat's "district" isn't a `jurisdiction` today.
- **Advocacy groups** — issue-based organizations that may span or ignore
  jurisdictional lines entirely (a statewide tenants' rights group, a
  regional environmental coalition).
- **Media** — outlets covering a jurisdiction or region, relevant here
  mainly as another kind of "channel" a resident would look for, and as a
  potential source of `candidate_links`-style discovery in their own right.

All three can already **host community channels** in the current `channels`
model (a party's Discord, an advocacy group's newsletter) and may have
**representation boards** modeled as `bodies` with `seats`/`roles` — so the
data model likely doesn't need new tables so much as: (a) deciding whether
these groups need a jurisdiction-independent anchor instead of being forced
onto one `jurisdiction_id`, and (b) extending `body_categories` /
`scopeForBodyCategory` so these groups' web presence and channels show up
correctly wherever `chief_executive`/`legislative` scope is assumed today
(e.g. `GOV_CAPABILITIES.appliesTo` currently has no bucket for a
non-governmental body at all).

## Review workflow

CLI/direct editing (`ScribeForm.tsx`, the API routes, ingestion tools like
`add-body.ts`) is the current, temporary way to enter and review data. A
dedicated web review UI is expected eventually, once volunteer scribe
recruitment scales past what CLI/PR-based review supports.
