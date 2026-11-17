import type { InitiativeMetrics, InitiativeStatus, QuestionType } from "../../types/contracts.js";

// Rule-based question router (contract §8 #7, architecture §6). Pure functions.
// numerical -> scorecard only; narrative -> charter evidence only; mixed -> scorecard decides which
// initiatives matter, charters explain why.

const NUMERICAL_TERMS = [
  "roi", "return", "spend", "spent", "cost", "costs", "value", "realised", "realized", "adoption", "users", "payback",
  "status", "total", "how much", "how many", "highest", "lowest", "top", "rank", "average", "negative", "positive",
  "percent", "percentage", "%", "number", "figures", "scorecard", "metric", "metrics", "red", "amber", "green",
  "on track", "at risk", "off track", "worst", "best", "performing", "performance", "underperform", "compare", "portfolio",
];

const NARRATIVE_TERMS = [
  "why", "reason", "reasons", "explain", "cause", "causes", "because", "risk", "risks", "dependency", "dependencies",
  "purpose", "scope", "problem", "objective", "charter", "governance", "next steps", "plan", "approach", "target users",
  "describe", "sponsor", "challenges", "issues", "mitigation", "lessons", "happening", "going on",
  "business case", "benefits measurement",
];

/** Words that do not identify an initiative on their own. */
const GENERIC_NAME_WORDS = new Set(["assistant", "bot", "copilot", "model", "automation", "the", "ai", "of", "and"]);

export type Selector = "negative_roi" | "low_adoption" | InitiativeStatus;

const SELECTOR_TERMS: { selector: Selector; terms: string[] }[] = [
  { selector: "negative_roi", terms: ["negative roi", "negative return", "losing money", "loss-making", "below zero", "roi below", "negative"] },
  { selector: "low_adoption", terms: ["low adoption", "poor adoption", "adoption is low", "adoption below", "low usage"] },
  { selector: "off_track", terms: ["off track", "off-track", "red", "failing", "underperform", "need attention", "needs attention", "attention", "struggling", "worst"] },
  { selector: "at_risk", terms: ["at risk", "at-risk", "amber", "need attention", "needs attention", "attention", "underperform"] },
  { selector: "on_track", terms: ["on track", "on-track", "green", "best", "successful", "performing well"] },
];

export interface Route {
  questionType: QuestionType;
  /** Initiatives named in the question (by NMB ID or by name). */
  mentionedIds: string[];
  /** Scorecard conditions named in the question, e.g. "negative ROI". */
  selectors: Selector[];
}

function containsTerm(text: string, term: string): boolean {
  if (term === "%") return text.includes("%");
  return new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text);
}

/** Initiatives named in the question: "NMB-004", "nmb4", the full name, or its distinctive words. */
export function findMentionedInitiatives(question: string, initiatives: readonly Pick<InitiativeMetrics, "initiativeId" | "name">[]): string[] {
  const text = question.toLowerCase();
  const found = new Set<string>();
  for (const match of text.matchAll(/\bnmb-?0*(\d{1,3})\b/g)) {
    const id = `NMB-${(match[1] ?? "").padStart(3, "0")}`;
    if (initiatives.some((i) => i.initiativeId === id)) found.add(id);
  }
  for (const initiative of initiatives) {
    const name = initiative.name.toLowerCase();
    if (text.includes(name)) {
      found.add(initiative.initiativeId);
      continue;
    }
    const distinctive = name.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC_NAME_WORDS.has(w));
    const hits = distinctive.filter((w) => containsTerm(text, w)).length;
    if (distinctive.length > 0 && hits >= Math.min(2, distinctive.length)) found.add(initiative.initiativeId);
  }
  return [...found].sort();
}

export function routeQuestion(question: string, initiatives: readonly Pick<InitiativeMetrics, "initiativeId" | "name">[]): Route {
  const text = question.toLowerCase();
  const numerical = NUMERICAL_TERMS.some((t) => containsTerm(text, t));
  const narrative = NARRATIVE_TERMS.some((t) => containsTerm(text, t));
  const mentionedIds = findMentionedInitiatives(question, initiatives);
  const selectors = SELECTOR_TERMS.filter(({ terms }) => terms.some((t) => containsTerm(text, t))).map((s) => s.selector);

  let questionType: QuestionType;
  if (numerical && narrative) questionType = "mixed";
  else if (numerical) questionType = "numerical";
  else if (narrative) questionType = mentionedIds.length > 0 || selectors.length > 0 ? "mixed" : "narrative";
  else questionType = mentionedIds.length > 0 ? "mixed" : "narrative";
  return { questionType, mentionedIds, selectors };
}

/** Initiatives a question is about, decided by the scorecard (never by the LLM). */
export function selectInitiatives(
  initiatives: readonly InitiativeMetrics[],
  route: Pick<Route, "selectors">,
  explicitIds: readonly string[],
): InitiativeMetrics[] {
  const matches = (i: InitiativeMetrics): boolean =>
    route.selectors.some((s) =>
      s === "negative_roi" ? i.roi !== null && i.roi < 0
        : s === "low_adoption" ? i.adoptionRate !== null && i.adoptionRate < 0.3
          : i.status === s,
    );
  if (explicitIds.length > 0) return initiatives.filter((i) => explicitIds.includes(i.initiativeId));
  if (route.selectors.length > 0) return initiatives.filter(matches);
  return [...initiatives];
}
