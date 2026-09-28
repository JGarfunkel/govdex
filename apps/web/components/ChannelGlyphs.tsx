"use client";

import type { ChannelInfo, EditTarget } from "../lib/geoTypes";
import { useAuth } from "./AuthProvider";
import { govdexFetchJson } from "../lib/api";
import { EditableGlyph, type GlyphEdit } from "./EditableGlyph";

// The "Channels" glyph row: what an entity uses to communicate — email plus
// the broadcast/community platforms recorded in the `channels` table. Ports
// the glyph pattern from client/representing.html's glyphSet(): a colored,
// linked icon when a channel is present, a faint bare icon (with a "no X"
// tooltip) when it's absent or unknown. Distinct from ResourceGlyphs, which
// covers what an entity makes available (website, meetings, rules) — see the
// Entities/Resources/Channels/Capabilities split in data-dictionary.md.
const PLATFORM_GROUPS: { key: string; icon: string; label: string; color: string; platforms: string[] }[] = [
  { key: "youtube", icon: "ti-brand-youtube", label: "YouTube", color: "#FF0000", platforms: ["youtube"] },
  { key: "facebook", icon: "ti-brand-facebook", label: "Facebook", color: "#1877F2", platforms: ["facebook_page", "facebook"] },
  { key: "instagram", icon: "ti-brand-instagram", label: "Instagram", color: "#E4405F", platforms: ["instagram"] },
  { key: "bluesky", icon: "ti-brand-bluesky", label: "Bluesky", color: "#1185FE", platforms: ["bluesky"] },
  { key: "x", icon: "ti-brand-x", label: "X", color: "#111111", platforms: ["x", "twitter"] },
  { key: "discord", icon: "ti-brand-discord", label: "Discord", color: "#5865F2", platforms: ["discord"] },
  { key: "slack", icon: "ti-brand-slack", label: "Slack", color: "#4A154B", platforms: ["slack"] },
];

function Glyph({
  icon,
  label,
  color,
  href,
  edit,
}: {
  icon: string;
  label: string;
  color: string;
  href?: string | null;
  edit?: GlyphEdit;
}) {
  const title = edit ? `${label} (right-click to edit)` : `no ${label}`;
  const glyph = !href ? (
    <i className={`ti ${icon}`} title={title} />
  ) : (
    <a href={href} target="_blank" rel="noopener noreferrer" title={edit ? title : label}>
      <i className={`ti ${icon}`} style={{ color }} />
    </a>
  );
  return <EditableGlyph edit={edit}>{glyph}</EditableGlyph>;
}

export function ChannelGlyphs({
  email,
  channels,
  editTarget,
}: {
  email?: string | null;
  channels: ChannelInfo[];
  // Where an edit writes to. Body-backed rows (chief executive / governing
  // body / committees / advisory boards, and jurisdiction-backed rows with a
  // governing body) get email + channel edits; a jurisdiction with no
  // governing body has no email/channels table row to anchor an edit on —
  // see EditTarget in geoTypes.ts.
  editTarget?: EditTarget;
}) {
  const { idToken, canEdit } = useAuth();
  const editableBodyOnly = canEdit && editTarget?.table === "bodies";

  async function proposeField(table: "bodies", column: "email", newValue: string | null) {
    return govdexFetchJson<{ revisionId: string; applied: boolean }>("/propose", {
      method: "POST",
      idToken: idToken ?? undefined,
      body: JSON.stringify({
        tableName: table,
        recordId: editTarget!.id,
        op: "update",
        diff: { [column]: newValue },
      }),
    });
  }

  async function proposeChannel(existing: ChannelInfo | undefined, platform: string, newValue: string | null) {
    const recordId = existing?.id ?? crypto.randomUUID();
    const diff: Record<string, unknown> = newValue
      ? { status: "present", url: newValue, platform: existing?.platform ?? platform }
      : { status: "absent", url: null };
    if (!existing) {
      diff.body_id = editTarget!.id;
      diff.kind = "broadcast";
    }
    return govdexFetchJson<{ revisionId: string; applied: boolean }>("/propose", {
      method: "POST",
      idToken: idToken ?? undefined,
      body: JSON.stringify({ tableName: "channels", recordId, op: existing ? "update" : "insert", diff }),
    });
  }

  return (
    <div className="glyphs">
      <Glyph
        icon="ti-mail"
        label="email"
        color="#5a686e"
        href={email ? `mailto:${email}` : null}
        edit={
          editableBodyOnly ? { value: email ?? null, kind: "email", save: (v) => proposeField("bodies", "email", v) } : undefined
        }
      />
      <span className="glyph-divider" aria-hidden="true" />
      {PLATFORM_GROUPS.map((group) => {
        const channel = channels.find(
          (c) => c.platform && group.platforms.includes(c.platform) && c.status === "present" && c.url,
        );
        return (
          <Glyph
            key={group.key}
            icon={group.icon}
            label={group.label}
            color={group.color}
            href={channel?.url ?? null}
            edit={
              editableBodyOnly
                ? { value: channel?.url ?? null, kind: "url", save: (v) => proposeChannel(channel, group.platforms[0], v) }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
