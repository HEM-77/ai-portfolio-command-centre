import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Typed configuration, loaded once. Other code imports `config`; it never reads process.env
// directly (AGENTS.md §6). Variable names come from docs/api-contracts.md §6.

/** server/.env, resolved from this file so it works from src/ (tsx) and dist/ (node). */
const ENV_FILE_PATH = resolve(import.meta.dirname, "..", "..", ".env");

// Documented defaults: the server runs on 3001 and the Vite client on 5173 (contract §1, §6).
const DEFAULT_PORT = 3001;
const DEFAULT_CLIENT_ORIGIN = "http://localhost:5173";

export interface Config {
  port: number;
  clientOrigin: string;
  openRouter: {
    apiKey: string | null;
    model: string | null; // undecided: contract §8 #6
  };
  embedding: {
    apiKey: string | null;
    baseUrl: string | null; // undecided: contract §8 #5
    model: string | null; // undecided: contract §8 #5
  };
}

type Env = Record<string, string | undefined>;

/**
 * Load server/.env into process.env if it exists, using Node's built-in loader.
 * A missing file is fine (for example in CI or when variables come from the shell).
 * Variables already set in the shell are not overwritten.
 */
function loadEnvFile(path: string): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

/** Treat unset and blank values the same way: as "not configured". */
function optional(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function parsePort(raw: string | null): number {
  if (raw === null) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    // Fail fast on startup with a clear message rather than listening on a wrong port.
    throw new Error(`Invalid PORT "${raw}": expected an integer between 1 and 65535.`);
  }
  return port;
}

/**
 * Build the config from an env object. Pure apart from its input, so tests can pass a fake env.
 *
 * AI and embedding settings are optional: without them the dashboard and flags still work,
 * and /api/health reports them as not configured.
 */
export function loadConfig(env: Env): Config {
  return {
    port: parsePort(optional(env, "PORT")),
    clientOrigin: optional(env, "CLIENT_ORIGIN") ?? DEFAULT_CLIENT_ORIGIN,
    openRouter: {
      apiKey: optional(env, "OPENROUTER_API_KEY"),
      model: optional(env, "OPENROUTER_MODEL"),
    },
    embedding: {
      apiKey: optional(env, "EMBEDDING_API_KEY"),
      baseUrl: optional(env, "EMBEDDING_BASE_URL"),
      model: optional(env, "EMBEDDING_MODEL"),
    },
  };
}

/** True when everything needed to call OpenRouter is set. Used by /api/health. */
export function isOpenRouterConfigured(c: Config): boolean {
  return c.openRouter.apiKey !== null && c.openRouter.model !== null;
}

/** True when everything needed to call the embedding provider is set. Used by /api/health. */
export function isEmbeddingConfigured(c: Config): boolean {
  return c.embedding.apiKey !== null && c.embedding.baseUrl !== null && c.embedding.model !== null;
}

loadEnvFile(ENV_FILE_PATH);

export const config: Config = loadConfig(process.env);
