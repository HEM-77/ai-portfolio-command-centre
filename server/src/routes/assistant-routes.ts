import { Router } from "express";
import { createAssistantController } from "../controllers/assistant-controller.js";
import type { AiService, PortfolioService } from "../types/contracts.js";

/** Mounted at /api/assistant. */
export function createAssistantRouter(ai: AiService | undefined, portfolio: PortfolioService | undefined): Router {
  const controller = createAssistantController(ai, portfolio);
  const router = Router();
  router.post("/ask", controller.ask);
  return router;
}
