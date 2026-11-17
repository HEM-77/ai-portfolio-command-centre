import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_CHARTERS_DIR } from "./__fixtures__/fake-embedder.js";
import {
  CharterFormatError,
  chunkCharter,
  embeddingInput,
  parseCharter,
  slugify,
  splitIntoPassages,
} from "./charter-parser.js";
import { MAX_CHUNK_CHARS } from "./constants.js";

const CHARTER = `---
initiativeId: INIT-003
name: "Claims Triage Assistant"
businessUnit: Operations
---

# Claims Triage Assistant

Intro text before the first section is not evidence.

## Objective

Route claims automatically.

## Risks

Training is scheduled after go-live.

### Sub-risk

Vendor delay.

## Empty Section

## Status Notes
Integration delayed.
`;

describe("parseCharter: metadata", () => {
  it("extracts initiativeId, name and businessUnit from front matter, stripping quotes", () => {
    const { metadata } = parseCharter(CHARTER, "INIT-003-claims-triage.md");
    expect(metadata).toEqual({ initiativeId: "INIT-003", name: "Claims Triage Assistant", businessUnit: "Operations" });
  });

  it("handles Windows line endings and a byte-order mark", () => {
    const windows = `﻿${CHARTER.replace(/\n/g, "\r\n")}`;
    const parsed = parseCharter(windows, "INIT-003-claims-triage.md");
    expect(parsed.metadata.initiativeId).toBe("INIT-003");
    expect(parsed.sections.map((s) => s.heading)).toEqual(["Objective", "Risks", "Status Notes"]);
  });

  it.each([
    ["no front matter", "# Title\n\n## Risks\n\nText", "INIT-003-x.md", /missing front matter/],
    ["missing field", "---\ninitiativeId: INIT-003\nname: X\n---\n## Risks\nText", "INIT-003-x.md", /businessUnit/],
    ["bad ID format", "---\ninitiativeId: 3\nname: X\nbusinessUnit: Y\n---\n## Risks\nText", "3-x.md", /INIT-001/],
    ["file name does not match ID", CHARTER, "INIT-004-claims-triage.md", /must start with "INIT-003-"/],
    ["no sections", "---\ninitiativeId: INIT-003\nname: X\nbusinessUnit: Y\n---\n# Title only", "INIT-003-x.md", /no "## " sections/],
  ])("rejects a charter with %s", (_label, markdown, fileName, message) => {
    expect(() => parseCharter(markdown, fileName)).toThrow(CharterFormatError);
    expect(() => parseCharter(markdown, fileName)).toThrow(message);
  });
});

describe("parseCharter: sections", () => {
  const { sections } = parseCharter(CHARTER, "INIT-003-claims-triage.md");

  it("splits on ## headings, skipping the title, the preamble and empty sections", () => {
    expect(sections.map((s) => s.heading)).toEqual(["Objective", "Risks", "Status Notes"]);
  });

  it("keeps ### subheadings inside their section", () => {
    expect(sections[1]?.text).toBe("Training is scheduled after go-live.\n\n### Sub-risk\n\nVendor delay.");
  });
});

describe("splitIntoPassages", () => {
  it("keeps short text whole", () => {
    expect(splitIntoPassages("short", 100)).toEqual(["short"]);
  });

  it("packs whole paragraphs up to the limit and never cuts a paragraph", () => {
    const p = (ch: string) => ch.repeat(40);
    const text = [p("a"), p("b"), p("c"), p("d")].join("\n\n");
    expect(splitIntoPassages(text, 90)).toEqual([`${p("a")}\n\n${p("b")}`, `${p("c")}\n\n${p("d")}`]);
  });

  it("keeps a single paragraph longer than the limit as one passage", () => {
    const long = "x".repeat(150);
    expect(splitIntoPassages(`${long}\n\nshort`, 100)).toEqual([long, "short"]);
  });
});

describe("chunkCharter", () => {
  it("preserves initiative ID, name, section and source file, with stable chunk IDs", () => {
    const chunks = chunkCharter(parseCharter(CHARTER, "INIT-003-claims-triage.md"), "charters/INIT-003-claims-triage.md");

    expect(chunks.map((c) => c.chunkId)).toEqual(["INIT-003#objective-1", "INIT-003#risks-1", "INIT-003#status-notes-1"]);
    expect(chunks[2]).toEqual({
      chunkId: "INIT-003#status-notes-1",
      initiativeId: "INIT-003",
      initiativeName: "Claims Triage Assistant",
      sourceFile: "charters/INIT-003-claims-triage.md",
      section: "Status Notes",
      text: "Integration delayed.",
    });
  });

  it("numbers passages of an oversized section and keeps IDs unique for repeated headings", () => {
    const markdown = `---\ninitiativeId: INIT-007\nname: X\nbusinessUnit: Y\n---\n## Risks\n\n${"a".repeat(60)}\n\n${"b".repeat(60)}\n\n## Risks\n\nMore.`;
    const ids = chunkCharter(parseCharter(markdown, "INIT-007-x.md"), "charters/INIT-007-x.md", 100).map((c) => c.chunkId);
    expect(ids).toEqual(["INIT-007#risks-1", "INIT-007#risks-2", "INIT-007#risks-3"]);
  });

  it("splits the long fixture section on paragraph boundaries within the size limit", async () => {
    const file = "INIT-903-fixture-contract-review.md";
    const charter = parseCharter(await readFile(join(FIXTURE_CHARTERS_DIR, file), "utf8"), file);
    const scope = chunkCharter(charter, `fixtures/${file}`).filter((c) => c.section === "Scope");

    expect(scope.length).toBeGreaterThan(1);
    expect(scope.every((c) => c.text.length <= MAX_CHUNK_CHARS)).toBe(true);
    expect(scope.map((c) => c.text).join("\n\n")).toBe(charter.sections.find((s) => s.heading === "Scope")?.text);
  });
});

describe("helpers", () => {
  it("slugifies headings", () => {
    expect(slugify("Status Notes")).toBe("status-notes");
    expect(slugify("  Risks & Issues!  ")).toBe("risks-issues");
    expect(slugify("!!!")).toBe("section");
  });

  it("prefixes the embedding input with initiative and section, but keeps chunk text raw", () => {
    const [chunk] = chunkCharter(parseCharter(CHARTER, "INIT-003-claims-triage.md"), "charters/x.md");
    expect(chunk && embeddingInput(chunk)).toBe("Claims Triage Assistant (INIT-003) - Objective\n\nRoute claims automatically.");
    expect(chunk?.text).toBe("Route claims automatically.");
  });
});
