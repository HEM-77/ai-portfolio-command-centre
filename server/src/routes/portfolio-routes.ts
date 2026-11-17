import { Router } from "express";
import { createPortfolioController } from "../controllers/portfolio-controller.js";
import type { PortfolioService } from "../types/contracts.js";

/** Mounted at /api/portfolio. */
export function createPortfolioRouter(portfolio: PortfolioService | undefined): Router {
  const controller = createPortfolioController(portfolio);
  const router = Router();
  router.get("/summary", controller.getSummary);
  router.get("/initiatives", controller.getInitiatives);
  router.get("/quality", controller.getQuality);
  return router;
}
