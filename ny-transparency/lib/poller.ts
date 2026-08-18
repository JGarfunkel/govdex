import { createHash } from "crypto";
import { fetchCsv } from "./csv-source";
import { parseCsvToRows } from "./parse-rows";
import { readSnapshot, writeSnapshot } from "./cache-io";
import type { Snapshot } from "./types";

let lastHash: string | null = null;
let timer: NodeJS.Timeout | null = null;

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function pollOnce(log: (msg: string) => void): Promise<void> {
  try {
    await refreshNow(log);
  } catch (err) {
    log(`ny-transparency: poll failed, keeping last-good snapshot (${(err as Error).message})`);
  }
}

export async function refreshNow(log: (msg: string) => void = console.log): Promise<Snapshot> {
  const raw = await fetchCsv();
  const hash = hashOf(raw);
  if (hash === lastHash) {
    const existing = readSnapshot();
    if (existing) return existing;
  }

  const rows = parseCsvToRows(raw);
  const snapshot: Snapshot = { sourceHash: hash, fetchedAt: new Date().toISOString(), rows };
  writeSnapshot(snapshot);
  lastHash = hash;
  log(`ny-transparency: sheet updated, ${rows.length} rows cached`);
  return snapshot;
}

export async function startPoller(intervalMs: number, log: (msg: string) => void = console.log): Promise<void> {
  const existing = readSnapshot();
  if (existing) lastHash = existing.sourceHash;

  await pollOnce(log);
  timer = setInterval(() => void pollOnce(log), intervalMs);
  timer.unref?.();
}

export function stopPoller(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
