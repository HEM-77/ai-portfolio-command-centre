import { describe, expect, it } from "vitest";
import { AppError } from "../../types/app-error.js";
import type { Evidence, InitiativeMetrics, PortfolioService, PortfolioSummary, RagService } from "../../types/contracts.js";
import { createAiService } from "./ai-service.js";
import { createOpenRouterClient, parseCompletion, type ChatClient } from "./openrouter-client.js";
import type { ChatMessage } from "./prompt.js";

// No real API is ever called: the chat model, retriever and scorecard are fakes.

const metrics = (id: string, name: string, overrides: Partial<InitiativeMetrics> = {}): InitiativeMetrics => ({
  initiativeId: id, name, businessUnit: "Ops", owner: null, initiativeType: "Copilot", status: "on_track",
  spendToDate: 100000, valueRealised: 150000, roi: 0.5, adoptionRate: 0.7, paybackMonths: 8, dataQualityIssueCount: 0,
  asOf: "2026-11-15", ...overrides,
});
const INITIATIVES = [
  metrics("NMB-001", "Nimbus Service Copilot"),
  metrics("NMB-008", "Marketing Content Copilot", { status: "off_track", spendToDate: 524880, valueRealised: 432000, roi: -0.177, adoptionRate: 0.75 }),
];
const SUMMARY: PortfolioSummary = {
  asOf: "2026-11-15", initiativeCount: 2, totalSpend: 624880, totalValueRealised: 582000, portfolioRoi: -0.0686,
  averageAdoptionRate: 0.725, negativeRoiCount: 1, countsByStatus: { on_track: 1, at_risk: 0, off_track: 1 },
};

function fakePortfolio(ready = true): PortfolioService {
  return {
    load: async () => {}, isReady: () => ready, getScorecard: () => ({ summary: SUMMARY, initiatives: INITIATIVES }),
    getSummary: () => SUMMARY, getInitiatives: () => [...INITIATIVES], getQualityReport: () => { throw new Error("unused"); },
    getInitiative: (id) => INITIATIVES.find((i) => i.initiativeId === id),
  };
}

const evidence = (id: string, section: string, text: string): Evidence => ({
  chunkId: `${id}#x`, initiativeId: id, sourceFile: `charters/${id}_X.md`, section, text, score: 0.6,
});

function fakeRag(found: Evidence[], ready = true): RagService & { calls: { query: string; ids?: string[] }[] } {
  const calls: { query: string; ids?: string[] }[] = [];
  return {
    calls, buildIndex: async () => ({ chunkCount: 0 }), loadIndex: async () => {}, isReady: () => ready, getChunkCount: () => found.length,
    retrieve: async (query, options) => {
      calls.push({ query, ...(options?.initiativeIds ? { ids: options.initiativeIds } : {}) });
      return found.filter((e) => !options?.initiativeIds || options.initiativeIds.includes(e.initiativeId));
    },
  };
}

function fakeChat(reply: string | Error): ChatClient & { prompts: ChatMessage[][] } {
  const prompts: ChatMessage[][] = [];
  return {
    model: "test/model", prompts,
    complete: async (messages) => {
      prompts.push([...messages]);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

const NMB008_EVIDENCE = [
  evidence("NMB-008", "Risks and Dependencies", "Per-seat licence cost is high relative to benefit."),
  evidence("NMB-001", "Risks and Dependencies", "Agents may over-trust suggestions."),
];
const now = () => new Date("2026-11-17T09:00:00.000Z");

describe("AiService.ask", () => {
  it("answers a mixed question: scorecard selects NMB-008, evidence is limited to it, draft verified", async () => {
    const rag = fakeRag(NMB008_EVIDENCE);
    const chat = fakeChat("Marketing Content Copilot has ROI -17.7%, mainly because licences are costly [C1].");
    const ai = createAiService({ portfolio: fakePortfolio(), rag, chat, now });

    const result = await ai.ask({ question: "Which initiatives have negative ROI, and why?" });

    expect(rag.calls).toEqual([{ query: "Which initiatives have negative ROI, and why?", ids: ["NMB-008"] }]);
    expect(result).toEqual({
      questionType: "mixed",
      answer: "Marketing Content Copilot has ROI -17.7%, mainly because licences are costly [C1].",
      figures: [{ initiativeId: "NMB-008", metric: "roi", value: -0.177, source: "scorecard" }],
      citations: [{ citationId: "C1", initiativeId: "NMB-008", sourceFile: "charters/NMB-008_X.md", section: "Risks and Dependencies", excerpt: "Per-seat licence cost is high relative to benefit." }],
      validation: { status: "verified", notes: [] },
      model: "test/model",
      generatedAt: "2026-11-17T09:00:00.000Z",
    });
    const user = chat.prompts[0]?.[1]?.content ?? "";
    expect(user).toContain("ROI -17.7%"); // figures are pre-formatted for the model
    expect(user).toMatch(/<evidence>[\s\S]*\[C1\] NMB-008[\s\S]*<\/evidence>/);
  });

  it("replaces a draft with a wrong number by the code-built answer, marked unverified", async () => {
    const chat = fakeChat("Marketing Content Copilot has ROI 250% [C1].");
    const result = await createAiService({ portfolio: fakePortfolio(), rag: fakeRag(NMB008_EVIDENCE), chat, now })
      .ask({ question: "Which initiatives have negative ROI, and why?" });

    expect(result.validation.status).toBe("unverified");
    expect(result.validation.notes[0]).toMatch(/250%/);
    expect(result.answer).not.toContain("250%");
    expect(result.answer).toContain("ROI -17.7%");
    expect(result.answer).toContain("[C1]");
    expect(result.model).toBe("test/model");
  });

  it("replaces a draft with an invented citation", async () => {
    const result = await createAiService({ portfolio: fakePortfolio(), rag: fakeRag(NMB008_EVIDENCE), chat: fakeChat("Costs are high [C4]."), now })
      .ask({ question: "Which initiatives have negative ROI, and why?" });
    expect(result.validation).toMatchObject({ status: "unverified" });
    expect(result.citations.every((c) => c.citationId === "C1")).toBe(true);
  });

  it("answers a numerical question from the scorecard without retrieving evidence", async () => {
    const rag = fakeRag(NMB008_EVIDENCE);
    const result = await createAiService({ portfolio: fakePortfolio(), rag, chat: fakeChat("Total spend is $624,880."), now })
      .ask({ question: "What is the total spend?" });
    expect(result).toMatchObject({ questionType: "numerical", validation: { status: "verified" }, citations: [] });
    expect(result.figures).toEqual([{ initiativeId: null, metric: "totalSpend", value: 624880, source: "scorecard" }]);
    expect(rag.calls).toEqual([]);
  });

  it("says there is not enough evidence, without calling the model, when nothing relevant is found", async () => {
    const chat = fakeChat("should not be called");
    const result = await createAiService({ portfolio: fakePortfolio(), rag: fakeRag([]), chat, now })
      .ask({ question: "What is the weather in Paris tomorrow?" });
    expect(result).toMatchObject({ questionType: "narrative", validation: { status: "insufficient_evidence" }, model: null, figures: [], citations: [] });
    expect(chat.prompts).toHaveLength(0);
  });

  it("still answers from figures and evidence when no model is configured", async () => {
    const result = await createAiService({ portfolio: fakePortfolio(), rag: fakeRag(NMB008_EVIDENCE), chat: null, now })
      .ask({ question: "Which initiatives have negative ROI, and why?" });
    expect(result).toMatchObject({ validation: { status: "unverified" }, model: null });
    expect(result.validation.notes.at(-1)).toMatch(/not configured/);
  });

  it("notes when charter search is unavailable and answers from the scorecard", async () => {
    const result = await createAiService({ portfolio: fakePortfolio(), rag: fakeRag([], false), chat: fakeChat("ROI is -17.7%."), now })
      .ask({ question: "Which initiatives have negative ROI, and why?" });
    expect(result.validation.status).toBe("verified");
    expect(result.validation.notes[0]).toMatch(/Charter search is not available/);
  });

  it("is NOT_READY for a scorecard question before the scorecard loads", async () => {
    const error = await createAiService({ portfolio: fakePortfolio(false), rag: fakeRag([]), chat: fakeChat("x"), now })
      .ask({ question: "What is the total spend?" }).then(() => null, (e: unknown) => e);
    expect(error instanceof AppError && error.code).toBe("NOT_READY");
  });

  it("passes an upstream model failure through as UPSTREAM_ERROR (contract §1)", async () => {
    const failing = fakeChat(new AppError("UPSTREAM_ERROR", "AI model provider returned HTTP 503"));
    await expect(createAiService({ portfolio: fakePortfolio(), rag: fakeRag([]), chat: failing, now }).ask({ question: "What is the total spend?" }))
      .rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });

  it("restricts retrieval to the initiativeIds in the request", async () => {
    const rag = fakeRag(NMB008_EVIDENCE);
    await createAiService({ portfolio: fakePortfolio(), rag, chat: fakeChat("Agents may over-trust it [C1]."), now })
      .ask({ question: "What are the risks?", initiativeIds: ["NMB-001"] });
    expect(rag.calls[0]?.ids).toEqual(["NMB-001"]);
  });
});

describe("AiService.generateNarrative", () => {
  const input = {
    purpose: "weekly_brief" as const,
    summary: SUMMARY,
    flags: [{ flagId: "FLAG-001", initiativeId: "NMB-008", initiativeName: "Marketing Content Copilot", rule: "negative_roi" as const, severity: "high" as const, message: "ROI is -17.7%.", metrics: { roi: -0.177 } }],
  };

  it("returns a verified narrative that uses only given numbers", async () => {
    const ai = createAiService({ portfolio: undefined, rag: undefined, chat: fakeChat("Portfolio ROI is -6.9%. Marketing Content Copilot needs attention at -17.7%."), now });
    expect(await ai.generateNarrative(input)).toEqual({ status: "verified", text: "Portfolio ROI is -6.9%. Marketing Content Copilot needs attention at -17.7%.", citations: [] });
  });

  it("falls back to a code-built text when the draft invents a number, and is unavailable when the model fails", async () => {
    const wrong = await createAiService({ portfolio: undefined, rag: undefined, chat: fakeChat("ROI is 99%."), now }).generateNarrative(input);
    expect(wrong.status).toBe("unverified");
    expect(wrong.text).toContain("Marketing Content Copilot: ROI is -17.7%.");
    const down = await createAiService({ portfolio: undefined, rag: undefined, chat: fakeChat(new Error("down")), now }).generateNarrative(input);
    expect(down).toEqual({ status: "unavailable", text: null, citations: [] });
    expect(await createAiService({ portfolio: undefined, rag: undefined, chat: null, now }).generateNarrative(input)).toEqual(down);
  });
});

describe("OpenRouter client (fake fetch)", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const ok = { choices: [{ message: { role: "assistant", content: "Answer." } }] };

  it("posts the model and messages and returns the answer text", async () => {
    const requests: { url: string; body: unknown; auth: string | null }[] = [];
    const client = createOpenRouterClient({
      apiKey: "sk-test", model: "test/model",
      fetchFn: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
        return json(200, ok);
      },
    });
    expect(await client.complete([{ role: "user", content: "Q" }])).toBe("Answer.");
    expect(requests[0]).toMatchObject({ url: "https://openrouter.ai/api/v1/chat/completions", auth: "Bearer sk-test", body: { model: "test/model", temperature: 0 } });
  });

  it("retries once on 429, then reports failures as UPSTREAM_ERROR without leaking the key", async () => {
    let calls = 0;
    const retrying = createOpenRouterClient({ apiKey: "k", model: "m", sleep: async () => {}, fetchFn: async () => (++calls === 1 ? json(429, {}) : json(200, ok)) });
    expect(await retrying.complete([])).toBe("Answer.");
    expect(calls).toBe(2);

    const rejected = createOpenRouterClient({ apiKey: "sk-secret", model: "m", fetchFn: async () => json(401, { error: { message: "bad key sk-secret" } }) });
    const error = await rejected.complete([]).then(() => null, (e: unknown) => e);
    expect(error).toMatchObject({ code: "UPSTREAM_ERROR", message: "AI model provider returned HTTP 401" });
    expect(String((error as AppError).cause)).not.toContain("sk-secret");
  });

  it("treats a 200 response carrying an error, or without text, as a failure", () => {
    expect(() => parseCompletion({ error: { message: "x" } })).toThrow(/returned an error/);
    expect(() => parseCompletion({ choices: [] })).toThrow(/no answer text/);
  });
});
