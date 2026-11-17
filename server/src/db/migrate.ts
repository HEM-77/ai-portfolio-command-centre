import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Pool } from "pg";
import { query, withTransaction } from "../config/database.js";

// Minimal, repeatable SQL migrations: numbered .sql files in server/db/migrations/, applied in
// order, each in its own transaction, and recorded in schema_migrations with a checksum.
// No framework: the whole mechanism is this file.

/** server/db/migrations, resolved from this file so it works from src/ (tsx) and dist/ (node). */
export const DEFAULT_MIGRATIONS_DIR = resolve(import.meta.dirname, "..", "..", "db", "migrations");

/** Any constant works; it only has to be the same for every process running migrations. */
const MIGRATION_LOCK_KEY = 4_202_611;

const MIGRATION_FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface Migration {
  version: string; // "0001"
  name: string; // "0001_initial_schema.sql"
  sql: string;
  checksum: string; // sha256 of the file, so an edited, already-applied migration is detected
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function readMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Promise<Migration[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const migrations: Migration[] = [];
  const versions = new Set<string>();
  for (const name of names) {
    const match = MIGRATION_FILE_PATTERN.exec(name);
    if (!match?.[1]) throw new Error(`Migration file "${name}" must be named like 0001_description.sql`);
    if (versions.has(match[1])) throw new Error(`Two migrations share version ${match[1]}`);
    versions.add(match[1]);
    // Normalise line endings so a CRLF checkout has the same checksum as LF.
    const sql = (await readFile(join(dir, name), "utf8")).replace(/\r\n/g, "\n");
    migrations.push({ version: match[1], name, sql, checksum: createHash("sha256").update(sql).digest("hex") });
  }
  return migrations;
}

/**
 * Apply every pending migration. Safe to run repeatedly and concurrently: an advisory lock
 * serialises runners, applied versions are skipped, and a changed checksum stops the run
 * (fix forward with a new migration instead of editing an applied one).
 */
export async function migrate(pool: Pool, dir: string = DEFAULT_MIGRATIONS_DIR): Promise<MigrationResult> {
  const migrations = await readMigrations(dir);
  const result: MigrationResult = { applied: [], alreadyApplied: [] };

  for (const migration of migrations) {
    await withTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version     text PRIMARY KEY,
          name        text NOT NULL,
          checksum    text NOT NULL,
          applied_at  timestamptz NOT NULL DEFAULT now()
        )`);

      const [existing] = await query<{ checksum: string }>(
        client,
        "SELECT checksum FROM schema_migrations WHERE version = $1",
        [migration.version],
      );
      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.name} was changed after it was applied. Add a new migration instead of editing it.`,
          );
        }
        result.alreadyApplied.push(migration.name);
        return;
      }

      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [
        migration.version,
        migration.name,
        migration.checksum,
      ]);
      result.applied.push(migration.name);
    });
  }
  return result;
}

/** Names of migrations on disk that the database has not applied yet. */
export async function pendingMigrations(pool: Pool, dir: string = DEFAULT_MIGRATIONS_DIR): Promise<string[]> {
  const migrations = await readMigrations(dir);
  const [table] = await query<{ exists: boolean }>(pool, "SELECT to_regclass('schema_migrations') IS NOT NULL AS exists");
  if (!table?.exists) return migrations.map((m) => m.name);
  const applied = new Set(
    (await query<{ version: string }>(pool, "SELECT version FROM schema_migrations")).map((r) => r.version),
  );
  return migrations.filter((m) => !applied.has(m.version)).map((m) => m.name);
}
