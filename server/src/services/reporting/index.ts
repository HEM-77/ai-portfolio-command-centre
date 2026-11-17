import { buildAttentionFlags } from "./attention-flags.ts";
import type {
  AiServiceLike,
  AttentionFlag,
  Narrative,
  PortfolioServiceLike,
  WeeklyBrief,
} from "./contract-types.ts";

export { buildAttentionFlags } from "./attention-flags.ts";

// ReportingService from docs/api-contracts.md §4.
export interface ReportingService {
  getAttentionFlags(): AttentionFlag[];
  getWeeklyBrief(): Promise<WeeklyBrief>;
}

const UNAVAILABLE: Narrative = { status: "unavailable", text: null, citations: [] };

// Dependencies are passed in so tests can use fakes and Hem can wire the real services.
export function createReportingService(deps: {
  portfolio: PortfolioServiceLike;
  ai: AiServiceLike;
  now?: () => Date;
}): ReportingService {
  const now = deps.now ?? (() => new Date());

  function getAttentionFlags(): AttentionFlag[] {
    return buildAttentionFlags(deps.portfolio.getScorecard().initiatives);
  }

  async function getNarrative(input: Parameters<AiServiceLike["generateNarrative"]>[0]): Promise<Narrative> {
    try {
      return await deps.ai.generateNarrative(input);
    } catch (err) {
      // The brief must still render from summary + flags when the LLM is down (contract §3.6).
      console.warn("[reporting] narrative unavailable:", err instanceof Error ? err.message : String(err));
      return UNAVAILABLE;
    }
  }

  async function getWeeklyBrief(): Promise<WeeklyBrief> {
    const { summary, initiatives } = deps.portfolio.getScorecard();
    const flags = buildAttentionFlags(initiatives);
    const narrative = await getNarrative({ purpose: "weekly_brief", summary, flags });
    return {
      // Decision §8 #11: the week is the latest data date, not today's date.
      weekEnding: summary.asOf,
      generatedAt: now().toISOString().replace(/\.\d{3}Z$/, "Z"),
      summary,
      flags,
      narrative,
    };
  }

  return { getAttentionFlags, getWeeklyBrief };
}
