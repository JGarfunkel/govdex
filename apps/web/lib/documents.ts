import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

// cwd is the repo root under the root server/index.ts process (which mounts
// this Next app), but apps/web when run via `next dev`/`next build` directly.
const CONTENT_DIR = [
  path.join(process.cwd(), "apps", "web", "content"),
  path.join(process.cwd(), "content"),
].find((dir) => existsSync(dir)) ?? path.join(process.cwd(), "content");

export async function readDocumentHtml(slug: string): Promise<string> {
  const html = await readFile(path.join(CONTENT_DIR, `${slug}.html`), "utf8");
  // Normalize CRLF (checked out as-is on Windows) to LF -- otherwise the raw
  // \r\n ends up in the dangerouslySetInnerHTML string while the browser's
  // HTML parser normalizes it to \n, causing a hydration mismatch.
  return html.replace(/\r\n/g, "\n");
}

// Docs served at /about/[slug]. "about" itself lives at /about via its own
// static page.tsx, not through this map. Add an entry + matching
// content/{slug}.html to publish a new one.
export const aboutDocs = {
  "gov-structures": "Understanding US Government Structures",
  "gov-guide": "Guide for Governments",
  faq: "FAQ",
} as const;

export type AboutDocSlug = keyof typeof aboutDocs;
