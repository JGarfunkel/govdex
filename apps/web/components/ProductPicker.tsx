"use client";

import { useEffect, useState } from "react";
import { govdexFetchJson } from "../lib/api";

export interface ProductResult {
  id: string;
  name: string;
  vendor: string;
  function_code: string;
}

const SEARCH_DEBOUNCE_MS = 300;

// Debounced search against GET /products?vendor=…&function=…, for matching a
// spider-found GovTech vendor hit (candidate_links link_type='vendor')
// against an existing catalog product before falling back to adding a new
// one. Auto-selects when the search returns exactly one match — a vendor
// like Granicus can host several distinct products, so this is the direct
// disambiguation UI: one result pre-selects, several require the editor to
// pick, none means "add new product" is the only path.
export function ProductPicker({
  idToken,
  vendor,
  functionCode,
  onSelect,
  onResultsChange,
}: {
  idToken: string | undefined;
  vendor: string;
  functionCode?: string | null;
  onSelect: (result: ProductResult | null) => void;
  onResultsChange?: (count: number) => void;
}) {
  const [results, setResults] = useState<ProductResult[]>([]);
  const [selected, setSelected] = useState<ProductResult | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (vendor.trim().length < 2) {
      setResults([]);
      setSearched(true);
      onResultsChange?.(0);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ vendor });
    if (functionCode) params.set("function", functionCode);
    govdexFetchJson<{ products: ProductResult[] }>(`/products?${params}`, { idToken })
      .then((d) => {
        if (cancelled) return;
        setResults(d.products);
        setSearched(true);
        onResultsChange?.(d.products.length);
        if (d.products.length === 1) {
          setSelected(d.products[0]);
          onSelect(d.products[0]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResults([]);
          setSearched(true);
          onResultsChange?.(0);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor, functionCode, idToken]);

  function select(result: ProductResult) {
    setSelected(result);
    onSelect(result);
  }

  function clear() {
    setSelected(null);
    onSelect(null);
  }

  if (selected) {
    return (
      <span className="picker">
        {selected.vendor} — {selected.name}{" "}
        <button type="button" onClick={clear}>
          change
        </button>
      </span>
    );
  }

  if (!searched) return <span className="entity-meta">searching catalog…</span>;

  if (results.length === 0) {
    return <span className="entity-meta">no matching product in the catalog</span>;
  }

  return (
    <ul className="picker-results">
      {results.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => select(r)}>
            {r.vendor} — {r.name} <span className="entity-meta">({r.function_code})</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
