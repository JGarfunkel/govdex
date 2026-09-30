# Agent notes — GovDex (NY Civic Transparency Database)

Persistent context for a coding agent working on the GovDex subsystem of this
repo (`apps/web`, `apps/api`, `packages/db`, `packages/shared`, `ingestion/`).
The rest of the repo (`client/`, `server/`, `reports/ny-transparency/`, the Ordinizer
packages) is unrelated legacy/parallel functionality — see the top-level
README/plan history for how GovDex is mounted alongside it (`/<state>` — a two-letter
state/DC/territory code like `/ny`, plus `/`, `/login`, `/scribe`, `/resolve`, and
`/jurisdictions|bodies/<id>` permalinks — for the
Next.js app, `/api/stack` for the Express API, both in the same root
`server/index.ts` process).

Invariants, carried over from `local/govdex/govdex-project.md` (the original
build spec) and enforced by `packages/db/schema.sql`:

- The database is the source of truth for permissions. Do not reimplement
  edit rules in the app; call `can_edit_field` (see `apps/api/src/permissions.ts`)
  or read `field_policies`.
- Every user-driven write runs inside `withUser` (`apps/api/src/withUser.ts`),
  which sets `app.user_id` for the transaction. Ingestion scripts
  (`ingestion/`) never set it — their writes stay `origin='import'`.
- Match entities on `jurisdiction_identifiers` (scheme+value), never on
  names. See `ingestion/lib/upsert.ts`'s `upsertJurisdictionByIdentifier`.
- "Verified absence" is a value (`channels.status = 'absent'`). Never let
  blank stand for checked-and-none — the scribe UI (`ScribeForm.tsx`) makes
  "checked, none" a deliberate extra click, never a default. The spider
  (`ingestion/spider/`) must never write `status='absent'` itself.
- Scribe edit scope is `scribe_editable_jurisdictions()`: assigned,
  all `within` descendants (recursive), and overlaps/coextensive of the
  assigned jurisdiction or any descendant (one hop). It never reaches upward. Do not widen it in
  app code.
- Ingestion inserts must explicitly set `origin = 'import'` — the schema
  column default is `'manual'` (for hand/UI-created rows), so ingestion has to
  say so on every insert, not rely on the default.

Known incomplete pieces (see the plan history for why):
- t03 (PostGIS boundary import) is written but not run — needs `ogr2ogr`/GDAL
  installed locally.
- t05 (OpenStates state legislators) is written but not run — needs
  `OPENSTATES_API_KEY`, and is not yet idempotent on re-run (see the comment
  at the top of `ingestion/t05-officials/run.ts`).
- Firebase Auth is fully wired against env vars but has no real project
  behind it yet — see `.env` for the `FIREBASE_ADMIN_*` / `NEXT_PUBLIC_FIREBASE_*`
  placeholders that need real values from a Firebase console project.
- `/resolve` is pre-PostGIS: it approximates from the relation graph
  (`apps/api/src/lib/resolveApprox.ts`) via the Census geocoder + `county_fips`/
  `district_number` stashed in `jurisdictions.attributes` at t01. School
  districts are not resolved until t03 boundaries load.
