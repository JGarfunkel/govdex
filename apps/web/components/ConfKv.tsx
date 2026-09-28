import type { ReactNode } from "react";

// Generic key/value renderer for a state's locale-pack YAML (see
// apps/web/app/[state]/conf/page.tsx). Deliberately doesn't hardcode field
// names from ConceptProfile/GovernanceEntry/sources' shapes — it renders
// whatever keys are actually present in the parsed YAML, so this stays a
// true mirror of the file for review instead of drifting from it.
export function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderValue(value: unknown): ReactNode {
  if (value === undefined || value === null) return <span className="field-blank">—</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="field-blank">—</span>;
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return value.join(", ");
    }
    return (
      <ul className="kv-sublist">
        {value.map((v, i) => (
          <li key={i}>{renderValue(v)}</li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    return <ConfKvTable data={value as Record<string, unknown>} />;
  }
  return String(value);
}

export function ConfKvTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <p className="field-blank">No fields.</p>;
  return (
    <div className="kv-list">
      {entries.map(([key, value]) => (
        <div className="kv-row" key={key}>
          <span className="kv-label">{humanize(key)}</span>
          <span className="kv-value">{renderValue(value)}</span>
        </div>
      ))}
    </div>
  );
}
