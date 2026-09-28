# Entity × Resource Availability Matrix

Companion to the README. For each entity type, it shows how commonly each
resource, channel, and capability is publicly available — the transparency
landscape — and it keeps that typical picture separate from what any individual
entity is observed to have.

## Entities

- **Jurisdiction** — a bounded area of authority. Holds the documents scoped to
  the whole area: code of laws, budget, capital projects.
- **Region** — a named area with no authority: River Towns, Sound Shore,
  Northern Westchester, and at city scale a neighborhood or district. A
  collection of member areas (jurisdictions, or smaller regions). Holds no
  resources of its own; it exists to anchor associations and to aggregate.
  `region` is the portable concept, and the locale pack supplies the label a
  resident sees ("Neighborhood" in a city, "Region" in the suburbs) — the same
  split that names `educational_region` "BOCES."
- **Governmental body** — a group that governs a jurisdiction (Governor's office, State Senate, County Legislature, City Council, Town Board,
  Planning Board, ZBA). Holds meetings, a Directory, its own procedures.
- **Association** — a nongovernmental group tied to a jurisdiction or region.
  `is_governmental = false`; anchored by an `associated_with` link rather than
  governing a place. Four subtypes: political party, volunteer association,
  advocacy group, informational group (media, online community).

## Association scope (v1)

The bound is communal purpose. A group is in scope when it takes an interest in
communal affairs or gives the public a way to engage. It is out of scope when it
exists to serve its own members' private interests.

Open membership is a signal of that purpose, not the rule itself. The three
standard exclusions are inward by purpose, and the membership gate is the
symptom:

- HOA — serves members' property
- Religious congregation — serves members' faith
- Trade / professional association — serves members' trade

Rotary shows why membership alone won't decide it: its membership is semi-gated,
but its purpose is communal, so it is in. LWV, political parties, advocacy
groups, and community Facebook groups are in on both counts.

For genuinely split cases — a church food bank, a trade group's public-policy
arm — scope the arm, not the parent. The outward-facing program models as its
own in-scope association even when the parent body is out, reusing the
body/committee split already in the schema.

## Availability legend

For each cell in the matrix:

- **⬤ Typically available** — usually there and public for this type.
- **⦾ Sometimes available** — varies across the type (media budgets, volunteer
  rosters). In the UI this is a half-filled circle; keep the meaning on the
  shape, not on color.
- **◯ Typically not available** — the resource applies and would be worth
  having, but it is usually missing. Every empty circle is an opportunity.
- **blank — Not applicable.** The resource does not apply to this type. No
  opportunity, no gap.

**Typing rules.** Two associations are constituted by a channel, so absence
means the entity is misclassified rather than that it has a gap. These are
enforced as typing rules:

- A **media** entity requires a broadcast channel.
- An **online community** entity requires a community channel.

For a jurisdiction, the parallel constituting fact is `has_active_government`.
That predicate gates whether rules, budget, and projects apply at all — with
active government they are scored, without it they are blank.

## The matrix

| Entity | Rules | Budget | Projects | Meetings | Directory | Broadcast | Community | General cap. | Gov cap. |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Jurisdiction          | ⬤ | ⬤ | ⦾ |    |    |    |    |    |    |
| Region                |    |   |    |    |    |    |    |    |    |
| Governmental body     | ⦾ |    | ⦾ | ⬤ | ⦾ | ⦾ |    | ⦾ | ⦾ |
| Advisory board        | ⦾ |    | ⦾ | ⬤ | ⦾ | ⦾ | ◯  | ⦾ |    |
| Party committee       | ◯ | ◯ | ◯ | ◯ | ◯ | ⦾ | ◯ | ◯ |    |
| Volunteer association | ⦾ | ⦾ | ⦾ | ◯ | ⦾ | ⬤ | ◯ | ◯ |    |
| Advocacy group        | ⦾ | ⦾ | ⬤ | ◯ | ⦾ | ⬤ | ◯ | ◯ |    |
| Media                 | ◯ | ⦾ |    |    | ⬤ | ⬤ | ◯ | ⦾ |    |
| Online community      | ⦾ |    |    |    | ⦾ | ◯ | ⬤ | ◯ |    |

Notes riding under the cells:

- **Rules** is the portable column for a governing text under many local names:
  code of laws for a jurisdiction, procedures or charter for a body, bylaws for
  an association, community guidelines for an online group, ownership and ethics
  disclosure for a media outlet. Every entity has one. Whether it is public is
  the recurring question, and for media it usually is not.
- **Budget** is jurisdiction-scoped for government, so a governmental body's own
  row is blank; the budget lives on the jurisdiction it governs. For media,
  budget is public for publicly funded outlets and private for the rest, which
  is why it reads as sometimes-available.
- **Projects** is the portable column for what an entity is actively
  undertaking, under local names — Capital Projects for a jurisdiction,
  Campaigns for an advocacy group, Initiatives or Programs for a board or
  volunteer group. It attaches by the same rule as budget: a capital project is
  scoped to the whole place and funded from the capital budget, so it sits on
  the jurisdiction; a board's or association's own effort sits on that body. It
  meets Budget at the capital budget but answers a different question — what is
  being built, not what is planned to be spent. It is the one resource whose
  items carry their own status (planned / active / complete / cancelled), and
  the one most likely to exist as a mappable dashboard, where the
  exposure-dashboard scorecard applies directly.
- **Meetings** collapses calendar, agenda, and minutes. Government meetings are
  usually posted (OML drives coverage); association meetings rarely are; media
  hold no public meetings.
- **Directory** is the published list of leaders or anyone else in an organization who would like to be contacted. It
  is distinct from the committees/boards index — the wayfinding page listing a
  body's sub-boards — which is a separate navigational artifact that can hang
  off either a jurisdiction or a body. For a governmental body it is ⦾ because
  prominent offices are well covered and small boards are patchy.
- **Community** on a governmental body is blank, not empty: a government running
  no member-to-member space is expected rather than a missed opportunity. Flip
  it to ◯ if participatory government is treated as an opportunity.
- **General cap. / Gov cap.** split the capability set (below). Every
  association is blank on Gov cap., because government-anchored capabilities flow
  from authority over residents that an association does not hold.
- **Media** and **online community** are the two channel kinds turned into
  standalone entities: media is a broadcast surface, an online community is a
  community surface.

The fills are first-pass estimates of the general landscape; crawl data will
sharpen them.

## Capabilities

The capability set is the govtech software a body runs, rolled up into the seven
`govCapabilities` categories. They split on one line: general capabilities are
the mechanics of being an organized group; government-anchored capabilities flow
from authority over residents — delivering services to them, and being held to
account for that authority.

**General** (government or association):

- **presence** — a findable web presence (website / CMS).
- **participation** — tools for people to engage: comment portals, surveys,
  forums, sign-ups.
- **proceedings** — meeting process: agendas, minutes, recording/streaming.
- **operations** — back office: finance, membership/HR, scheduling.

**Government-anchored** (authority over residents; associations are blank here):

- **services** — service delivery: permitting, 311/requests, licensing,
  benefits.
- **transparency** — public-disclosure infrastructure: open-data portals,
  records/FOIL systems.
- **oversight** — accountability regimes: audit, ethics, compliance/GRC.

Two edges to hold. A compliance/GRC tool sits under **operations** when it is
internal, and moves to **transparency** or **oversight** only when it produces
public-facing disclosure. And a large association may adopt transparency or
oversight tooling voluntarily; that is allowed, not expected, which is why the
matrix leaves Gov cap. blank for associations.

## Gaps

The empty circles are the opportunities, and they cluster into a handful of
patterns that come from both the data and what is already known about civil
society.

**The community-channel gap.** Volunteer groups, advocacy groups, and
government broadcast at residents; few run a real member-to-member space.
Community is empty across the associations, and the common observation is
broadcast public, community absent. A body that only announces has not built a
place for residents to talk to each other.

**The withheld-bylaws gap, and why it compounds.** Association rules are only
sometimes public, and a private rulebook does more damage than a single missing
file. It blocks assessment of everything the rules would let you check — whether
the group keeps membership open, whether it holds to a non-discrimination norm,
how it seats its leaders. Transparency of rules is the precondition for judging
conduct. The matrix records rules present but private as distinct from rules
absent.

**The party-Directory blank, and the whole party row.** A party committee is
constituted by its seats, and the Directory should be public, and it is the layer
no directory carries. The people on these committees decide ballot access and
fill vacancies. The party row is nearly all empty, which is the party-
transparency finding stated in glyphs.

**Present but undiscoverable.** An entity whose resources exist only behind its
own site — rules internal, a group you must be invited to, a budget available on
request — reads as absent to a resident even though it exists. Capital projects
are a common case: real spending on real assets, readable only as line items
inside a budget PDF, never surfaced as a followable or mapped record of what is
being built. Private and absent are different observations with different fixes.
Absent needs the thing created. Private needs it disclosed.

**Structural non-gaps.** A region holds no resources by design. A government
runs no member-to-member space. Media hold no public meetings. The blank cells
mark these so a real opportunity is not buried under structural blanks, and the
opportunity count stays honest.