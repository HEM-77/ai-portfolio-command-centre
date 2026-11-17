import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RagService } from "../../types/contracts.js";
import { createFakeEmbedder } from "./__fixtures__/fake-embedder.js";
import { chunkCharter, parseCharter, parseCharterMetadata, type CharterChunk, type ParsedCharter } from "./charter-parser.js";
import { DEFAULT_CHARTERS_DIR, REPO_ROOT } from "./constants.js";
import { createRagService } from "./rag-service.js";

// Regression test over the 10 official Nimbus charters in charters/ (contract §5.2), read as-is.
// No network: the index is built with the deterministic fake embedder into a temporary folder.

const EXPECTED_SECTIONS = [
  "Purpose and Business Case",
  "Scope",
  "Target Users and Adoption Approach",
  "Benefits Measurement Approach",
  "Risks and Dependencies",
  "Governance and Next Steps",
];

const EXPECTED_IDS = Array.from({ length: 10 }, (_, i) => `NMB-${String(i + 1).padStart(3, "0")}`);

interface OfficialCharter {
  fileName: string;
  raw: string;
  parsed: ParsedCharter;
  chunks: CharterChunk[];
}

let charters: OfficialCharter[];

beforeAll(async () => {
  const fileNames = (await readdir(DEFAULT_CHARTERS_DIR)).filter((f) => f.endsWith(".md")).sort();
  charters = await Promise.all(
    fileNames.map(async (fileName) => {
      const raw = await readFile(join(DEFAULT_CHARTERS_DIR, fileName), "utf8");
      const parsed = parseCharter(raw, fileName);
      return { fileName, raw, parsed, chunks: chunkCharter(parsed, `charters/${fileName}`) };
    }),
  );
});

/**
 * Independent reference: the text under each `## ` heading of the raw file, with HTML comments
 * removed. Written differently from the parser on purpose, so the two can disagree.
 */
function referenceSections(raw: string): string[] {
  const parts = raw.replace(/\r\n/g, "\n").split(/^## .*$/m).slice(1);
  return parts.map((part) =>
    part
      .replace(/<!--[\s\S]*?-->/g, "")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim(),
  );
}

describe("official Nimbus charters", () => {
  it("has exactly 10 charter files with official names and unique IDs NMB-001..NMB-010", () => {
    expect(charters).toHaveLength(10);
    for (const { fileName } of charters) expect(fileName).toMatch(/^NMB-\d{3}_[A-Za-z0-9_]+\.md$/);
    const ids = charters.map((c) => c.parsed.metadata.initiativeId);
    expect(new Set(ids).size).toBe(10);
    expect(ids).toEqual(EXPECTED_IDS);
  });

  it("parses every charter, with title ID, metadata ID and file name prefix in agreement", () => {
    for (const { fileName, raw, parsed } of charters) {
      const { initiativeId, name, businessUnit } = parsed.metadata;
      expect(fileName.startsWith(`${initiativeId}_`)).toBe(true);
      expect(raw).toContain(`# Project Charter: ${name} (${initiativeId})`);
      expect(raw).toContain(`**Initiative ID:** ${initiativeId}`);
      expect(name.trim()).not.toBe("");
      expect(businessUnit.trim()).not.toBe("");
    }
  });

  it("exposes each charter's Delivery lead through the pure metadata parser", () => {
    for (const { fileName, raw, parsed } of charters) {
      const metadata = parseCharterMetadata(raw, fileName);
      expect(metadata).toEqual(parsed.metadata);
      expect(metadata.deliveryLead).toMatch(/^\S.* \(.+\)$/); // "Name (Role)", as written in the file
      expect(raw).toContain(`**Delivery lead:** ${metadata.deliveryLead}`);
    }
  });

  it("has the six official sections, in order, without heading numbers", () => {
    for (const { parsed } of charters) {
      expect(parsed.sections.map((s) => s.heading)).toEqual(EXPECTED_SECTIONS);
    }
  });

  it("produces exactly 60 chunks with unique IDs and correct source files", () => {
    const chunks = charters.flatMap((c) => c.chunks);
    expect(chunks).toHaveLength(60);
    expect(new Set(chunks.map((c) => c.chunkId)).size).toBe(60);
    for (const { fileName, chunks: own, parsed } of charters) {
      for (const chunk of own) {
        expect(chunk.sourceFile).toBe(`charters/${fileName}`);
        expect(chunk.initiativeId).toBe(parsed.metadata.initiativeId);
        expect(chunk.chunkId.startsWith(`${parsed.metadata.initiativeId}#`)).toBe(true);
      }
    }
  });

  it("has non-empty chunk text that reconstructs each section after HTML-comment removal", () => {
    for (const { raw, parsed, chunks } of charters) {
      const reference = referenceSections(raw);
      expect(reference).toHaveLength(EXPECTED_SECTIONS.length);
      parsed.sections.forEach((section, i) => {
        const own = chunks.filter((c) => c.section === section.heading);
        expect(own.length).toBeGreaterThan(0);
        expect(own.every((c) => c.text.trim() !== "")).toBe(true);
        expect(own.map((c) => c.text).join("\n\n")).toBe(section.text);
        expect(section.text).toBe(reference[i]);
      });
    }
  });

  it("removes the hidden HTML comment from NMB-007's Scope, and only there", () => {
    const nmb007 = charters.find((c) => c.parsed.metadata.initiativeId === "NMB-007");
    expect(nmb007?.raw).toContain("<!--"); // the official file itself is unchanged

    const scope = nmb007?.chunks.filter((c) => c.section === "Scope") ?? [];
    expect(scope).toHaveLength(1);
    expect(scope[0]?.text).toBe("Accounts payable teams in four shared-service centres. Employee expenses are excluded.");

    const withComments = charters.flatMap((c) =>
      c.parsed.sections.filter((s) => s.htmlCommentsRemoved > 0).map((s) => `${c.parsed.metadata.initiativeId}/${s.heading}`),
    );
    expect(withComments).toEqual(["NMB-007/Scope"]);
    for (const chunk of charters.flatMap((c) => c.chunks)) {
      expect(chunk.text).not.toMatch(/<!--|-->|SYSTEM OVERRIDE/);
    }
  });
});

describe("indexing the official charters (fake embedder, temporary index)", () => {
  let dir: string;
  let rag: RagService;
  const warnings: string[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rag-official-"));
    rag = createRagService({
      embedder: createFakeEmbedder(),
      chartersDir: DEFAULT_CHARTERS_DIR,
      indexPath: join(dir, "vector-index.json"),
      repoRoot: REPO_ROOT,
      logger: { warn: (message: string) => warnings.push(message) },
    });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("builds an index of 60 chunks across 10 initiatives and warns about the removed comment", async () => {
    const { chunkCount } = await rag.buildIndex();
    expect(chunkCount).toBe(60);
    expect(rag.getChunkCount()).toBe(60);

    const index = JSON.parse(await readFile(join(dir, "vector-index.json"), "utf8")) as {
      chunks: { initiativeId: string; sourceFile: string }[];
    };
    expect(new Set(index.chunks.map((c) => c.initiativeId))).toEqual(new Set(EXPECTED_IDS));
    expect(index.chunks.every((c) => /^charters\/NMB-\d{3}_[A-Za-z0-9_]+\.md$/.test(c.sourceFile))).toBe(true);

    expect(warnings).toEqual([
      '[rag] Removed 1 hidden HTML comment(s) from NMB-007 section "Scope" (not indexed)',
    ]);
  });

  it("returns only NMB-004 evidence when retrieval is filtered to NMB-004", async () => {
    const evidence = await rag.retrieve("What are the risks and dependencies of contract review?", {
      initiativeIds: ["NMB-004"],
      minScore: 0,
      topK: 10,
    });
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((e) => e.initiativeId === "NMB-004")).toBe(true);
    expect(evidence.every((e) => e.sourceFile === "charters/NMB-004_Contract_Review_Assistant.md")).toBe(true);
  });
});
