import { resolve } from "node:path";
import type { Embedder } from "../embedding-client.js";

// Test helpers only (excluded from the production build).

export const FIXTURE_CHARTERS_DIR = resolve(import.meta.dirname, "charters");

const STOP_WORDS = new Set(["the", "a", "an", "is", "are", "to", "of", "and", "or", "in", "on", "for", "so", "be", "it", "by", "with", "what", "why", "how", "does", "do", "which"]);

/**
 * Deterministic bag-of-words "embedding": each word adds 1 to a hashed dimension. Texts that
 * share words get high cosine similarity, unrelated texts get ~0. Enough to test retrieval
 * logic without any network call.
 */
export function fakeEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (STOP_WORDS.has(word)) continue;
    let hash = 0;
    for (const ch of word) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    vector[hash % dimensions] = (vector[hash % dimensions] ?? 0) + 1;
  }
  return vector;
}

export interface FakeEmbedder extends Embedder {
  calls: string[][];
}

export function createFakeEmbedder(model = "fake/bag-of-words", dimensions = 256): FakeEmbedder {
  const calls: string[][] = [];
  return {
    model,
    dimensions,
    calls,
    async embed(texts: readonly string[]): Promise<number[][]> {
      calls.push([...texts]);
      return texts.map((t) => fakeEmbedding(t, dimensions));
    },
  };
}
