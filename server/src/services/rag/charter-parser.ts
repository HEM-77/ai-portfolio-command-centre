import { MAX_CHUNK_CHARS } from "./constants.js";

// Turns an official Nimbus charter (contract §5.2) into citable chunks. Pure functions: no I/O,
// no logging, no embeddings. The official format, used unchanged:
//
//   # Project Charter: <Initiative name> (NMB-xxx)
//
//   **Initiative ID:** NMB-xxx
//   **Business unit:** <business unit>
//   **Delivery lead:** <name (role)>
//   ...
//
//   ## 1. Purpose and Business Case
//   ...

/** Canonical Nimbus initiative ID (contract §5.1). Strict: no lowercase, no missing hyphen. */
export const INITIATIVE_ID_PATTERN = /^NMB-\d{3}$/;

/** Official file name: `NMB-xxx_Name_With_Underscores.md` (contract §5.2). */
const FILE_NAME_PATTERN = /^(NMB-\d{3})_[A-Za-z0-9_]+\.md$/;

const TITLE_PATTERN = /^# Project Charter:\s*(.+?)\s*\(([^()]*)\)\s*$/;

/** `**Label:** value`. The colon sits inside the bold markers in the official files. */
const METADATA_LINE_PATTERN = /^\*\*([^*]+?):\*\*\s*(.*?)\s*$/;

/** A level-two heading; `###` and deeper stay inside their section. */
const SECTION_HEADING_PATTERN = /^##(?!#)\s+(.+?)\s*#*\s*$/;

/** Only a numeric prefix like "5. " is removed, so "2026 Plan" stays "2026 Plan". */
const SECTION_NUMBER_PREFIX = /^\d+\.\s+/;

/** An HTML comment, or an unterminated one running to the end of the text (hidden when rendered too). */
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?(?:-->|$)/g;

export interface CharterMetadata {
  initiativeId: string;
  name: string;
  businessUnit: string;
  /** The "Delivery lead" line verbatim, e.g. "Daniel Okafor (Programme Lead)"; null when absent or blank. */
  deliveryLead: string | null;
}

export interface CharterSection {
  heading: string; // heading text without its number, used as Evidence.section
  text: string; // section text with HTML comments removed
  /** How many hidden HTML comments were removed from this section. The caller logs them. */
  htmlCommentsRemoved: number;
}

export interface ParsedCharter {
  metadata: CharterMetadata;
  sections: CharterSection[];
}

/** One citable passage. `text` is the charter text (minus HTML comments), quoted in citations. */
export interface CharterChunk {
  chunkId: string; // "NMB-007#risks-and-dependencies-1"
  initiativeId: string;
  initiativeName: string;
  sourceFile: string; // repo-relative, forward slashes: "charters/NMB-007_Invoice_Processing_Automation.md"
  section: string;
  text: string;
}

/** A charter that cannot be indexed. Ingestion logs it and skips the file instead of crashing. */
export class CharterFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CharterFormatError";
  }
}

/** Remove a byte-order mark and normalise Windows / old Mac line endings. */
function normaliseText(markdown: string): string {
  return markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

/**
 * Split into the part before the first `##` heading (title + metadata) and the lines from that
 * heading on. Headings inside an HTML comment do not count, so hidden text cannot open a section.
 */
function splitPreamble(text: string): { preamble: string; bodyLines: string[] } {
  const lines = text.split("\n");
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!inComment && SECTION_HEADING_PATTERN.test(line)) {
      return { preamble: lines.slice(0, i).join("\n"), bodyLines: lines.slice(i) };
    }
    inComment = commentStateAfter(line, inComment);
  }
  return { preamble: text, bodyLines: [] };
}

/** Whether we are inside an HTML comment at the end of `line`, given the state at its start. */
function commentStateAfter(line: string, inComment: boolean): boolean {
  let state = inComment;
  let position = 0;
  for (;;) {
    const marker = state ? "-->" : "<!--";
    const found = line.indexOf(marker, position);
    if (found < 0) return state;
    state = !state;
    position = found + marker.length;
  }
}

/**
 * Parse only the title and `**Label:** value` metadata of an official charter (contract §5.2).
 * Pure: safe for any module to call; it never touches embeddings, the index or the network.
 *
 * Checks that the title ID, the "Initiative ID" line and the file name all agree, which catches a
 * charter whose header was copied from another file and would otherwise cite the wrong initiative.
 */
export function parseCharterMetadata(markdown: string, fileName: string): CharterMetadata {
  const text = normaliseText(markdown);

  if (/^---[ \t]*\n/.test(text)) {
    throw new CharterFormatError(
      `${fileName}: YAML front matter is not supported; use the official "# Project Charter: <Name> (NMB-xxx)" format`,
    );
  }

  // Hidden comments are not metadata: a comment cannot supply or override a label.
  const preambleLines = splitPreamble(text).preamble.replace(HTML_COMMENT_PATTERN, "").split("\n");
  const firstLine = preambleLines.find((line) => line.trim() !== "")?.trim() ?? "";
  const title = TITLE_PATTERN.exec(firstLine);
  if (!title?.[1] || title[2] === undefined) {
    throw new CharterFormatError(`${fileName}: first line must be "# Project Charter: <Name> (NMB-xxx)"`);
  }
  const name = title[1];
  const titleId = title[2].trim();

  const fields = new Map<string, string>();
  for (const line of preambleLines) {
    const match = METADATA_LINE_PATTERN.exec(line.trim());
    if (!match?.[1]) continue;
    const label = match[1].trim().replace(/\s+/g, " ").toLowerCase();
    if (fields.has(label)) {
      throw new CharterFormatError(`${fileName}: metadata label "${match[1].trim()}" appears more than once`);
    }
    fields.set(label, match[2] ?? "");
  }

  const initiativeId = requireField(fields, "initiative id", "Initiative ID", fileName);
  const businessUnit = requireField(fields, "business unit", "Business unit", fileName);

  if (!INITIATIVE_ID_PATTERN.test(initiativeId)) {
    throw new CharterFormatError(`${fileName}: Initiative ID "${initiativeId}" must look like NMB-001`);
  }
  if (titleId !== initiativeId) {
    throw new CharterFormatError(`${fileName}: title ID "${titleId}" does not match Initiative ID "${initiativeId}"`);
  }

  const fileMatch = FILE_NAME_PATTERN.exec(fileName);
  if (!fileMatch) {
    throw new CharterFormatError(`${fileName}: file name must look like "NMB-001_Initiative_Name.md"`);
  }
  if (fileMatch[1] !== initiativeId) {
    throw new CharterFormatError(`${fileName}: file name must start with "${initiativeId}_"`);
  }

  const deliveryLead = fields.get("delivery lead") || null;
  return { initiativeId, name, businessUnit, deliveryLead };
}

function requireField(fields: Map<string, string>, key: string, label: string, fileName: string): string {
  const value = fields.get(key);
  if (value === undefined) throw new CharterFormatError(`${fileName}: missing "**${label}:**" line`);
  if (value === "") throw new CharterFormatError(`${fileName}: "${label}" is empty`);
  return value;
}

/**
 * Parse metadata and `##` sections. The title, metadata and anything else before the first `##`
 * are not evidence. Metadata-like lines after the first `##` are ordinary section text.
 */
export function parseCharter(markdown: string, fileName: string): ParsedCharter {
  const metadata = parseCharterMetadata(markdown, fileName);
  const sections = splitSections(splitPreamble(normaliseText(markdown)).bodyLines);
  if (sections.length === 0) {
    throw new CharterFormatError(`${fileName}: no "## " sections with content`);
  }
  return { metadata, sections };
}

function splitSections(bodyLines: readonly string[]): CharterSection[] {
  const raw: { heading: string; lines: string[] }[] = [];
  let inComment = false;

  for (const line of bodyLines) {
    const heading = inComment ? null : SECTION_HEADING_PATTERN.exec(line);
    if (heading?.[1]) {
      raw.push({ heading: heading[1].replace(SECTION_NUMBER_PREFIX, ""), lines: [] });
    } else {
      raw.at(-1)?.lines.push(line);
    }
    inComment = commentStateAfter(line, inComment);
  }

  return raw
    .map(({ heading, lines }) => ({ heading, ...removeHtmlComments(lines.join("\n")) }))
    .map(({ heading, text, removed }) => ({ heading, text: text.trim(), htmlCommentsRemoved: removed }))
    .filter((section) => section.text.length > 0);
}

/**
 * Hidden HTML comments are not visible charter content and are a known prompt-injection vector,
 * so they are never indexed or quoted. The charter file itself is not changed.
 */
function removeHtmlComments(text: string): { text: string; removed: number } {
  const removed = text.match(HTML_COMMENT_PATTERN)?.length ?? 0;
  if (removed === 0) return { text, removed };
  const cleaned = text
    .replace(HTML_COMMENT_PATTERN, "")
    .replace(/[ \t]+$/gm, "") // whitespace left where an inline comment was
    .replace(/\n{3,}/g, "\n\n"); // blank lines left where a block comment was
  return { text: cleaned, removed };
}

/**
 * Split text on blank lines into passages of at most `maxChars`, keeping paragraphs whole.
 * A single paragraph longer than `maxChars` stays one passage: cutting mid-sentence would make
 * a worse citation than a slightly long one.
 */
export function splitIntoPassages(text: string, maxChars: number = MAX_CHUNK_CHARS): string[] {
  if (text.length <= maxChars) return [text];

  const passages: string[] = [];
  let current = "";
  for (const paragraph of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    if (current === "") {
      current = paragraph;
    } else if (current.length + 2 + paragraph.length <= maxChars) {
      current += `\n\n${paragraph}`;
    } else {
      passages.push(current);
      current = paragraph;
    }
  }
  if (current !== "") passages.push(current);
  return passages;
}

/** "Risks and Dependencies" -> "risks-and-dependencies" */
export function slugify(heading: string): string {
  return (
    heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/**
 * One chunk per passage. IDs number passages per section slug ("scope-1", "scope-2"), and keep
 * counting if a heading repeats, so chunk IDs are always unique within a charter.
 */
export function chunkCharter(
  charter: ParsedCharter,
  sourceFile: string,
  maxChars: number = MAX_CHUNK_CHARS,
): CharterChunk[] {
  const { initiativeId, name } = charter.metadata;
  const countBySlug = new Map<string, number>();
  const chunks: CharterChunk[] = [];

  for (const section of charter.sections) {
    const slug = slugify(section.heading);
    for (const passage of splitIntoPassages(section.text, maxChars)) {
      const n = (countBySlug.get(slug) ?? 0) + 1;
      countBySlug.set(slug, n);
      chunks.push({
        chunkId: `${initiativeId}#${slug}-${n}`,
        initiativeId,
        initiativeName: name,
        sourceFile,
        section: section.heading,
        text: passage,
      });
    }
  }
  return chunks;
}

/**
 * Text sent to the embedding model. The initiative name and section are prepended because a
 * passage like "Training was delayed" says nothing about which initiative it belongs to; the
 * header lets a question that names the initiative find it. Citations still quote `chunk.text`.
 */
export function embeddingInput(chunk: CharterChunk): string {
  return `${chunk.initiativeName} (${chunk.initiativeId}) - ${chunk.section}\n\n${chunk.text}`;
}
