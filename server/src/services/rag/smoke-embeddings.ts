import { config } from "../../config/index.js";
import { isAppError } from "../../types/app-error.js";
import { EMBEDDING_DIMENSIONS } from "./constants.js";
import { createEmbedderFromConfig } from "./index.js";
import { cosineSimilarity } from "./vector-index.js";

// `npm run smoke:embeddings`: ONE real call to the embedding provider, to verify the key,
// model and vector size before building the index. The only automated code path that uses
// real credentials; unit tests use stubs. Prints variable NAMES, never values.

const SAMPLES = [
  "Claims adjusters were not trained before the rollout, so adoption stayed low.",
  "Low adoption because staff training happened after go-live.",
  "The invoice copilot reduced manual data entry in accounts payable.",
];

const embedder = createEmbedderFromConfig(config);
if (!embedder) {
  const missing = (["EMBEDDING_API_KEY", "EMBEDDING_BASE_URL", "EMBEDDING_MODEL"] as const).filter((name) => {
    const key = name === "EMBEDDING_API_KEY" ? "apiKey" : name === "EMBEDDING_BASE_URL" ? "baseUrl" : "model";
    return config.embedding[key] === null;
  });
  console.error(`Embedding provider not configured. Set in server/.env: ${missing.join(", ")}`);
  process.exit(1);
}

try {
  const started = Date.now();
  const vectors = await embedder.embed(SAMPLES);
  const elapsed = Date.now() - started;
  const [a, b, c] = vectors;
  if (!a || !b || !c) throw new Error("expected 3 vectors");

  console.log(`OK  model=${embedder.model}  vectors=${vectors.length}  dimensions=${a.length} (expected ${EMBEDDING_DIMENSIONS})  latency=${elapsed} ms`);
  console.log(`    similar pair   (training/adoption): ${cosineSimilarity(a, b).toFixed(3)}`);
  console.log(`    unrelated pair (training/invoices) : ${cosineSimilarity(a, c).toFixed(3)}`);
  if (cosineSimilarity(a, b) <= cosineSimilarity(a, c)) {
    console.warn("WARN  the similar pair did not score higher than the unrelated pair");
  }
} catch (error) {
  console.error(`FAILED  ${isAppError(error) ? error.message : String(error)}`);
  process.exitCode = 1;
}
