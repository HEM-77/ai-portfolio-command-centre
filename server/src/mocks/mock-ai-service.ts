import type { AiService, AskRequest, AskResult, NarrativeInput, WeeklyBriefNarrative } from "../types/contracts.js";
import { MOCK_ASK_RESULT, MOCK_NARRATIVE } from "./mock-data.js";

/**
 * Mock of Hem's AiService. Returns the same canned answer for every question, so the
 * Assistant screen can be built before routing, retrieval and OpenRouter exist.
 * It does not read the question: there is no routing or generation here.
 */
export function createMockAiService(): AiService {
  return {
    async ask(_input: AskRequest): Promise<AskResult> {
      return { ...structuredClone(MOCK_ASK_RESULT), generatedAt: new Date().toISOString() };
    },
    async generateNarrative(_input: NarrativeInput): Promise<WeeklyBriefNarrative> {
      return structuredClone(MOCK_NARRATIVE);
    },
  };
}
