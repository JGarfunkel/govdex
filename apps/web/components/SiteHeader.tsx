import Link from "next/link";
import { aboutDocs, readDocumentHtml } from "../lib/documents";
import { LegendToggle } from "./LegendToggle";
import { SiteMenu } from "./SiteMenu";

const aboutItems = [
  { href: "/about", label: "About" },
  ...Object.entries(aboutDocs).map(([slug, title]) => ({ href: `/about/${slug}`, label: title })),
];

export async function SiteHeader() {
  const legendHtml = await readDocumentHtml("legend");
  return (
    <header className="site-header">
      <Link href="/" className="site-header-brand">
        GovDex
      </Link>
      <nav className="site-header-nav">
        <LegendToggle html={legendHtml} />
        <SiteMenu label="About" items={aboutItems} />
      </nav>
    </header>
  );
}
