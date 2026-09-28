"use client";

import { useState } from "react";
import type { ChannelKind } from "@govdex/shared";
import { govdexFetchJson } from "../lib/api";
import { useAuth } from "./AuthProvider";

type Answer = "unset" | "has_url" | "checked_none";

// The guided question for one channel kind. Three states, and "checked, none"
// is a deliberate extra click — the radio starts on nothing selected, never
// defaulting to "none," so a skipped question stays genuinely blank instead
// of silently becoming a false "verified absent."
export function ChannelQuestion({
  bodyId,
  kind,
  label,
  onSaved,
}: {
  bodyId: string;
  kind: ChannelKind;
  label: string;
  onSaved: () => void;
}) {
  const { idToken } = useAuth();
  const [answer, setAnswer] = useState<Answer>("unset");
  const [url, setUrl] = useState("");
  const [platform, setPlatform] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (answer === "unset" || !idToken) return;
    setSaving(true);
    setError(null);
    try {
      const status = answer === "has_url" ? "present" : "absent";
      await govdexFetchJson("/propose", {
        method: "POST",
        idToken,
        body: JSON.stringify({
          tableName: "channels",
          recordId: crypto.randomUUID(),
          op: "insert",
          diff: {
            body_id: bodyId,
            kind,
            status,
            url: status === "present" ? url : null,
            platform: status === "present" ? platform || null : null,
          },
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset style={{ marginBottom: 16, padding: 12 }}>
      <legend>{label}</legend>
      <label style={{ display: "block" }}>
        <input type="radio" name={`${kind}-answer`} checked={answer === "has_url"} onChange={() => setAnswer("has_url")} />
        {" "}Yes — paste the link
      </label>
      {answer === "has_url" && (
        <div style={{ marginLeft: 24, marginTop: 4 }}>
          <input type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} style={{ width: "100%", maxWidth: 400 }} />
          <br />
          <input type="text" placeholder="platform (e.g. facebook_group)" value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ width: "100%", maxWidth: 400, marginTop: 4 }} />
        </div>
      )}
      <label style={{ display: "block", marginTop: 4 }}>
        <input type="radio" name={`${kind}-answer`} checked={answer === "checked_none"} onChange={() => setAnswer("checked_none")} />
        {" "}No — checked, none exists
      </label>
      <button type="button" disabled={answer === "unset" || saving} onClick={save} style={{ marginTop: 8 }}>
        {saving ? "Saving…" : "Save"}
      </button>
      {error && <p className="warning">{error}</p>}
    </fieldset>
  );
}
