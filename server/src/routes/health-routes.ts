import { Router } from "express";
import { createHealthController, type HealthDependencies } from "../controllers/health-controller.js";

/** Mounted at /api. */
export function createHealthRouter(deps: HealthDependencies): Router {
  const router = Router();
  router.get("/health", createHealthController(deps));
  return router;
}
