import type { Pool, PoolClient } from "pg";

// Small caches so every ingestion script doesn't re-query the (tiny, static)
// lookup tables per row.

export async function getConceptIds(db: Pool | PoolClient): Promise<Record<string, number>> {
  const { rows } = await db.query<{ id: number; code: string }>("select id, code from type_concepts");
  return Object.fromEntries(rows.map((r) => [r.code, r.id]));
}

export async function getProfileId(db: Pool | PoolClient, code: string): Promise<number> {
  const { rows } = await db.query<{ id: number }>("select id from profiles where code = $1", [code]);
  if (!rows[0]) throw new Error(`Profile ${code} not found — did you run govdex:seed?`);
  return rows[0].id;
}

export async function getBodyCategoryId(db: Pool | PoolClient, code: string): Promise<number> {
  const { rows } = await db.query<{ id: number }>("select id from body_categories where code = $1", [code]);
  if (!rows[0]) throw new Error(`Body category ${code} not found — did you run govdex:seed?`);
  return rows[0].id;
}
