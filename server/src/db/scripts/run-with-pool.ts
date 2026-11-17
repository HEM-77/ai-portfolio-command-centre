import type { Pool } from "pg";
import { config } from "../../config/index.js";
import { closePool, createDatabasePool, describeDatabaseUrl } from "../../config/database.js";
import { isAppError } from "../../types/app-error.js";

/**
 * Shared wrapper for the db:* scripts: open the pool from DATABASE_URL, run the task, always
 * close the pool, and set a non-zero exit code on failure. Prints the URL with the password masked.
 */
export async function runWithPool(task: (pool: Pool) => Promise<void>): Promise<void> {
  const url = config.database.url;
  if (!url) {
    console.error("DATABASE_URL is not set. Add it to server/.env (see server/.env.example and server/db/README.md).");
    process.exitCode = 1;
    return;
  }
  console.log(`Database: ${describeDatabaseUrl(url)}`);
  const pool = createDatabasePool(url);
  try {
    await task(pool);
  } catch (error) {
    const cause = isAppError(error) && error.cause instanceof Error ? ` (${error.cause.message})` : "";
    console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}${cause}`);
    process.exitCode = 1;
  } finally {
    await closePool(pool);
  }
}
