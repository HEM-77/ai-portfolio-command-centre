import { checkConnection } from "../../config/database.js";
import { pendingMigrations } from "../migrate.js";
import { runWithPool } from "./run-with-pool.js";

// `npm run db:check`: can the server reach PostgreSQL, and is the schema up to date?

await runWithPool(async (pool) => {
  const { serverVersion, database } = await checkConnection(pool);
  console.log(`OK  connected to "${database}" (PostgreSQL ${serverVersion})`);
  const pending = await pendingMigrations(pool);
  console.log(pending.length === 0 ? "OK  schema is up to date" : `WARN  pending migrations: ${pending.join(", ")}`);
});
