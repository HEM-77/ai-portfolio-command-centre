import { isEmbeddingConfigured, type Config } from "../../config/index.js";
import type { RagService } from "../../types/contracts.js";
import { DEFAULT_CHARTERS_DIR, DEFAULT_INDEX_PATH, EMBEDDING_DIMENSIONS, REPO_ROOT } from "./constants.js";
import { createEmbeddingClient, type Embedder } from "./embedding-client.js";
import { createRagService } from "./rag-service.js";

// Public entry point of the RAG module (contract §4). Other modules import only from here.

export { createRagService } from "./rag-service.js";
export type { RagServiceOptions } from "./rag-service.js";
export { createEmbeddingClient } from "./embedding-client.js";
export type { Embedder } from "./embedding-client.js";

/** The embedder from config, or null when EMBEDDING_* is not fully set. */
export function createEmbedderFromConfig(config: Config): Embedder | null {
  const { apiKey, baseUrl, model } = config.embedding;
  if (!isEmbeddingConfigured(config) || !apiKey || !baseUrl || !model) return null;
  return createEmbeddingClient({ apiKey, baseUrl, model, dimensions: EMBEDDING_DIMENSIONS });
}

/** The RagService the app uses: real embedder, repo charters, server/storage/vector-index.json. */
export function createRagServiceFromConfig(config: Config, overrides: { chartersDir?: string } = {}): RagService {
  return createRagService({
    embedder: createEmbedderFromConfig(config),
    chartersDir: overrides.chartersDir ?? DEFAULT_CHARTERS_DIR,
    indexPath: DEFAULT_INDEX_PATH,
    repoRoot: REPO_ROOT,
  });
}
