import Link from "next/link";
import { aboutDocs } from "../lib/documents";
import { SiteMenu } from "./SiteMenu";

const aboutItems = [
  { href: "/about", label: "About" },
  ...Object.entries(aboutDocs).map(([slug, title]) => ({ href: `/about/${slug}`, label: title })),
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="site-header-brand">
        GovDex
      </Link>
      <nav>
        <SiteMenu label="About" items={aboutItems} />
      </nav>
    </header>
  );
}
