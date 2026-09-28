# Sheet column guide

This is the source spreadsheet for the transparency scorecard (one tab, one
row per `domain` × `metric` × `scope`). The app fetches it as CSV
([lib/csv-source.ts](lib/csv-source.ts)) and parses it with
[lib/parse-rows.ts](lib/parse-rows.ts) — column headers must match exactly
(lowercase, underscores). A column left blank on a row is fine; the app
treats blank as "not yet evaluated," not "no."

Column order in the current tab:

```
domain, metric, scope,
exists, dataset_url, dashboard_url, dashboard_name, visibility,
provider, source,
format, has_map, has_trend, has_search,
granularity, range, cadence, lag, legal_basis, notes,
tune, who_can_tune
```

## Identity columns

**`domain`** — Category grouping, e.g. `Transportation`, `Education`. Free
text, but reuse an existing value exactly (case-sensitive match to group
rows together) rather than inventing a near-duplicate.

**`metric`** — The specific thing being measured, e.g. `Traffic crash
locations`. City and state rows for the same metric must have this string
match exactly — it's the join key that pairs them for relation scoring
([lib/grading/build-domains.ts](lib/grading/build-domains.ts)).

**`scope`** — `New York City` or `New York State` (`nyc`, `city`, `nys`,
`state` also accepted, case-insensitive). One row per scope per metric.

## Does the data exist and get released?

**`exists`** — One of:
| value | meaning |
|---|---|
| `published` | Released and available now |
| `partial` | Released, but incomplete (missing fields, partial coverage, etc.) |
| `not_found` | Looked and couldn't find it — flag for follow-up, don't assume it doesn't exist. Counts as "not collected" until someone confirms otherwise |
| `higher_level` | Not collected *here* because the state collects it instead — expected division of labor, not a gap. City rows only (see caveat below) |
| `no_mandate` | Not collected by either jurisdiction — no legal requirement to, a genuine gap |
| `n/a` | Legacy/generic "not collected" — reason unspecified. Still parses, but prefer `higher_level` or `no_mandate` on any row you touch |
| *(blank)* | Not yet researched |

Anything else typed here is silently dropped to blank, so stick to these
tokens — though spacing/punctuation is forgiving: `higher level`,
`higher-level`, and `higher_level` all parse the same way (spaces and
hyphens are treated as underscores). `higher_level`, `no_mandate`, and
`not_found` all score identically (all count as "not collected" for
relation/adequacy purposes) — the split is for legibility, so a reader isn't
left wondering whether a `not_collected` row is an intentional jurisdictional
split, an actual accountability gap, or just an unconfirmed lookup.

`not_found` replaces the old `verify` value — `verify` still parses (mapped
automatically to `not_found`) so existing sheet cells keep working, but type
`not_found` going forward. Note the scoring changed along with the rename:
`verify` used to count as "collected" (provisional credit); `not_found`
counts as "not collected" instead, since the label now says the search came
up empty rather than "probably there."

`higher_level` is directional — it means "the state has this," so it only
makes sense on a **City** row. There's no equivalent value yet for a State
row deferring to a city-only dataset (e.g. something inherently local); that
would need a different token if/when it comes up — don't reuse
`higher_level` for it.

**`dataset_url`** — Link to the raw data (API endpoint, CSV/download page,
Socrata dataset, etc.). Leave blank if there's no direct dataset link.

**`dashboard_url`** — Link to an interactive presentation of the data (a
built dashboard/viewer), separate from the raw dataset link. Leave blank if
there's no dashboard, even if `dataset_url` is filled in — that's the normal
"data but no dashboard" case.

**`dashboard_name`** — Display name for the dashboard link, e.g. `Vision
Zero View`. Only meaningful if `dashboard_url` is set.

**`visibility`** — Who can actually reach the published data. One of:
| value | meaning |
|---|---|
| `public` | Anyone can view it, no login | 
| `restricted` | Requires a login — e.g. NYSDOT's crash dashboard, visible only to employees/contractors, not the public |
| `internal` | Not released outside the agency at all (rare — usually this means `exists` should be `partial` or `n/a` instead; use `internal` only when you've confirmed it exists and is deliberately withheld) |
| *(blank)* | Assume public — most rows are, don't bother filling this in unless it's restricted or internal |

Only fill this in for the *non-default* case (`restricted` or `internal`).
Leaving it blank on an otherwise-published public dataset is correct and
expected.

## Who publishes it

**`provider`** — `gov` for a government agency, `NGO` for a third-party
republisher (shows an "NGO" badge in the UI). Leave blank if unknown.

**`source`** — Free text naming the actual agency/system, e.g. `NYPD Motor
Vehicle Collisions (Vision Zero)`.

## What form it comes in

**`format`** — Delivery/structure tags only — *not* a place to note map,
trend, or search capability anymore (see `has_map`/`has_trend`/`has_search`
below). Use one or more of, comma- or slash-separated:
- `api` — queryable API (Socrata, ArcGIS REST, custom REST, etc.)
- `csv` — bulk CSV/Excel-style download
- `excel` — Excel-only download (no CSV)
- `pdf` — PDF report only (locked/unstructured — the least reusable form)
- `dashboard-only` — no downloadable file at all, only viewable in a
  dashboard

Don't assume `api` implies `csv` or vice versa — tag both only when both are
actually true. Some APIs (custom agency REST endpoints, ArcGIS feature
servers) have no bulk export; some datasets are CSV-only with no query API.
They're independent facts about the same source.

A `pdf`-only, `has_map: no`, `has_trend: no` row is a legitimate, common
combination — it just means a static report is the ceiling for that source.
There's no separate "PDF is the highest tier" column; `format` + `has_map` +
`has_trend` together already say that.

**`has_map`** — `yes`/`y`/`true`/`1`/`x` if the dashboard includes a
geographic/map view. Anything else (including blank) is treated as no. Only
fill this in when `dashboard_url` is also set — a map flag on a row with no
dashboard link is ignored by the app.

**`has_trend`** — Same rule, for a time-series/trend-chart view.

**`has_search`** — Same rule, for a name/case-number/address lookup —
distinct from `has_map`. Don't assume one implies the other: a map can be
browse-only with no name search, and a search tool (e.g. case-number lookup)
can have no map at all. Only mark `yes` if you can actually type something
in and get a specific record back, not just filter/sort a visible table.

## Quality signals

**`granularity`** — Free text describing the resolution of records, e.g.
`incident level`, `precinct`, `statewide`. The app keyword-matches this into
point vs. area resolution — see `POINT_GRANULARITY_KEYWORDS` /
`AREA_GRANULARITY_KEYWORDS` in
[lib/grading/assess.ts](lib/grading/assess.ts) if you want to check whether
a phrase you're using will be picked up.

**`range`** — Time span covered, e.g. `2013–present`. Currently
display-only, not parsed into an assessment.

**`cadence`** — How often the data is updated, e.g. `daily`, `monthly`,
`annual`, `quarterly`.

**`lag`** — How stale the most recent data is, e.g. `6 weeks`, `12+
months`, `short`. This (falling back to `cadence` if blank) drives the
current/lagging timeliness glyph — see `CURRENT_TIMELINESS_KEYWORDS` /
`LAGGING_TIMELINESS_KEYWORDS` in
[lib/grading/assess.ts](lib/grading/assess.ts).

**`legal_basis`** — Statute or local law requiring publication, e.g. `Local
Law 11 (2012)`, `statutory (Dignity for All Students Act)`. Blank if
publication is voluntary/no known legal mandate.

**`notes`** — Free text for anything not captured elsewhere. Shows up
nowhere structured yet, but is read by people reviewing the sheet.

## Recommendation columns

**`tune`** — The specific fix/ask for closing a gap, e.g. `Publish
incident-level crash data as an open feed matching the city`.

**`who_can_tune`** — Who has the authority to make that change, e.g.
`NYSDOT / DMV; Legislature (ease DMV restriction) [verify]`. Use `[verify]`
inline (free text, unrelated to the `exists` column) for anything you're not
sure of yet.

## Migrating existing rows

Existing rows have map/trend/search information buried in `format` (e.g.
`"API/CSV + map"`, `"dashboard + API/CSV"`, `"API/CSV / Search"`,
`"tables / PDF"`). When you touch a row:
1. Pull any map/trend/search mention out into `has_map` / `has_trend` /
   `has_search`.
2. Reduce `format` to just the delivery tags (`api`, `csv`, `excel`, `pdf`,
   `dashboard-only`).
3. Set `visibility` only if it's not plain public.
4. If `exists` is bare `n/a`, replace it with `higher_level` or
   `no_mandate`, whichever actually applies.
5. If `exists` is `verify`, retype it as `not_found` — it still parses as-is,
   but now scores as "not collected" instead of "collected," so a row you
   meant as provisional credit will read differently until relabeled and,
   ideally, actually confirmed one way or the other.

Until a row is migrated, `has_map`/`has_trend`/`has_search` read as blank
(no), so those glyphs will go dark even though the old `format` text still
describes a map, chart, or search tool — that's expected during the
transition, not a bug.
