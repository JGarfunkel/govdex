import { describe, expect, it } from "vitest";
import { looksLikeAlertLink } from "./alertDetector";

describe("looksLikeAlertLink", () => {
  it("matches URLs mentioning alerts", () => {
    expect(looksLikeAlertLink("https://example.gov/CivicAlerts.aspx?AID=123")).toBe(true);
    expect(looksLikeAlertLink("https://example.gov/sign-up-for-alerts")).toBe(true);
    expect(looksLikeAlertLink("https://example.gov/EMERGENCY-ALERT")).toBe(true);
  });

  it("does not match an unrelated page", () => {
    expect(looksLikeAlertLink("https://example.gov/about")).toBe(false);
  });
});
