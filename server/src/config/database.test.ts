import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, hasTestDatabase, type TestDatabase } from "../testing/test-database.js";
import { isAppError } from "../types/app-error.js";
import { checkConnection, closePool, createDatabasePool, describeDatabaseUrl, query, withTransaction } from "./database.js";
import { isDatabaseConfigured, loadConfig } from "./index.js";

describe("database config (no database needed)", () => {
  it("reads DATABASE_URL as optional", () => {
    expect(isDatabaseConfigured(loadConfig({}))).toBe(false);
    expect(isDatabaseConfigured(loadConfig({ DATABASE_URL: "  " }))).toBe(false);
    expect(loadConfig({ DATABASE_URL: "postgres://u:p@h:5432/d" }).database.url).toBe("postgres://u:p@h:5432/d");
  });

  it("masks the password when describing the URL for logs", () => {
    const described = describeDatabaseUrl("postgres://portfolio:s3cret-pass@localhost:5432/portfolio");
    expect(described).toBe("postgres://portfolio:****@localhost:5432/portfolio");
    expect(described).not.toContain("s3cret");
    expect(describeDatabaseUrl("not a url")).toBe("(unparseable DATABASE_URL)");
  });

  it("refuses an unsafe schema name", () => {
    expect(() => createDatabasePool("postgres://u:p@localhost/d", { searchPath: "x; DROP TABLE y" })).toThrow(/Invalid schema name/);
  });

  it("reports an unreachable database as NOT_READY without exposing the password", async () => {
    const pool = createDatabasePool("postgres://user:topsecret@127.0.0.1:1/none");
    try {
      const error = await checkConnection(pool).then(() => null, (e: unknown) => e);
      expect(isAppError(error) && error.code).toBe("NOT_READY");
      expect(String((error as Error).message)).not.toContain("topsecret");
    } finally {
      await closePool(pool);
      await closePool(pool); // safe to call twice
    }
  });
});

describe.skipIf(!hasTestDatabase)("database connection (PostgreSQL)", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("connects and reports the server version", async () => {
    const info = await checkConnection(db.pool);
    expect(info.serverVersion).toMatch(/^\d+/);
  });

  it("uses the throwaway schema via search_path", async () => {
    const [row] = await query<{ schema: string }>(db.pool, "SELECT current_schema() AS schema");
    expect(row?.schema).toBe(db.schema);
  });

  it("returns date columns as ISO strings, not shifted JS Dates", async () => {
    const [row] = await query<{ d: unknown }>(db.pool, "SELECT '2026-11-15'::date AS d");
    expect(row?.d).toBe("2026-11-15");
  });

  it("commits a transaction on success and rolls it back on error", async () => {
    await query(db.pool, "CREATE TABLE tx_probe (id int PRIMARY KEY)");
    await withTransaction(db.pool, async (client) => {
      await client.query("INSERT INTO tx_probe VALUES (1)");
    });
    await expect(
      withTransaction(db.pool, async (client) => {
        await client.query("INSERT INTO tx_probe VALUES (2)");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const rows = await query<{ id: number }>(db.pool, "SELECT id FROM tx_probe ORDER BY id");
    expect(rows).toEqual([{ id: 1 }]);
  });

  it("reuses pooled connections instead of opening one per query", async () => {
    await Promise.all(Array.from({ length: 20 }, () => query(db.pool, "SELECT 1")));
    expect(db.pool.totalCount).toBeLessThanOrEqual(5);
  });
});
