import { migrate } from "../migrate.js";
import { runWithPool } from "./run-with-pool.js";

// `npm run db:migrate`: apply pending SQL migrations from server/db/migrations/. Safe to re-run.

await runWithPool(async (pool) => {
  const { applied, alreadyApplied } = await migrate(pool);
  for (const name of alreadyApplied) console.log(`skip     ${name} (already applied)`);
  for (const name of applied) console.log(`applied  ${name}`);
  console.log(applied.length === 0 ? "Schema is up to date." : `Applied ${applied.length} migration(s).`);
});
