const SHEET_ID = "10FgSvjwrlGP3a5UTtAC5x1GxaC7472EfAqnPK2_dqyE";
const GID = "510196393";

export const CSV_EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

export async function fetchCsv(): Promise<string> {
  const res = await fetch(CSV_EXPORT_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Sheet CSV fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}
