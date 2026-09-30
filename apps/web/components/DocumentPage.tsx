export function DocumentPage({ title, html }: { title: string; html: string }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-8">
      <div
        className="prose prose-neutral max-w-none font-serif prose-headings:font-sans prose-a:text-green-700"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </main>
  );
}
