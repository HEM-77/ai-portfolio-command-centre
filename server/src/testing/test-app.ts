import type { Response } from "supertest";
import type { AppDependencies } from "../app.js";
import { loadConfig, type Config } from "../config/index.js";
import { createMockAiService } from "../mocks/mock-ai-service.js";
import { createMockPortfolioService } from "../mocks/mock-portfolio-service.js";
import { createMockReportingService } from "../mocks/mock-reporting-service.js";
import type { ApiFailure, ApiSuccess, ErrorCode } from "../types/contracts.js";
import { expect } from "vitest";

// Test helpers only. Excluded from the production build (tsconfig.build.json).

/** Config built from an empty env, so tests never depend on a real server/.env or real keys. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({}), ...overrides };
}

/** Config with every key "set" to a dummy value. Nothing is ever called with these. */
export function fullyConfigured(): Config {
  return loadConfig({
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_MODEL: "test/model",
    EMBEDDING_API_KEY: "test-key",
    EMBEDDING_BASE_URL: "http://embeddings.invalid",
    EMBEDDING_MODEL: "test-embedding",
  });
}

/** The same mock services index.ts uses, wired the same way. */
export function mockDependencies(): AppDependencies {
  const portfolio = createMockPortfolioService();
  const ai = createMockAiService();
  const reporting = createMockReportingService(portfolio, ai);
  return { config: testConfig(), portfolio, ai, reporting };
}

/** Assert a success envelope and return its data. */
export function expectOk<T>(res: Response, status = 200): T {
  expect(res.status).toBe(status);
  const body = res.body as ApiSuccess<T>;
  expect(Object.keys(body).sort()).toEqual(["data", "ok"]);
  expect(body.ok).toBe(true);
  return body.data;
}

/** Assert an error envelope with the given HTTP status and error code. Returns the message. */
export function expectError(res: Response, status: number, code: ErrorCode): string {
  expect(res.status).toBe(status);
  const body = res.body as ApiFailure;
  expect(Object.keys(body).sort()).toEqual(["error", "ok"]);
  expect(body.ok).toBe(false);
  expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe("string");
  return body.error.message;
}
