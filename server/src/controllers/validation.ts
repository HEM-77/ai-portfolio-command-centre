import { AppError } from "../types/app-error.js";

// Small input-validation helpers shared by controllers (AGENTS.md §7). They throw AppError,
// which the error middleware turns into a 400 VALIDATION_ERROR (or 503 NOT_READY) envelope.

/** A service that has not been wired into the app yet means the feature is not ready. */
export function requireService<T>(service: T | undefined, name: string): T {
  if (service === undefined) {
    throw new AppError("NOT_READY", `${name} is not available yet`);
  }
  return service;
}

/** Throw NOT_READY if a service is wired in but has not finished loading. */
export function requireReady(service: { isReady(): boolean }, what: string): void {
  if (!service.isReady()) {
    throw new AppError("NOT_READY", `${what} is not loaded yet`);
  }
}

/**
 * Read an optional query parameter as a single non-blank string.
 * Repeated parameters (?sort=a&sort=b) arrive as arrays and are rejected.
 */
export function optionalQueryString(query: Record<string, unknown>, name: string): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new AppError("VALIDATION_ERROR", `${name} must be given once, as a single value`);
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new AppError("VALIDATION_ERROR", `${name} must not be empty`);
  }
  return trimmed;
}

/** Narrow a value to one of a fixed set of allowed strings. */
export function oneOf<T extends string>(value: string, allowed: readonly T[], name: string): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new AppError("VALIDATION_ERROR", `${name} must be one of: ${allowed.join(", ")}`);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
