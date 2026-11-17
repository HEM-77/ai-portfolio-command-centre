import type { Citation, Figure } from "../../types/contracts.js";
import type { DisplayFigure } from "./figures.js";

// Validates an LLM draft (contract §3.5, AGENTS.md §7): every number must come from the scorecard
// figures or from a cited evidence passage, and every [Cn] marker must be a citation we supplied.
// Pure functions.

interface NumberToken {
  text: string;
  index: number; // position in the original text
  written: number; // the number as written, signed: "$2.25M" -> 2.25
  value: number; // after the multiplier: "$2.25M" -> 2250000
  decimals: number; // decimals written, before the multiplier
  multiplier: number;
  percent: boolean;
}

const MULTIPLIERS: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, bn: 1e9, b: 1e9, billion: 1e9 };

// "-$1,234.5", "188.5%", "$2.25M", "3 million". Excludes digits glued to letters (e.g. "Q3", "C1").
const NUMBER_PATTERN = /(?<![\w.])-?\$?\d+(?:,\d{3})*(?:\.\d+)?(?:\s?(?:%|percent\b)|\s?(?:k|m|bn|b)\b|\s(?:thousand|million|billion)\b)?/gi;

export function extractNumbers(text: string): NumberToken[] {
  // Identifiers and markers are not quantities.
  const cleaned = text
    // Same-length blanks keep character positions, so `index` points into the original text.
    .replace(/\[C\d+\]/g, (m) => " ".repeat(m.length))
    .replace(/\bNMB-?\d{1,3}\b/gi, (m) => " ".repeat(m.length))
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, (m) => " ".repeat(m.length));
  const tokens: NumberToken[] = [];
  for (const match of cleaned.matchAll(NUMBER_PATTERN)) {
    const raw = match[0];
    const numeric = /-?\$?(\d+(?:,\d{3})*(?:\.\d+)?)/.exec(raw);
    if (!numeric?.[1]) continue;
    const digits = numeric[1].replace(/,/g, "");
    const suffix = raw.slice((numeric.index ?? 0) + numeric[0].length).trim().toLowerCase();
    const percent = suffix === "%" || suffix === "percent";
    const multiplier = MULTIPLIERS[suffix] ?? 1;
    const sign = raw.trim().startsWith("-") ? -1 : 1;
    tokens.push({
      text: raw.trim(),
      index: match.index ?? 0,
      written: sign * Number(digits),
      value: sign * Number(digits) * multiplier,
      decimals: digits.includes(".") ? (digits.split(".")[1]?.length ?? 0) : 0,
      multiplier,
      percent,
    });
  }
  return tokens;
}

const roundTo = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * Does the token state this figure? The figure is rounded to the precision the token was written
 * with, so "188.5%", "189%" and "$2.25M" all match their figures, but "250%" never matches 188.5%.
 */
function matchesFigure(token: NumberToken, f: DisplayFigure): boolean {
  const value = f.figure.value;
  if (value === null) return false;
  if (f.kind === "ratio") {
    if (!token.percent) return false;
    return same(roundTo(value * 100, token.decimals), token.written);
  }
  if (token.percent) return false;
  return same(roundTo(value / token.multiplier, token.decimals), token.written);
}

/** Words that name each metric, used to tell apart figures that happen to share a value. */
const METRIC_WORDS: Record<string, string[]> = {
  roi: ["roi", "return"], portfolioRoi: ["roi", "return"],
  adoptionRate: ["adoption"], averageAdoptionRate: ["adoption"],
  spendToDate: ["spend", "cost"], totalSpend: ["spend", "cost"],
  valueRealised: ["value", "benefit"], totalValueRealised: ["value", "benefit"],
  paybackMonths: ["payback"], dataQualityIssueCount: ["data-quality", "data quality", "quality"],
  negativeRoiCount: ["negative"], initiativeCount: ["initiatives"],
  "countsByStatus.on_track": ["on track", "green"], "countsByStatus.at_risk": ["at risk", "amber"],
  "countsByStatus.off_track": ["off track", "red"],
};

/**
 * Of the figures a number matches, pick the one the sentence is about: its metric word close to the
 * number, preferring the initiative named nearby; otherwise the first match.
 */
function pickFigure(token: NumberToken, matches: readonly DisplayFigure[], answer: string): DisplayFigure | undefined {
  if (matches.length <= 1) return matches[0];
  const around = answer.slice(Math.max(0, token.index - 60), token.index + token.text.length + 30).toLowerCase();
  const before = answer.slice(0, token.index).toLowerCase();
  const score = (f: DisplayFigure) => {
    const words = METRIC_WORDS[f.figure.metric] ?? [];
    const metricHit = words.some((w) => around.includes(w)) ? 2 : 0;
    const id = f.figure.initiativeId?.toLowerCase();
    const initiativeHit = id && before.lastIndexOf(id) >= 0 && before.lastIndexOf(id) > before.length - 400 ? 1 : 0;
    return metricHit + initiativeHit;
  };
  return [...matches].sort((a, b) => score(b) - score(a))[0];
}

/** Years (2025) are dates, not metrics. */
const isYear = (t: NumberToken) => !t.percent && t.multiplier === 1 && t.decimals === 0 && t.value >= 1990 && t.value <= 2100 && !t.text.includes("$");

export interface ValidationResult {
  ok: boolean;
  notes: string[];
  /** Figures the answer actually states, in the order they first appear. */
  usedFigures: Figure[];
  /** Supplied citations the answer actually references. */
  usedCitations: Citation[];
}

export interface ValidationInput {
  answer: string;
  figures: readonly DisplayFigure[];
  citations: readonly Citation[];
  /** Full evidence text per citation ID: numbers quoted from a cited passage are allowed. */
  evidenceText: ReadonlyMap<string, string>;
  /** Numbers the user wrote in the question (e.g. "top 3") are not claims. */
  question: string;
  /** True when the answer must cite at least one supplied passage. */
  requireCitation: boolean;
}

export function validateAnswer(input: ValidationInput): ValidationResult {
  const notes: string[] = [];
  const answer = input.answer.trim();
  if (answer === "") return { ok: false, notes: ["The model returned an empty answer."], usedFigures: [], usedCitations: [] };

  const known = new Map(input.citations.map((c) => [c.citationId, c]));
  const markers = [...new Set([...answer.matchAll(/\[(C\d+)\]/g)].map((m) => m[1] ?? ""))];
  const unknown = markers.filter((id) => !known.has(id));
  if (unknown.length > 0) notes.push(`Citation ${unknown.map((id) => `[${id}]`).join(", ")} does not match any retrieved evidence.`);
  const usedCitations = markers.filter((id) => known.has(id)).map((id) => known.get(id) as Citation);
  if (input.requireCitation && usedCitations.length === 0) notes.push("The answer does not cite any of the retrieved charter evidence.");

  // Numbers in cited passages may be quoted (e.g. a charter's adoption target), with their citation.
  const citedNumbers = usedCitations.flatMap((c) => extractNumbers(input.evidenceText.get(c.citationId) ?? ""));
  const questionNumbers = extractNumbers(input.question);
  const used = new Map<string, Figure>();
  const unsupported: string[] = [];
  for (const token of extractNumbers(answer)) {
    if (isYear(token)) continue;
    const figure = pickFigure(token, input.figures.filter((f) => matchesFigure(token, f)), answer);
    if (figure) {
      used.set(`${figure.figure.initiativeId}|${figure.figure.metric}`, figure.figure);
      continue;
    }
    const quoted = [...citedNumbers, ...questionNumbers].some((n) => same(n.value, token.value) && n.percent === token.percent);
    if (!quoted) unsupported.push(token.text);
  }
  if (unsupported.length > 0) {
    notes.push(`Number(s) ${[...new Set(unsupported)].join(", ")} do not match the scorecard or the cited evidence.`);
  }

  return { ok: notes.length === 0, notes, usedFigures: [...used.values()], usedCitations };
}
