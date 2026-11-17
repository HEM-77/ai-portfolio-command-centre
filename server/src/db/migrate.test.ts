import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query } from "../config/database.js";
import { createTestDatabase, hasTestDatabase, type TestDatabase } from "../testing/test-database.js";
import { DEFAULT_MIGRATIONS_DIR, migrate, pendingMigrations, readMigrations } from "./migrate.js";

describe("readMigrations (no database needed)", () => {
  it("finds the numbered SQL files in order with checksums", async () => {
    const migrations = await readMigrations();
    expect(migrations.map((m) => m.name)).toEqual(["0001_initial_schema.sql"]);
    expect(migrations[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a badly named migration file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrations-"));
    try {
      await writeFile(join(dir, "init.sql"), "SELECT 1;");
      await expect(readMigrations(dir)).rejects.toThrow(/must be named like 0001_description.sql/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasTestDatabase)("migrate (PostgreSQL)", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("applies pending migrations once, then reports them as already applied", async () => {
    expect(await pendingMigrations(db.pool)).toEqual(["0001_initial_schema.sql"]);
    expect(await migrate(db.pool)).toEqual({ applied: ["0001_initial_schema.sql"], alreadyApplied: [] });
    expect(await migrate(db.pool)).toEqual({ applied: [], alreadyApplied: ["0001_initial_schema.sql"] });
    expect(await pendingMigrations(db.pool)).toEqual([]);
  });

  it("creates exactly the expected tables in the target schema", async () => {
    const rows = await query<{ table_name: string }>(
      db.pool,
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
      [db.schema],
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "cost_benefit", "fx_rates", "ingestion_issues", "ingestion_runs", "initiatives", "schema_migrations", "weekly_usage",
    ]);
  });

  it("creates the indexes on initiative IDs and dates", async () => {
    const rows = await query<{ indexname: string }>(db.pool, "SELECT indexname FROM pg_indexes WHERE schemaname = $1", [db.schema]);
    expect(rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining(["weekly_usage_pkey", "weekly_usage_week_ending_idx", "cost_benefit_pkey", "cost_benefit_period_idx"]),
    );
  });

  it("stops if an applied migration file was edited", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrations-"));
    try {
      await cp(DEFAULT_MIGRATIONS_DIR, dir, { recursive: true });
      const file = join(dir, "0001_initial_schema.sql");
      await writeFile(file, `${await readFile(file, "utf8")}\n-- edited\n`);
      await expect(migrate(db.pool, dir)).rejects.toThrow(/was changed after it was applied/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rolls back a failing migration completely", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrations-"));
    try {
      await cp(DEFAULT_MIGRATIONS_DIR, dir, { recursive: true });
      await writeFile(join(dir, "0002_broken.sql"), "CREATE TABLE half_done (id int);\nSELECT no_such_function();");
      await expect(migrate(db.pool, dir)).rejects.toThrow();
      const [row] = await query<{ exists: boolean }>(db.pool, "SELECT to_regclass('half_done') IS NOT NULL AS exists");
      expect(row?.exists).toBe(false);
      expect(await pendingMigrations(db.pool, dir)).toEqual(["0002_broken.sql"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
