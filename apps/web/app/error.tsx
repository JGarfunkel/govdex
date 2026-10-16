"use client";

// Route-level error boundary: shown when a server page throws (e.g. the API
// or database is unreachable) instead of Next's blank/generic error screen.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>We couldn&apos;t load this page</h1>
      <p>
        GovDex is having trouble reaching its data right now. This is usually temporary — please try again in a minute.
      </p>
      <button onClick={reset}>Try again</button>
      {process.env.NODE_ENV !== "production" && (
        <pre style={{ marginTop: "1.5rem", whiteSpace: "pre-wrap", opacity: 0.7 }}>{error.message}</pre>
      )}
    </main>
  );
}
