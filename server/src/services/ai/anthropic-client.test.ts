import { describe, expect, it } from "vitest";
import { isAnswerModelConfigured, loadConfig } from "../../config/index.js";
import type { AppError } from "../../types/app-error.js";
import { createAnthropicClient } from "./anthropic-client.js";
import { createChatClientFromConfig } from "./index.js";

// The real Anthropic SDK runs, but against a fake fetch: no request ever leaves the machine.

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function fakeFetch(status: number, payload: unknown, captured: Captured[] = []): typeof fetch {
  return async (input, init) => {
    captured.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });
  };
}

const message = (content: unknown[], stopReason = "end_turn", extra: Record<string, unknown> = {}) => ({
  id: "msg_test", type: "message", role: "assistant", model: "claude-sonnet-5-5", content, stop_reason: stopReason,
  stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 }, ...extra,
});

const MESSAGES = [
  { role: "system" as const, content: "Use only the blocks." },
  { role: "user" as const, content: "<question>Q</question>" },
];

describe("Anthropic client", () => {
  it("sends the system prompt separately, low effort, server-side fallback and no sampling parameters", async () => {
    const captured: Captured[] = [];
    const client = createAnthropicClient({ apiKey: "sk-ant-test", model: "claude-sonnet-5-5", maxRetries: 0, fetchFn: fakeFetch(200, message([{ type: "text", text: "Answer." }]), captured) });

    expect(await client.complete(MESSAGES)).toBe("Answer.");
    expect(client.model).toBe("claude-sonnet-5-5");
    const [request] = captured;
    expect(request?.url).toMatch(/\/v1\/messages/);
    expect(request?.headers.get("authorization")).toContain("sk-ant-test"); // SDK 1.x sends the key here
    expect(request?.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(request?.body).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 16000,
      system: "Use only the blocks.",
      messages: [{ role: "user", content: "<question>Q</question>" }],
      output_config: { effort: "low" },
      fallbacks: "default",
    });
    expect(request?.body).not.toHaveProperty("temperature"); // non-default sampling is a 400 on Sonnet 5.5
    expect(request?.body).not.toHaveProperty("thinking"); // adaptive by default
  });

  it("returns only the text blocks (thinking blocks are skipped)", async () => {
    const client = createAnthropicClient({
      apiKey: "k", model: "m", maxRetries: 0,
      fetchFn: fakeFetch(200, message([{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "Part 1. " }, { type: "text", text: "Part 2." }])),
    });
    expect(await client.complete(MESSAGES)).toBe("Part 1. Part 2.");
  });

  it("turns a refusal into UPSTREAM_ERROR", async () => {
    const client = createAnthropicClient({
      apiKey: "k", model: "m", maxRetries: 0,
      fetchFn: fakeFetch(200, message([], "refusal", { stop_details: { type: "refusal", category: "cyber", explanation: "x" } })),
    });
    await expect(client.complete(MESSAGES)).rejects.toMatchObject({ code: "UPSTREAM_ERROR", message: "The AI model declined to answer this question" });
  });

  it("reports a rejected key clearly without leaking it", async () => {
    const client = createAnthropicClient({
      apiKey: "sk-ant-secret", model: "m", maxRetries: 0,
      fetchFn: fakeFetch(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key sk-ant-secret" } }),
    });
    const error = (await client.complete(MESSAGES).then(() => null, (e: unknown) => e)) as AppError;
    expect(error).toMatchObject({ code: "UPSTREAM_ERROR", message: "The AI model provider rejected the API key (check ANTHROPIC_API_KEY)" });
    expect(String(error.cause)).not.toContain("sk-ant-secret");
  });

  it("reports rate limits and server errors as UPSTREAM_ERROR", async () => {
    const limited = createAnthropicClient({ apiKey: "k", model: "m", maxRetries: 0, fetchFn: fakeFetch(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }) });
    await expect(limited.complete(MESSAGES)).rejects.toMatchObject({ code: "UPSTREAM_ERROR", message: expect.stringMatching(/rate limiting/) });
    const overloaded = createAnthropicClient({ apiKey: "k", model: "m", maxRetries: 0, fetchFn: fakeFetch(529, { type: "error", error: { type: "overloaded_error", message: "busy" } }) });
    await expect(overloaded.complete(MESSAGES)).rejects.toMatchObject({ code: "UPSTREAM_ERROR", message: "AI model provider returned HTTP 529" });
  });
});

describe("answer model selection from config", () => {
  it("prefers Claude when ANTHROPIC_API_KEY is set, defaulting to claude-sonnet-5-5", () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: "sk-ant-x", OPENROUTER_API_KEY: "sk-or-x", OPENROUTER_MODEL: "anthropic/claude-sonnet-5.5" });
    expect(createChatClientFromConfig(config)?.model).toBe("claude-sonnet-5-5");
    expect(createChatClientFromConfig(loadConfig({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude-opus-5-5" }))?.model).toBe("claude-opus-5-5");
  });

  it("falls back to OpenRouter, then to none", () => {
    expect(createChatClientFromConfig(loadConfig({ OPENROUTER_API_KEY: "sk-or-x", OPENROUTER_MODEL: "anthropic/claude-sonnet-5.5" }))?.model).toBe("anthropic/claude-sonnet-5.5");
    expect(createChatClientFromConfig(loadConfig({}))).toBeNull();
    expect(isAnswerModelConfigured(loadConfig({ ANTHROPIC_API_KEY: "k" }))).toBe(true);
    expect(isAnswerModelConfigured(loadConfig({}))).toBe(false);
  });
});
