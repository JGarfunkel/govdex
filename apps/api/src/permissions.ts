import { getPool } from "./db";

// Thin read wrapper around the DB's own permission functions (can_edit_field,
// required_tier, user_edit_tier). The database is the source of truth for
// permissions — this module never reimplements the rule, it just calls it,
// both to gate writes with a clear reason before the trigger backstop fires,
// and to tell the frontend which fields to gray out.

export async function canEditField(
  userId: string,
  tableName: string,
  columnName: string | null,
  jurisdictionId: string | null,
): Promise<boolean> {
  const { rows } = await getPool().query<{ can_edit_field: boolean }>(
    "select can_edit_field($1, $2, $3, $4) as can_edit_field",
    [userId, tableName, columnName, jurisdictionId],
  );
  return rows[0]?.can_edit_field ?? false;
}

export async function requiredTier(tableName: string, columnName: string | null): Promise<string> {
  const { rows } = await getPool().query<{ required_tier: string }>(
    "select required_tier($1, $2) as required_tier",
    [tableName, columnName],
  );
  return rows[0]?.required_tier ?? "admin";
}

export async function userEditTier(userId: string, jurisdictionId: string | null): Promise<string | null> {
  const { rows } = await getPool().query<{ user_edit_tier: string | null }>(
    "select user_edit_tier($1, $2) as user_edit_tier",
    [userId, jurisdictionId],
  );
  return rows[0]?.user_edit_tier ?? null;
}
