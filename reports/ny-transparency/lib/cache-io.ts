import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import type { Snapshot } from "./types";

const CACHE_DIR = path.resolve(process.cwd(), "data", "ny-transparency");
const CACHE_PATH = path.join(CACHE_DIR, "cache.json");

export function readSnapshot(): Snapshot | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as Snapshot;
  } catch {
    return null;
  }
}

export function writeSnapshot(snapshot: Snapshot): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const tmpPath = `${CACHE_PATH}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), "utf-8");
  renameSync(tmpPath, CACHE_PATH);
}
