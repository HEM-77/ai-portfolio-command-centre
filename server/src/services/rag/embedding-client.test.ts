import { describe, expect, it } from "vitest";
import { AppError } from "../../types/app-error.js";
import { createEmbeddingClient, parseEmbeddingResponse } from "./embedding-client.js";

const KEY = "sk-or-test-secret-123";
const DIMS = 3;

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch stub that replays responses in order and records every call. */
function stubFetch(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("no more stubbed responses");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetchFn, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const ok = (vectors: number[][]) =>
  json({ object: "list", data: vectors.map((embedding, index) => ({ object: "embedding", index, embedding })) });

function client(responses: Array<Response | Error>, extra: { batchSize?: number; maxRetries?: number } = {}) {
  const stub = stubFetch(responses);
  const sleeps: number[] = [];
  const embedder = createEmbeddingClient({
    apiKey: KEY,
    baseUrl: "https://openrouter.ai/api/v1/",
    model: "openai/text-embedding-3-small",
    dimensions: DIMS,
    fetchFn: stub.fetchFn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  });
  return { embedder, calls: stub.calls, sleeps };
}

async function upstreamError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe("UPSTREAM_ERROR");
  expect((error as AppError).message).not.toContain(KEY);
  return error as AppError;
}

describe("embedding client: request", () => {
  it("POSTs model, input, dimensions and the bearer key to {baseUrl}/embeddings", async () => {
    const { embedder, calls } = client([ok([[1, 0, 0], [0, 1, 0]])]);

    expect(await embedder.embed(["alpha", "beta"])).toEqual([[1, 0, 0], [0, 1, 0]]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(calls[0]?.init?.method).toBe("POST");
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      model: "openai/text-embedding-3-small",
      input: ["alpha", "beta"],
      dimensions: DIMS,
      encoding_format: "float",
    });
  });

  it("sends inputs in batches and returns vectors in input order", async () => {
    const { embedder, calls } = client([ok([[1, 0, 0], [0, 1, 0]]), ok([[0, 0, 1]])], { batchSize: 2 });
    expect(await embedder.embed(["a", "b", "c"])).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    expect(calls).toHaveLength(2);
  });

  it("makes no request for an empty input list", async () => {
    const { embedder, calls } = client([]);
    expect(await embedder.embed([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("embedding client: response validation", () => {
  it("orders results by index, not array position", () => {
    const body = { data: [{ index: 1, embedding: [0, 1, 0] }, { index: 0, embedding: [1, 0, 0] }] };
    expect(parseEmbeddingResponse(body, 2, DIMS)).toEqual([[1, 0, 0], [0, 1, 0]]);
  });

  it.each([
    ["not an object", "oops", /not an object/],
    ["no data array", { foo: 1 }, /no data array/],
    ["wrong count", { data: [{ index: 0, embedding: [1, 0, 0] }] }, /expected 2 embeddings, received 1/],
    ["wrong dimensions", { data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [1, 0] }] }, /expected 3 dimensions, received 2/],
    ["non-numeric values", { data: [{ index: 0, embedding: [1, "x", 0] }, { index: 1, embedding: [1, 0, 0] }] }, /not a numeric vector/],
    ["NaN values", { data: [{ index: 0, embedding: [1, Number.NaN, 0] }, { index: 1, embedding: [1, 0, 0] }] }, /not a numeric vector/],
    ["duplicate index", { data: [{ index: 0, embedding: [1, 0, 0] }, { index: 0, embedding: [1, 0, 0] }] }, /invalid or duplicate index/],
    ["an error object on HTTP 200", { error: { message: "model not found" } }, /model not found/],
  ])("rejects a response with %s", (_label, body, message) => {
    expect(() => parseEmbeddingResponse(body, 2, DIMS)).toThrow(message);
  });
});

describe("embedding client: errors and rate limits", () => {
  it("explains a rejected key without echoing it", async () => {
    const { embedder } = client([json({ error: { message: `Invalid key ${KEY}` } }, 401)]);
    const error = await upstreamError(embedder.embed(["a"]));
    expect(error.message).toMatch(/rejected the API key \(HTTP 401\)/);
    expect(error.message).toContain("[redacted]");
  });

  it("reports insufficient credits", async () => {
    const { embedder } = client([json({ error: { message: "Insufficient credits" } }, 402)]);
    expect((await upstreamError(embedder.embed(["a"]))).message).toMatch(/insufficient credits \(HTTP 402\)/);
  });

  it("retries a 429 using Retry-After, then succeeds", async () => {
    const { embedder, calls, sleeps } = client([json({}, 429, { "Retry-After": "2" }), ok([[1, 0, 0]])]);
    expect(await embedder.embed(["a"])).toEqual([[1, 0, 0]]);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it("gives up after the retry limit with a clear rate-limit message", async () => {
    const { embedder, calls, sleeps } = client([json({}, 429), json({}, 429), json({}, 429)], { maxRetries: 2 });
    expect((await upstreamError(embedder.embed(["a"]))).message).toMatch(/rate limit reached \(HTTP 429\)/);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]); // exponential backoff without Retry-After
  });

  it("retries a 503 but not a 400", async () => {
    const retried = client([json({}, 503), ok([[1, 0, 0]])]);
    expect(await retried.embedder.embed(["a"])).toEqual([[1, 0, 0]]);

    const notRetried = client([json({ error: { message: "bad input" } }, 400)]);
    expect((await upstreamError(notRetried.embedder.embed(["a"]))).message).toBe("Embedding provider returned HTTP 400: bad input");
    expect(notRetried.calls).toHaveLength(1);
  });

  it("maps a timeout and a network failure to UPSTREAM_ERROR", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect((await upstreamError(client([timeout]).embedder.embed(["a"]))).message).toMatch(/timed out after 30s/);
    expect((await upstreamError(client([new TypeError("fetch failed")]).embedder.embed(["a"]))).message).toBe(
      "Could not reach the embedding provider",
    );
  });
});
