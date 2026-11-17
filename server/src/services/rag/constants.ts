import { resolve } from "node:path";

// RAG settings in one place so they are easy to tune. Paths resolve from this file, so they
// work from src/ (tsx) and dist/ (node): both sit at server/<src|dist>/services/rag/.

/** Repository root (the folder that holds charters/ and server/). */
export const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");

/** Spoorthy's charters (contract §5.1). */
export const DEFAULT_CHARTERS_DIR = resolve(REPO_ROOT, "charters");

/** Generated index, git-ignored (contract §8 #8). */
export const DEFAULT_INDEX_PATH = resolve(REPO_ROOT, "server", "storage", "vector-index.json");

/** Vector size for openai/text-embedding-3-small (approved decision). The index stores it and is rejected on mismatch. */
export const EMBEDDING_DIMENSIONS = 1536;

/** Sections longer than this are split on paragraph boundaries. About 300 tokens: small enough to cite precisely. */
export const MAX_CHUNK_CHARS = 1200;

/** Contract §4: retrieve() returns 5 chunks by default. */
export const DEFAULT_TOP_K = 5;

/**
 * Chunks scoring below this are dropped, so an off-topic question returns [] instead of weak "evidence".
 * Starting value only: calibrate it on the evaluation questions once real charters land.
 */
export const DEFAULT_MIN_SCORE = 0.3;

/** Embedding calls fail with UPSTREAM_ERROR after this long, so ingestion and questions never hang. */
export const EMBEDDING_TIMEOUT_MS = 30_000;

/** Retries for rate limits (429) and provider errors (5xx). */
export const EMBEDDING_MAX_RETRIES = 2;

/** Texts per embeddings request. */
export const EMBEDDING_BATCH_SIZE = 64;
