import type { Request, Response } from "express";
import { AppError } from "../types/app-error.js";
import type { AiService, AskRequest, PortfolioService } from "../types/contracts.js";
import { sendOk } from "./respond.js";
import { isPlainObject, requireService } from "./validation.js";

export const QUESTION_MIN_LENGTH = 3;
export const QUESTION_MAX_LENGTH = 1000;

/**
 * Validate the §3.5 request body. The question is trimmed before the length check, as the
 * contract says, and the trimmed text is what reaches the AI module.
 *
 * Unknown initiative IDs return 404 NOT_FOUND (contract §1). They are checked only when the
 * Portfolio service is available, because it is the only source of known IDs.
 */
export function parseAskRequest(body: unknown, portfolio: PortfolioService | undefined): AskRequest {
  if (!isPlainObject(body)) {
    throw new AppError("VALIDATION_ERROR", "Request body must be a JSON object");
  }

  const { question, initiativeIds } = body;
  if (typeof question !== "string") {
    throw new AppError("VALIDATION_ERROR", "question is required and must be a string");
  }
  const trimmed = question.trim();
  if (trimmed.length < QUESTION_MIN_LENGTH || trimmed.length > QUESTION_MAX_LENGTH) {
    throw new AppError(
      "VALIDATION_ERROR",
      `question must be between ${QUESTION_MIN_LENGTH} and ${QUESTION_MAX_LENGTH} characters`,
    );
  }

  const request: AskRequest = { question: trimmed };

  if (initiativeIds !== undefined) {
    if (!Array.isArray(initiativeIds) || !initiativeIds.every((id) => typeof id === "string")) {
      throw new AppError("VALIDATION_ERROR", "initiativeIds must be an array of strings");
    }
    if (portfolio?.isReady()) {
      const unknown = initiativeIds.filter((id) => portfolio.getInitiative(id) === undefined);
      if (unknown.length > 0) {
        throw new AppError("NOT_FOUND", `Unknown initiative ID: ${unknown.join(", ")}`);
      }
    }
    if (initiativeIds.length > 0) request.initiativeIds = initiativeIds;
  }

  return request;
}

/** Handler for POST /api/assistant/ask. */
export function createAssistantController(aiService: AiService | undefined, portfolio: PortfolioService | undefined) {
  return {
    async ask(req: Request, res: Response): Promise<void> {
      const input = parseAskRequest(req.body, portfolio);
      const ai = requireService(aiService, "Assistant");
      sendOk(res, await ai.ask(input));
    },
  };
}
