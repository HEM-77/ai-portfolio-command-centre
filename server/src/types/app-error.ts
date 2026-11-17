import type { ErrorCode } from "./contracts.js";

/** HTTP status for each error code (docs/api-contracts.md §1). */
export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  UPSTREAM_ERROR: 502,
  NOT_READY: 503,
  INTERNAL_ERROR: 500,
};

/**
 * The one error type services and controllers throw.
 *
 * Why: the error middleware turns an AppError into the `{ ok: false, error }` envelope with
 * the right HTTP status, so no controller builds error JSON by hand. Anything that is not an
 * AppError becomes INTERNAL_ERROR with a generic message, so stack traces, file paths or keys
 * never reach the client.
 *
 * `message` is sent to the client: keep it safe and human-readable. Put internal detail
 * (the upstream error, a file path) in `cause`, which is only logged on the server.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
    this.status = HTTP_STATUS_BY_CODE[code];
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
