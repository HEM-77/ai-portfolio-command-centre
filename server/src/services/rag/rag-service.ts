import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { AppError } from "../../types/app-error.js";
import type { Evidence, RagService, RetrieveOptions } from "../../types/contracts.js";
import { CharterFormatError, chunkCharter, embeddingInput, parseCharter, type CharterChunk } from "./charter-parser.js";
import { DEFAULT_MIN_SCORE, DEFAULT_TOP_K } from "./constants.js";
import type { Embedder } from "./embedding-client.js";
import {
  INDEX_FORMAT_VERSION,
  loadIndex,
  normalize,
  saveIndex,
  searchIndex,
  type IndexedChunk,
  type VectorIndexFile,
} from "./vector-index.js";

export interface RagServiceOptions {
  /** null when EMBEDDING_* is not configured: the service then reports not ready. */
  embedder: Embedder | null;
  chartersDir: string;
  indexPath: string;
  /** Source files are recorded relative to this, e.g. "charters/INIT-003-claims-triage.md". */
  repoRoot: string;
  defaultTopK?: number;
  defaultMinScore?: number;
  logger?: Pick<Console, "warn">;
}

/** Implements contract §4 RagService over the local JSON vector index. */
export function createRagService(options: RagServiceOptions): RagService {
  const {
    embedder,
    chartersDir,
    indexPath,
    repoRoot,
    defaultTopK = DEFAULT_TOP_K,
    defaultMinScore = DEFAULT_MIN_SCORE,
    logger = console,
  } = options;
  let index: VectorIndexFile | null = null;

  function requireEmbedder(): Embedder {
    if (!embedder) {
      throw new AppError("NOT_READY", "Embedding provider is not configured (EMBEDDING_API_KEY, EMBEDDING_BASE_URL, EMBEDDING_MODEL)");
    }
    return embedder;
  }

  /** Read and chunk every charter. Bad files are logged and skipped, never fatal (AGENTS.md §4). */
  async function readChunks(): Promise<CharterChunk[]> {
    let fileNames: string[];
    try {
      fileNames = (await readdir(chartersDir)).filter((name) => name.endsWith(".md")).sort();
    } catch (error) {
      logger.warn(`[rag] Cannot read charters folder ${chartersDir}`);
      throw new AppError("NOT_READY", "Charters folder not found", { cause: error });
    }

    const chunks: CharterChunk[] = [];
    for (const fileName of fileNames) {
      const path = join(chartersDir, fileName);
      try {
        const charter = parseCharter(await readFile(path, "utf8"), fileName);
        chunks.push(...chunkCharter(charter, relative(repoRoot, path).split("\\").join("/")));
      } catch (error) {
        if (!(error instanceof CharterFormatError)) throw error;
        logger.warn(`[rag] Skipped charter: ${error.message}`);
      }
    }
    return chunks;
  }

  return {
    async buildIndex(): Promise<{ chunkCount: number }> {
      const client = requireEmbedder();
      const chunks = await readChunks();
      if (chunks.length === 0) {
        logger.warn(`[rag] No valid charters found in ${chartersDir}`);
        throw new AppError("NOT_READY", "No valid charter files found to index");
      }

      const vectors = await client.embed(chunks.map(embeddingInput));
      const indexed: IndexedChunk[] = chunks.map((chunk, i) => ({
        chunkId: chunk.chunkId,
        initiativeId: chunk.initiativeId,
        sourceFile: chunk.sourceFile,
        section: chunk.section,
        text: chunk.text,
        vector: normalize(vectors[i] ?? []),
      }));

      const file: VectorIndexFile = {
        version: INDEX_FORMAT_VERSION,
        model: client.model,
        dimensions: client.dimensions,
        createdAt: new Date().toISOString(),
        chunkCount: indexed.length,
        chunks: indexed,
      };
      await saveIndex(indexPath, file);
      index = file;
      return { chunkCount: file.chunkCount };
    },

    async loadIndex(): Promise<void> {
      const client = requireEmbedder();
      index = await loadIndex(indexPath, { model: client.model, dimensions: client.dimensions });
    },

    isReady(): boolean {
      return index !== null && embedder !== null;
    },

    getChunkCount(): number {
      return index?.chunkCount ?? 0;
    },

    /** Contract §4: [] when nothing is relevant. Throws only when not ready or the provider fails. */
    async retrieve(query: string, retrieveOptions: RetrieveOptions = {}): Promise<Evidence[]> {
      const client = requireEmbedder();
      if (index === null) throw new AppError("NOT_READY", "Vector index is not loaded");

      const text = query.trim();
      if (text === "") return [];
      const topK = retrieveOptions.topK ?? defaultTopK;
      if (!Number.isInteger(topK) || topK < 1) return [];

      const [queryVector] = await client.embed([text]);
      const hits = searchIndex(index.chunks, normalize(queryVector ?? []), {
        topK,
        minScore: retrieveOptions.minScore ?? defaultMinScore,
        ...(retrieveOptions.initiativeIds ? { initiativeIds: retrieveOptions.initiativeIds } : {}),
      });

      return hits.map(({ chunk, score }) => ({
        chunkId: chunk.chunkId,
        initiativeId: chunk.initiativeId,
        sourceFile: chunk.sourceFile,
        section: chunk.section,
        text: chunk.text,
        score: Math.round(Math.min(1, Math.max(0, score)) * 10_000) / 10_000, // contract: 0..1
      }));
    },
  };
}
