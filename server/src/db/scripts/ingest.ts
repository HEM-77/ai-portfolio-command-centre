import { resolve } from "node:path";
import { DEFAULT_SOURCE_DIR, ingestNimbusDataset } from "../ingest/ingest.js";
import { runWithPool } from "./run-with-pool.js";

// `npm run db:ingest` loads data/raw/*.csv into PostgreSQL in one transaction.
// `npm run db:ingest -- --source <folder>` loads another folder with the same four files.

function sourceDirFromArgs(argv: readonly string[]): string {
  const flag = argv.indexOf("--source");
  const value = flag >= 0 ? argv[flag + 1] : undefined;
  return value ? resolve(process.cwd(), value) : DEFAULT_SOURCE_DIR;
}

await runWithPool(async (pool) => {
  const report = await ingestNimbusDataset(pool, sourceDirFromArgs(process.argv.slice(2)));
  console.log(`Ingestion run ${report.runId} from ${report.sourceDir}`);
  console.table(report.tables);
  for (const issue of report.issues) {
    const where = `${issue.sourceFile}${issue.sourceRow === null ? "" : ` row ${issue.sourceRow}`}`;
    console.log(`${issue.severity.toUpperCase().padEnd(7)} ${issue.action.padEnd(8)} ${where}: ${issue.message}`);
  }
  console.log(`${report.issueCounts.errors} error(s), ${report.issueCounts.warnings} warning(s). Issues are stored in ingestion_issues.`);
});
