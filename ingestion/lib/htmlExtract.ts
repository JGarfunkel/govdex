// Config-driven HTML directory extraction (cheerio) for the loader's
// `websites` sources — see WebsitesSpec in sourceSpec.ts and the examples in
// ma.yaml (sources.municipalities.websites) and ca.yaml. No I/O except
// fetchHtml; extractEntries is pure.
import * as cheerio from "cheerio";
import { coerce, type Coercion, type WebsitesSpec } from "./sourceSpec";

export interface ExtractedEntry {
  name: string;
  website: string | null;
  fields: Record<string, unknown>; // every entry field, coerced
}

export async function fetchHtml(url: string): Promise<string> {
  // A browser-ish UA gets a Cloudflare challenge on some hosts (mma.org); a
  // plain tool UA is what was verified to work.
  const res = await fetch(url, { headers: { "User-Agent": "GovdexIngestion/0.1" } });
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText} (${url})`);
  return res.text();
}

type Ref = string | { select: string; as?: Coercion };

function splitRef(ref: Ref): { selector: string; attr: string | null; as?: Coercion } {
  const raw = typeof ref === "string" ? ref : ref.select;
  const at = raw.lastIndexOf("@");
  const selector = at === -1 ? raw : raw.slice(0, at);
  const attr = at === -1 ? null : raw.slice(at + 1);
  return { selector: selector.trim(), attr, as: typeof ref === "string" ? undefined : ref.as };
}

export function extractEntries(html: string, entry: WebsitesSpec["entry"]): ExtractedEntry[] {
  const $ = cheerio.load(html);
  const scope = entry.container ? $(entry.container).first() : $.root();
  const out: ExtractedEntry[] = [];

  scope.find(entry.rows).each((_, el) => {
    const row = $(el);
    const fields: Record<string, unknown> = {};
    for (const [key, ref] of Object.entries(entry.fields)) {
      const { selector, attr, as } = splitRef(ref as Ref);
      const target = selector ? row.find(selector).first() : row;
      const raw = attr ? target.attr(attr) : target.text().replace(/\s+/g, " ");
      fields[key] = coerce(raw, as);
    }
    const name = typeof fields.name === "string" ? fields.name : "";
    if (!name) return;
    out.push({ name, website: typeof fields.website === "string" ? fields.website : null, fields });
  });
  return out;
}
