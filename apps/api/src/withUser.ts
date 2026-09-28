import type { PoolClient } from "pg";
import { getPool } from "./db";

// Run a handler in a transaction with app.user_id set for the duration.
// This is the load-bearing piece: every user-driven write goes through it, so
// the enforce_field_policies() and stamp_origin() triggers in schema.sql can
// see who's writing. Ingestion scripts never call this, so their writes stay
// origin='import'.
export async function withUser<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [userId]); // true = local to txn
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
