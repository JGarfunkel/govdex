// Applies migrations/*.sql in filename order, tracking progress in
// schema_migrations so re-runs only pick up new files. Each migration runs in
// its own transaction (Postgres DDL is transactional, so a failing file rolls
// back cleanly rather than leaving the schema half-applied).
//
// Usage:
//   npx tsx packages/db/src/migrate.ts            # apply pending migrations
//   npx tsx packages/db/src/migrate.ts --baseline # record pending migrations
//                                                  # as applied without running
//                                                  # them (a db that already
//                                                  # has that schema, e.g. via
//                                                  # `npm run govdex:db:schema`)
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./pool";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function ensureMigrationsTable() {
  await getPool().query(`
    create table if not exists schema_migrations (
      id         text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function pendingMigrations(): Promise<string[]> {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await getPool().query<{ id: string }>("select id from schema_migrations");
  const applied = new Set(rows.map((r) => r.id));
  return files.filter((f) => !applied.has(f));
}

async function main() {
  const baseline = process.argv.includes("--baseline");
  const pool = getPool();

  await ensureMigrationsTable();
  const pending = await pendingMigrations();

  if (pending.length === 0) {
    console.log("No pending migrations.");
  }

  for (const file of pending) {
    if (baseline) {
      await pool.query("insert into schema_migrations (id) values ($1)", [file]);
      console.log(`Baselined ${file} (not executed)`);
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (id) values ($1)", [file]);
      await client.query("commit");
      console.log(`Applied ${file}`);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
