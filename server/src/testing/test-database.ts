import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { closePool, createDatabasePool } from "../config/database.js";
import { config } from "../config/index.js";
import { migrate } from "../db/migrate.js";

// Test helpers only (excluded from the production build).
//
// Database tests run only when DATABASE_URL is set (server/.env), so `npm test` still passes on a
// machine without Docker. Each test file gets its own throwaway schema, created here and dropped
// afterwards: tests never read or change the real tables in `public`.

export const TEST_DATABASE_URL = config.database.url;

/** Use as `describe.skipIf(!hasTestDatabase)` for tests that need PostgreSQL. */
export const hasTestDatabase = TEST_DATABASE_URL !== null;

export interface TestDatabase {
  pool: Pool;
  schema: string;
  /** Drop the schema and close both pools. */
  drop(): Promise<void>;
}

/** Create an empty schema and a pool whose search_path points at it. Optionally run migrations. */
export async function createTestDatabase(options: { migrate?: boolean } = {}): Promise<TestDatabase> {
  if (!TEST_DATABASE_URL) throw new Error("DATABASE_URL is not set; guard the test with hasTestDatabase");
  const schema = `test_${randomBytes(6).toString("hex")}`;

  const admin = createDatabasePool(TEST_DATABASE_URL, { max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = createDatabasePool(TEST_DATABASE_URL, { searchPath: schema });
  if (options.migrate) await migrate(pool);

  return {
    pool,
    schema,
    async drop() {
      await closePool(pool);
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await closePool(admin);
    },
  };
}
