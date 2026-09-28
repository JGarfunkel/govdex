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
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}
