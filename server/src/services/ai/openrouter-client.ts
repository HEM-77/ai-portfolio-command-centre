import { AppError } from "../../types/app-error.js";
import { LLM_MAX_RETRIES, LLM_MAX_TOKENS, LLM_TEMPERATURE, LLM_TIMEOUT_MS, OPENROUTER_BASE_URL } from "./constants.js";
import type { ChatMessage } from "./prompt.js";

// The only code that talks to OpenRouter (architecture §3 boundary rule). Node's built-in fetch
// against the OpenAI-compatible POST /chat/completions endpoint; no SDK needed.

export interface ChatClient {
  readonly model: string;
  /** The assistant message text. Throws AppError UPSTREAM_ERROR on any provider failure. */
  complete(messages: readonly ChatMessage[]): Promise<string>;
}

export interface OpenRouterClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Injected in tests so no real request is ever made. */
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function createOpenRouterClient(options: OpenRouterClientOptions): ChatClient {
  const {
    apiKey,
    model,
    baseUrl = OPENROUTER_BASE_URL,
    timeoutMs = LLM_TIMEOUT_MS,
    maxRetries = LLM_MAX_RETRIES,
    fetchFn = fetch,
    sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  } = options;
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const scrub = (text: string) => text.split(apiKey).join("[redacted]").slice(0, 200);

  return {
    model,
    async complete(messages: readonly ChatMessage[]): Promise<string> {
      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
          response = await fetchFn(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "X-Title": "AI Portfolio Command Centre",
            },
            body: JSON.stringify({ model, messages, temperature: LLM_TEMPERATURE, max_tokens: LLM_MAX_TOKENS }),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
          throw new AppError("UPSTREAM_ERROR", timedOut ? `AI model did not answer within ${timeoutMs / 1000}s` : "Could not reach the AI model provider", {
            cause: error,
          });
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch (error) {
          throw new AppError("UPSTREAM_ERROR", "AI model provider returned a response that is not JSON", { cause: error });
        }

        if (!response.ok) {
          if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
            await sleep(1000 * 2 ** attempt);
            continue;
          }
          const detail = errorMessage(body);
          throw new AppError("UPSTREAM_ERROR", `AI model provider returned HTTP ${response.status}`, {
            cause: new Error(detail ? scrub(detail) : `HTTP ${response.status}`),
          });
        }
        return parseCompletion(body);
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const error = body.error;
  return isRecord(error) && typeof error.message === "string" ? error.message : typeof error === "string" ? error : null;
}

/** Validate the provider response and return the assistant text. A 200 carrying `error` is a failure. */
export function parseCompletion(body: unknown): string {
  if (!isRecord(body)) throw new AppError("UPSTREAM_ERROR", "AI model provider returned an invalid response");
  if (body.error !== undefined) {
    throw new AppError("UPSTREAM_ERROR", "AI model provider returned an error", { cause: new Error(errorMessage(body) ?? "unknown") });
  }
  const choices = body.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) ? first.message : undefined;
  const content = isRecord(message) ? message.content : undefined;
  if (typeof content !== "string") throw new AppError("UPSTREAM_ERROR", "AI model provider returned no answer text");
  return content;
}
