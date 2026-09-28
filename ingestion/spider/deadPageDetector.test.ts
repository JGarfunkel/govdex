import { describe, expect, it } from "vitest";
import { extractTitle, looksLikeDeadPageTitle } from "./deadPageDetector";

describe("extractTitle", () => {
  it("pulls the <title> element's text", () => {
    expect(extractTitle("<html><head><title>Town of Example</title></head></html>")).toBe("Town of Example");
  });

  it("returns an empty string when there's no <title>", () => {
    expect(extractTitle("<html><body>hi</body></html>")).toBe("");
  });
});

describe("looksLikeDeadPageTitle", () => {
  it("matches common soft-404 titles", () => {
    expect(looksLikeDeadPageTitle("Page Not Found")).toBe(true);
    expect(looksLikeDeadPageTitle("404 Not Found")).toBe(true);
    expect(looksLikeDeadPageTitle("404")).toBe(true);
    expect(looksLikeDeadPageTitle("Oops! That page can't be found.")).toBe(true);
    expect(looksLikeDeadPageTitle("Sorry, this page does not exist")).toBe(true);
  });

  it("matches parked/suspended-domain titles", () => {
    expect(looksLikeDeadPageTitle("Domain For Sale")).toBe(true);
    expect(looksLikeDeadPageTitle("Account Suspended")).toBe(true);
  });

  it("leaves an ordinary page title alone", () => {
    expect(looksLikeDeadPageTitle("Town of Example — Boards & Committees")).toBe(false);
    expect(looksLikeDeadPageTitle("2026 Adopted Budget")).toBe(false);
  });

  it("treats an empty title as not dead — no evidence either way", () => {
    expect(looksLikeDeadPageTitle("")).toBe(false);
  });
});
