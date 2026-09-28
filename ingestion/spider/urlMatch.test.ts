import { describe, expect, it } from "vitest";
import { ensureProtocol, normalizeUrl } from "./urlMatch";

describe("ensureProtocol", () => {
  it("leaves an http(s) URL unchanged", () => {
    expect(ensureProtocol("https://example.gov/page")).toBe("https://example.gov/page");
    expect(ensureProtocol("http://example.gov/page")).toBe("http://example.gov/page");
  });

  it("defaults a bare host/path to https", () => {
    expect(ensureProtocol("example.gov")).toBe("https://example.gov");
    expect(ensureProtocol("www.example.gov/boards")).toBe("https://www.example.gov/boards");
  });

  it("prefixes a protocol-relative URL with https: rather than https://", () => {
    expect(ensureProtocol("//example.gov/page")).toBe("https://example.gov/page");
  });

  it("trims surrounding whitespace", () => {
    expect(ensureProtocol("  example.gov  ")).toBe("https://example.gov");
  });
});

describe("normalizeUrl", () => {
  it("strips a trailing slash on a non-root path", () => {
    expect(normalizeUrl("https://example.gov/foo/")).toBe("https://example.gov/foo");
  });

  it("leaves the root path alone", () => {
    expect(normalizeUrl("https://example.gov/")).toBe("https://example.gov/");
  });
});
