import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";
import { createMockPortfolioService } from "./mocks/mock-portfolio-service.js";
import { expectError, expectOk, mockDependencies, testConfig } from "./testing/test-app.js";
import { AppError } from "./types/app-error.js";
import type { PortfolioService } from "./types/contracts.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("unknown routes", () => {
  const app = createApp(mockDependencies());

  it.each([
    ["GET", "/api/nope"],
    ["GET", "/api/portfolio/nope"],
    ["GET", "/"],
    ["POST", "/api/portfolio/summary"],
    ["GET", "/api/assistant/ask"],
  ])("%s %s returns 404 NOT_FOUND in the error envelope", async (method, path) => {
    const res = method === "GET" ? await request(app).get(path) : await request(app).post(path);
    expectError(res, 404, "NOT_FOUND");
  });
});

describe("error middleware", () => {
  /** A portfolio service whose getSummary throws the given error. */
  function appWhoseSummaryThrows(error: unknown) {
    const real = createMockPortfolioService();
    const failing: PortfolioService = {
      ...real,
      getSummary: () => {
        throw error;
      },
    };
    return createApp({ config: testConfig(), portfolio: failing });
  }

  it("turns an unexpected error into 500 INTERNAL_ERROR without leaking details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = appWhoseSummaryThrows(new Error("secret at C:\\server\\src\\x.ts key=sk-123"));

    const res = await request(app).get("/api/portfolio/summary");
    const message = expectError(res, 500, "INTERNAL_ERROR");

    expect(message).toBe("Something went wrong on the server");
    expect(res.text).not.toContain("secret");
    expect(res.text).not.toContain("sk-123");
    expect(res.text).not.toContain("x.ts");
  });

  it("keeps the code and status of an AppError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = appWhoseSummaryThrows(new AppError("UPSTREAM_ERROR", "Embedding provider timed out"));

    const message = expectError(await request(app).get("/api/portfolio/summary"), 502, "UPSTREAM_ERROR");
    expect(message).toBe("Embedding provider timed out");
  });

  it("returns 400 VALIDATION_ERROR for malformed JSON", async () => {
    const res = await request(createApp(mockDependencies()))
      .post("/api/assistant/ask")
      .set("Content-Type", "application/json")
      .send("{bad");
    expect(expectError(res, 400, "VALIDATION_ERROR")).toBe("Request body is not valid JSON");
  });

  it("returns 400 VALIDATION_ERROR for an oversized body", async () => {
    const res = await request(createApp(mockDependencies()))
      .post("/api/assistant/ask")
      .send({ question: "a".repeat(200_000) });
    expect(expectError(res, 400, "VALIDATION_ERROR")).toBe("Request body is too large");
  });
});

describe("dependency injection and NOT_READY", () => {
  const bare = createApp({ config: testConfig() });

  it.each([
    ["GET", "/api/portfolio/summary"],
    ["GET", "/api/portfolio/initiatives"],
    ["GET", "/api/portfolio/quality"],
    ["GET", "/api/reports/weekly"],
  ])("%s %s returns 503 NOT_READY when its service is not injected", async (_method, path) => {
    expectError(await request(bare).get(path), 503, "NOT_READY");
  });

  it("POST /api/assistant/ask returns 503 NOT_READY when no AI service is injected", async () => {
    const res = await request(bare).post("/api/assistant/ask").send({ question: "Which initiatives have negative ROI?" });
    expectError(res, 503, "NOT_READY");
  });

  it("validates the request before checking AI readiness", async () => {
    expectError(await request(bare).post("/api/assistant/ask").send({ question: "hi" }), 400, "VALIDATION_ERROR");
  });

  it("returns 503 NOT_READY when the portfolio service is injected but not loaded", async () => {
    const notLoaded: PortfolioService = { ...createMockPortfolioService(), isReady: () => false };
    const app = createApp({ config: testConfig(), portfolio: notLoaded });

    expectError(await request(app).get("/api/portfolio/summary"), 503, "NOT_READY");
    expectError(await request(app).get("/api/portfolio/initiatives"), 503, "NOT_READY");
    expectError(await request(app).get("/api/portfolio/quality"), 503, "NOT_READY");
  });

  it("keeps health available when every service is missing", async () => {
    expectOk(await request(bare).get("/api/health"));
  });

  it("serves whatever service is injected", async () => {
    const custom: PortfolioService = {
      ...createMockPortfolioService(),
      getSummary: () => ({
        asOf: "2030-01-31",
        initiativeCount: 0,
        totalSpend: 0,
        totalValueRealised: 0,
        portfolioRoi: null,
        averageAdoptionRate: null,
        negativeRoiCount: 0,
        countsByStatus: { on_track: 0, at_risk: 0, off_track: 0 },
      }),
    };
    const app = createApp({ config: testConfig(), portfolio: custom });

    const data = expectOk<{ asOf: string }>(await request(app).get("/api/portfolio/summary"));
    expect(data.asOf).toBe("2030-01-31");
  });
});

describe("CORS", () => {
  it("allows the configured client origin", async () => {
    const app = createApp({ ...mockDependencies(), config: testConfig({ clientOrigins: ["http://localhost:5173"] }) });
    const res = await request(app).get("/api/health").set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("allows both local Vite origins by default and no others", async () => {
    const app = createApp(mockDependencies());
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173"]) {
      const res = await request(app).get("/api/health").set("Origin", origin);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
    }
    const other = await request(app).get("/api/health").set("Origin", "http://evil.example");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("reads a comma-separated CLIENT_ORIGIN", () => {
    expect(loadConfig({ CLIENT_ORIGIN: "http://a.test, http://b.test" }).clientOrigins).toEqual(["http://a.test", "http://b.test"]);
  });
});
