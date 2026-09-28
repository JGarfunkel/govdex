import { Suspense } from "react";
import { getDomainGroups } from "../lib/get-assessed-rows";
import { TransparencyTable } from "../components/transparency-table";
import { RefreshButton } from "../components/refresh-button";

export const dynamic = "force-dynamic";

export default function Page() {
  const { groups, fetchedAt } = getDomainGroups();

  return (
    <>
      <main className="page">
        <header className="page-header lede">
          <h1>NYC vs. NYS Open Data Transparency</h1>
          <p>
            This page surveys the exposure dashboards New York City and New York State
            publish and scores each against the same four questions: is the data collected
            at all, can you see it on a map and over time, how fine is its grain, and how far
            behind is it. Every domain gets a City row and a State row, banded together, so
            the two read against each other directly.
          </p>

          <details className="disclosure">
            <summary>Scope</summary>
            <p>
              The focus here is on "harm exposure dashboards" which focus on everyday concerns --
              roads, crime, restaurants, schools.
                Budget and zoning each warrant a            place-based explorer of their own, which we'll be building separately. Nationwide
              real-time networks like PurpleAir span every jurisdiction at once, which puts
              them outside a city-versus-state comparison.
            </p>
          </details>

          <details className="disclosure">
            <summary>Findings</summary>
            <p>
              First, the city usually leads. Where both jurisdictions publish, the city's
              dashboard tends to be finer and fresher. Residents outside the five boroughs
              fall back on the state's — for traffic and restaurant inspections a usable state
              version exists, but for much else the capability is thin, or it's unclear
              whether the state offers it at all.
            </p>
            <p>
              Second, there is lag in the data and it's not clearly disclosed. For example, the
              city provides detailed dataset pages underlying each graph and dashboard; some of
              them are marked as "updated daily" -- yet their contents list being updated a few
              weeks ago. Additionally a dataset's refresh rate isn't the inspection rate behind it — an
              establishment is inspected only every so often, so a posted result can be old on
              a dashboard that refreshed this morning; what the reader needs, and rarely gets,
              is how often the underlying inspections actually happen. The NYPD dashboards show
              a last-updated date but no cadence and no next-publication date.
              NYSED reporting runs more than a year behind with no explanation for the delay.
            </p>
            <p>
              Third — and this one is a pattern we're still evaluating, not a firm conclusion —
              dashboards are hard to find. We found many dashboards through a Google search; this
              was far easier than trying to find via an agency's front page.
              deep, and they rarely surface on an agency's front page or in its press. We want
              to quantify this before drawing a conclusion. Some of the burial is ordinary —
              any leader wants to control the timing and framing of what gets attention, and
              that's part of the job, not evidence of bad faith — but with greater findability,
              the dashboards would invite more use and more scrutiny, improving their quality.
            </p>
          </details>

          <div className="fetched-row">
            {fetchedAt && (
              <p className="fetched-at">
                Source data last updated {new Date(fetchedAt).toLocaleString("en-US")}.
              </p>
            )}
            <RefreshButton />
          </div>
        </header>

        {groups.length === 0 ? (
          <p className="empty">No data available yet — check back shortly.</p>
        ) : (
          <Suspense fallback={null}>
            <TransparencyTable groups={groups} />
          </Suspense>
        )}
      </main>

      <footer className="page-footer">
        <a href="https://civillyengaged.org/" target="_blank" rel="noopener noreferrer">
          <img
            src="https://civillyengaged.org/civillyengaged.jpg"
            alt="Civilly Engaged"
            className="page-footer-logo"
          />
        </a>
        <p className="page-footer-text">
          <a href="https://civillyengaged.org/" target="_blank" rel="noopener noreferrer">
            civillyengaged.org
          </a>
          {" · "}
          <a href="mailto:civillyengaged@gmail.com">civillyengaged@gmail.com</a>
        </p>
      </footer>
    </>
  );
}
