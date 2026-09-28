// Thin wrapper around the US Census Bureau's keyless geocoder. Used for the
// pre-PostGIS /resolve path: turn a free-text address into a county FIPS code
// plus county-subdivision/place names and legislative district numbers, then
// match those against jurisdictions loaded by ingestion t01 (see resolveApprox.ts).
const GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";

// Numeric layer IDs, confirmed live against the Current_Current vintage
// (Aug 2026): 54=congressional, 52=state senate (upper), 50=state assembly
// (lower). Requested by numeric id because the *response* key for these is
// versioned text ("119th Congressional Districts", "2024 State Legislative
// Districts - Upper") that changes on redistricting/reapportionment — the id
// stays stable even when the label does, but the key name still has to be
// pattern-matched below rather than looked up exactly.
const LAYERS = ["Counties", "County Subdivisions", "Incorporated Places", "54", "52", "50"].join(",");

// KNOWN LIVE-TESTED QUIRK: the Census geocoder reliably returns the
// congressional layer (54) in a combined request, but state senate/assembly
// (52/50) came back inconsistently when combined with other layers in the
// same request during testing (sometimes present, sometimes silently
// dropped) — this looks like a server-side limit/flakiness on their end, not
// a bug in how they're requested here (isolated requests for 52/50 alone
// also varied run to run). resolveApprox.ts already treats a missing
// district as "not resolved" rather than an error, so this degrades
// gracefully; a more reliable fix would be a second, separate geocoder call
// per district layer if this needs to be dependable in production.

function findGeographyKey(geographies: Record<string, unknown>, pattern: RegExp): string | undefined {
  return Object.keys(geographies).find((k) => pattern.test(k));
}

export interface CensusGeography {
  GEOID?: string;
  NAME?: string;
  BASENAME?: string;
  [key: string]: unknown;
}

export interface CensusGeocodeResult {
  county?: CensusGeography;
  countySubdivision?: CensusGeography;
  place?: CensusGeography;
  congressionalDistrict?: CensusGeography;
  stateSenateDistrict?: CensusGeography;
  stateAssemblyDistrict?: CensusGeography;
}

export async function geocodeAddress(address: string): Promise<CensusGeocodeResult | null> {
  const url = new URL(GEOCODER_URL);
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("layers", LAYERS);
  url.searchParams.set("format", "json");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Census geocoder returned ${res.status}`);
  }
  const body = await res.json();
  const match = body?.result?.addressMatches?.[0];
  if (!match) return null;

  const geographies: Record<string, CensusGeography[] | undefined> = match.geographies ?? {};
  const congressionalKey = findGeographyKey(geographies, /Congressional Districts$/);
  const senateKey = findGeographyKey(geographies, /State Legislative Districts - Upper$/);
  const assemblyKey = findGeographyKey(geographies, /State Legislative Districts - Lower$/);

  return {
    county: geographies["Counties"]?.[0],
    countySubdivision: geographies["County Subdivisions"]?.[0],
    place: geographies["Incorporated Places"]?.[0],
    congressionalDistrict: congressionalKey ? geographies[congressionalKey]?.[0] : undefined,
    stateSenateDistrict: senateKey ? geographies[senateKey]?.[0] : undefined,
    stateAssemblyDistrict: assemblyKey ? geographies[assemblyKey]?.[0] : undefined,
  };
}
