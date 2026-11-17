import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "../../types/app-error.js";
import { ANTHROPIC_EFFORT, ANTHROPIC_MAX_TOKENS, LLM_MAX_RETRIES, LLM_TIMEOUT_MS } from "./constants.js";
import type { ChatClient } from "./openrouter-client.js";
import type { ChatMessage } from "./prompt.js";

// Claude through the official Anthropic SDK (the answer model; embeddings stay on OpenRouter because
// the Anthropic API has no embeddings endpoint). Implements the same ChatClient as the OpenRouter
// client, so the AI service does not care which provider answers.
//
// Request choices for claude-sonnet-5-5:
// - no temperature/top_p: non-default sampling values return 400 on this model; grounding is enforced
//   by the prompt and by answer validation instead.
// - thinking left at its default (adaptive) with effort "low": short grounded Q&A, answered quickly.
// - max_tokens leaves room for thinking, which counts towards it; the prompt keeps answers short.
// - server-side refusal fallback ("default"): if the model declines on policy grounds, the API
//   retries on the server-defined fallback model inside the same call.

export interface AnthropicClientOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Injected in tests so no real request is ever made. */
  fetchFn?: typeof fetch;
}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function createAnthropicClient(options: AnthropicClientOptions): ChatClient {
  const { apiKey, model, timeoutMs = LLM_TIMEOUT_MS, maxRetries = LLM_MAX_RETRIES, fetchFn } = options;
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries, ...(fetchFn ? { fetch: fetchFn } : {}) });

  return {
    model,
    async complete(messages: readonly ChatMessage[]): Promise<string> {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const turns = messages.filter((m) => m.role !== "system").map((m) => ({ role: "user" as const, content: m.content }));

      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create({
          model,
          max_tokens: ANTHROPIC_MAX_TOKENS,
          ...(system ? { system } : {}),
          messages: turns,
          output_config: { effort: ANTHROPIC_EFFORT },
          betas: [FALLBACK_BETA],
          fallbacks: "default",
        });
      } catch (error) {
        throw toUpstreamError(error, apiKey);
      }

      if (response.stop_reason === "refusal") {
        throw new AppError("UPSTREAM_ERROR", "The AI model declined to answer this question", {
          cause: new Error(`refusal: ${response.stop_details?.category ?? "uncategorised"}`),
        });
      }
      const text = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      if (text.trim() === "") throw new AppError("UPSTREAM_ERROR", "The AI model returned no answer text");
      return text;
    },
  };
}

/** Map SDK errors to UPSTREAM_ERROR with a safe message; provider detail (key scrubbed) goes to `cause`. */
function toUpstreamError(error: unknown, apiKey: string): AppError {
  const detail = (error instanceof Error ? error.message : String(error)).split(apiKey).join("[redacted]").slice(0, 300);
  const cause = new Error(detail);
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AppError("UPSTREAM_ERROR", `AI model did not answer within ${LLM_TIMEOUT_MS / 1000}s`, { cause });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AppError("UPSTREAM_ERROR", "Could not reach the AI model provider", { cause });
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AppError("UPSTREAM_ERROR", "The AI model provider rejected the API key (check ANTHROPIC_API_KEY)", { cause });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AppError("UPSTREAM_ERROR", "The AI model provider is rate limiting requests; try again shortly", { cause });
  }
  if (error instanceof Anthropic.APIError) {
    return new AppError("UPSTREAM_ERROR", `AI model provider returned HTTP ${error.status ?? "error"}`, { cause });
  }
  return new AppError("UPSTREAM_ERROR", "AI model request failed", { cause });
}
