import type { Metadata } from "next";
import { DocumentPage } from "../../components/DocumentPage";
import { readDocumentHtml } from "../../lib/documents";

export const metadata: Metadata = {
  title: "About — GovDex",
};

export default async function AboutPage() {
  const html = await readDocumentHtml("about");
  return <DocumentPage title="About" html={html} />;
}
