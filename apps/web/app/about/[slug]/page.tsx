import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocumentPage } from "../../../components/DocumentPage";
import { aboutDocs, readDocumentHtml, type AboutDocSlug } from "../../../lib/documents";

export function generateStaticParams() {
  return Object.keys(aboutDocs).map((slug) => ({ slug }));
}

function isAboutDocSlug(slug: string): slug is AboutDocSlug {
  return slug in aboutDocs;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isAboutDocSlug(slug)) return {};
  return { title: `${aboutDocs[slug]} — GovDex` };
}

export default async function AboutDocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isAboutDocSlug(slug)) notFound();

  const title = aboutDocs[slug];
  const html = await readDocumentHtml(slug);
  return <DocumentPage title={title} html={html} />;
}
