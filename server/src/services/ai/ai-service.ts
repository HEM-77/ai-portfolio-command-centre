import { AppError } from "../../types/app-error.js";
import type {
  AiService,
  AskRequest,
  AskResult,
  AttentionFlag,
  Citation,
  Evidence,
  Figure,
  InitiativeMetrics,
  NarrativeInput,
  PortfolioService,
  QuestionType,
  RagService,
  WeeklyBriefNarrative,
} from "../../types/contracts.js";
import { EXCERPT_MAX_CHARS, MIXED_MIN_SCORE, MIXED_TOP_K, NARRATIVE_TOP_K } from "./constants.js";
import { formatValue, initiativeFigures, scorecardLine, statusLabel, summaryFigures, summaryLine, type DisplayFigure, type FigureKind } from "./figures.js";
import type { ChatClient } from "./openrouter-client.js";
import { buildAssistantMessages, buildNarrativeMessages, type CitedEvidence } from "./prompt.js";
import { routeQuestion, selectInitiatives } from "./router.js";
import { validateAnswer } from "./validate.js";

// AiService (contract §4, architecture §6): route -> scorecard figures and/or charter evidence ->
// grounded prompt -> OpenRouter -> validate figures and citations -> answer, or a code-built
// fallback marked unverified. The LLM only explains values it is given; it never calculates.

export interface AiServiceOptions {
  portfolio: PortfolioService | undefined;
  rag: RagService | undefined;
  /** null when OPENROUTER_* is not configured: answers then come from the code-built fallback. */
  chat: ChatClient | null;
  now?: () => Date;
}

const INSUFFICIENT_ANSWER = "There is not enough evidence in the portfolio scorecard or the initiative charters to answer this question.";

/** Trim a passage to a short quote on a word boundary. */
export function excerpt(text: string, max: number = EXCERPT_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40)).trimEnd()}…`;
}

/** One sentence per initiative, built by code from the same display figures the LLM sees. */
function initiativeSentence(m: InitiativeMetrics): string {
  const f = Object.fromEntries(initiativeFigures(m).map((d) => [d.figure.metric, d.display]));
  return `${m.name} (${m.initiativeId}) is ${statusLabel(m.status)}: ROI ${f.roi}, adoption ${f.adoptionRate}, spend to date ${f.spendToDate}, value realised ${f.valueRealised}.`;
}

export function createAiService(options: AiServiceOptions): AiService {
  const { portfolio, rag, chat, now = () => new Date() } = options;

  function result(
    questionType: QuestionType,
    answer: string,
    figures: Figure[],
    citations: Citation[],
    status: AskResult["validation"]["status"],
    notes: string[],
    model: string | null,
  ): AskResult {
    return { questionType, answer, figures, citations, validation: { status, notes }, model, generatedAt: now().toISOString() };
  }

  async function findEvidence(question: string, initiativeIds: readonly string[], mixed: boolean, notes: string[]): Promise<Evidence[]> {
    if (!rag?.isReady()) {
      notes.push("Charter search is not available (the vector index is not loaded), so no charter evidence was used.");
      return [];
    }
    return rag.retrieve(question, {
      ...(initiativeIds.length > 0 ? { initiativeIds: [...initiativeIds] } : {}),
      topK: mixed ? MIXED_TOP_K : NARRATIVE_TOP_K,
      ...(mixed ? { minScore: MIXED_MIN_SCORE } : {}),
    });
  }

  return {
    async ask(input: AskRequest): Promise<AskResult> {
      const question = input.question.trim();
      const scorecardReady = portfolio?.isReady() ?? false;
      const initiatives = scorecardReady && portfolio ? portfolio.getInitiatives() : [];
      const route = routeQuestion(question, initiatives);
      const explicitIds = input.initiativeIds ?? route.mentionedIds;
      const { questionType } = route;
      const notes: string[] = [];

      // 1. Scorecard: the structured data decides which initiatives matter (architecture §6).
      let selected: InitiativeMetrics[] = [];
      const scorecardLines: string[] = [];
      const figures: DisplayFigure[] = [];
      let asOf: string | null = null;
      if (questionType !== "narrative") {
        if (!scorecardReady || !portfolio) throw new AppError("NOT_READY", "Portfolio scorecard is not loaded yet");
        const summary = portfolio.getSummary();
        asOf = summary.asOf;
        selected = selectInitiatives(initiatives, route, explicitIds);
        const shown = questionType === "numerical" || selected.length === 0 ? initiatives : selected;
        scorecardLines.push(summaryLine(summary), ...shown.map(scorecardLine));
        figures.push(...summaryFigures(summary), ...shown.flatMap(initiativeFigures));
      }

      // 2. Charter evidence: for mixed questions, only from the initiatives the scorecard selected.
      let evidence: Evidence[] = [];
      if (questionType !== "numerical") {
        const narrowed = questionType === "mixed" && selected.length > 0 && selected.length < initiatives.length;
        const ids = narrowed ? selected.map((i) => i.initiativeId) : explicitIds;
        evidence = await findEvidence(question, ids, questionType === "mixed", notes);
      }
      const names = new Map(initiatives.map((i) => [i.initiativeId, i.name]));
      const cited: CitedEvidence[] = evidence.map((e, i) => ({ citationId: `C${i + 1}`, evidence: e, initiativeName: names.get(e.initiativeId) ?? e.initiativeId }));
      const citations: Citation[] = cited.map(({ citationId, evidence: e }) => ({
        citationId, initiativeId: e.initiativeId, sourceFile: e.sourceFile, section: e.section, excerpt: excerpt(e.text),
      }));

      // 3. Nothing to ground an answer on: say so, never guess (contract §3.5).
      if (figures.length === 0 && evidence.length === 0) {
        return result(questionType, INSUFFICIENT_ANSWER, [], [], "insufficient_evidence", notes, null);
      }

      // 4. Code-built answer from the same figures and evidence, used whenever the LLM cannot be trusted.
      const fallback = (reasons: string[], model: string | null): AskResult => {
        const focus = selected.length > 0 && selected.length < initiatives.length ? selected : [];
        const parts: string[] = [];
        const used: Figure[] = [];
        if (questionType !== "narrative" && portfolio) {
          if (focus.length === 0) {
            parts.push(`${summaryLine(portfolio.getSummary())}.`);
            used.push(...summaryFigures(portfolio.getSummary()).map((d) => d.figure));
          }
          for (const m of focus.slice(0, 6)) {
            parts.push(initiativeSentence(m));
            used.push(...initiativeFigures(m).filter((d) => ["roi", "adoptionRate", "spendToDate", "valueRealised"].includes(d.figure.metric)).map((d) => d.figure));
          }
        }
        const quoted = citations.slice(0, 3);
        for (const c of quoted) parts.push(`${names.get(c.initiativeId) ?? c.initiativeId}, ${c.section}: "${c.excerpt}" [${c.citationId}]`);
        return result(questionType, parts.join(" "), used, quoted, "unverified", [...notes, ...reasons], model);
      };

      if (!chat) return fallback(["The AI model is not configured, so the answer shows the scorecard figures and charter evidence directly."], null);

      const draft = await chat.complete(buildAssistantMessages({ question, asOf, scorecardLines, evidence: cited }));
      const check = validateAnswer({
        answer: draft,
        figures,
        citations,
        evidenceText: new Map(cited.map((c) => [c.citationId, c.evidence.text])),
        question,
        requireCitation: evidence.length > 0 && questionType !== "numerical",
      });
      if (!check.ok) return fallback(check.notes, chat.model);
      return result(questionType, draft.trim(), check.usedFigures, check.usedCitations, "verified", notes, chat.model);
    },

    async generateNarrative(input: NarrativeInput): Promise<WeeklyBriefNarrative> {
      if (!chat) return { status: "unavailable", text: null, citations: [] };
      const figures = [...summaryFigures(input.summary), ...input.flags.flatMap(flagFigures)];
      const flagLines = input.flags.map((f) => `${f.initiativeName} (${f.initiativeId}), ${f.severity} severity, ${f.rule}: ${f.message}`);
      let draft: string;
      try {
        draft = await chat.complete(buildNarrativeMessages({ summaryLine: summaryLine(input.summary), flagLines }));
      } catch {
        // Contract §3.6: an LLM failure makes the narrative unavailable; the brief still renders.
        return { status: "unavailable", text: null, citations: [] };
      }
      const check = validateAnswer({ answer: draft, figures, citations: [], evidenceText: new Map(), question: flagLines.join(" "), requireCitation: false });
      if (check.ok) return { status: "verified", text: draft.trim(), citations: [] };
      const text = [`${summaryLine(input.summary)}.`, ...input.flags.map((f) => `${f.initiativeName}: ${f.message}`)].join(" ");
      return { status: "unverified", text, citations: [] };
    },
  };
}

const FLAG_METRIC_KINDS: Partial<Record<keyof InitiativeMetrics, FigureKind>> = {
  roi: "ratio",
  adoptionRate: "ratio",
  spendToDate: "money",
  valueRealised: "money",
  paybackMonths: "months",
  dataQualityIssueCount: "count",
};

function flagFigures(flag: AttentionFlag): DisplayFigure[] {
  return Object.entries(flag.metrics).flatMap(([metric, value]) => {
    const kind = FLAG_METRIC_KINDS[metric as keyof InitiativeMetrics];
    if (!kind || (typeof value !== "number" && value !== null)) return [];
    return [{ figure: { initiativeId: flag.initiativeId, metric, value, source: "scorecard" as const }, kind, display: formatValue(value, kind) }];
  });
}
