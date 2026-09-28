"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export interface GlyphEdit {
  value: string | null;
  kind?: "url" | "email";
  // Resolves to whether the API applied the edit immediately or queued it
  // for review (see apps/api/src/routes/propose.ts's isLowRisk branch).
  save: (newValue: string | null) => Promise<{ applied: boolean }>;
}

// Wraps a glyph (an <a>/<i> pair from ResourceGlyphs, ChannelGlyphs, or
// CapabilityGlyphs) with a popover for editing the URL it points at. Renders
// children unchanged when `edit` is omitted — callers only pass it once
// AuthProvider's canEdit is true and there's an unambiguous record to write
// to (see ResourceGlyphs'/ChannelGlyphs' editTarget prop, CapabilityGlyphs'
// single-match check).
// `trigger` picks how the popover opens: "contextmenu" (the default) for
// glyphs that are themselves a working link, where a plain click needs to
// keep navigating; "click" for a glyph that exists only to open the editor
// (e.g. HeaderWebsite's standalone pencil), where a hidden right-click-only
// affordance would just look broken.
export function EditableGlyph({
  children,
  edit,
  trigger = "contextmenu",
}: {
  children: ReactNode;
  edit?: GlyphEdit;
  trigger?: "click" | "contextmenu";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (!edit) return <>{children}</>;

  function openEditor(e: React.MouseEvent) {
    e.preventDefault();
    setValue(edit!.value ?? "");
    setError(null);
    setStatus(null);
    setOpen(true);
  }

  async function submit(newValue: string | null) {
    setSaving(true);
    setError(null);
    try {
      const { applied } = await edit!.save(newValue);
      setStatus(applied ? "Saved." : "Submitted for review.");
      router.refresh();
      setTimeout(() => setOpen(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span
      className={`glyph-editable${trigger === "click" ? " glyph-editable-click" : ""}`}
      onContextMenu={trigger === "contextmenu" ? openEditor : undefined}
      onClick={trigger === "click" ? openEditor : undefined}
    >
      {children}
      {open && (
        <>
          <span className="glyph-popover-backdrop" onClick={() => setOpen(false)} />
          <span className="glyph-popover" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              value={value}
              placeholder={edit.kind === "email" ? "name@example.gov" : "https://…"}
              disabled={saving}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit(value.trim() || null);
                if (e.key === "Escape") setOpen(false);
              }}
            />
            <span className="glyph-popover-actions">
              <button type="button" disabled={saving} onClick={() => submit(value.trim() || null)}>
                {saving ? "Saving…" : "Save"}
              </button>
              {edit.value && (
                <button type="button" disabled={saving} onClick={() => submit(null)}>
                  Clear
                </button>
              )}
              <button type="button" disabled={saving} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </span>
            {status && <span className="glyph-popover-status">{status}</span>}
            {error && <span className="warning">{error}</span>}
          </span>
        </>
      )}
    </span>
  );
}
