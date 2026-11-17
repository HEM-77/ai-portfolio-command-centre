import type { Request, Response } from "express";
import { isAnswerModelConfigured, isEmbeddingConfigured, type Config } from "../config/index.js";
import type { HealthStatus, PortfolioService, RagService } from "../types/contracts.js";
import { sendOk } from "./respond.js";

/** Only the read-only parts of each service that the health check needs. */
export interface HealthDependencies {
  config: Config;
  portfolio?: Pick<PortfolioService, "isReady" | "getSummary">;
  rag?: Pick<RagService, "isReady" | "getChunkCount">;
}

/**
 * Build the §3.1 health body. A module that is not wired in yet counts as "not loaded",
 * so the check reports reality instead of pretending everything is fine.
 * Never includes secrets: only whether keys are configured.
 */
export function getHealthStatus(deps: HealthDependencies): HealthStatus {
  const scorecardLoaded = deps.portfolio?.isReady() ?? false;
  const vectorIndexLoaded = deps.rag?.isReady() ?? false;

  const checks: HealthStatus["checks"] = {
    scorecardLoaded,
    initiativeCount: scorecardLoaded && deps.portfolio ? deps.portfolio.getSummary().initiativeCount : 0,
    vectorIndexLoaded,
    chunkCount: vectorIndexLoaded && deps.rag ? deps.rag.getChunkCount() : 0,
    // Contract field name kept (§3.1): true when any answer model is configured (Claude or OpenRouter).
    openRouterConfigured: isAnswerModelConfigured(deps.config),
    embeddingConfigured: isEmbeddingConfigured(deps.config),
  };

  const allReady =
    checks.scorecardLoaded &&
    checks.vectorIndexLoaded &&
    checks.openRouterConfigured &&
    checks.embeddingConfigured;

  return {
    status: allReady ? "ok" : "degraded",
    uptimeSeconds: Math.floor(process.uptime()),
    checks,
  };
}

/** GET /api/health. Always HTTP 200, even when degraded, so the client can show what is missing. */
export function createHealthController(deps: HealthDependencies) {
  return (_req: Request, res: Response): void => {
    sendOk(res, getHealthStatus(deps));
  };
}
