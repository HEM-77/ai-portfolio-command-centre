import { resolve } from "node:path";
import { config } from "../../config/index.js";
import { isAppError } from "../../types/app-error.js";
import { DEFAULT_CHARTERS_DIR, DEFAULT_INDEX_PATH } from "./constants.js";
import { createRagServiceFromConfig } from "./index.js";

// `npm run ingest` builds server/storage/vector-index.json from the charters.
// `npm run ingest -- --charters <folder>` indexes another folder (e.g. the test fixtures).

function chartersDirFromArgs(argv: readonly string[]): string {
  const flag = argv.indexOf("--charters");
  const value = flag >= 0 ? argv[flag + 1] : undefined;
  return value ? resolve(process.cwd(), value) : DEFAULT_CHARTERS_DIR;
}

const chartersDir = chartersDirFromArgs(process.argv.slice(2));
console.log(`Indexing charters from ${chartersDir}`);

try {
  const started = Date.now();
  const { chunkCount } = await createRagServiceFromConfig(config, { chartersDir }).buildIndex();
  console.log(`Indexed ${chunkCount} chunks with ${config.embedding.model} in ${Date.now() - started} ms`);
  console.log(`Wrote ${DEFAULT_INDEX_PATH}`);
} catch (error) {
  // AppError messages are written to be safe to show; never print config values.
  console.error(`Ingestion failed: ${isAppError(error) ? error.message : String(error)}`);
  process.exitCode = 1;
}
