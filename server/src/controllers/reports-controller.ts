import type { Request, Response } from "express";
import type { ReportingService } from "../types/contracts.js";
import { sendOk } from "./respond.js";
import { requireService } from "./validation.js";

/** Handler for GET /api/reports/weekly (§3.6). */
export function createReportsController(reportingService: ReportingService | undefined) {
  return {
    async getWeekly(_req: Request, res: Response): Promise<void> {
      const reporting = requireService(reportingService, "Reporting service");
      sendOk(res, await reporting.getWeeklyBrief());
    },
  };
}
