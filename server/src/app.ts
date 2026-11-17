import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Config } from "./config/index.js";
import { createAssistantRouter } from "./routes/assistant-routes.js";
import { createHealthRouter } from "./routes/health-routes.js";
import { createPortfolioRouter } from "./routes/portfolio-routes.js";
import { createReportsRouter } from "./routes/reports-routes.js";
import { AppError, isAppError } from "./types/app-error.js";
import type { AiService, ApiFailure, PortfolioService, RagService, ReportingService } from "./types/contracts.js";

/**
 * Everything the app needs, passed in rather than imported. Why: tests can build the app with
 * stub services and fake config, and index.ts swaps mocks for real modules in one place.
 * Services are optional until each module is wired in; a missing one gives 503 NOT_READY.
 */
export interface AppDependencies {
  config: Config;
  portfolio?: PortfolioService;
  rag?: RagService;
  ai?: AiService;
  reporting?: ReportingService;
}

/** Upper bound for JSON bodies. The largest request is a question of at most 1000 characters. */
const JSON_BODY_LIMIT = "100kb";

export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(cors({ origin: deps.config.clientOrigins }));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use("/api", createHealthRouter(deps));
  app.use("/api/portfolio", createPortfolioRouter(deps.portfolio));
  app.use("/api/assistant", createAssistantRouter(deps.ai, deps.portfolio));
  app.use("/api/reports", createReportsRouter(deps.reporting));

  // Order matters: the 404 handler runs only when no route matched, and the error handler last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/** Any unmatched route becomes a NOT_FOUND envelope instead of Express's default HTML page. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError("NOT_FOUND", `Route ${req.method} ${req.path} not found`));
}

/**
 * The single place that turns errors into the `{ ok: false, error }` envelope (contract §1).
 * Express 5 forwards errors thrown in async handlers here too, so controllers need no try/catch.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const appError = toAppError(err);

  // Unexpected errors are logged in full on the server only. The client gets a safe message.
  if (appError.code === "INTERNAL_ERROR" || appError.code === "UPSTREAM_ERROR") {
    console.error(`[${appError.code}]`, appError.message, appError.cause ?? err);
  }

  const body: ApiFailure = {
    ok: false,
    error: { code: appError.code, message: appError.message },
  };
  res.status(appError.status).json(body);
}

function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;

  // express.json() rejects bad bodies with a 4xx error (malformed JSON, body too large).
  // That is the caller's mistake, so report it as VALIDATION_ERROR, not a server failure.
  if (isClientBodyError(err)) {
    const message = err.type === "entity.too.large" ? "Request body is too large" : "Request body is not valid JSON";
    return new AppError("VALIDATION_ERROR", message, { cause: err });
  }

  return new AppError("INTERNAL_ERROR", "Something went wrong on the server", { cause: err });
}

/** Errors from Express's body parser carry a numeric 4xx `status` and a string `type`. */
function isClientBodyError(err: unknown): err is { status: number; type: string } {
  if (typeof err !== "object" || err === null) return false;
  const { status, type } = err as { status?: unknown; type?: unknown };
  return typeof status === "number" && status >= 400 && status < 500 && typeof type === "string";
}
