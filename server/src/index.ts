import { createApp } from "./app.js";
import { checkConnection, closePool, createDatabasePool, describeDatabaseUrl } from "./config/database.js";
import { config, isAnthropicConfigured, isAnswerModelConfigured, isEmbeddingConfigured } from "./config/index.js";
import { createPortfolioRepository } from "./db/index.js";
import { createMockAiService } from "./mocks/mock-ai-service.js";
import { createMockReportingService } from "./mocks/mock-reporting-service.js";
import { createAiServiceFromConfig } from "./services/ai/index.js";
import { createPortfolioService } from "./services/portfolio/index.js";
import { createRagServiceFromConfig } from "./services/rag/index.js";
import { isAppError } from "./types/app-error.js";

// Entry point: build the services, inject them into the app and start listening.
//
// REAL: Portfolio (PostgreSQL, see server/db/README.md), RAG and the assistant (AI module). A missing database or vector index
// does not stop the server: the affected endpoints return 503 NOT_READY and /api/health shows it.
// There is deliberately no fallback to mock portfolio data.
//
// MOCKS: Reporting stays a mock until it is wired (src/mocks/). Its narrative uses the mock AI on
// purpose: the mock flags are not real data, so a real model must not write a narrative about them.

const errorDetail = (error: unknown): string =>
  isAppError(error) && error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error instanceof Error ? error.message : String(error);

// PostgreSQL pool: one per process, shared by every request.
const database = config.database.url ? createDatabasePool(config.database.url) : null;
if (database && config.database.url) {
  try {
    const info = await checkConnection(database);
    console.log(`Database connected: ${info.database} (PostgreSQL ${info.serverVersion}).`);
  } catch (error) {
    console.warn(`Database not reachable at ${describeDatabaseUrl(config.database.url)}: ${errorDetail(error)}`);
  }
} else {
  console.warn("DATABASE_URL not set: portfolio endpoints will return 503 NOT_READY (see server/db/README.md).");
}

const portfolio = database ? createPortfolioService({ repository: createPortfolioRepository(database) }) : undefined;
if (portfolio) {
  try {
    await portfolio.load();
    const summary = portfolio.getSummary();
    console.log(`Portfolio scorecard loaded from PostgreSQL: ${summary.initiativeCount} initiatives, as of ${summary.asOf}.`);
  } catch (error) {
    console.warn(`Portfolio scorecard not loaded: ${errorDetail(error)}`);
  }
}

const rag = createRagServiceFromConfig(config);
try {
  await rag.loadIndex();
  console.log(`Vector index loaded: ${rag.getChunkCount()} chunks.`);
} catch (error) {
  console.warn(`Vector index not loaded: ${isAppError(error) ? error.message : String(error)}`);
}

const ai = createAiServiceFromConfig(config, { portfolio, rag });
const reporting = portfolio ? createMockReportingService(portfolio, createMockAiService()) : undefined;

const app = createApp({ config, portfolio, ai, reporting, rag });
console.warn("Using MOCK reporting service (src/mocks/): weekly-brief flags and narrative are NOT real yet.");

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}/api`);
  // Report whether keys are set, never their values.
  if (isAnthropicConfigured(config)) {
    console.log(`Assistant answers: Claude (${config.anthropic.model}) via the Anthropic API.`);
  } else if (isAnswerModelConfigured(config)) {
    console.log(`Assistant answers: ${config.openRouter.model ?? ""} via OpenRouter.`);
  } else {
    console.warn("No answer model configured (ANTHROPIC_API_KEY or OPENROUTER_*): the assistant shows figures and sources without an AI-written answer.");
  }
  if (!isEmbeddingConfigured(config)) {
    console.warn("Embedding provider not configured: ingestion and retrieval will be unavailable.");
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${config.port} is already in use. Stop the other process or set PORT in server/.env.`);
  } else {
    console.error("Server failed to start:", error);
  }
  process.exit(1);
});

/** Stop accepting requests, close database connections, then exit. Forced after 5 s. */
function shutdown(signal: string): void {
  console.log(`${signal} received: shutting down.`);
  setTimeout(() => process.exit(1), 5_000).unref();
  server.close(() => {
    void (database ? closePool(database) : Promise.resolve()).finally(() => process.exit(0));
  });
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
