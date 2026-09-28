import { getPool } from "../db";
import { geocodeAddress } from "./censusGeocoder";

// Pre-PostGIS /resolve: approximate "every jurisdiction covering this point"
// from the relation graph loaded by ingestion, instead of a point-in-polygon
// query (that lands in t03). Matching rule, per ingestion/t01: every county,
// city, town, and village jurisdiction carries attributes.county_fips, and
// every AD/SD/CD/JD jurisdiction carries attributes.district_number — both
// stashed specifically so this resolve path has something cheap and exact to
// join on, instead of fuzzy name matching.
//
// Known, deliberate limitation: school districts are NOT resolved here.
// District boundaries cross town lines and t02 only derives clean `within`
// relations for the geographically clean cases (doc: "leave overlaps for the
// geometry pass"), so a school district's address-level containment isn't
// knowable until t03 boundaries load. Omitted rather than guessed.

export interface ResolvedJurisdiction {
  id: string;
  name: string;
  concept: string;
  local_name: string | null;
}

export interface ResolveResult {
  address: string;
  matched: ResolvedJurisdiction[];
  warnings: string[];
}

async function findByCountyFips(conceptCodes: string[], countyFips: string, name: string) {
  const { rows } = await getPool().query<{ id: string; name: string; concept: string; local_name: string | null }>(
    `select j.id, j.name, tc.code as concept, cp.local_name
       from jurisdictions j
       join type_concepts tc on tc.id = j.concept_id
       left join concept_profiles cp on cp.profile_id = j.profile_id and cp.concept_id = j.concept_id
      where tc.code = any($1)
        and j.attributes->>'county_fips' = $2
        and lower(j.name) = lower($3)
      limit 1`,
    [conceptCodes, countyFips, name],
  );
  return rows[0] ?? null;
}

async function findByDistrictNumber(conceptCode: string, districtNumber: number) {
  const { rows } = await getPool().query<{ id: string; name: string; concept: string; local_name: string | null }>(
    `select j.id, j.name, tc.code as concept, cp.local_name
       from jurisdictions j
       join type_concepts tc on tc.id = j.concept_id
       left join concept_profiles cp on cp.profile_id = j.profile_id and cp.concept_id = j.concept_id
      where tc.code = $1
        and (j.attributes->>'district_number')::int = $2
      limit 1`,
    [conceptCode, districtNumber],
  );
  return rows[0] ?? null;
}

async function findCounty(countyFips: string) {
  const { rows } = await getPool().query<{ id: string; name: string; concept: string; local_name: string | null }>(
    `select j.id, j.name, tc.code as concept, cp.local_name
       from jurisdictions j
       join type_concepts tc on tc.id = j.concept_id
       left join concept_profiles cp on cp.profile_id = j.profile_id and cp.concept_id = j.concept_id
      where tc.code = 'county'
        and j.attributes->>'county_fips' = $1
      limit 1`,
    [countyFips],
  );
  return rows[0] ?? null;
}

function districtNumberFrom(basename: string | undefined): number | null {
  if (!basename) return null;
  const n = parseInt(basename.replace(/[^0-9]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

export async function resolveApprox(address: string): Promise<ResolveResult> {
  const warnings: string[] = [];
  const geo = await geocodeAddress(address);
  if (!geo || !geo.county?.GEOID) {
    return { address, matched: [], warnings: ["No address match from the Census geocoder."] };
  }

  const countyFips = geo.county.GEOID; // 5-digit state+county FIPS
  const matched: ResolvedJurisdiction[] = [];

  const county = await findCounty(countyFips);
  if (county) matched.push(county);
  else warnings.push(`No loaded jurisdiction for county FIPS ${countyFips}.`);

  // County subdivision (MCD): a town, or a city (cities are coextensive with
  // their own MCD in NY), matched by name within the same county.
  const subdivisionName = geo.countySubdivision?.BASENAME;
  let cityOrTown: ResolvedJurisdiction | null = null;
  if (subdivisionName) {
    cityOrTown = await findByCountyFips(["town", "city"], countyFips, subdivisionName);
    if (cityOrTown) matched.push(cityOrTown);
    else warnings.push(`No loaded town/city jurisdiction named "${subdivisionName}" in county FIPS ${countyFips}.`);
  }

  // Incorporated place: a village (or the same city already matched above —
  // skip re-adding it).
  const placeName = geo.place?.BASENAME;
  if (placeName && placeName !== cityOrTown?.name) {
    const village = await findByCountyFips(["village", "city"], countyFips, placeName);
    if (village && village.id !== cityOrTown?.id) matched.push(village);
  }

  const cdNumber = districtNumberFrom(geo.congressionalDistrict?.BASENAME);
  if (cdNumber !== null) {
    const cd = await findByDistrictNumber("us_house_district", cdNumber);
    if (cd) matched.push(cd);
  }
  const sdNumber = districtNumberFrom(geo.stateSenateDistrict?.BASENAME);
  if (sdNumber !== null) {
    const sd = await findByDistrictNumber("state_senate_district", sdNumber);
    if (sd) matched.push(sd);
  }
  const adNumber = districtNumberFrom(geo.stateAssemblyDistrict?.BASENAME);
  if (adNumber !== null) {
    const ad = await findByDistrictNumber("state_house_district", adNumber);
    if (ad) matched.push(ad);
  }

  warnings.push("School district resolution requires PostGIS boundaries (t03) and is not attempted here.");

  return { address, matched, warnings };
}
