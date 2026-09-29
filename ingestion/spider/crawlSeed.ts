import type { getPool } from "@govdex/db";
import { politeFetch, politeFetchWithType } from "./fetcher";
import { runCascade, findHubLink, findBoardsHubLink, findGovHubLink, fetchHiddenSubmenuPage } from "./cascade";
import { classifyLink, isMunicipalSocialProfile, handleNamesJurisdiction, extractAccountName } from "./classifier";
import { classifyVendor } from "./vendorClassifier";
import { guessBoard, boardSlugScore } from "./boardDetector";
import { guessAgendaMatch, normalize as normalizeBodyName } from "./agendaDetector";
import { isAffiliatedVendorHost } from "./affiliation";
import { looksLikeCalendarLink, canonicalizeCalendarLink, guessLegistarCalendarUrl } from "./calendarDetector";
import { looksLikeAlertLink } from "./alertDetector";
import { looksLikeBudgetLink, verifyBudgetPage } from "./budgetDetector";
import { hostnameIsDotCom } from "./tldDetector";
import { normalizeUrl, ensureProtocol, sameHost } from "./urlMatch";
import { isBlacklisted } from "./blacklist";

const MAX_PAGES_PER_SEED = 40; // politeness cap on recursive board-hub crawling

interface PageEntry {
  url: string;
  html: string;
  depth: number;
  // True for the "Boards & Committees" hub page itself — the one page where
  // a board-shaped link that's ONLY found inside a nav-like container (see
  // cascade.ts's isInNavLikeContainer) is worth flagging as the
  // 'index_in_menu_not_page' friction, rather than just a discoverability
  // curiosity.
  isBoardsHub?: boolean;
}

// Records that the boards hub page doesn't actually list some of the
// jurisdiction's boards/committees itself — they're only reachable via the
// site's persistent nav menu (a CivicPlus-style accordion sidebar repeating
// on every page, commonly). Same machine-proposes/human-triages shape as
// candidate_links — see schema.sql's frictions comment.
async function recordIndexInMenuFriction(
  pool: ReturnType<typeof getPool>,
  jurisdictionId: string | null,
  sourceBodyId: string | null,
  crawlJobId: string | null,
  pageUrl: string,
  navOnlyNames: string[],
): Promise<void> {
  if (!jurisdictionId || navOnlyNames.length === 0) return; // no jurisdiction to attach the finding to
  const summary = `${navOnlyNames.length} board/committee link(s) found only in the site's nav menu, not listed on the boards & committees page itself`;
  try {
    await pool.query(
      `insert into frictions
         (jurisdiction_id, body_id, crawl_job_id, pattern_type, page_url, summary, detail)
       values ($1, $2, $3, 'index_in_menu_not_page', $4, $5, $6)
       on conflict (jurisdiction_id, pattern_type, page_url) do nothing`,
      [jurisdictionId, sourceBodyId, crawlJobId, pageUrl, summary, navOnlyNames.join(", ")],
    );
    console.log(`    ! friction (index_in_menu_not_page): ${navOnlyNames.length} board(s) menu-only — ${navOnlyNames.join(", ")}`);
  } catch (err) {
    console.warn(`  failed to record index-in-menu finding for ${pageUrl}: ${err instanceof Error ? err.message : err}`);
  }
}

// Records a jurisdiction's budget as published only as a PDF document rather
// than an HTML permalink page a resident can bookmark/read in a browser —
// see verifyBudgetPage. Not a rejection: the candidate_links row is still
// written, a PDF budget is better than none.
async function recordBudgetPdfFriction(
  pool: ReturnType<typeof getPool>,
  jurisdictionId: string | null,
  sourceBodyId: string | null,
  crawlJobId: string | null,
  pageUrl: string,
): Promise<void> {
  if (!jurisdictionId) return;
  try {
    await pool.query(
      `insert into frictions
         (jurisdiction_id, body_id, crawl_job_id, pattern_type, page_url, summary)
       values ($1, $2, $3, 'budget_only_pdf', $4, $5)
       on conflict (jurisdiction_id, pattern_type, page_url) do nothing`,
      [jurisdictionId, sourceBodyId, crawlJobId, pageUrl, `Budget is only published as a PDF (${pageUrl}), not an HTML permalink page`],
    );
    console.log(`    ! friction (budget_only_pdf): ${pageUrl}`);
  } catch (err) {
    console.warn(`  failed to record budget-PDF finding for ${pageUrl}: ${err instanceof Error ? err.message : err}`);
  }
}

// Records the jurisdiction's own seed website as being on a .com domain —
// see tldDetector.ts. Checked once per crawl against seedUrl itself, not
// every link found while crawling it.
async function recordComTldFriction(
  pool: ReturnType<typeof getPool>,
  jurisdictionId: string | null,
  sourceBodyId: string | null,
  crawlJobId: string | null,
  seedUrl: string,
): Promise<void> {
  if (!jurisdictionId) return;
  try {
    await pool.query(
      `insert into frictions
         (jurisdiction_id, body_id, crawl_job_id, pattern_type, page_url, summary)
       values ($1, $2, $3, 'website_com_tld', $4, $5)
       on conflict (jurisdiction_id, pattern_type, page_url) do nothing`,
      [jurisdictionId, sourceBodyId, crawlJobId, seedUrl, `Government website ${seedUrl} uses a .com domain`],
    );
    console.log(`    ! friction (website_com_tld): ${seedUrl}`);
  } catch (err) {
    console.warn(`  failed to record .com TLD finding for ${seedUrl}: ${err instanceof Error ? err.message : err}`);
  }
}

interface CandidateRow {
  jurisdictionId: string | null;
  sourceBodyId: string | null;
  crawlJobId: string | null;
  foundOnUrl: string;
  targetUrl: string;
  linkType: "channel" | "board" | "district" | "calendar" | "vendor" | "index" | "agenda" | "minutes" | "agenda_minutes" | "budget";
  title?: string | null;
  guessedPlatform?: string | null;
  guessedKind?: string | null;
  guessedBodyName?: string | null;
  guessedJurisdictionName?: string | null;
  guessedVendor?: string | null;
  guessedFunction?: string | null;
  guessedTargetBodyId?: string | null;
  // Defaults to 'new'. reconcileChannel sets 'duplicate' for a channel link
  // a jurisdiction already has a better (named) one for on that platform,
  // so it's recorded without adding another 'new' item to triage.
  status?: "new" | "duplicate";
}

// Inserts one candidate_links row, reporting whether it was actually new
// (vs. the on-conflict no-op for an already-known target_url) so callers can
// count real discoveries, not just insert attempts.
async function insertCandidate(pool: ReturnType<typeof getPool>, row: CandidateRow): Promise<boolean> {
  const { rows } = await pool.query(
    `insert into candidate_links
       (jurisdiction_id, source_body_id, crawl_job_id, found_on_url, target_url, link_type, title,
        guessed_platform, guessed_kind, guessed_body_name, guessed_jurisdiction_name,
        guessed_vendor, guessed_function, guessed_target_body_id, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     on conflict (jurisdiction_id, target_url) do nothing
     returning id`,
    [
      row.jurisdictionId,
      row.sourceBodyId,
      row.crawlJobId,
      row.foundOnUrl,
      row.targetUrl,
      row.linkType,
      row.title ?? null,
      row.guessedPlatform ?? null,
      row.guessedKind ?? null,
      row.guessedBodyName ?? null,
      row.guessedJurisdictionName ?? null,
      row.guessedVendor ?? null,
      row.guessedFunction ?? null,
      row.guessedTargetBodyId ?? null,
      row.status ?? "new",
    ],
  );
  return rows.length > 0;
}

// A jurisdiction's site commonly links the same social channel more than
// once on the same crawl, on any platform — a footer icon pointing at an
// opaque "/channel/UC..." ID, a header link to "/@VillageOfArdsley"; a
// numeric-ID Facebook page badge alongside a "facebook.com/VillageOfX" link
// — both pass isMunicipalSocialProfile, since the opaque one has no handle
// to reject, but they're the same channel and shouldn't both need a
// scribe's triage. Decides the status the newly-found link should be
// inserted with: 'new' if it should become (or stay) the one candidate for
// this (jurisdiction, platform) pair, 'duplicate' if an existing row
// already covers it. Never demotes a status='promoted' row — that's
// already a human's decision, not the spider's to revisit.
async function reconcileChannel(
  pool: ReturnType<typeof getPool>,
  jurisdictionId: string | null,
  targetUrl: string,
  jurisdictionName: string | null,
  platform: string,
): Promise<"new" | "duplicate"> {
  if (!jurisdictionId) return "new";
  const { rows } = await pool.query<{ target_url: string; status: string }>(
    `select target_url, status from candidate_links
       where jurisdiction_id = $1 and link_type = 'channel' and guessed_platform = $2
         and status <> 'rejected' and target_url <> $3`,
    [jurisdictionId, platform, targetUrl],
  );
  if (rows.length === 0) return "new";
  if (rows.some((r) => r.status === "promoted")) return "duplicate";
  if (rows.some((r) => r.status === "new" && handleNamesJurisdiction(r.target_url, jurisdictionName))) return "duplicate";
  if (!handleNamesJurisdiction(targetUrl, jurisdictionName)) return "duplicate"; // no better than what's already there

  // This link names the jurisdiction and the existing 'new' row(s) don't —
  // supersede them so the named link is the one a scribe sees.
  await pool.query(
    `update candidate_links set status = 'duplicate'
       where jurisdiction_id = $1 and link_type = 'channel' and guessed_platform = $2 and status = 'new'`,
    [jurisdictionId, platform],
  );
  return "new";
}

// A jurisdiction's site commonly links the same vendor more than once on the
// same crawl (a "powered by Revize" footer badge, a login link, a separate
// admin portal link — different target_urls, same product) — one candidate
// per (jurisdiction, vendor) is enough for a scribe to triage, same reasoning
// as reconcileChannel above. Never demotes a status='promoted' row.
async function reconcileVendor(
  pool: ReturnType<typeof getPool>,
  jurisdictionId: string | null,
  targetUrl: string,
  vendor: string,
): Promise<"new" | "duplicate"> {
  if (!jurisdictionId) return "new";
  const { rows } = await pool.query<{ status: string }>(
    `select status from candidate_links
       where jurisdiction_id = $1 and link_type = 'vendor' and guessed_vendor = $2
         and status <> 'rejected' and target_url <> $3`,
    [jurisdictionId, vendor, targetUrl],
  );
  return rows.length === 0 ? "new" : "duplicate";
}

// A jurisdiction's site commonly links its budget page/document more than
// once (a homepage highlight, a finance-department subpage, a footer
// "quick links" list) — one candidate per jurisdiction is enough for a
// scribe to triage, same reasoning as reconcileVendor above. Never demotes
// a status='promoted' row.
async function reconcileBudget(
  pool: ReturnType<typeof getPool>,
  jurisdictionId: string | null,
  targetUrl: string,
): Promise<"new" | "duplicate"> {
  if (!jurisdictionId) return "new";
  const { rows } = await pool.query<{ status: string }>(
    `select status from candidate_links
       where jurisdiction_id = $1 and link_type = 'budget'
         and status <> 'rejected' and target_url <> $2`,
    [jurisdictionId, targetUrl],
  );
  return rows.length === 0 ? "new" : "duplicate";
}

// A jurisdiction's site commonly links the same board twice (a nav item and a
// page-body link, say) under different URLs, e.g. "/203/Planning-Board" vs
// "/DocumentCenter/..." or an opaque "/page.aspx?id=7". The link whose URL
// slug best matches the board's name tokens (boardSlugScore) is the one
// candidate a scribe should see; ties keep whichever is already there.
// Never demotes a status='promoted' row.
async function reconcileBoard(
  pool: ReturnType<typeof getPool>,
  jurisdictionId: string | null,
  targetUrl: string,
  bodyName: string,
): Promise<"new" | "duplicate"> {
  if (!jurisdictionId) return "new";
  const { rows } = await pool.query<{ id: string; target_url: string; status: string; guessed_body_name: string | null }>(
    `select id, target_url, status, guessed_body_name from candidate_links
       where jurisdiction_id = $1 and link_type = 'board'
         and status <> 'rejected' and status <> 'duplicate' and target_url <> $2`,
    [jurisdictionId, targetUrl],
  );
  const wanted = normalizeBodyName(bodyName);
  const same = rows.filter((r) => r.guessed_body_name != null && normalizeBodyName(r.guessed_body_name) === wanted);
  if (same.length === 0) return "new";
  if (same.some((r) => r.status === "promoted")) return "duplicate";

  const myScore = boardSlugScore(bodyName, targetUrl);
  const bestExisting = Math.max(...same.map((r) => boardSlugScore(bodyName, r.target_url)));
  if (myScore <= bestExisting) return "duplicate";

  await pool.query(`update candidate_links set status = 'duplicate' where id = any($1::uuid[]) and status = 'new'`, [
    same.map((r) => r.id),
  ]);
  return "new";
}

// A jurisdiction's boards/committees directory is commonly linked more than
// once too — the dedicated hub found by findBoardsHubLink plus a nav item or
// footer link with slightly different anchor text ("Boards & Committees" vs
// "Boards and Commissions"), each a different target_url. One directory
// candidate per jurisdiction is enough for a scribe to triage; the link whose
// URL slug best matches its own title (boardSlugScore) wins, ties keep the
// existing row. Never demotes a status='promoted' row.
async function reconcileIndex(
  pool: ReturnType<typeof getPool>,
  jurisdictionId: string | null,
  targetUrl: string,
  title: string | null,
): Promise<"new" | "duplicate"> {
  if (!jurisdictionId) return "new";
  const { rows } = await pool.query<{ id: string; target_url: string; status: string; title: string | null }>(
    `select id, target_url, status, title from candidate_links
       where jurisdiction_id = $1 and link_type = 'index'
         and status <> 'rejected' and status <> 'duplicate' and target_url <> $2`,
    [jurisdictionId, targetUrl],
  );
  if (rows.length === 0) return "new";
  if (rows.some((r) => r.status === "promoted")) return "duplicate";

  const myScore = title ? boardSlugScore(title, targetUrl) : 0;
  const bestExisting = Math.max(...rows.map((r) => (r.title ? boardSlugScore(r.title, r.target_url) : 0)));
  if (myScore <= bestExisting) return "duplicate";

  await pool.query(`update candidate_links set status = 'duplicate' where id = any($1::uuid[]) and status = 'new'`, [
    rows.map((r) => r.id),
  ]);
  return "new";
}

// A jurisdiction's meeting/events calendar is commonly linked more than once
// under different URL shapes (a Legistar calendar and a plain "/calendar/"
// page, say) — canonicalizeCalendarLink only collapses variants of the *same*
// URL, so without this, two genuinely different calendar URLs would each
// land as their own 'new' candidate. One candidate per jurisdiction is enough
// for a scribe to triage, same reasoning as reconcileBudget/reconcileVendor
// above. Never demotes a status='promoted' row.
async function reconcileCalendar(
  pool: ReturnType<typeof getPool>,
  jurisdictionId: string | null,
  targetUrl: string,
): Promise<"new" | "duplicate"> {
  if (!jurisdictionId) return "new";
  const { rows } = await pool.query<{ status: string }>(
    `select status from candidate_links
       where jurisdiction_id = $1 and link_type = 'calendar'
         and status <> 'rejected' and target_url <> $2`,
    [jurisdictionId, targetUrl],
  );
  return rows.length === 0 ? "new" : "duplicate";
}

// Confirms and proposes the guessed $HOST/Calendar.aspx for a Legistar link
// found elsewhere on the site (almost always recognized as a vendor link,
// not a calendar one — see guessLegistarCalendarUrl). A guess alone isn't
// enough to propose: Calendar.aspx could 404 on an instance that only
// publishes agendas/minutes, so it's fetched and only written up if it
// actually resolves to an HTML page. checkedHosts caps this at one probe per
// Legistar host per crawl, no matter how many links into that host are found.
async function checkLegistarCalendar(
  pool: ReturnType<typeof getPool>,
  jurisdictionId: string | null,
  sourceBodyId: string | null,
  crawlJobId: string | null,
  foundOnUrl: string,
  legistarUrl: string,
  checkedHosts: Set<string>,
): Promise<boolean> {
  const guessedUrl = guessLegistarCalendarUrl(legistarUrl);
  if (!guessedUrl || checkedHosts.has(guessedUrl)) return false;
  checkedHosts.add(guessedUrl);

  const { html } = await politeFetchWithType(guessedUrl, { jurisdictionId, sourceBodyId, crawlJobId });
  if (!html) return false; // non-200 or non-HTML response — the guess didn't pan out

  const targetUrl = canonicalizeCalendarLink(guessedUrl);
  const status = await reconcileCalendar(pool, jurisdictionId, targetUrl);
  const inserted = await insertCandidate(pool, {
    jurisdictionId,
    sourceBodyId,
    crawlJobId,
    foundOnUrl,
    targetUrl,
    linkType: "calendar",
    title: "Meeting Calendar",
    status,
  });
  if (inserted) console.log(`    + calendar (guessed from Legistar link, confirmed 200) — ${targetUrl}`);
  return inserted;
}

// The cascade wrapped in a fetch-and-traverse loop: seed page, then at most
// one hop each to a "Connect"/"Get Involved" hub (channels) and a "Boards &
// Committees" hub (candidate bodies), recursing into board-shaped hits up to
// recurseDepth. Shared by ingestion/spider/run.ts's CLI (crawlJobId=null)
// and worker.ts's queue consumer (crawlJobId set, so discovered rows trace
// back to the job that found them).
//
// Never writes channel status='absent' — see candidate_links' comment in
// schema.sql. The spider only proposes; promotion is a human action.
export async function crawlSeed(
  pool: ReturnType<typeof getPool>,
  jurisdictionId: string | null,
  jurisdictionName: string | null,
  sourceBodyId: string | null,
  seedUrl: string,
  recurseDepth: number,
  crawlJobId: string | null = null,
): Promise<number> {
  // Normalize before anything else uses seedUrl as a fetch target, a
  // resolution base for relative hrefs, or a stored found_on_url — see
  // ensureProtocol's comment in urlMatch.ts.
  seedUrl = ensureProtocol(seedUrl);
  console.log(`  crawling ${seedUrl}`);
  console.log(
    `  looking for: boards/committees/districts, social & newsletter channels, GovTech vendor software, meeting/agenda calendar links, known bodies' agenda/minutes pages, a jurisdiction budget page`,
  );
  if (hostnameIsDotCom(seedUrl)) await recordComTldFriction(pool, jurisdictionId, sourceBodyId, crawlJobId, seedUrl);
  const meta = { jurisdictionId, sourceBodyId, crawlJobId };
  // Politeness/archival-scope boundary: never fetch (and so never cache)
  // content that isn't this jurisdiction's own site — a linked Facebook
  // page, an unrelated Legistar/BoardDocs tenant, a "Connect" hub that turns
  // out to point off-site, etc. are someone else's server and someone
  // else's content, not ours to download. The one carve-out is a GovTech
  // vendor host that already names this jurisdiction (isAffiliatedVendorHost
  // — e.g. a Granicus subdomain), since that's still effectively the
  // jurisdiction's own presence, just hosted elsewhere. checkLegistarCalendar
  // below has its own separate, deliberate off-host probe and isn't gated by
  // this at all.
  const isAllowedFetchHost = (url: string): boolean =>
    sameHost(url, seedUrl) || (!!jurisdictionName && isAffiliatedVendorHost(url, jurisdictionName));
  // Loaded once per crawl so agendaDetector.ts can match "X Committee
  // Meeting Minutes"-shaped anchor text against a body that already exists,
  // rather than every hit re-querying it.
  const knownBodies = jurisdictionId
    ? (await pool.query<{ id: string; name: string }>(`select id, name from bodies where jurisdiction_id = $1`, [jurisdictionId])).rows
    : [];
  // This jurisdiction's local type label ("Village", "Town", "City",
  // "County", "State") — lets guessBoard() recognize "<name> Board of X" /
  // "<name> <type> Board of X" / "<type> of <name> Board of X" as the same
  // body a prefix-free "Board of X" anchor would name. coalesce(cp.local_name,
  // tc.code) mirrors t06-slugs/run.ts's fallback for a concept with no
  // profile-specific label.
  const jurisdictionType = jurisdictionId
    ? ((
        await pool.query<{ local_name: string | null }>(
          `select coalesce(cp.local_name, tc.code) as local_name
             from jurisdictions j
             join type_concepts tc on tc.id = j.concept_id
             left join concept_profiles cp on cp.profile_id = j.profile_id and cp.concept_id = j.concept_id
            where j.id = $1`,
          [jurisdictionId],
        )
      ).rows[0]?.local_name ?? null)
    : null;
  // Channel URLs this jurisdiction's bodies already have on record (any
  // status — even 'unverified' means a human already entered it) — a hit
  // matching one of these is already registered, not a new find, so it
  // shouldn't clutter the scribe's triage queue. Loaded once per crawl like
  // knownBodies above.
  const knownChannelUrls = jurisdictionId
    ? new Set(
        (
          await pool.query<{ url: string }>(
            `select c.url from channels c join bodies b on b.id = c.body_id where b.jurisdiction_id = $1 and c.url is not null`,
            [jurisdictionId],
          )
        ).rows.map((r) => normalizeUrl(r.url)),
      )
    : new Set<string>();
  // isSeedPage: true — this is the jurisdiction's own prime seed page, the
  // one fetch on this run whose bot-management block is severe enough to
  // surface at the jurisdiction level (see fetcher.ts's
  // recordBotProtectionFinding). Every other politeFetch/politeFetchWithType
  // call below uses the plain `meta`, so a block on a hub/sub-page/vendor
  // host is recorded as the lesser crawler_blocked_secondary finding.
  const html = await politeFetch(seedUrl, { ...meta, isSeedPage: true });
  if (!html) {
    console.warn(`  no page fetched for ${seedUrl}`);
    return 0;
  }
  // A real municipal homepage is rarely under ~1KB — a tiny body usually means
  // a placeholder/stub file, a JS-only shell, or an interstitial rather than
  // actual page content, which explains a 0-candidate run with no other
  // warnings logged above.
  if (html.length < 1000) {
    console.warn(`  fetched only ${html.length} byte(s) from ${seedUrl} — looks like a stub/placeholder page, not the real site`);
  }

  const pages: PageEntry[] = [{ url: seedUrl, html, depth: 0 }];
  const fetchedUrls = new Set([seedUrl]);
  // One Calendar.aspx probe per Legistar host per crawl — see
  // checkLegistarCalendar.
  const legistarCalendarHostsChecked = new Set<string>();

  const hiddenSubmenu = await fetchHiddenSubmenuPage(seedUrl, html);
  if (hiddenSubmenu) {
    console.log(`  found CivicPlus hidden-submenu endpoint: ${hiddenSubmenu.url}`);
    pages.push({ url: hiddenSubmenu.url, html: hiddenSubmenu.html, depth: 0 });
    fetchedUrls.add(hiddenSubmenu.url);
  }

  // A "Connect"/"social" nav item as often points at a CivicPlus "Notify
  // Me"/CivicAlerts sign-up page as at an actual social/newsletter hub —
  // findHubLink only matches on anchor text, so the href itself still needs
  // this check before it's trusted (and fetched) as a hub link.
  const hub = ((): string | null => {
    const found = findHubLink(seedUrl, html);
    return found && !looksLikeAlertLink(found) ? found : null;
  })();
  console.log(hub ? `  found "connect"/"get involved" hub link: ${hub}` : `  no "connect"/"get involved" hub link found on ${seedUrl}`);
  if (hub && !fetchedUrls.has(hub)) {
    if (!isAllowedFetchHost(hub)) {
      console.log(`  hub link is off this site's host, not fetching: ${hub}`);
    } else {
      const hubHtml = await politeFetch(hub, meta);
      if (hubHtml) {
        pages.push({ url: hub, html: hubHtml, depth: 0 });
        fetchedUrls.add(hub);
      } else {
        console.warn(`  hub link found but failed to fetch: ${hub}`);
      }
    }
  }

  let boardsHub = findBoardsHubLink(seedUrl, html);
  if (boardsHub && looksLikeAlertLink(boardsHub)) boardsHub = null;
  let boardsHubFoundOn = seedUrl;
  if (boardsHub) {
    console.log(`  found "boards & committees" hub link: ${boardsHub}`);
  } else {
    console.log(`  no "boards & committees" hub link found on ${seedUrl} — trying a "Government" hub as a detour`);
    let govHub = findGovHubLink(seedUrl, html);
    if (govHub && looksLikeAlertLink(govHub)) govHub = null;
    if (govHub && !fetchedUrls.has(govHub) && !isAllowedFetchHost(govHub)) {
      console.log(`  "government" hub link is off this site's host, not fetching: ${govHub}`);
    } else if (govHub && !fetchedUrls.has(govHub)) {
      const govHtml = await politeFetch(govHub, meta);
      if (govHtml) {
        pages.push({ url: govHub, html: govHtml, depth: 0 });
        fetchedUrls.add(govHub);
        boardsHub = findBoardsHubLink(govHub, govHtml);
        if (boardsHub && looksLikeAlertLink(boardsHub)) boardsHub = null;
        boardsHubFoundOn = govHub;
        console.log(
          boardsHub
            ? `  found "boards & committees" hub link via ${govHub}: ${boardsHub}`
            : `  no "boards & committees" hub link found on ${govHub} either`,
        );
      } else {
        console.warn(`  "government" hub link found but failed to fetch: ${govHub}`);
      }
    } else {
      console.log(`  no "government" hub link found on ${seedUrl} either`);
    }
  }

  let written = 0;
  const found: Record<CandidateRow["linkType"], number> = {
    channel: 0,
    board: 0,
    district: 0,
    calendar: 0,
    vendor: 0,
    index: 0,
    agenda: 0,
    minutes: 0,
    agenda_minutes: 0,
    budget: 0,
  };

  // The boards hub itself is an index of this jurisdiction's bodies, not a
  // body — worth a candidate_links row (link_type='index') so a scribe can
  // see it, or a later crawl can revisit it directly as a --url seed
  // (see run.ts), even before any single board link is recognized within it.
  if (boardsHub) {
    const indexInserted = await insertCandidate(pool, {
      jurisdictionId,
      sourceBodyId,
      crawlJobId,
      foundOnUrl: boardsHubFoundOn,
      targetUrl: boardsHub,
      linkType: "index",
      title: "Boards & Committees",
      status: await reconcileIndex(pool, jurisdictionId, boardsHub, "Boards & Committees"),
    });
    if (indexInserted) {
      written++;
      found.index++;
      console.log(`    + index (boards & committees hub) — ${boardsHub}`);
    }
  }

  if (boardsHub && !fetchedUrls.has(boardsHub)) {
    if (!isAllowedFetchHost(boardsHub)) {
      console.log(`  boards hub link is off this site's host, not fetching: ${boardsHub}`);
    } else {
      const boardsHtml = await politeFetch(boardsHub, meta);
      if (boardsHtml) {
        pages.push({ url: boardsHub, html: boardsHtml, depth: 0, isBoardsHub: true });
        fetchedUrls.add(boardsHub);
      } else {
        console.warn(`  boards hub link found but failed to fetch: ${boardsHub}`);
      }
    }
  }

  // pages.length grows as we go (recursion queues more entries onto it) —
  // re-reading it each iteration is the point, this is a BFS over a queue.
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];

    const hits = await runCascade(page.url, page.html);
    if (hits.length === 0) {
      console.log(`  ${page.url}: no links found in anchors, inline scripts, or external scripts`);
    }
    let recognized = 0;
    let duplicates = 0;
    const navOnlyBoardNames: string[] = [];
    for (const hit of hits) {
      if (looksLikeAlertLink(hit.url)) continue; // press/weather/emergency alert module — never a body/channel/vendor/calendar page
      const classified = classifyLink(hit.url);
      const kind =
        classified.kind && isMunicipalSocialProfile(hit.url, classified.platform, jurisdictionName) ? classified.kind : null;
      const platform = kind ? classified.platform : null;
      const boardGuess = kind ? null : hit.text ? guessBoard(hit.text, hit.url, jurisdictionName, jurisdictionType) : null;
      const agendaMatch = !kind && !boardGuess && hit.text ? guessAgendaMatch(hit.text, knownBodies) : null;
      const vendorMatch = !kind && !boardGuess && !agendaMatch ? classifyVendor(hit.url) : null;
      if (vendorMatch?.vendor === "Legistar") {
        const calendarInserted = await checkLegistarCalendar(
          pool,
          jurisdictionId,
          sourceBodyId,
          crawlJobId,
          page.url,
          hit.url,
          legistarCalendarHostsChecked,
        );
        if (calendarInserted) {
          written++;
          found.calendar++;
        }
      }
      const isBudgetCandidate =
        !kind && !boardGuess && !agendaMatch && !vendorMatch ? looksLikeBudgetLink(hit.url, hit.text) : false;
      // Anchor text/URL alone can't tell a real budget page from a stale
      // prior-year one, or a PDF document from an HTML permalink page —
      // worth an extra fetch, but only for the rare link that already looks
      // like a budget link. See verifyBudgetPage.
      const budgetVerdict = isBudgetCandidate ? await verifyBudgetPage(hit.url, (u) => politeFetchWithType(u, meta)) : null;
      const isBudget = budgetVerdict?.kind === "confirmed" || budgetVerdict?.kind === "pdf";
      const isCalendar = !kind && !boardGuess && !agendaMatch && !vendorMatch && !isBudget ? looksLikeCalendarLink(hit.url) : false;
      if (!kind && !boardGuess && !agendaMatch && !vendorMatch && !isBudget && !isCalendar) continue; // nothing recognizable about this link
      recognized++;
      if (budgetVerdict?.kind === "pdf") await recordBudgetPdfFriction(pool, jurisdictionId, sourceBodyId, crawlJobId, hit.url);

      // Collapse any $HOST/calendar/<filter-or-page> variant to the bare
      // $HOST/calendar/ index before it's stored — see canonicalizeCalendarLink.
      const targetUrl = isCalendar ? canonicalizeCalendarLink(hit.url) : hit.url;

      const guessedBodyName = boardGuess?.kind === "committee" ? boardGuess.name : agendaMatch?.bodyName ?? null;
      const guessedJurisdictionName = boardGuess?.kind === "district" ? boardGuess.name : null;
      if (page.isBoardsHub && boardGuess && guessedBodyName && hit.inNav) navOnlyBoardNames.push(guessedBodyName);
      const linkType: CandidateRow["linkType"] = kind
        ? "channel"
        : boardGuess?.kind === "district"
          ? "district"
          : boardGuess?.kind === "index"
            ? "index"
            : boardGuess
              ? "board"
              : agendaMatch
                ? agendaMatch.recordKind
                : vendorMatch
                  ? "vendor"
                  : isBudget
                    ? "budget"
                    : "calendar";

      // Already registered — a channel this jurisdiction already has on
      // file, or a board/committee already in the bodies table by name —
      // isn't a new find, so skip it rather than surfacing it for a scribe
      // to triage again. Checked before reconcileChannel/insertCandidate so
      // it doesn't cost a query or a candidate_links row.
      const alreadyRegistered =
        (linkType === "channel" && knownChannelUrls.has(normalizeUrl(targetUrl))) ||
        (linkType === "board" &&
          guessedBodyName != null &&
          knownBodies.some((b) => normalizeBodyName(b.name) === normalizeBodyName(guessedBodyName)));
      if (alreadyRegistered) {
        duplicates++;
        console.log(`    = already registered — ${targetUrl}`);
        continue;
      }

      // Already checked and confirmed dead (404/gone) by
      // prune-dead-candidates.ts on a prior run — don't re-propose it just
      // because the site still links to it.
      if (isBlacklisted(jurisdictionId, targetUrl)) {
        duplicates++;
        console.log(`    x blacklisted (confirmed dead) — ${targetUrl}`);
        continue;
      }

      // A jurisdiction gets one candidate per (channel platform) — see
      // reconcileChannel — preferring whichever link's own handle names the
      // jurisdiction over an opaque ID. Likewise one candidate per vendor —
      // see reconcileVendor.
      const candidateStatus = platform
        ? await reconcileChannel(pool, jurisdictionId, targetUrl, jurisdictionName, platform)
        : vendorMatch
          ? await reconcileVendor(pool, jurisdictionId, targetUrl, vendorMatch.vendor)
          : isBudget
            ? await reconcileBudget(pool, jurisdictionId, targetUrl)
            : isCalendar
              ? await reconcileCalendar(pool, jurisdictionId, targetUrl)
              : linkType === "board" && guessedBodyName
                ? await reconcileBoard(pool, jurisdictionId, targetUrl, guessedBodyName)
                : linkType === "index"
                  ? await reconcileIndex(pool, jurisdictionId, targetUrl, hit.text ?? null)
                  : "new";

      // Channel candidates don't care about the source page's anchor text —
      // "platform: AccountName" (or just "platform" when the URL carries no
      // human-readable name, e.g. a Mailchimp/Constant Contact link or a
      // Discord/Slack invite) is a more useful title than whatever text the
      // page happened to link with.
      const channelTitle = platform
        ? (() => {
            const accountName = extractAccountName(targetUrl, platform);
            return accountName ? `${platform}: ${accountName}` : platform;
          })()
        : null;

      const inserted = await insertCandidate(pool, {
        jurisdictionId,
        sourceBodyId,
        crawlJobId,
        foundOnUrl: page.url,
        targetUrl,
        linkType,
        title: channelTitle ?? hit.text ?? null,
        guessedPlatform: platform,
        guessedKind: kind,
        guessedBodyName,
        guessedJurisdictionName,
        guessedVendor: vendorMatch?.vendor,
        guessedFunction: vendorMatch?.function,
        guessedTargetBodyId: agendaMatch?.bodyId,
        status: candidateStatus,
      });
      if (inserted) {
        written++;
        found[linkType]++;
        const label =
          linkType === "board"
            ? `board "${guessedBodyName}"`
            : linkType === "district"
              ? `district "${guessedJurisdictionName}"`
              : linkType === "index"
                ? `index (boards/committees hub) — "${hit.text}"`
                : linkType === "channel"
                  ? `channel ${platform} (${kind})`
                  : linkType === "vendor"
                    ? `vendor ${vendorMatch?.vendor} (${vendorMatch?.function})`
                    : linkType === "agenda" || linkType === "minutes" || linkType === "agenda_minutes"
                      ? `${linkType} for "${guessedBodyName}"`
                      : linkType === "budget"
                        ? "budget page"
                        : "calendar link";
        const marker = candidateStatus === "duplicate" ? "~" : "+";
        const suffix =
          candidateStatus === "duplicate" ? ` (duplicate ${platform ? `${platform} channel` : "vendor"})` : "";
        console.log(`    ${marker} ${label} — ${targetUrl}${suffix}`);

        // Snapshot the actual document, not just the page it was found on —
        // geoPayload.ts's public "crawled documents" card shows discovered_at
        // next to hasCachedPage(target_url), so a real find should actually
        // have a cached copy of its own page, not just of found_on_url. Free
        // (a cache hit, no network call) when this target_url was already
        // fetched earlier in this same crawl, e.g. a recursed board hub or a
        // budget page already pulled down by verifyBudgetPage above. Skipped
        // for a 'duplicate' candidate — it won't appear on that card — and
        // for anything off this site's host (see isAllowedFetchHost): most
        // channel/vendor target_urls are a third party's server (Facebook,
        // an unrelated Legistar tenant, …), not this jurisdiction's own
        // content, and not ours to archive.
        if (candidateStatus !== "duplicate" && isAllowedFetchHost(targetUrl)) {
          await politeFetchWithType(targetUrl, meta);
        }
      } else {
        duplicates++;
      }

      // A committee/board-shaped link may itself be a hub (a directory of
      // more specific bodies) rather than a leaf — follow it one more hop,
      // never off-site, bounded by recurseDepth and the page cap. Only for an
      // actual board discovery — an agenda/minutes match is already a known
      // body's leaf meeting-record page, never a hub to recurse into. An
      // index guess (a plural "Boards and Commissions"-shaped link found
      // opportunistically in the general cascade, as opposed to the
      // dedicated boardsHub search above) is itself already known to be a
      // hub, not a candidate body — follow it the same way.
      if (
        boardGuess &&
        (guessedBodyName || boardGuess.kind === "index") &&
        page.depth < recurseDepth &&
        pages.length < MAX_PAGES_PER_SEED &&
        !fetchedUrls.has(hit.url) &&
        isAllowedFetchHost(hit.url)
      ) {
        fetchedUrls.add(hit.url);
        const subHtml = await politeFetch(hit.url, meta);
        if (subHtml) pages.push({ url: hit.url, html: subHtml, depth: page.depth + 1 });
      }
    }
    if (hits.length > 0) {
      console.log(
        `  ${page.url}: ${hits.length} link(s) via ${hits[0].rung}, ${recognized} recognized (channel/board/vendor/calendar), ${hits.length - recognized} unrecognized, ${duplicates} already known`,
      );
    }
    if (page.isBoardsHub && navOnlyBoardNames.length > 0) {
      await recordIndexInMenuFriction(pool, jurisdictionId, sourceBodyId, crawlJobId, page.url, navOnlyBoardNames);
    }
  }

  const summary = Object.entries(found)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `${n} ${type}`)
    .join(", ");
  console.log(`  ${seedUrl}: ${written} new candidate(s) — ${summary || "nothing new"}`);
  return written;
}
