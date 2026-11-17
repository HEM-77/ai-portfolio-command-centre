import { Router } from "express";
import { createReportsController } from "../controllers/reports-controller.js";
import type { ReportingService } from "../types/contracts.js";

/** Mounted at /api/reports. */
export function createReportsRouter(reporting: ReportingService | undefined): Router {
  const controller = createReportsController(reporting);
  const router = Router();
  router.get("/weekly", controller.getWeekly);
  return router;
}
