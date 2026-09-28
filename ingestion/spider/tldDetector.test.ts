import { describe, expect, it } from "vitest";
import { hostnameIsDotCom } from "./tldDetector";

describe("hostnameIsDotCom", () => {
  it("flags a .com government website", () => {
    expect(hostnameIsDotCom("https://www.exampletown.com/")).toBe(true);
  });

  it("does not flag standard government/nonprofit TLDs", () => {
    expect(hostnameIsDotCom("https://www.exampletown.gov/")).toBe(false);
    expect(hostnameIsDotCom("https://www.exampletown.ny.us/")).toBe(false);
    expect(hostnameIsDotCom("https://www.exampletown.us/")).toBe(false);
    expect(hostnameIsDotCom("https://www.exampletown.org/")).toBe(false);
  });

  it("does not flag a .com used only as a path segment, not the host", () => {
    expect(hostnameIsDotCom("https://www.exampletown.gov/redirect?to=partner.com")).toBe(false);
  });

  it("returns false for an unparseable URL", () => {
    expect(hostnameIsDotCom("not a url")).toBe(false);
  });
});
