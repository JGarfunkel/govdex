// copy-to-neon — one-shot copy of the local Docker Postgres data into an empty
// NeonDB database that already has the schema applied (packages/db/schema.sql
// or migrations/0001_init.sql, run by hand with psql against the DIRECT string).
//
// How it works: pg_dump --data-only / pg_restore run *inside* the local db
// container (it has the matching PG 16 client tools, so nothing needs
// installing on the host), connecting out to Neon. The restore is one
// transaction with --exit-on-error, so a failure leaves Neon untouched.
// A data-only load is safe here: the stamp_origin / guard_user_role triggers
// only act when app.user_id is set, which a bulk load never does, so `origin`
// survives. updated_at is rewritten by set_updated_at — accepted.
//
// Not copied: schema_migrations (baselined instead), field_policies (seeded by
// schema.sql), website_problems (superseded by frictions), spatial_ref_sys
// (PostGIS internals). The local dev user is copied (other rows reference it)
// but neutralised: firebase_uid nulled and demoted to viewer. Promote your real
// admin after first sign-in (the script prints the SQL).
//
// Usage (NEON_DIRECT_URL = Neon's *direct* string, not the -pooler one):
//   NEON_DIRECT_URL=postgresql://... npx tsx ingestion/tools/copy-to-neon.ts           dry run: preflight only
//   NEON_DIRECT_URL=postgresql://... npx tsx ingestion/tools/copy-to-neon.ts --write   copy + verify
//   --container <name>   local db container (default: whichever publishes host port 5433)
import "dotenv/config";
import { execFileSync, spawnSync } from "node:child_process";
import { Pool } from "pg";
import { getPool } from "@govdex/db";

const EXCLUDE_TABLES = ["schema_migrations", "field_policies", "website_problems", "spatial_ref_sys"];
const DEV_USER_UID = "local-dev";
const DUMP_PATH = "/tmp/govdex-copy.dump";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function mask(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.username}:***@${u.host}${u.pathname}`;
}

function q(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

async function publicTables(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
  );
  return rows.map((r) => r.table_name);
}

async function countRows(pool: Pool, tables: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const t of tables) {
    const { rows } = await pool.query<{ n: string }>(`select count(*) as n from public.${q(t)}`);
    counts.set(t, Number(rows[0].n));
  }
  return counts;
}

function findContainer(): string {
  const explicit = arg("--container");
  if (explicit) return explicit;
  const out = execFileSync("docker", ["ps", "--filter", "publish=5433", "--format", "{{.Names}}"], {
    encoding: "utf8",
  }).trim();
  const names = out.split(/\r?\n/).filter(Boolean);
  if (names.length !== 1) {
    throw new Error(`Expected exactly one container publishing port 5433, found [${names.join(", ")}]; pass --container <name>`);
  }
  return names[0];
}

async function main() {
  const write = process.argv.includes("--write");
  const neonUrl = process.env.NEON_DIRECT_URL;
  const localUrl = process.env.DATABASE_URL;
  if (!neonUrl) throw new Error("NEON_DIRECT_URL is not set (use Neon's DIRECT connection string)");
  if (!localUrl) throw new Error("DATABASE_URL (the local db) is not set");

  const neonHost = new URL(neonUrl).hostname;
  if (neonHost.includes("-pooler")) {
    throw new Error("NEON_DIRECT_URL points at the pooled (-pooler) host; use the direct string for a bulk restore");
  }
  if (/^(localhost|127\.|::1)/.test(neonHost) || neonUrl === localUrl) {
    throw new Error("NEON_DIRECT_URL looks like the local database — refusing");
  }

  const local = getPool();
  const neon = new Pool({ connectionString: neonUrl });
  try {
    console.log(`Local: ${mask(localUrl)}\nNeon:  ${mask(neonUrl)}\n`);

    // --- Preflight -----------------------------------------------------------
    const [localTables, neonTables] = await Promise.all([publicTables(local), publicTables(neon)]);
    if (neonTables.length === 0) {
      throw new Error("Neon has no tables in public — apply packages/db/migrations/0001_init.sql first");
    }
    const copyTables = localTables.filter((t) => !EXCLUDE_TABLES.includes(t));

    const localCounts = await countRows(local, copyTables);
    const missingOnNeon = copyTables.filter((t) => !neonTables.includes(t));
    const missingWithRows = missingOnNeon.filter((t) => (localCounts.get(t) ?? 0) > 0);
    if (missingWithRows.length) {
      throw new Error(
        `Local tables with rows but absent from Neon's schema: ${missingWithRows.join(", ")} ` +
          `(local schema is behind/ahead of schema.sql — reconcile before copying)`,
      );
    }
    const toCopy = copyTables.filter((t) => neonTables.includes(t));

    const neonCounts = await countRows(neon, toCopy);
    const dirty = toCopy.filter((t) => (neonCounts.get(t) ?? 0) > 0);
    if (dirty.length) {
      throw new Error(
        `Neon tables already contain rows: ${dirty.map((t) => `${t}=${neonCounts.get(t)}`).join(", ")}. ` +
          `Start from an empty schema (drop schema public cascade; re-apply 0001_init.sql, or use a fresh Neon branch).`,
      );
    }

    const total = toCopy.reduce((s, t) => s + (localCounts.get(t) ?? 0), 0);
    console.log(`Preflight OK: ${toCopy.length} tables, ${total} rows to copy; Neon tables are empty.`);
    console.log(`Excluded: ${EXCLUDE_TABLES.join(", ")}`);
    for (const t of toCopy) if ((localCounts.get(t) ?? 0) > 0) console.log(`  ${t.padEnd(28)} ${localCounts.get(t)}`);

    if (!write) {
      console.log("\nDry run — nothing copied. Re-run with --write to copy.");
      return;
    }

    // --- Copy ----------------------------------------------------------------
    const container = findContainer();
    const { username, pathname } = new URL(localUrl);
    const localDb = pathname.replace(/^\//, "");
    const localUser = decodeURIComponent(username);
    console.log(`\nDumping from container ${container}...`);
    const excludeArgs = EXCLUDE_TABLES.flatMap((t) => ["-T", t]);
    execFileSync(
      "docker",
      ["exec", container, "pg_dump", "-U", localUser, "-d", localDb, "--data-only", "-Fc", "--no-owner", "--no-acl", "-n", "public", ...excludeArgs, "-f", DUMP_PATH],
      { stdio: ["ignore", "ignore", "ignore"] }, // pg_dump warns about circular FKs; the restore is what must succeed
    );

    console.log("Restoring into Neon (single transaction)...");
    try {
      execFileSync(
        "docker",
        ["exec", "-e", `NEON_URL=${neonUrl}`, container, "sh", "-c",
          `pg_restore --data-only --single-transaction --exit-on-error --no-owner --no-acl -d "$NEON_URL" ${DUMP_PATH}`],
        { stdio: "inherit" },
      );
    } finally {
      execFileSync("docker", ["exec", container, "rm", "-f", DUMP_PATH], { stdio: "ignore" });
    }

    // --- Post-copy -----------------------------------------------------------
    const r = await neon.query(
      `update users set firebase_uid = null, global_role = 'viewer' where firebase_uid = $1`,
      [DEV_USER_UID],
    );
    console.log(`Neutralised local dev user (${r.rowCount} row).`);

    console.log("Baselining schema_migrations on Neon...");
    const base = spawnSync("npx", ["tsx", "packages/db/src/migrate.ts", "--baseline"], {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, DATABASE_URL: neonUrl },
    });
    if (base.status !== 0) throw new Error("migrate.ts --baseline failed");

    // --- Verify --------------------------------------------------------------
    const after = await countRows(neon, toCopy);
    const mismatches = toCopy.filter((t) => after.get(t) !== localCounts.get(t));
    if (mismatches.length) {
      for (const t of mismatches) console.error(`MISMATCH ${t}: local=${localCounts.get(t)} neon=${after.get(t)}`);
      throw new Error("Row counts differ after copy");
    }
    console.log(`\nVerified: all ${toCopy.length} tables match (${total} rows).`);
    console.log(
      `\nNext: deploy with the POOLED string as DATABASE_URL. After your first real sign-in, promote yourself:\n` +
        `  update users set global_role = 'admin' where email = '<your google email>';`,
    );
  } finally {
    await neon.end();
    await local.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
