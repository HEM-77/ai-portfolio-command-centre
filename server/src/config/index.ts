import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Typed configuration, loaded once. Other code imports `config`; it never reads process.env
// directly (AGENTS.md §6). Variable names come from docs/api-contracts.md §6.

/** server/.env, resolved from this file so it works from src/ (tsx) and dist/ (node). */
const ENV_FILE_PATH = resolve(import.meta.dirname, "..", "..", ".env");

// Documented defaults: the server runs on 3001 and the Vite client on 5173 (contract §1, §6).
const DEFAULT_PORT = 3001;
// Both spellings of the local Vite origin: the dev script binds to 127.0.0.1 and prints that URL,
// while localhost is what people usually type. A browser treats them as different origins.
/** The Claude model chosen for answers (contract §8 #6); ANTHROPIC_MODEL overrides it. */
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";

const DEFAULT_CLIENT_ORIGINS =["http://localhost:5173", "http://127.0.0.1:5173"];

export interface Config {
  port: number;
  clientOrigins: string[]; // CLIENT_ORIGIN, comma-separated; exact origins allowed by CORS
  anthropic: {
    apiKey: string | null; // Claude API key: when set, Claude answers questions (contract §8 #6)
    model: string; // ANTHROPIC_MODEL, default claude-sonnet-5-5
  };
  openRouter: {
    apiKey: string | null; // embeddings may reuse it; answers only when no Anthropic key is set
    model: string | null;
  };
  embedding: {
    apiKey: string | null;
    baseUrl: string | null; // undecided: contract §8 #5
    model: string | null; // undecided: contract §8 #5
  };
  database: {
    url: string | null; // postgres://user:password@host:port/db; a secret, never logged
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

/** "a, b" -> ["a", "b"]; blank -> the two local Vite origins. Never a wildcard. */
function parseOrigins(raw: string | null): string[] {
  const origins = (raw ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  return origins.length > 0 ? origins : [...DEFAULT_CLIENT_ORIGINS];
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
    clientOrigins: parseOrigins(optional(env, "CLIENT_ORIGIN")),
    anthropic: {
      apiKey: optional(env, "ANTHROPIC_API_KEY"),
      model: optional(env, "ANTHROPIC_MODEL") ?? DEFAULT_ANTHROPIC_MODEL,
    },
    openRouter: {
      apiKey: optional(env, "OPENROUTER_API_KEY"),
      model: optional(env, "OPENROUTER_MODEL"),
    },
    embedding: {
      apiKey: optional(env, "EMBEDDING_API_KEY"),
      baseUrl: optional(env, "EMBEDDING_BASE_URL"),
      model: optional(env, "EMBEDDING_MODEL"),
    },
    database: {
      url: optional(env, "DATABASE_URL"),
    },
  };
}

/** True when a Claude API key is set: Claude (Anthropic API) answers questions. */
export function isAnthropicConfigured(c: Config): boolean {
  return c.anthropic.apiKey !== null;
}

/**
 * True when some answer model is configured (Claude, or OpenRouter as the alternative). Reported by
 * /api/health as `openRouterConfigured`, the field name the contract (§3.1) still uses.
 */
export function isAnswerModelConfigured(c: Config): boolean {
  return isAnthropicConfigured(c) || isOpenRouterConfigured(c);
}

/** True when everything needed to call OpenRouter for answers is set. */
export function isOpenRouterConfigured(c: Config): boolean {
  return c.openRouter.apiKey !== null && c.openRouter.model !== null;
}

/** True when DATABASE_URL is set. Optional at startup, like the AI keys: the app runs without it. */
export function isDatabaseConfigured(c: Config): boolean {
  return c.database.url !== null;
}

/** True when everything needed to call the embedding provider is set. Used by /api/health. */
export function isEmbeddingConfigured(c: Config): boolean {
  return c.embedding.apiKey !== null && c.embedding.baseUrl !== null && c.embedding.model !== null;
}

loadEnvFile(ENV_FILE_PATH);

export const config: Config = loadConfig(process.env);
