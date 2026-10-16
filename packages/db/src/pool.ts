import { Pool } from "pg";

let pool: Pool | undefined;

// Single shared pool for the whole process (API server and ingestion scripts
// each create their own process, so this is one pool per process, not global
// across processes). Lazily constructed so importing this module never fails
// just because DATABASE_URL isn't set yet (e.g. during `tsc --noEmit`).
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      // Include what this process actually sees (never the value) so a
      // deployed "not set" can be told apart from empty / wrong-process.
      const raw = process.env.DATABASE_URL;
      const dbKeys = Object.keys(process.env).filter((k) => k.toUpperCase().includes("DATABASE"));
      throw new Error(
        `DATABASE_URL is not set (typeof=${typeof raw}, length=${raw?.length ?? "n/a"}, pid=${process.pid}, DATABASE* keys: ${dbKeys.join(", ") || "none"})`,
      );
    }
    // connectionTimeoutMillis: fail with an error instead of hanging forever when
    // the database is unreachable. Generous enough for a Neon cold wake-up.
    pool = new Pool({
      connectionString,
      connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 15000),
    });
    pool.on("error", (err) => console.error("[db] idle client error:", err.message));
    if (process.env.DB_SLOW_QUERY_MS !== "0") instrumentSlowQueries(pool);
  }
  return pool;
}

// Logs any pool.query slower than DB_SLOW_QUERY_MS (default 250; 0 disables),
// including time spent waiting for a connection or a Neon compute wake-up,
// which is what "pages are slow and nothing is logged" usually is.
function instrumentSlowQueries(p: Pool): void {
  const threshold = Number(process.env.DB_SLOW_QUERY_MS ?? 250);
  const original = p.query.bind(p) as (...args: unknown[]) => unknown;
  (p as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
    const start = Date.now();
    const first = args[0];
    const text = (typeof first === "string" ? first : (first as { text?: string })?.text ?? "").replace(/\s+/g, " ").trim();
    const report = () => {
      const ms = Date.now() - start;
      if (ms >= threshold) {
        console.log(`[db] ${ms}ms (pool: ${p.totalCount} total, ${p.idleCount} idle, ${p.waitingCount} waiting) ${text.slice(0, 120)}`);
      }
    };
    const result = original(...args);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      (result as Promise<unknown>).then(report, report);
    }
    return result;
  };
}

// Quick reachability probe for boot-time checks: resolves with a short
// human-readable status instead of throwing.
export async function checkDb(timeoutMs = 5000): Promise<{ ok: boolean; ms: number; error?: string }> {
  const start = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      getPool().query("select 1"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no response in ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, ms: Date.now() - start };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
