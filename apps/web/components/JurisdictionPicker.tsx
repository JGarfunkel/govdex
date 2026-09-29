"use client";

import { useEffect, useState } from "react";
import { govdexFetchJson } from "../lib/api";

export interface JurisdictionResult {
  id: string;
  name: string;
  concept_code: string;
  level: string;
}

const SEARCH_DEBOUNCE_MS = 300;

// Debounced name search against GET /jurisdictions?q=…&level=…, for matching
// a spider-found special district (candidate_links link_type='district')
// against an existing jurisdiction before falling back to creating one.
// Generic (not district-specific) so it's reusable for any future
// jurisdiction-matching UI.
export function JurisdictionPicker({
  idToken,
  level,
  defaultQuery,
  onSelect,
}: {
  idToken: string | undefined;
  level?: string;
  defaultQuery?: string;
  onSelect: (result: JurisdictionResult | null) => void;
}) {
  const [query, setQuery] = useState(defaultQuery ?? "");
  const [results, setResults] = useState<JurisdictionResult[]>([]);
  const [selected, setSelected] = useState<JurisdictionResult | null>(null);

  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query });
      if (level) params.set("level", level);
      govdexFetchJson<{ jurisdictions: JurisdictionResult[] }>(`/jurisdictions?${params}`, { idToken })
        .then((d) => {
          console.log("[JurisdictionPicker] search", { query, level, count: d.jurisdictions.length });
          if (!cancelled) setResults(d.jurisdictions);
        })
        .catch((err) => {
          console.error("[JurisdictionPicker] search failed", { query, level, err });
          if (!cancelled) setResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, level, idToken, selected]);

  function select(result: JurisdictionResult) {
    setSelected(result);
    setResults([]);
    onSelect(result);
  }

  function clear() {
    setSelected(null);
    onSelect(null);
  }

  if (selected) {
    return (
      <span className="picker">
        {selected.name} <span className="entity-meta">({selected.concept_code})</span>{" "}
        <button type="button" onClick={clear}>
          change
        </button>
      </span>
    );
  }

  return (
    <span className="picker">
      <input type="text" value={query} placeholder="Search jurisdictions…" onChange={(e) => setQuery(e.target.value)} />
      {results.length > 0 && (
        <ul className="picker-results">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => select(r)}>
                {r.name} <span className="entity-meta">({r.concept_code})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
