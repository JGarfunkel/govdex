import { describe, expect, it } from "vitest";
import { extractEntries } from "./htmlExtract";
import { buildRecord, coerce, dedupeRows, filterRows, normalizeName, readField, slugOf, sourceFields, staticRecords, titleCase, type SourceSpec } from "./sourceSpec";
import { parseTsv } from "./tsv";

describe("titleCase", () => {
  it("capitalizes each word and hyphen part", () => {
    expect(titleCase("NORTH ATTLEBOROUGH")).toBe("North Attleborough");
  });
  it("keeps listed small words lowercase except at the start", () => {
    expect(titleCase("MANCHESTER-BY-THE-SEA", ["by", "the", "of"])).toBe("Manchester-by-the-Sea");
    expect(titleCase("THE PLAINS", ["the"])).toBe("The Plains");
  });
});

describe("normalizeName", () => {
  it("ignores case, punctuation, spaces and diacritics", () => {
    expect(normalizeName("La Cañada Flintridge")).toBe("lacanadaflintridge");
    expect(normalizeName("Manchester-by-the-Sea")).toBe("manchesterbythesea");
  });
  it("does not equate abbreviations (that is what aliases are for)", () => {
    expect(normalizeName("Mt. Shasta")).not.toBe(normalizeName("Mount Shasta"));
  });
});

describe("coerce", () => {
  it("treats blank and null as null", () => {
    expect(coerce("  ")).toBeNull();
    expect(coerce(null)).toBeNull();
  });
  it("parses numbers with thousands separators", () => {
    expect(coerce("37,150", "number")).toBe(37150);
    expect(coerce("n/a", "number")).toBeNull();
  });
  it("stringifies integers such as an integer FIPS code", () => {
    expect(coerce(25003, "string")).toBe("25003");
  });
  it("splits comma lists and converts US dates", () => {
    expect(coerce("Groton, Dunstable", "comma_list")).toEqual(["Groton", "Dunstable"]);
    expect(coerce("12/22/1970", "date_us")).toBe("1970-12-22");
    expect(coerce("&nbsp;", "date_us")).toBeNull();
  });
});

const municipalities: SourceSpec = {
  kind: "arcgis",
  concept_from: { field: "TYPE", map: { T: "town", C: "city", TC: "city" } },
  name: { field: "TOWN20", transform: "title_case", lowercase_words: ["by", "the"] },
  identifiers: [
    { scheme: "census_geoid", field: "GEOID20" },
    { scheme: "gnis", field: "COUSUBNS20" },
  ],
  attributes: { county_fips: { field: "FIPS_STCO20", as: "string" }, population_estimate: "POP2020" },
};

describe("buildRecord", () => {
  it("maps a municipality row using concept_from, name transform, identifiers and attributes", () => {
    const built = buildRecord(municipalities, {
      TYPE: "TC",
      TOWN20: "NORTH ATTLEBOROUGH",
      GEOID20: "2500549000",
      COUSUBNS20: null,
      FIPS_STCO20: 25005,
      POP2020: 30834,
    });
    expect("record" in built && built.record).toMatchObject({
      conceptCode: "city",
      name: "North Attleborough",
      identifiers: [{ scheme: "census_geoid", value: "2500549000" }],
      attributes: { county_fips: "25005", population_estimate: 30834 },
    });
  });
  it("applies a concept override by transformed name", () => {
    const spec = { ...municipalities, concept_overrides: { "East Longmeadow": "city" } };
    const built = buildRecord(spec, { TYPE: "T", TOWN20: "EAST LONGMEADOW", GEOID20: "2501319995" });
    expect("record" in built && built.record.conceptCode).toBe("city");
  });
  it("skips an unmapped type and a row with no identifier", () => {
    expect(buildRecord(municipalities, { TYPE: "X", TOWN20: "A", GEOID20: "1" })).toHaveProperty("skip");
    expect(buildRecord(municipalities, { TYPE: "T", TOWN20: "A" })).toHaveProperty("skip");
  });
  it("lists every source field the spec reads", () => {
    expect(sourceFields(municipalities).sort()).toEqual(["COUSUBNS20", "FIPS_STCO20", "GEOID20", "POP2020", "TOWN20", "TYPE"]);
  });
});

describe("staticRecords", () => {
  it("builds a numbered series", () => {
    const recs = staticRecords({
      kind: "static",
      concept: "us_house_district",
      identifiers: [{ scheme: "ma_cd", derive: "number" }],
      count: 9,
      label: "Congressional District {n}",
    });
    expect(recs).toHaveLength(9);
    expect(recs[8]).toMatchObject({ name: "Congressional District 9", identifiers: [{ scheme: "ma_cd", value: "9" }], attributes: { district_number: 9 } });
  });
  it("builds slug identifiers for a literal list", () => {
    const recs = staticRecords({ kind: "static", concept: "educational_region", identifiers: [{ scheme: "ma_collab_slug", derive: "slug_of_name" }], entries: ["Cape Cod", "Bi-County"] });
    expect(recs.map((r) => r.identifiers[0].value)).toEqual(["cape-cod", "bi-county"]);
    expect(slugOf("South Shore")).toBe("south-shore");
  });
});

describe("extractEntries", () => {
  it("reads a link-list directory using only the first container (MA/MMA shape)", () => {
    const html = `
      <div class="panel"><a href="http://www.abingtonma.gov"><strong> Abington</strong> &#8211; www.abingtonma.gov</a><br/>
        <a href="http://www.acton-ma.gov"> <strong> Acton </strong> &#8211; www.acton-ma.gov</a></div>
      <div class="panel"><a href="http://www.abingtonma.gov"><strong>Abington</strong></a></div>`;
    const out = extractEntries(html, { container: "div.panel", rows: "a", fields: { name: "strong", website: "@href" } });
    expect(out.map((e) => [e.name, e.website])).toEqual([
      ["Abington", "http://www.abingtonma.gov"],
      ["Acton", "http://www.acton-ma.gov"],
    ]);
  });
  it("reads a table directory with typed cells (CA/League shape)", () => {
    const html = `<table><tbody>
      <tr class="rgRow"><td>Adelanto</td><td>addr</td><td>12/22/1970</td><td>Charter City</td><td>37,150</td><td>760</td><td><a href="http://www.ci.adelanto.ca.us">x</a></td></tr>
      <tr class="rgAltRow"><td>Alameda</td><td>addr</td><td>&nbsp;</td><td>General Law City</td><td>1</td><td>2</td><td></td></tr></tbody></table>`;
    const out = extractEntries(html, {
      rows: "tr.rgRow, tr.rgAltRow",
      fields: {
        name: "td:nth-child(1)",
        incorporated: { select: "td:nth-child(3)", as: "date_us" },
        city_type: "td:nth-child(4)",
        population_estimate: { select: "td:nth-child(5)", as: "number" },
        website: "td:nth-child(7) a@href",
      },
    });
    expect(out[0]).toMatchObject({ name: "Adelanto", website: "http://www.ci.adelanto.ca.us", fields: { incorporated: "1970-12-22", city_type: "Charter City", population_estimate: 37150 } });
    expect(out[1]).toMatchObject({ name: "Alameda", website: null, fields: { incorporated: null } });
  });
});

describe("field transforms, dedupe, filter, tsv", () => {
  it("strips a suffix and adds a prefix", () => {
    expect(readField({ C: "San Bernardino County" }, { field: "C", strip_suffix: " County" })).toBe("San Bernardino");
    expect(readField({ F: "051" }, { field: "F", prefix: "06" })).toBe("06051");
    expect(readField({ C: "Mono" }, { field: "C", strip_suffix: " County" })).toBe("Mono");
  });
  it("applies name_overrides after the name transform", () => {
    const spec: SourceSpec = { kind: "arcgis", concept: "city", name: { field: "N" }, name_overrides: { Angels: "Angels Camp" }, identifiers: [{ scheme: "cdtfa", field: "ID" }] };
    const built = buildRecord(spec, { N: "Angels", ID: 1 });
    expect("record" in built && built.record.name).toBe("Angels Camp");
  });
  it("reads a website column and accepts a prefixed identifier", () => {
    const spec: SourceSpec = { kind: "tsv", concept: "county", name: "N", identifiers: [{ scheme: "fips", field: { field: "F", prefix: "06" } }], website: "W" };
    const built = buildRecord(spec, { N: "Mono", F: "051", W: "www.monocounty.ca.gov" });
    expect("record" in built && built.record).toMatchObject({ identifiers: [{ scheme: "fips", value: "06051" }], website: "www.monocounty.ca.gov" });
  });
  it("dedupes on a source field, first row wins", () => {
    const d = dedupeRows([{ id: "1", n: "a" }, { id: "1", n: "b" }, { id: "2", n: "c" }], "id");
    expect(d.rows.map((r) => r.n)).toEqual(["a", "c"]);
    expect(d.dropped).toBe(1);
  });
  it("filters rows, with null meaning blank", () => {
    const rows = [
      { School: null, Status: "Active", DOC: "54" },
      { School: "X", Status: "Active", DOC: "54" },
      { School: null, Status: "Closed", DOC: "54" },
      { School: null, Status: "Active", DOC: "98" },
    ];
    expect(filterRows(rows, { School: null, Status: "Active", DOC: ["52", "54", "56"] })).toHaveLength(1);
  });
  it("parses tsv, turning null markers and blanks into null", () => {
    const rows = parseTsv("﻿A\tB\tC\r\nx\tNo Data\t\r\ny\t2\tz\r\n", ["No Data"]);
    expect(rows).toEqual([
      { A: "x", B: null, C: null },
      { A: "y", B: "2", C: "z" },
    ]);
  });
});
