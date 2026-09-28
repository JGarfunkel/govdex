# National Scale Estimate

Counts each state would contribute if every state got the same rollout as [[Rollout plan]] — Westchester and its subdivisions — extended nationwide. Companion to [data-dictionary.md](data-dictionary.md) (entity types) and [packages/db/schema.sql](packages/db/schema.sql) (actual tables).

**Counties / Municipalities / School Boards are exact figures** from the U.S. Census Bureau's 2022 Census of Governments, table `CG2200ORG02` ("Local Governments by Type and State"). Municipalities = municipal governments + town/township governments. School Boards = *independent* school district governments only — states that run schools as a dependent arm of city/county government (Virginia, North Carolina, Maryland, Hawaii, Alaska) show 0–1 here even though schools obviously exist there; that's a Census classification quirk, not a data gap.

Everything from **Est. Advisory Boards** onward is a planning estimate — the multipliers are called out below so they can be tuned.

| State | Counties | Municipalities | School Boards | Est. Advisory Boards | Est. Office Holders | Est. Total DB Rows |
|---|---:|---:|---:|---:|---:|---:|
| Alabama | 67 | 462 | 138 | 1,926 | 13,971 | 29,604 |
| Alaska | 15 | 149 | 0 | 537 | 3,714 | 7,875 |
| Arizona | 15 | 91 | 242 | 605 | 5,400 | 11,557 |
| Arkansas | 75 | 500 | 234 | 2,184 | 16,233 | 34,434 |
| California | 57 | 482 | 1,006 | 2,794 | 24,417 | 52,292 |
| Colorado | 62 | 272 | 180 | 1,368 | 10,290 | 21,756 |
| Connecticut | 0 | 179 | 17 | 554 | 3,963 | 8,497 |
| Delaware | 3 | 57 | 19 | 208 | 1,542 | 3,293 |
| Florida | 66 | 412 | 95 | 1,727 | 12,366 | 26,158 |
| Georgia | 152 | 537 | 180 | 2,703 | 19,365 | 40,701 |
| Hawaii | 3 | 1 | 0 | 21 | 138 | 279 |
| Idaho | 44 | 199 | 118 | 979 | 7,311 | 15,455 |
| Illinois | 102 | 2,720 | 890 | 9,662 | 71,778 | 153,496 |
| Indiana | 91 | 1,571 | 290 | 5,549 | 40,020 | 85,333 |
| Iowa | 99 | 940 | 342 | 3,756 | 27,705 | 58,914 |
| Kansas | 103 | 1,891 | 306 | 6,597 | 47,400 | 101,085 |
| Kentucky | 118 | 417 | 171 | 2,130 | 15,411 | 32,415 |
| Louisiana | 60 | 304 | 69 | 1,341 | 9,552 | 20,154 |
| Maine | 16 | 484 | 101 | 1,649 | 12,000 | 25,654 |
| Maryland | 23 | 157 | 0 | 609 | 4,194 | 8,859 |
| Massachusetts | 5 | 351 | 85 | 1,168 | 8,586 | 18,395 |
| Michigan | 83 | 1,773 | 567 | 6,384 | 47,274 | 101,001 |
| Minnesota | 87 | 2,633 | 330 | 8,751 | 62,646 | 133,851 |
| Mississippi | 82 | 298 | 150 | 1,536 | 11,256 | 23,706 |
| Missouri | 114 | 1,226 | 529 | 4,891 | 36,540 | 77,816 |
| Montana | 54 | 128 | 310 | 1,018 | 8,514 | 18,032 |
| Nebraska | 93 | 878 | 267 | 3,459 | 25,269 | 53,706 |
| Nevada | 16 | 19 | 17 | 170 | 1,227 | 2,545 |
| New Hampshire | 10 | 234 | 166 | 928 | 7,296 | 15,626 |
| New Jersey | 21 | 564 | 521 | 2,339 | 18,915 | 40,564 |
| New Mexico | 33 | 105 | 96 | 609 | 4,644 | 9,795 |
| New York | 57 | 1,525 | 676 | 5,593 | 42,360 | 90,647 |
| North Carolina | 100 | 552 | 0 | 2,256 | 15,492 | 32,640 |
| North Dakota | 53 | 1,661 | 173 | 5,474 | 39,024 | 83,377 |
| Ohio | 88 | 2,234 | 665 | 7,895 | 58,326 | 124,684 |
| Oklahoma | 77 | 592 | 539 | 2,777 | 21,903 | 46,660 |
| Oregon | 36 | 240 | 223 | 1,159 | 9,120 | 19,406 |
| Pennsylvania | 66 | 2,559 | 514 | 8,587 | 62,481 | 133,667 |
| Rhode Island | 0 | 39 | 4 | 121 | 867 | 1,859 |
| South Carolina | 46 | 271 | 78 | 1,167 | 8,421 | 17,811 |
| South Dakota | 66 | 1,207 | 149 | 4,166 | 29,709 | 63,337 |
| Tennessee | 92 | 345 | 14 | 1,601 | 11,001 | 23,065 |
| Texas | 254 | 1,225 | 1,070 | 6,269 | 48,471 | 102,757 |
| Utah | 29 | 254 | 41 | 977 | 6,957 | 14,758 |
| Vermont | 14 | 277 | 121 | 1,036 | 7,815 | 16,703 |
| Virginia | 95 | 228 | 1 | 1,255 | 8,505 | 17,696 |
| Washington | 39 | 281 | 295 | 1,372 | 10,962 | 23,357 |
| West Virginia | 55 | 231 | 55 | 1,078 | 7,656 | 16,115 |
| Wisconsin | 72 | 1,850 | 437 | 6,419 | 46,902 | 100,228 |
| Wyoming | 23 | 99 | 55 | 490 | 3,636 | 7,679 |
| District of Columbia | 0 | 1 | 0 | 3 | 21 | 45 |
| **U.S. Total** | **3,031** | **35,705** | **12,546** | **137,847** | **1,018,566** | **2,169,339** |

## Methodology for estimated columns

- **Advisory Boards** = 6 × counties + 3 × municipalities + 1 × school boards (planning board, ZBA, conservation commission, etc. — the "Advisory board" entity type split out in [data-dictionary.md](data-dictionary.md)).
- **Office Holders** = seats, not unique people (9/county, 6/municipality, 7/school board, 5/advisory board). Deliberately counts every seat, since a person on two boards holds two seats.
- **Est. Total DB Rows** (in the table above) is a rough planning number: jurisdictions + governmental bodies + advisory boards + office holders + a flat capability-adoption estimate. The section below replaces that flat estimate with one grounded in the actual schema.

## Row-size / storage estimate against the real schema

The "Est. Total DB Rows" column above used a placeholder capability-adoption model. The actual schema ([packages/db/schema.sql](packages/db/schema.sql)) splits things more finely — `seats` (durable positions) are distinct from `roles` (person-in-seat over time) and `officials` (the person), and `adoptions` is one row per body **actually observed** using a specific tracked product, not one row per capability slot regardless of use. Re-deriving national totals against those real tables, with fill-rate assumptions for the many nullable text/url columns each table carries:

| Table | Est. national rows | Est. bytes/row (data + row overhead) | Est. table size |
|---|---:|---:|---:|
| jurisdictions | 51,282 | ~220 | ~11 MB |
| bodies (governmental + advisory) | 189,129 | ~210 | ~38 MB |
| seats | 1,018,566 | ~150 | ~146 MB |
| roles (current occupancy) | ~950,000 | ~130 | ~118 MB |
| officials | ~950,000 | ~140 | ~127 MB |
| channels (2 kinds × body) | 378,258 | ~140 | ~51 MB |
| adoptions (~1.5/governmental body, ~0.3/advisory board) | ~118,000 | ~140 | ~16 MB |
| jurisdiction_identifiers (~3/jurisdiction) | ~150,000 | ~120 | ~17 MB |
| jurisdiction_relations (~1.5/jurisdiction) | ~77,000 | ~120 | ~9 MB |
| **Raw heap data, full national scale** | **~3.9M rows** | | **~530 MB** |
| + indexes (PK + FK btrees, ~55% of heap) | | | **~290 MB** |
| **Total** | | | **~820 MB** |

Even doubling that for safety margin — more fill-rate on optional fields than assumed, multiple governmental bodies per jurisdiction, several election cycles of `roles` history piling up — lands at **2–4 GB** for the entity/roster layer, fully built out across all 50 states. That's trivial for a single Postgres instance; no sharding, no read-replica-for-scale need. A single small managed instance (a few GB RAM) handles this with enormous headroom.

**The real wildcard isn't this layer.** Three tables scale with *activity*, not with jurisdiction count, and aren't reflected above:
- `revisions` — append-only edit history, one row per field change with a full `jsonb` diff. Grows with scribe activity, not entity count, and never gets pruned by design.
- `candidate_links` / `crawl_jobs` — spider staging. Every crawled page can produce a `candidate_links` row; running the spider broadly across thousands of jurisdiction sites could dwarf the roster tables above.
- `frictions` — smaller, similar shape.

None of those change the "single Postgres is fine" answer — Postgres handles multi-TB single-node databases routinely — but they're the tables to watch if storage ever becomes a real conversation, not `jurisdictions`/`bodies`/`seats`.
