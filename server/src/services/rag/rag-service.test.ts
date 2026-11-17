import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../types/app-error.js";
import type { RagService } from "../../types/contracts.js";
import { createFakeEmbedder, FIXTURE_CHARTERS_DIR, type FakeEmbedder } from "./__fixtures__/fake-embedder.js";
import { createRagService } from "./rag-service.js";
import type { VectorIndexFile } from "./vector-index.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const silent = { warn: () => {} };

let dir: string;
let indexPath: string;
let embedder: FakeEmbedder;
let rag: RagService;

function service(overrides: Partial<Parameters<typeof createRagService>[0]> = {}): RagService {
  return createRagService({
    embedder,
    chartersDir: FIXTURE_CHARTERS_DIR,
    indexPath,
    repoRoot: REPO_ROOT,
    defaultMinScore: 0.2,
    logger: silent,
    ...overrides,
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rag-service-"));
  indexPath = join(dir, "vector-index.json");
  embedder = createFakeEmbedder();
  rag = service();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe("buildIndex", () => {
  it("indexes every section of the fixture charters with metadata, raw text and vectors", async () => {
    const { chunkCount } = await rag.buildIndex();
    const file = JSON.parse(await readFile(indexPath, "utf8")) as VectorIndexFile;

    expect(chunkCount).toBe(file.chunks.length);
    expect(chunkCount).toBeGreaterThanOrEqual(10);
    expect(file).toMatchObject({ version: 1, model: "fake/bag-of-words", dimensions: 256, chunkCount });
    expect(new Set(file.chunks.map((c) => c.initiativeId))).toEqual(new Set(["INIT-901", "INIT-902", "INIT-903"]));

    const status = file.chunks.find((c) => c.chunkId === "INIT-901#status-notes-1");
    expect(status).toMatchObject({
      initiativeId: "INIT-901",
      section: "Status Notes",
      sourceFile: "server/src/services/rag/__fixtures__/charters/INIT-901-fixture-claims-triage.md",
    });
    expect(status?.text.startsWith("Claims system API integration delayed")).toBe(true); // raw text, no header
    expect(file.chunks.every((c) => c.vector.length === 256)).toBe(true);
    expect(rag.isReady()).toBe(true);
    expect(rag.getChunkCount()).toBe(chunkCount);
  });

  it("embeds all chunks in one call, with the initiative/section header", async () => {
    await rag.buildIndex();
    expect(embedder.calls).toHaveLength(1);
    expect(embedder.calls[0]?.[0]).toMatch(/^Fixture Claims Triage Assistant \(INIT-901\) - Objective\n\n/);
  });

  it("skips a malformed charter instead of failing", async () => {
    const charters = join(dir, "charters");
    const good = await readFile(join(FIXTURE_CHARTERS_DIR, "INIT-902-fixture-invoice-copilot.md"), "utf8");
    await mkdir(charters);
    await writeFile(join(charters, "INIT-902-fixture-invoice-copilot.md"), good);
    await writeFile(join(charters, "INIT-950-broken.md"), "# no front matter\n\n## Risks\n\nText");
    const warnings: string[] = [];

    const result = await service({ chartersDir: charters, logger: { warn: (m: string) => warnings.push(m) } }).buildIndex();

    expect(result.chunkCount).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes("INIT-950-broken.md"))).toBe(true);
  });

  it("is NOT_READY without an embedder, without charters, or with an empty folder", async () => {
    expect((await errorOf(service({ embedder: null }).buildIndex())).code).toBe("NOT_READY");
    expect((await errorOf(service({ chartersDir: join(dir, "missing") }).buildIndex())).code).toBe("NOT_READY");
    expect((await errorOf(service({ chartersDir: dir }).buildIndex())).message).toBe("No valid charter files found to index");
  });
});

describe("loadIndex", () => {
  it("loads an index built earlier, in a fresh service", async () => {
    const { chunkCount } = await rag.buildIndex();
    const fresh = service();
    expect(fresh.isReady()).toBe(false);
    expect(fresh.getChunkCount()).toBe(0);

    await fresh.loadIndex();
    expect(fresh.isReady()).toBe(true);
    expect(fresh.getChunkCount()).toBe(chunkCount);
  });

  it("refuses an index built with another embedding model", async () => {
    await rag.buildIndex();
    const other = service({ embedder: createFakeEmbedder("other/model") });
    const error = await errorOf(other.loadIndex());
    expect(error.code).toBe("NOT_READY");
    expect(other.isReady()).toBe(false);
  });

  it("refuses an index built with other dimensions", async () => {
    await rag.buildIndex();
    expect((await errorOf(service({ embedder: createFakeEmbedder("fake/bag-of-words", 128) }).loadIndex())).code).toBe("NOT_READY");
  });
});

describe("retrieve", () => {
  beforeEach(async () => {
    await rag.buildIndex();
  });

  it("returns contract-shaped evidence, best match first", async () => {
    const evidence = await rag.retrieve("Why was adjuster training scheduled after go-live?");

    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0]).toMatchObject({ chunkId: "INIT-901#risks-1", initiativeId: "INIT-901", section: "Risks" });
    expect(Object.keys(evidence[0] ?? {}).sort()).toEqual(["chunkId", "initiativeId", "score", "section", "sourceFile", "text"]);
    expect(evidence.every((e) => e.score >= 0 && e.score <= 1)).toBe(true);
    expect(evidence.map((e) => e.score)).toEqual([...evidence.map((e) => e.score)].sort((a, b) => b - a));
  });

  it("returns at most topK chunks (default 5)", async () => {
    expect((await rag.retrieve("contract clause legal review supplier", { minScore: 0 })).length).toBe(5);
    expect((await rag.retrieve("contract clause legal review supplier", { topK: 2, minScore: 0 })).length).toBe(2);
  });

  it("only returns evidence from the requested initiatives", async () => {
    const evidence = await rag.retrieve("Why was adjuster training scheduled after go-live?", {
      initiativeIds: ["INIT-902"],
      minScore: 0,
    });
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((e) => e.initiativeId === "INIT-902")).toBe(true);
  });

  it("returns [] when nothing passes the threshold, for unknown initiatives, and for blank queries", async () => {
    expect(await rag.retrieve("quarterly weather forecast for penguins")).toEqual([]);
    expect(await rag.retrieve("adjuster training", { initiativeIds: ["INIT-999"] })).toEqual([]);
    expect(await rag.retrieve("   ")).toEqual([]);
  });

  it("embeds the trimmed question once per call", async () => {
    embedder.calls.length = 0;
    await rag.retrieve("  adjuster training  ");
    expect(embedder.calls).toEqual([["adjuster training"]]);
  });

  it("throws NOT_READY before an index is loaded", async () => {
    expect((await errorOf(service().retrieve("anything"))).code).toBe("NOT_READY");
  });
});
