import { MAX_CHUNK_CHARS } from "./constants.js";

// Turns a Markdown charter (contract §5.1) into citable chunks. Pure functions: no I/O.

export const INITIATIVE_ID_PATTERN = /^INIT-\d{3}$/;
const REQUIRED_FIELDS = ["initiativeId", "name", "businessUnit"] as const;

export interface CharterMetadata {
  initiativeId: string;
  name: string;
  businessUnit: string;
}

export interface CharterSection {
  heading: string; // the "## " heading text, used as Evidence.section
  text: string;
}

export interface ParsedCharter {
  metadata: CharterMetadata;
  sections: CharterSection[];
}

/** One citable passage. `text` is the raw charter text, quoted in citations. */
export interface CharterChunk {
  chunkId: string; // "INIT-003#risks-1"
  initiativeId: string;
  initiativeName: string;
  sourceFile: string; // repo-relative, forward slashes: "charters/INIT-003-claims-triage.md"
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

/**
 * Parse front matter and `##` sections. The `# Title` line and anything before the first `##`
 * are not evidence. `###` subheadings stay inside their `##` section.
 *
 * The file name must start with the initiative ID (contract §5.1), which catches a charter
 * whose front matter was copied from another file and would otherwise cite the wrong initiative.
 */
export function parseCharter(markdown: string, fileName: string): ParsedCharter {
  const text = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  const frontMatter = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!frontMatter) {
    throw new CharterFormatError(`${fileName}: missing front matter (a --- block at the top of the file)`);
  }

  const fields = parseFrontMatter(frontMatter[1] ?? "");
  for (const field of REQUIRED_FIELDS) {
    if (!fields[field]) throw new CharterFormatError(`${fileName}: front matter is missing "${field}"`);
  }
  const metadata: CharterMetadata = {
    initiativeId: fields.initiativeId ?? "",
    name: fields.name ?? "",
    businessUnit: fields.businessUnit ?? "",
  };

  if (!INITIATIVE_ID_PATTERN.test(metadata.initiativeId)) {
    throw new CharterFormatError(`${fileName}: initiativeId "${metadata.initiativeId}" must look like INIT-001`);
  }
  if (!fileName.startsWith(`${metadata.initiativeId}-`)) {
    throw new CharterFormatError(`${fileName}: file name must start with "${metadata.initiativeId}-"`);
  }

  const sections = splitSections(text.slice(frontMatter[0].length));
  if (sections.length === 0) {
    throw new CharterFormatError(`${fileName}: no "## " sections with content`);
  }
  return { metadata, sections };
}

/** Simple `key: value` lines. Enough for our three flat fields; no YAML library needed. */
function parseFrontMatter(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match?.[1]) continue;
    fields[match[1]] = (match[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
  }
  return fields;
}

function splitSections(body: string): CharterSection[] {
  const sections: CharterSection[] = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const line of body.split("\n")) {
    const heading = /^##(?!#)\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1]) {
      if (current) sections.push({ heading: current.heading, text: current.lines.join("\n").trim() });
      current = { heading: heading[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ heading: current.heading, text: current.lines.join("\n").trim() });

  return sections.filter((section) => section.text.length > 0);
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

/** "Status Notes" -> "status-notes" */
export function slugify(heading: string): string {
  return (
    heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/**
 * One chunk per passage. IDs number passages per section slug ("risks-1", "risks-2"), and keep
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
