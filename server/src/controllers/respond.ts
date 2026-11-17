import type { Response } from "express";
import type { ApiSuccess } from "../types/contracts.js";

/**
 * Send a success envelope: `{ ok: true, data }` (docs/api-contracts.md §1).
 * Errors are never sent here: controllers throw AppError and the error middleware replies.
 */
export function sendOk<T>(res: Response, data: T, status = 200): void {
  const body: ApiSuccess<T> = { ok: true, data };
  res.status(status).json(body);
}
