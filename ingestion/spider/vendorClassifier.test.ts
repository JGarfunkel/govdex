import { describe, expect, it } from "vitest";
import { classifyVendor, isIgnoredHost } from "./vendorClassifier";

describe("classifyVendor", () => {
  it("matches a known GovTech vendor domain and returns its vendor + function", () => {
    expect(classifyVendor("https://www.revize.com/")).toEqual({ vendor: "Revize", function: "website_cms" });
    expect(classifyVendor("https://accela.com/permits")).toEqual({ vendor: "Accela", function: "permitting" });
  });

  it("matches on a subdomain, not just the bare domain", () => {
    expect(classifyVendor("https://cms6.revize.com/revize/security/index.jsp?webspace=x")).toEqual({
      vendor: "Revize",
      function: "website_cms",
    });
  });

  it("matches any pattern in a multi-pattern rule", () => {
    expect(classifyVendor("https://example.civicplus.com/")).toEqual({ vendor: "CivicPlus", function: "website_cms" });
    expect(classifyVendor("https://example.civicengage.com/")).toEqual({ vendor: "CivicPlus", function: "website_cms" });
    expect(classifyVendor("https://example.civicclerk.com/")).toEqual({ vendor: "CivicPlus", function: "website_cms" });
  });

  it("is case-insensitive", () => {
    expect(classifyVendor("https://WWW.REVIZE.COM/")).toEqual({ vendor: "Revize", function: "website_cms" });
  });

  it("does not match a domain that merely contains a vendor pattern as a substring", () => {
    expect(classifyVendor("https://notrevize.com/")).toBeNull();
    expect(classifyVendor("https://myrevize.com.example.net/")).toBeNull();
  });

  it("returns null for a site with no recognized vendor", () => {
    expect(classifyVendor("https://www.exampletown.gov/about")).toBeNull();
  });
});

describe("isIgnoredHost", () => {
  it("flags known CDN/analytics infra", () => {
    expect(isIgnoredHost("https://www.googletagmanager.com/gtag/js")).toBe(true);
    expect(isIgnoredHost("https://cdnjs.cloudflare.com/ajax/libs/jquery.js")).toBe(true);
  });

  it("flags social/newsletter domains already handled as channels", () => {
    expect(isIgnoredHost("https://www.facebook.com/exampletown")).toBe(true);
    expect(isIgnoredHost("https://mailchi.mp/exampletown/newsletter")).toBe(true);
  });

  it("does not flag a real vendor or an ordinary municipal link", () => {
    expect(isIgnoredHost("https://www.revize.com/")).toBe(false);
    expect(isIgnoredHost("https://www.exampletown.gov/about")).toBe(false);
  });
});
