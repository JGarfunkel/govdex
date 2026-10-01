"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

// Header button plus a right-hand panel showing the legend (content/legend.html).
// The panel is non-modal: the page stays usable beside it so a reader can
// compare glyphs against a row. Styled after civillyengaged.org's sidebar.css
// (aside.sidebar + close ×) but implemented in React rather than loading its
// sidebar.js, which positions asides imperatively against an in-content
// trigger and expects a `.js` class on <html>. The panel is portaled to <body>
// because .site-header's backdrop-filter makes it the containing block for
// position: fixed descendants, which would collapse the panel to the header's height.
export function LegendToggle({ html }: { html: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  // The standalone /about/legend page already shows the same content.
  const onLegendPage = pathname === "/about/legend";

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (onLegendPage) return null;

  return (
    <>
      <button
        type="button"
        className="site-menu-button"
        aria-expanded={open}
        aria-controls="legend-panel"
        onClick={() => setOpen((o) => !o)}
      >
        <i className="ti ti-info-circle" /> Legend
      </button>
      {mounted &&
        createPortal(
          <aside
            id="legend-panel"
            className={`legend-panel${open ? " is-open" : ""}`}
            aria-label="Legend"
            aria-hidden={!open}
          >
            <button
              type="button"
              className="legend-panel-close"
              aria-label="Close legend"
              onClick={() => setOpen(false)}
            >
              &times;
            </button>
            <div
              className="legend-panel-body"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </aside>,
          document.body,
        )}
    </>
  );
}
