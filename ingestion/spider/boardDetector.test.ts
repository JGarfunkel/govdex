import { describe, expect, it } from "vitest";
import { guessBoard } from "./boardDetector";

describe("guessBoard — district shape", () => {
  it("matches <=3 leading words + a configured type + 'District'", () => {
    expect(guessBoard("Bedford Hills Fire District")).toEqual({ name: "Bedford Hills Fire District", kind: "district" });
    expect(guessBoard("Consolidated Water District")).toEqual({ name: "Consolidated Water District", kind: "district" });
  });

  it("tolerates a trailing acronym parenthetical", () => {
    expect(guessBoard("Bedford Hills Fire District (BHFD)")).toEqual({
      name: "Bedford Hills Fire District (BHFD)",
      kind: "district",
    });
  });

  it("rejects text that merely contains the word 'district'", () => {
    expect(guessBoard("Congressional District 17")).toBeNull();
    expect(guessBoard("Visit the school district's website")).toBeNull();
  });

  it("rejects a district type not in the configured list", () => {
    expect(guessBoard("Downtown Lighting District")).toBeNull();
  });

  it("requires the type word to be whole, not a substring of a leading word", () => {
    expect(guessBoard("Watertown District")).toBeNull();
    expect(guessBoard("Watertown School District")).toEqual({ name: "Watertown School District", kind: "district" });
  });

  it("treats a 'District <hint>' as a committee/body, not a district, when it doesn't end in the bare word 'District'", () => {
    expect(guessBoard("Historic District Committee")).toEqual({ name: "Historic District Committee", kind: "committee" });
  });

  it("treats '<...> District Commission' as a commission, not a district", () => {
    expect(guessBoard("Water District Commission")).toEqual({ name: "Water District Commission", kind: "committee" });
    expect(guessBoard("Historic District Commission")).toEqual({
      name: "Historic District Commission",
      kind: "committee",
    });
    expect(guessBoard("District Commission")).toEqual({ name: "District Commission", kind: "committee" });
  });
});

describe("guessBoard — committee/council shape", () => {
  it("matches a hint word as the first or last token", () => {
    expect(guessBoard("Planning Board")).toEqual({ name: "Planning Board", kind: "committee" });
    expect(guessBoard("Historic Preservation Advisory Council")).toEqual({
      name: "Historic Preservation Advisory Council",
      kind: "committee",
    });
    expect(guessBoard("Recreation Commission")).toEqual({ name: "Recreation Commission", kind: "committee" });
  });

  it("matches the two-word hint 'Task Force' at the end of the text", () => {
    expect(guessBoard("Recreation Task Force")).toEqual({ name: "Recreation Task Force", kind: "committee" });
  });

  it("does not match 'Council' inside 'Councilman'/'Councilwoman'", () => {
    expect(guessBoard("Councilman John Smith")).toBeNull();
    expect(guessBoard("Councilwoman Jane Doe")).toBeNull();
  });

  it("does not match prefix 'Volunteer:' prefixed to a committee name", () => {
    expect(guessBoard("Volunteer: Planning Board")).toBeNull();
  });

  it("does not match 'Agenda' in a committee name", () => {
    expect(guessBoard("Agenda for Planning Board Meeting")).toBeNull();
  });

  it("rejects a document title that only mentions a council in passing", () => {
    expect(guessBoard("2026 Adopted Budget -Town Council Letter of Transmittal")).toBeNull();
  });

  it("rejects text on the reject list even when hint-shaped", () => {
    expect(guessBoard("Contact the Zoning Board")).toBeNull();
    expect(guessBoard("Email the Town Council")).toBeNull();
    expect(guessBoard("Recreation Department Brochure")).toBeNull();
  });

  it("rejects the jurisdiction's own already-known governing body", () => {
    expect(guessBoard("Town Council")).toBeNull();
    expect(guessBoard("Rye Town Council")).toBeNull();
  });

  it("rejects a link ending in .pdf even when the text is body-shaped", () => {
    expect(guessBoard("Planning Board", "https://example.gov/docs/planning-board-bylaws.pdf")).toBeNull();
    expect(guessBoard("Planning Board", "https://example.gov/docs/planning-board-bylaws.PDF")).toBeNull();
    expect(guessBoard("Planning Board", "https://example.gov/docs/planning-board-bylaws.pdf?rev=2")).toBeNull();
  });

  it("still matches when a URL is given but isn't a PDF", () => {
    expect(guessBoard("Planning Board", "https://example.gov/boards/planning-board")).toEqual({
      name: "Planning Board",
      kind: "committee",
    });
  });

  it("rejects a CivicAlerts URL even when the text is body-shaped", () => {
    expect(
      guessBoard("Planning Board", "https://example.gov/CivicAlerts.aspx?AID=123"),
    ).toBeNull();
  });

  it("rejects a committee name that embeds a numeric meeting date", () => {
    expect(guessBoard("Planning Board 3/4/2025")).toBeNull();
    expect(guessBoard("Zoning Board of Appeals - 03-04-2025")).toBeNull();
    expect(guessBoard("Historic Preservation Commission 2025-03-04")).toBeNull();
    expect(guessBoard("Recreation Commission 3.4.25")).toBeNull();
  });

  it("rejects a '<...> District Commission' that embeds a numeric meeting date", () => {
    expect(guessBoard("Water District Commission 1/2/2025")).toBeNull();
  });

  it("rejects one starting with 'Apply to'", () => {
    expect(guessBoard("Apply to a Town Committee, Commission, or Board")).toBeNull();
  });

});

describe("guessBoard — jurisdiction-name-prefixed 'Board of X'", () => {
  it("strips '<name> Board of X'", () => {
    expect(guessBoard("Bedford Board of Assessment Review", undefined, "Bedford", "Village")).toEqual({
      name: "Board of Assessment Review",
      kind: "committee",
    });
  });

  it("strips '<name> <type> Board of X'", () => {
    expect(guessBoard("Bedford Village Board of Assessment Review", undefined, "Bedford", "Village")).toEqual({
      name: "Board of Assessment Review",
      kind: "committee",
    });
  });

  it("strips '<type> of <name> Board of X'", () => {
    expect(guessBoard("Village of Bedford Board of Assessment Review", undefined, "Bedford", "Village")).toEqual({
      name: "Board of Assessment Review",
      kind: "committee",
    });
  });

  it("is case-insensitive and works for other jurisdiction types", () => {
    expect(guessBoard("town of bedford board of ethics", undefined, "Bedford", "Town")).toEqual({
      name: "board of ethics",
      kind: "committee",
    });
    expect(guessBoard("Westchester County Board of Elections", undefined, "Westchester", "County")).toBeNull(); // "Board of Elections" is already excluded
  });

  it("does not strip when the jurisdiction name doesn't match", () => {
    expect(guessBoard("Ossining Board of Assessment Review", undefined, "Bedford", "Village")).toBeNull();
  });

  it("does nothing when no jurisdiction name is given", () => {
    expect(guessBoard("Bedford Board of Assessment Review")).toBeNull();
  });

  it("still strips when no jurisdiction type is known, for the bare-name variant", () => {
    expect(guessBoard("Bedford Board of Assessment Review", undefined, "Bedford", null)).toEqual({
      name: "Board of Assessment Review",
      kind: "committee",
    });
  });
});

describe("guessBoard — index/hub shape", () => {
  it("recognizes the plural 'Boards and Commissions' as an index/hub, not a single body", () => {
    expect(guessBoard("Boards and Commissions")).toEqual({ name: "Boards and Commissions", kind: "index" });
  });

  it("recognizes other plural hub phrasings", () => {
    expect(guessBoard("Boards & Committees")).toEqual({ name: "Boards & Committees", kind: "index" });
    expect(guessBoard("Boards, Committees, and Commissions")).toEqual({
      name: "Boards, Committees, and Commissions",
      kind: "index",
    });
  });

  it("does not treat a single specific body's name as an index", () => {
    expect(guessBoard("Planning Board")).toEqual({ name: "Planning Board", kind: "committee" });
  });
});
