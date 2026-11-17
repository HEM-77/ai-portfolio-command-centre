import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createMockAiService } from "../mocks/mock-ai-service.js";
import { createMockPortfolioService } from "../mocks/mock-portfolio-service.js";
import { createMockReportingService } from "../mocks/mock-reporting-service.js";
import { expectOk, mockDependencies, testConfig } from "../testing/test-app.js";
import type { AiService, NarrativeInput, WeeklyBrief } from "../types/contracts.js";

describe("GET /api/reports/weekly", () => {
  it("returns the weekly brief in the contract shape", async () => {
    const data = expectOk<WeeklyBrief>(await request(createApp(mockDependencies())).get("/api/reports/weekly"));

    expect(Object.keys(data).sort()).toEqual(["flags", "generatedAt", "narrative", "summary", "weekEnding"]);
    expect(Object.keys(data.narrative).sort()).toEqual(["citations", "status", "text"]);
    expect(data.flags.length).toBeGreaterThan(0);
    expect(Object.keys(data.flags[0] ?? {}).sort()).toEqual(
      ["flagId", "initiativeId", "initiativeName", "message", "metrics", "rule", "severity"],
    );
  });

  it("uses the latest asOf in the data as weekEnding, not today's date", async () => {
    const data = expectOk<WeeklyBrief>(await request(createApp(mockDependencies())).get("/api/reports/weekly"));
    expect(data.weekEnding).toBe(data.summary.asOf);
  });

  it("gets its summary from Portfolio and its narrative from the AI service", async () => {
    const narrativeCalls: NarrativeInput[] = [];
    const portfolio = createMockPortfolioService();
    const mockAi = createMockAiService();
    const ai: AiService = {
      ...mockAi,
      generateNarrative: async (input) => {
        narrativeCalls.push(input);
        return { status: "unavailable", text: null, citations: [] };
      },
    };
    const reporting = createMockReportingService(portfolio, ai);
    const app = createApp({ config: testConfig(), portfolio, ai, reporting });

    const data = expectOk<WeeklyBrief>(await request(app).get("/api/reports/weekly"));

    expect(narrativeCalls).toHaveLength(1);
    expect(narrativeCalls[0]?.purpose).toBe("weekly_brief");
    expect(narrativeCalls[0]?.summary).toEqual(portfolio.getSummary());
    // When the LLM is unavailable the brief still renders from summary and flags (contract §3.6).
    expect(data.narrative).toEqual({ status: "unavailable", text: null, citations: [] });
    expect(data.summary).toEqual(portfolio.getSummary());
    expect(data.flags.length).toBeGreaterThan(0);
  });
});
