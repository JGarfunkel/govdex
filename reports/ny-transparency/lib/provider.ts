// A row's `provider` is freeform sheet text; "ngo" is the only third-party
// value in use today, but this is the single place that decision lives so
// grading (build-domains.ts) and display (transparency-table.tsx) agree.
export function isThirdPartyProvider(provider: string): boolean {
  return provider.trim().toLowerCase() === "ngo";
}
