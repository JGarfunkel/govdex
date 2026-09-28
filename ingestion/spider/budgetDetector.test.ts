import { describe, expect, it } from "vitest";
import { looksLikeBudgetLink, verifyBudgetPage } from "./budgetDetector";

describe("looksLikeBudgetLink", () => {
  it("matches anchor text naming the budget document", () => {
    expect(looksLikeBudgetLink("https://example.gov/finance/x", "2026 Budget")).toBe(true);
    expect(looksLikeBudgetLink("https://example.gov/finance/x", "Adopted Budget")).toBe(true);
  });

  it("rejects anchor text naming a process/meeting page instead of the document", () => {
    expect(looksLikeBudgetLink("https://example.gov/x", "Budget Committee")).toBe(false);
    expect(looksLikeBudgetLink("https://example.gov/x", "Budget Hearing")).toBe(false);
  });

  it("rejects anchor text using the reject words shared with boardDetector.ts", () => {
    expect(looksLikeBudgetLink("https://example.gov/x", "Budget Calendar")).toBe(false);
    expect(looksLikeBudgetLink("https://example.gov/x", "Budget Meeting")).toBe(false);
    expect(looksLikeBudgetLink("https://example.gov/x", "Budget Schedule")).toBe(false);
  });

  it("falls back to the URL when anchor text is generic", () => {
    expect(looksLikeBudgetLink("https://example.gov/budget/", "Learn more")).toBe(true);
    expect(looksLikeBudgetLink("https://example.gov/about", "Learn more")).toBe(false);
  });

  it("rejects a CivicAlerts URL even when the anchor text names the budget", () => {
    expect(looksLikeBudgetLink("https://example.gov/CivicAlerts.aspx?AID=123", "2026 Budget")).toBe(false);
  });
});

describe("verifyBudgetPage", () => {
  const currentYear = new Date().getFullYear();

  it("flags a .pdf URL as a PDF without fetching", async () => {
    const fetchPage = async () => {
      throw new Error("should not fetch a .pdf URL");
    };
    await expect(verifyBudgetPage("https://example.gov/budget.pdf", fetchPage)).resolves.toEqual({ kind: "pdf" });
  });

  it("flags a PDF content-type response as a PDF", async () => {
    const fetchPage = async () => ({ contentType: "application/pdf", html: null });
    await expect(verifyBudgetPage("https://example.gov/finance/doc", fetchPage)).resolves.toEqual({ kind: "pdf" });
  });

  it("confirms a title shaped like 'Budget' plus at most one other word", async () => {
    const fetchPage = async () => ({ contentType: "text/html", html: "<html><head><title>Budget Info</title></head></html>" });
    await expect(verifyBudgetPage("https://example.gov/budget/", fetchPage)).resolves.toEqual({ kind: "confirmed" });
  });

  it("confirms a longer title that at least names the current year", async () => {
    const fetchPage = async () => ({
      contentType: "text/html",
      html: `<html><head><title>${currentYear} Adopted Budget -Town Council Letter of Transmittal</title></head></html>`,
    });
    await expect(verifyBudgetPage("https://example.gov/budget/", fetchPage)).resolves.toEqual({ kind: "confirmed" });
  });

  it("rejects a stale page shaped like neither a budget title nor naming the current year", async () => {
    const fetchPage = async () => ({
      contentType: "text/html",
      html: "<html><head><title>2019 Adopted Budget -Town Council Letter of Transmittal</title></head></html>",
    });
    await expect(verifyBudgetPage("https://example.gov/budget/", fetchPage)).resolves.toEqual({ kind: "rejected" });
  });
});
