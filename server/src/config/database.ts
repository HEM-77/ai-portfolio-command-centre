import pg from "pg";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { AppError } from "../types/app-error.js";

// PostgreSQL connection layer: one shared pool per process, created from config (never from
// process.env directly). See server/db/README.md for setup.

/** Postgres OID of the `date` type. */
const DATE_OID = 1082;

// Return `date` columns as the "YYYY-MM-DD" string Postgres sends. The default parser builds a
// JS Date at local midnight, which shifts the day in some time zones; the API uses ISO dates.
pg.types.setTypeParser(DATE_OID, (value: string) => value);

/** Pool limits for a single-process hackathon app: small, and failing fast rather than hanging. */
export const DATABASE_POOL_DEFAULTS = {
  max: 5,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
} as const;

export interface DatabasePoolOptions {
  /** Postgres schema to use instead of `public`. Tests use a throwaway schema per run. */
  searchPath?: string;
  max?: number;
  logger?: Pick<Console, "error">;
}

const SCHEMA_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Create the shared pool. Connections are opened lazily and reused across requests.
 * An idle client losing its connection emits "error" on the pool; without a listener that would
 * crash the process, so it is logged instead and the pool replaces the client.
 */
export function createDatabasePool(url: string, options: DatabasePoolOptions = {}): Pool {
  const { searchPath, max = DATABASE_POOL_DEFAULTS.max, logger = console } = options;
  if (searchPath !== undefined && !SCHEMA_NAME_PATTERN.test(searchPath)) {
    throw new Error(`Invalid schema name "${searchPath}"`);
  }

  const pool = new pg.Pool({
    connectionString: url,
    max,
    connectionTimeoutMillis: DATABASE_POOL_DEFAULTS.connectionTimeoutMillis,
    idleTimeoutMillis: DATABASE_POOL_DEFAULTS.idleTimeoutMillis,
    ...(searchPath ? { options: `-c search_path=${searchPath}` } : {}),
  });
  pool.on("error", (error) => {
    logger.error(`[db] Idle database client error: ${error.message}`);
  });
  return pool;
}

/** Run one parameterised query on any pool or client. Never build SQL by string concatenation. */
export async function query<Row extends QueryResultRow>(
  db: Pool | PoolClient,
  text: string,
  params: readonly unknown[] = [],
): Promise<Row[]> {
  const result = await db.query<Row>(text, params as unknown[]);
  return result.rows;
}

/**
 * Run `work` inside a transaction on one pooled client: COMMIT on success, ROLLBACK on any error
 * (which is rethrown). The client is always released back to the pool.
 */
export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await connect(pool);
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined); // the original error matters more
    throw error;
  } finally {
    client.release();
  }
}

/** Check that the database answers. Throws NOT_READY with a message that contains no credentials. */
export async function checkConnection(pool: Pool): Promise<{ serverVersion: string; database: string }> {
  const client = await connect(pool);
  try {
    const [row] = await query<{ server_version: string; database: string }>(
      client,
      "SELECT current_setting('server_version') AS server_version, current_database() AS database",
    );
    return { serverVersion: row?.server_version ?? "unknown", database: row?.database ?? "unknown" };
  } finally {
    client.release();
  }
}

/** Close every connection. Safe to call more than once. */
export async function closePool(pool: Pool): Promise<void> {
  if (!pool.ended) await pool.end();
}

/**
 * "postgres://user:****@host:5432/db": safe to print in logs. Never log the raw URL, which
 * contains the password.
 */
export function describeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "****";
    return parsed.toString();
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function connect(pool: Pool): Promise<PoolClient> {
  try {
    return await pool.connect();
  } catch (error) {
    // pg's message can include host and port but never the password; still keep the client-facing
    // message generic and leave the detail to the server log via `cause`.
    throw new AppError("NOT_READY", "Database is not reachable", { cause: error });
  }
}
