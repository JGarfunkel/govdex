// Emergency/weather/press "alerts" sign-up or module links (CivicPlus
// CivicAlerts, Nixle, "Sign up for Alerts", etc.) are never a board,
// channel, vendor, budget, or calendar page — just noise every other
// detector would otherwise have to reject on its own (see
// detector_common.yaml's narrower reject_url "CivicAlerts" entry, which this
// supersedes for crawlSeed.ts's purposes). Filtered out before any
// classification runs, rather than recognized and rejected by each one
// individually.
const ALERT_URL_RE = /alert/i;

export function looksLikeAlertLink(url: string): boolean {
  return ALERT_URL_RE.test(url);
}
