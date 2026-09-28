import { describe, expect, it } from "vitest";
import { classify, normalize, similarity, slugify } from "./civicApiProbe";

describe("normalize", () => {
  it("strips governance nouns and state suffixes", () => {
    expect(normalize("Westchester County, NY")).toBe("westchester");
    expect(normalize("Town of Greenburgh")).toBe("greenburgh");
    expect(normalize("Village of Mount Pleasant, New York")).toBe("mount pleasant");
  });
});

describe("slugify", () => {
  it("collapses a normalized name to a bare slug", () => {
    expect(slugify("Mount Pleasant, NY")).toBe("mountpleasant");
  });
});

describe("similarity", () => {
  it("is 1 for names identical after normalize", () => {
    expect(similarity("Westchester County, NY", "Westchester")).toBe(1);
  });

  it("is 0 for unrelated names", () => {
    expect(similarity("Westchester County, NY", "Zyzzyx")).toBeLessThan(0.3);
  });

  it("scores partial overlaps between the confirm and review thresholds", () => {
    const s = similarity("Mount Pleasant", "Mount Vernon");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe("classify", () => {
  it("classifies against the confirm/review thresholds", () => {
    expect(classify(0.9)).toBe("confirmed");
    expect(classify(0.7)).toBe("needs_review");
    expect(classify(0.3)).toBe("rejected");
  });
});
