import type { AiService, AttentionFlag, PortfolioService, ReportingService, WeeklyBrief } from "../types/contracts.js";
import { MOCK_FLAGS } from "./mock-data.js";

/**
 * Mock of Animesh's ReportingService. Wired like the real one: the summary comes from the
 * injected PortfolioService and the narrative from AiService.generateNarrative (contract §4).
 * The flags are fixed; no flag rules run here.
 */
export function createMockReportingService(portfolio: PortfolioService, ai: AiService): ReportingService {
  return {
    getAttentionFlags(): AttentionFlag[] {
      return structuredClone(MOCK_FLAGS);
    },
    async getWeeklyBrief(): Promise<WeeklyBrief> {
      const summary = portfolio.getSummary();
      const flags = structuredClone(MOCK_FLAGS);
      const narrative = await ai.generateNarrative({ purpose: "weekly_brief", summary, flags });
      return {
        weekEnding: summary.asOf, // contract §8 #11: latest asOf in the data, not today
        generatedAt: new Date().toISOString(),
        summary,
        flags,
        narrative,
      };
    },
  };
}
