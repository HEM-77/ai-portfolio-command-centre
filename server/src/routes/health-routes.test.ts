import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { expectOk, fullyConfigured, mockDependencies, testConfig } from "../testing/test-app.js";
import type { HealthStatus, RagService } from "../types/contracts.js";

/** A RAG stub that is loaded and reports a fixed chunk count. */
function loadedRag(chunkCount: number): RagService {
  return {
    buildIndex: async () => ({ chunkCount }),
    loadIndex: async () => {},
    isReady: () => true,
    getChunkCount: () => chunkCount,
    retrieve: async () => [],
  };
}

describe("GET /api/health", () => {
  it("reports degraded with every check false when nothing is wired in", async () => {
    const res = await request(createApp({ config: testConfig() })).get("/api/health");
    const data = expectOk<HealthStatus>(res);

    expect(data.status).toBe("degraded");
    expect(Number.isInteger(data.uptimeSeconds)).toBe(true);
    expect(data.checks).toEqual({
      scorecardLoaded: false,
      initiativeCount: 0,
      vectorIndexLoaded: false,
      chunkCount: 0,
      openRouterConfigured: false,
      embeddingConfigured: false,
    });
  });

  it("reads scorecard readiness and initiative count from the injected portfolio service", async () => {
    const res = await request(createApp(mockDependencies())).get("/api/health");
    const data = expectOk<HealthStatus>(res);

    expect(data.checks.scorecardLoaded).toBe(true);
    expect(data.checks.initiativeCount).toBe(4);
    expect(data.status).toBe("degraded"); // RAG and keys still missing
  });

  it("reports ok only when every module is loaded and every key is configured", async () => {
    const app = createApp({ ...mockDependencies(), config: fullyConfigured(), rag: loadedRag(148) });
    const data = expectOk<HealthStatus>(await request(app).get("/api/health"));

    expect(data.status).toBe("ok");
    expect(data.checks.vectorIndexLoaded).toBe(true);
    expect(data.checks.chunkCount).toBe(148);
    expect(data.checks.openRouterConfigured).toBe(true);
    expect(data.checks.embeddingConfigured).toBe(true);
  });

  it("never exposes key values", async () => {
    const app = createApp({ ...mockDependencies(), config: fullyConfigured() });
    const res = await request(app).get("/api/health");
    expect(res.text).not.toContain("test-key");
  });
});
