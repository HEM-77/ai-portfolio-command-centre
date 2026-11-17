// AI module settings in one place (contract §8 #6, #7).

/** Short grounded Q&A: low effort answers fast; quality is enforced by grounding and validation. */
export const ANTHROPIC_EFFORT = "low" as const;

/** Thinking counts towards max_tokens, so leave room; the prompt keeps the visible answer short. */
export const ANTHROPIC_MAX_TOKENS = 16_000;

/** OpenRouter's OpenAI-compatible API (alternative answer provider). The model comes from OPENROUTER_MODEL. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** LLM calls fail with UPSTREAM_ERROR after this long, so a question never hangs the UI. */
export const LLM_TIMEOUT_MS = 45_000;

/** One retry for rate limits (429) and provider errors (5xx). */
export const LLM_MAX_RETRIES = 1;

/** Deterministic, short answers for an executive audience. */
export const LLM_TEMPERATURE = 0;
export const LLM_MAX_TOKENS = 700;

/** Evidence passages per narrative question (contract §4 default). */
export const NARRATIVE_TOP_K = 5;

/** Evidence passages for a mixed question, already restricted to the initiatives the scorecard selected. */
export const MIXED_TOP_K = 8;

/**
 * For a mixed question the initiative filter already guarantees relevance, so a lower similarity
 * floor is used than for open narrative questions (RAG default 0.3).
 */
export const MIXED_MIN_SCORE = 0.15;

/** Citation excerpts are trimmed to this many characters (on a word boundary). */
export const EXCERPT_MAX_CHARS = 280;
