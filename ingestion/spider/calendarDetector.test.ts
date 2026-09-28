import { describe, expect, it } from "vitest";
import { canonicalizeCalendarLink, guessLegistarCalendarUrl, looksLikeCalendarLink } from "./calendarDetector";

describe("looksLikeCalendarLink", () => {
  it("matches known calendar/agenda/meeting/event URL shapes", () => {
    expect(looksLikeCalendarLink("https://calendar.google.com/calendar/embed?src=x")).toBe(true);
    expect(looksLikeCalendarLink("https://outlook.office365.com/calendar/published/x")).toBe(true);
    expect(looksLikeCalendarLink("https://example.gov/feed.ics")).toBe(true);
    expect(looksLikeCalendarLink("https://example.legistar.com/calendar.aspx")).toBe(true);
    expect(looksLikeCalendarLink("https://example.granicus.com/ViewPublisher.php?view_id=1")).toBe(true);
    expect(looksLikeCalendarLink("https://example.gov/calendar/")).toBe(true);
    expect(looksLikeCalendarLink("https://example.gov/agendas")).toBe(true);
    expect(looksLikeCalendarLink("https://example.gov/meetings/")).toBe(true);
    expect(looksLikeCalendarLink("https://example.gov/events/123-open-house")).toBe(true);
    expect(looksLikeCalendarLink("https://www.whiteplainsny.gov/calendar.aspx?CID=14")).toBe(true);
    expect(looksLikeCalendarLink("https://www.scarsdale.com/calendar.aspx?TID=30")).toBe(true);
  });

  it("does not match an unrelated page", () => {
    expect(looksLikeCalendarLink("https://example.gov/about")).toBe(false);
  });
});

describe("canonicalizeCalendarLink", () => {
  it("collapses filter/page/month variants to the bare calendar index", () => {
    expect(canonicalizeCalendarLink("https://example.gov/calendar/2024-09")).toBe("https://example.gov/calendar/");
    expect(canonicalizeCalendarLink("https://example.gov/calendar/month")).toBe("https://example.gov/calendar/");
    expect(canonicalizeCalendarLink("https://example.gov/calendar/list?category=meetings")).toBe(
      "https://example.gov/calendar/",
    );
  });

  it("leaves a URL with no calendar-index prefix unchanged", () => {
    expect(canonicalizeCalendarLink("https://example.gov/about")).toBe("https://example.gov/about");
  });

  // CivicPlus (White Plains, Scarsdale) serves one shared calendar.aspx and
  // filters it per-board with a category/term query param (CID/TID) — the
  // Boards & Committees page links out to one such filtered URL per board.
  // Without collapsing the query string away, each board's link canonicalizes
  // to a *different* target_url and the crawler proposes a separate calendar
  // candidate per board instead of recognizing them all as the same
  // site-wide calendar.
  it("collapses CivicPlus calendar.aspx category/term filters to the bare calendar page", () => {
    expect(canonicalizeCalendarLink("https://www.whiteplainsny.gov/calendar.aspx?CID=14")).toBe(
      "https://www.whiteplainsny.gov/calendar.aspx",
    );
    expect(canonicalizeCalendarLink("https://www.whiteplainsny.gov/calendar.aspx?CID=22-30")).toBe(
      "https://www.whiteplainsny.gov/calendar.aspx",
    );
    expect(canonicalizeCalendarLink("https://www.scarsdale.com/calendar.aspx?TID=30")).toBe(
      "https://www.scarsdale.com/calendar.aspx",
    );
  });

  it("is case-insensitive, e.g. CivicPlus's capitalized Calendar.aspx", () => {
    expect(canonicalizeCalendarLink("https://www.whiteplainsny.gov/Calendar.aspx?CID=14")).toBe(
      "https://www.whiteplainsny.gov/Calendar.aspx",
    );
  });
});

describe("guessLegistarCalendarUrl", () => {
  it("guesses Calendar.aspx off the bare host for any legistar.com link", () => {
    expect(guessLegistarCalendarUrl("https://mountvernonny.legistar.com/")).toBe(
      "https://mountvernonny.legistar.com/Calendar.aspx",
    );
    expect(guessLegistarCalendarUrl("https://mountvernonny.legistar.com/DepartmentDetail.aspx?ID=123")).toBe(
      "https://mountvernonny.legistar.com/Calendar.aspx",
    );
  });

  it("returns null for a non-Legistar or unparseable URL", () => {
    expect(guessLegistarCalendarUrl("https://example.gov/about")).toBeNull();
    expect(guessLegistarCalendarUrl("not a url")).toBeNull();
  });
});
