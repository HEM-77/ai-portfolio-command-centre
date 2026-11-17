import { AppError } from "../../types/app-error.js";
import { EMBEDDING_BATCH_SIZE, EMBEDDING_MAX_RETRIES, EMBEDDING_TIMEOUT_MS } from "./constants.js";

// The only code that talks to the embedding provider (architecture §3 boundary rule).
// Uses Node's built-in fetch against the OpenAI-compatible POST {baseUrl}/embeddings endpoint
// that OpenRouter exposes, so no SDK is needed.

export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  /** One vector per input, in input order. Throws AppError UPSTREAM_ERROR on any provider failure. */
  embed(texts: readonly string[]): Promise<number[][]>;
}

export interface EmbeddingClientOptions {
  apiKey: string;
  baseUrl: string; // e.g. https://openrouter.ai/api/v1
  model: string; // e.g. openai/text-embedding-3-small
  dimensions: number;
  timeoutMs?: number;
  maxRetries?: number;
  batchSize?: number;
  /** Injected in tests so no real request is ever made. */
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 10_000;

export function createEmbeddingClient(options: EmbeddingClientOptions): Embedder {
  const {
    apiKey,
    model,
    dimensions,
    timeoutMs = EMBEDDING_TIMEOUT_MS,
    maxRetries = EMBEDDING_MAX_RETRIES,
    batchSize = EMBEDDING_BATCH_SIZE,
    fetchFn = fetch,
    sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  } = options;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/embeddings`;

  async function requestBatch(input: readonly string[]): Promise<number[][]> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetchFn(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, input, dimensions, encoding_format: "float" }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new AppError(
          "UPSTREAM_ERROR",
          timedOut
            ? `Embedding request timed out after ${timeoutMs / 1000}s`
            : "Could not reach the embedding provider",
          { cause: error },
        );
      }

      if (response.ok) {
        return parseEmbeddingResponse(await readJson(response), input.length, dimensions);
      }

      const detail = providerMessage(await readJson(response).catch(() => null), apiKey);
      if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
        await sleep(retryDelayMs(response.headers.get("retry-after"), attempt));
        continue;
      }
      throw new AppError("UPSTREAM_ERROR", describeHttpError(response.status, detail));
    }
  }

  return {
    model,
    dimensions,
    async embed(texts: readonly string[]): Promise<number[][]> {
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += batchSize) {
        vectors.push(...(await requestBatch(texts.slice(start, start + batchSize))));
      }
      return vectors;
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new AppError("UPSTREAM_ERROR", "Embedding provider returned a response that is not JSON", { cause: error });
  }
}

/**
 * Validate the provider's response: one finite numeric vector of the expected size per input.
 * Results are ordered by `index`, not array position. A 200 response carrying an `error`
 * object (which OpenRouter can return) is treated as a failure.
 */
export function parseEmbeddingResponse(body: unknown, expectedCount: number, dimensions: number): number[][] {
  if (!isRecord(body)) throw invalid("response is not an object");
  if (body.error !== undefined) {
    throw new AppError("UPSTREAM_ERROR", `Embedding provider error: ${providerMessage(body, "") ?? "unknown error"}`);
  }
  if (!Array.isArray(body.data)) throw invalid("response has no data array");
  if (body.data.length !== expectedCount) {
    throw invalid(`expected ${expectedCount} embeddings, received ${body.data.length}`);
  }

  const vectors: (number[] | undefined)[] = new Array<number[] | undefined>(expectedCount);
  body.data.forEach((item, position) => {
    if (!isRecord(item)) throw invalid(`item ${position} is not an object`);
    const index = typeof item.index === "number" ? item.index : position;
    if (!Number.isInteger(index) || index < 0 || index >= expectedCount || vectors[index] !== undefined) {
      throw invalid(`item ${position} has an invalid or duplicate index`);
    }
    const embedding = item.embedding;
    if (!Array.isArray(embedding) || !embedding.every((v) => typeof v === "number" && Number.isFinite(v))) {
      throw invalid(`item ${position} is not a numeric vector`);
    }
    if (embedding.length !== dimensions) {
      throw invalid(`expected ${dimensions} dimensions, received ${embedding.length}`);
    }
    vectors[index] = embedding as number[];
  });

  return vectors.map((vector, i) => {
    if (!vector) throw invalid(`missing embedding for input ${i}`);
    return vector;
  });
}

function invalid(reason: string): AppError {
  return new AppError("UPSTREAM_ERROR", `Embedding provider returned an invalid response: ${reason}`);
}

/** Pull a short provider message for diagnostics, with the API key scrubbed just in case. */
function providerMessage(body: unknown, apiKey: string): string | null {
  if (!isRecord(body)) return null;
  const error = body.error;
  const raw = isRecord(error) && typeof error.message === "string" ? error.message : typeof error === "string" ? error : null;
  if (!raw) return null;
  const scrubbed = apiKey ? raw.split(apiKey).join("[redacted]") : raw;
  return scrubbed.slice(0, 200);
}

function describeHttpError(status: number, detail: string | null): string {
  const suffix = detail ? `: ${detail}` : "";
  switch (status) {
    case 401:
    case 403:
      return `Embedding provider rejected the API key (HTTP ${status}). Check EMBEDDING_API_KEY${suffix}`;
    case 402:
      return `Embedding provider reports insufficient credits (HTTP 402)${suffix}`;
    case 429:
      return `Embedding provider rate limit reached (HTTP 429); try again shortly${suffix}`;
    default:
      return `Embedding provider returned HTTP ${status}${suffix}`;
  }
}

/** Honour Retry-After (seconds) when given, otherwise back off 1s, 2s, 4s… capped at 10s. */
function retryDelayMs(retryAfter: string | null, attempt: number): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000 * 2 ** attempt;
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
