import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createMockAiService } from "../mocks/mock-ai-service.js";
import { expectError, expectOk, mockDependencies, testConfig } from "../testing/test-app.js";
import type { AiService, AskRequest, AskResult } from "../types/contracts.js";

const app = createApp(mockDependencies());

function ask(body: unknown) {
  return request(app).post("/api/assistant/ask").send(body as object);
}

/** An AiService that records what the controller passed to it. */
function recordingAi(): { ai: AiService; calls: AskRequest[] } {
  const calls: AskRequest[] = [];
  const mock = createMockAiService();
  return {
    calls,
    ai: {
      ...mock,
      ask: async (input) => {
        calls.push(input);
        return mock.ask(input);
      },
    },
  };
}

describe("POST /api/assistant/ask", () => {
  describe("valid requests", () => {
    it("returns an AskResult in the contract shape", async () => {
      const data = expectOk<AskResult>(await ask({ question: "Which initiatives have negative ROI, and why?" }));

      expect(Object.keys(data).sort()).toEqual(
        ["answer", "citations", "figures", "generatedAt", "model", "questionType", "validation"],
      );
      expect(data.validation).toEqual({ status: "verified", notes: [] });
      expect(data.figures.every((f) => f.source === "scorecard")).toBe(true);
    });

    it("only cites citation IDs that exist in citations", async () => {
      const data = expectOk<AskResult>(await ask({ question: "Which initiatives have negative ROI?" }));
      const cited = [...data.answer.matchAll(/\[(C\d+)\]/g)].map((m) => m[1]);
      const known = data.citations.map((c) => c.citationId);

      expect(cited.length).toBeGreaterThan(0);
      expect(cited.every((id) => known.includes(id ?? ""))).toBe(true);
    });

    it("accepts exactly 3 and exactly 1000 characters", async () => {
      expectOk(await ask({ question: "ROI" }));
      expectOk(await ask({ question: "a".repeat(1000) }));
    });

    it("accepts known initiativeIds", async () => {
      expectOk(await ask({ question: "Why is it behind?", initiativeIds: ["INIT-003"] }));
    });

    it("passes the trimmed question and initiativeIds to the injected AI service", async () => {
      const { ai, calls } = recordingAi();
      const spyApp = createApp({ ...mockDependencies(), ai });

      await request(spyApp).post("/api/assistant/ask").send({ question: "  Why?  ", initiativeIds: ["INIT-003"] });
      await request(spyApp).post("/api/assistant/ask").send({ question: "What is ROI?", initiativeIds: [] });

      expect(calls).toEqual([
        { question: "Why?", initiativeIds: ["INIT-003"] },
        { question: "What is ROI?" }, // an empty list means "no filter"
      ]);
    });
  });

  describe("invalid requests return 400 VALIDATION_ERROR", () => {
    it.each([
      ["missing question", {}],
      ["null question", { question: null }],
      ["non-string question", { question: 123 }],
      ["array question", { question: ["Why?"] }],
      ["question shorter than 3 characters", { question: "hi" }],
      ["question under 3 characters after trimming", { question: "   hi   " }],
      ["empty question", { question: "" }],
      ["question longer than 1000 characters", { question: "a".repeat(1001) }],
      ["initiativeIds not an array", { question: "Why?", initiativeIds: "INIT-003" }],
      ["initiativeIds with a non-string", { question: "Why?", initiativeIds: ["INIT-003", 7] }],
    ])("%s", async (_label, body) => {
      expectError(await ask(body), 400, "VALIDATION_ERROR");
    });

    it("uses the contract's length message", async () => {
      const message = expectError(await ask({ question: "hi" }), 400, "VALIDATION_ERROR");
      expect(message).toBe("question must be between 3 and 1000 characters");
    });

    it("rejects a JSON body that is not an object", async () => {
      expectError(await ask(["Why?"]), 400, "VALIDATION_ERROR");
    });

    it("rejects a body that is not JSON", async () => {
      const res = await request(app).post("/api/assistant/ask").type("form").send("question=Why");
      expectError(res, 400, "VALIDATION_ERROR");
    });
  });

  it("returns 404 NOT_FOUND for unknown initiative IDs", async () => {
    const message = expectError(
      await ask({ question: "Why is it behind?", initiativeIds: ["INIT-003", "INIT-999"] }),
      404,
      "NOT_FOUND",
    );
    expect(message).toContain("INIT-999");
    expect(message).not.toContain("INIT-003");
  });

  it("does not call the AI service when the request is invalid", async () => {
    const { ai, calls } = recordingAi();
    const spyApp = createApp({ ...mockDependencies(), ai });

    await request(spyApp).post("/api/assistant/ask").send({ question: "hi" });
    await request(spyApp).post("/api/assistant/ask").send({ question: "Why?", initiativeIds: ["INIT-999"] });

    expect(calls).toEqual([]);
  });

  it("skips the known-ID check when no portfolio service is wired in", async () => {
    const { ai, calls } = recordingAi();
    const spyApp = createApp({ config: testConfig(), ai });

    expectOk(await request(spyApp).post("/api/assistant/ask").send({ question: "Why?", initiativeIds: ["INIT-999"] }));
    expect(calls).toEqual([{ question: "Why?", initiativeIds: ["INIT-999"] }]);
  });
});
