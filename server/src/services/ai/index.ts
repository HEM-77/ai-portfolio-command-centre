import { isOpenRouterConfigured, type Config } from "../../config/index.js";
import type { AiService, PortfolioService, RagService } from "../../types/contracts.js";
import { createAiService } from "./ai-service.js";
import { createAnthropicClient } from "./anthropic-client.js";
import { createOpenRouterClient, type ChatClient } from "./openrouter-client.js";

// Public entry point of the AI module (contract §4). Other modules import only from here.

export { createAiService } from "./ai-service.js";
export type { AiServiceOptions } from "./ai-service.js";
export { createAnthropicClient } from "./anthropic-client.js";
export { createOpenRouterClient } from "./openrouter-client.js";
export type { ChatClient } from "./openrouter-client.js";

/**
 * The answer model from config: Claude via the Anthropic API when ANTHROPIC_API_KEY is set,
 * otherwise OpenRouter when OPENROUTER_API_KEY and OPENROUTER_MODEL are set, otherwise null
 * (answers then come from the code-built fallback).
 */
export function createChatClientFromConfig(config: Config): ChatClient | null {
  if (config.anthropic.apiKey) return createAnthropicClient({ apiKey: config.anthropic.apiKey, model: config.anthropic.model });
  const { apiKey, model } = config.openRouter;
  if (!isOpenRouterConfigured(config) || !apiKey || !model) return null;
  return createOpenRouterClient({ apiKey, model });
}

/** The AiService the app uses: real portfolio, RAG and OpenRouter. */
export function createAiServiceFromConfig(
  config: Config,
  deps: { portfolio: PortfolioService | undefined; rag: RagService | undefined },
): AiService {
  return createAiService({ ...deps, chat: createChatClientFromConfig(config) });
}
