import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../types/app-error.js";
import {
  cosineSimilarity,
  INDEX_FORMAT_VERSION,
  loadIndex,
  normalize,
  saveIndex,
  searchIndex,
  type IndexedChunk,
  type VectorIndexFile,
} from "./vector-index.js";

function chunk(chunkId: string, initiativeId: string, vector: number[]): IndexedChunk {
  return { chunkId, initiativeId, sourceFile: `charters/${initiativeId}.md`, section: "Risks", text: chunkId, vector: normalize(vector) };
}

describe("cosine similarity", () => {
  it("gives 1 for the same direction, 0 for orthogonal, -1 for opposite", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("matches a hand calculation", () => {
    // [1,1] . [1,0] = 1; |a| = sqrt(2), |b| = 1 -> 1/sqrt(2)
    expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("returns 0 for a zero vector and rejects mismatched lengths", () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(() => cosineSimilarity([1], [1, 0])).toThrow(/length mismatch/);
  });

  it("normalizes to unit length", () => {
    expect(normalize([3, 4])).toEqual([0.6, 0.8]);
    expect(normalize([0, 0])).toEqual([0, 0]);
  });
});

describe("searchIndex", () => {
  const chunks = [
    chunk("A#1", "INIT-001", [1, 0, 0]), // exact match for the query
    chunk("A#2", "INIT-001", [1, 1, 0]), // 0.707
    chunk("B#1", "INIT-002", [0.9, 0.1, 0]), // 0.994: second best overall
    chunk("C#1", "INIT-003", [0, 0, 1]), // 0: unrelated
  ];
  const query = [1, 0, 0];

  it("ranks known vectors by similarity", () => {
    expect(searchIndex(chunks, query, { topK: 5, minScore: 0 }).map((h) => h.chunk.chunkId)).toEqual(["A#1", "B#1", "A#2", "C#1"]);
  });

  it("applies the initiative filter before scoring", () => {
    const hits = searchIndex(chunks, query, { topK: 5, minScore: 0, initiativeIds: ["INIT-001"] });
    expect(hits.map((h) => h.chunk.chunkId)).toEqual(["A#1", "A#2"]); // B#1 scores higher but is excluded
  });

  it("treats an empty filter as no filter", () => {
    expect(searchIndex(chunks, query, { topK: 5, minScore: 0, initiativeIds: [] })).toHaveLength(4);
  });

  it("limits results to topK", () => {
    expect(searchIndex(chunks, query, { topK: 2, minScore: 0 }).map((h) => h.chunk.chunkId)).toEqual(["A#1", "B#1"]);
  });

  it("drops matches below minScore and returns [] when nothing is relevant", () => {
    expect(searchIndex(chunks, query, { topK: 5, minScore: 0.8 }).map((h) => h.chunk.chunkId)).toEqual(["A#1", "B#1"]);
    expect(searchIndex(chunks, [0, 1, 0], { topK: 5, minScore: 0.8 })).toEqual([]);
    expect(searchIndex(chunks, query, { topK: 5, minScore: 0, initiativeIds: ["INIT-999"] })).toEqual([]);
  });
});

describe("index file: save and load", () => {
  let dir: string;
  let path: string;
  const expected = { model: "openai/text-embedding-3-small", dimensions: 3 };
  const file: VectorIndexFile = {
    version: INDEX_FORMAT_VERSION,
    model: expected.model,
    dimensions: 3,
    createdAt: "2026-11-17T10:00:00.000Z",
    chunkCount: 2,
    chunks: [chunk("A#1", "INIT-001", [1, 0, 0]), chunk("B#1", "INIT-002", [0, 1, 0])],
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rag-index-"));
    path = join(dir, "nested", "vector-index.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function notReady(promise: Promise<unknown>): Promise<string> {
    const error = await promise.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("NOT_READY");
    return (error as AppError).message;
  }

  it("round-trips through disk, creating the folder", async () => {
    await saveIndex(path, file);
    expect(await loadIndex(path, expected)).toEqual(file);
  });

  it("reports a missing index as NOT_READY with a re-ingest hint", async () => {
    expect(await notReady(loadIndex(path, expected))).toMatch(/npm run ingest/);
  });

  it("rejects an index built with a different model", async () => {
    await saveIndex(path, file);
    expect(await notReady(loadIndex(path, { ...expected, model: "other/model" }))).toMatch(
      /built with model "openai\/text-embedding-3-small" but EMBEDDING_MODEL is "other\/model"/,
    );
  });

  it("rejects an index built with different dimensions", async () => {
    await saveIndex(path, file);
    expect(await notReady(loadIndex(path, { ...expected, dimensions: 1536 }))).toMatch(/built with 3 dimensions, expected 1536/);
  });

  it.each([
    ["invalid JSON", "{not json", /not valid JSON/],
    ["a short vector", { ...file, chunks: [{ ...file.chunks[0], vector: [1, 0] }], chunkCount: 1 }, /invalid vector/],
    ["a missing text", { ...file, chunks: [{ ...file.chunks[0], text: "" }], chunkCount: 1 }, /has no text/],
    ["duplicate chunk IDs", { ...file, chunks: [file.chunks[0], file.chunks[0]] }, /duplicate chunkId/],
    ["a wrong chunkCount", { ...file, chunkCount: 5 }, /chunkCount/],
    ["an unknown version", { ...file, version: 2 }, /format version 2/],
  ])("rejects %s", async (_label, content, message) => {
    await saveIndex(path, file);
    await writeFile(path, typeof content === "string" ? content : JSON.stringify(content), "utf8");
    expect(await notReady(loadIndex(path, expected))).toMatch(message);
  });

  it("leaves no temp file behind", async () => {
    await saveIndex(path, file);
    await expect(readFile(`${path}.tmp`)).rejects.toThrow();
  });
});
