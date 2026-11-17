import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AppError } from "../../types/app-error.js";

// The local JSON vector index: save, load + validate, and brute-force cosine search.
// About 100 chunks x 1536 dims is ~150k multiplications per query: well under a millisecond.

export const INDEX_FORMAT_VERSION = 1;

export interface IndexedChunk {
  chunkId: string;
  initiativeId: string;
  sourceFile: string;
  section: string;
  text: string; // raw charter text, quoted in citations
  vector: number[]; // unit length, so cosine similarity is a dot product
}

export interface VectorIndexFile {
  version: typeof INDEX_FORMAT_VERSION;
  model: string;
  dimensions: number;
  createdAt: string;
  chunkCount: number;
  chunks: IndexedChunk[];
}

export interface SearchOptions {
  initiativeIds?: readonly string[];
  topK: number;
  minScore: number;
}

export interface SearchHit {
  chunk: IndexedChunk;
  score: number;
}

/** Scale to unit length. A zero vector stays zero (it then matches nothing). */
export function normalize(vector: readonly number[]): number[] {
  const length = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return length === 0 ? vector.map(() => 0) : vector.map((v) => v / length);
}

/** Cosine similarity of any two equal-length vectors, in [-1, 1]. 0 if either is a zero vector. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

/**
 * Rank chunks against a query vector. The initiative filter is applied BEFORE scoring, so a
 * mixed question about INIT-003 can never be answered with another initiative's evidence,
 * however similar it is. Weak matches below minScore are dropped; [] means "no evidence".
 */
export function searchIndex(
  chunks: readonly IndexedChunk[],
  queryVector: readonly number[],
  options: SearchOptions,
): SearchHit[] {
  const allowed = options.initiativeIds && options.initiativeIds.length > 0 ? new Set(options.initiativeIds) : null;
  return chunks
    .filter((chunk) => allowed === null || allowed.has(chunk.initiativeId))
    .map((chunk) => ({ chunk, score: cosineSimilarity(chunk.vector, queryVector) }))
    .filter((hit) => hit.score >= options.minScore)
    .sort((a, b) => b.score - a.score || a.chunk.chunkId.localeCompare(b.chunk.chunkId))
    .slice(0, options.topK);
}

/** Write via a temp file and rename, so a crash mid-write never leaves a half-written index. */
export async function saveIndex(path: string, index: VectorIndexFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(index), "utf8");
  await rename(temp, path);
}

/**
 * Load and validate the index. It must have been built with the same embedding model and
 * dimensions we query with: vectors from different models are not comparable, and searching
 * them would return confident nonsense. Any problem is NOT_READY with a "re-run ingest" hint.
 */
export async function loadIndex(
  path: string,
  expected: { model: string; dimensions: number },
): Promise<VectorIndexFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new AppError("NOT_READY", "Vector index not found. Run `npm run ingest` first.", { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AppError("NOT_READY", "Vector index file is not valid JSON. Run `npm run ingest` again.", {
      cause: error,
    });
  }
  return validateIndex(parsed, expected);
}

export function validateIndex(value: unknown, expected: { model: string; dimensions: number }): VectorIndexFile {
  const fail = (reason: string) => new AppError("NOT_READY", `Vector index is unusable (${reason}). Run \`npm run ingest\` again.`);

  if (!isRecord(value)) throw fail("not an object");
  if (value.version !== INDEX_FORMAT_VERSION) throw fail(`unsupported format version ${String(value.version)}`);
  if (value.model !== expected.model) {
    throw fail(`built with model "${String(value.model)}" but EMBEDDING_MODEL is "${expected.model}"`);
  }
  if (value.dimensions !== expected.dimensions) {
    throw fail(`built with ${String(value.dimensions)} dimensions, expected ${expected.dimensions}`);
  }
  if (typeof value.createdAt !== "string") throw fail("missing createdAt");
  if (!Array.isArray(value.chunks)) throw fail("missing chunks");

  const seen = new Set<string>();
  const chunks = value.chunks.map((item, i): IndexedChunk => {
    if (!isRecord(item)) throw fail(`chunk ${i} is not an object`);
    for (const field of ["chunkId", "initiativeId", "sourceFile", "section", "text"] as const) {
      if (typeof item[field] !== "string" || item[field] === "") throw fail(`chunk ${i} has no ${field}`);
    }
    const vector = item.vector;
    if (
      !Array.isArray(vector) ||
      vector.length !== expected.dimensions ||
      !vector.every((v) => typeof v === "number" && Number.isFinite(v))
    ) {
      throw fail(`chunk ${i} has an invalid vector`);
    }
    const chunkId = item.chunkId as string;
    if (seen.has(chunkId)) throw fail(`duplicate chunkId ${chunkId}`);
    seen.add(chunkId);
    return {
      chunkId,
      initiativeId: item.initiativeId as string,
      sourceFile: item.sourceFile as string,
      section: item.section as string,
      text: item.text as string,
      vector: vector as number[],
    };
  });

  if (value.chunkCount !== chunks.length) throw fail("chunkCount does not match the chunks");

  return {
    version: INDEX_FORMAT_VERSION,
    model: expected.model,
    dimensions: expected.dimensions,
    createdAt: value.createdAt,
    chunkCount: chunks.length,
    chunks,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
