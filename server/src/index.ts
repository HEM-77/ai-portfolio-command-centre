import { createApp } from "./app.js";
import { config, isEmbeddingConfigured, isOpenRouterConfigured } from "./config/index.js";
import { createMockAiService } from "./mocks/mock-ai-service.js";
import { createMockPortfolioService } from "./mocks/mock-portfolio-service.js";
import { createMockReportingService } from "./mocks/mock-reporting-service.js";
import { createRagServiceFromConfig } from "./services/rag/index.js";
import { isAppError } from "./types/app-error.js";

// Entry point: build the services, inject them into the app and start listening.
//
// MOCKS: Portfolio, AI and Reporting are mocks until the real modules land. To swap one,
// import the real service from services/<module>/index.ts here, call its load() if it has
// one, and pass it in instead. Nothing else changes.
//
// RAG is real. A missing or stale index does not stop the server: /api/health reports
// vectorIndexLoaded: false and the dashboard keeps working.

const portfolio = createMockPortfolioService();
await portfolio.load();
const ai = createMockAiService();
const reporting = createMockReportingService(portfolio, ai);

const rag = createRagServiceFromConfig(config);
try {
  await rag.loadIndex();
  console.log(`Vector index loaded: ${rag.getChunkCount()} chunks.`);
} catch (error) {
  console.warn(`Vector index not loaded: ${isAppError(error) ? error.message : String(error)}`);
}

const app = createApp({ config, portfolio, ai, reporting, rag });
console.warn("Using MOCK portfolio, assistant and reporting services (src/mocks/).");

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}/api`);
  // Report whether keys are set, never their values.
  if (!isOpenRouterConfigured(config)) {
    console.warn("OpenRouter not configured: assistant answers will be unavailable.");
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
