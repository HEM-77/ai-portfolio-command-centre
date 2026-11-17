import type { PortfolioRepository } from "../../db/index.js";
import { AppError } from "../../types/app-error.js";
import type {
  DataQualityReport,
  InitiativeFilter,
  InitiativeMetrics,
  PortfolioService,
  PortfolioSummary,
  Scorecard,
} from "../../types/contracts.js";
import { buildPortfolio, type PortfolioBuild } from "./build-scorecard.js";

// PortfolioService (contract §4) backed by PostgreSQL. load() reads the records once and calculates
// the scorecard in memory, so every getter is synchronous and cheap. Re-run load() (restart the
// server) after `npm run db:ingest`.

export interface PortfolioServiceOptions {
  repository: PortfolioRepository;
  logger?: Pick<Console, "warn">;
}

const DEFAULT_SORT: keyof InitiativeMetrics = "initiativeId";

/** null always sorts last, whatever the order (contract §3.3); ties fall back to initiativeId. */
function compareInitiatives(a: InitiativeMetrics, b: InitiativeMetrics, sort: keyof InitiativeMetrics, order: "asc" | "desc"): number {
  const left = a[sort];
  const right = b[sort];
  if (left === null && right === null) return a.initiativeId.localeCompare(b.initiativeId);
  if (left === null) return 1;
  if (right === null) return -1;
  const direction = order === "asc" ? 1 : -1;
  const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
  return result !== 0 ? result * direction : a.initiativeId.localeCompare(b.initiativeId);
}

export function createPortfolioService(options: PortfolioServiceOptions): PortfolioService {
  const { repository, logger = console } = options;
  let state: PortfolioBuild | null = null;

  function ready(): PortfolioBuild {
    if (!state) throw new AppError("NOT_READY", "Portfolio scorecard is not loaded yet");
    return state;
  }

  return {
    /** Read everything from the database and calculate. Leaves the service not ready on failure. */
    async load(): Promise<void> {
      state = null;
      const [initiatives, usage, costBenefit, fxRates, ingestionRun] = await Promise.all([
        repository.listInitiatives(),
        repository.listWeeklyUsage(),
        repository.listCostBenefit(),
        repository.listFxRates(),
        repository.getLatestIngestionRun(),
      ]);
      if (!ingestionRun || initiatives.length === 0) {
        throw new AppError("NOT_READY", "No portfolio data in the database yet. Run npm run db:migrate and npm run db:ingest.");
      }
      state = buildPortfolio({ initiatives, usage, costBenefit, fxRates, ingestionRun });
      const issues = state.quality.issues.length;
      if (issues > 0) logger.warn(`[portfolio] ${issues} data-quality issue(s) recorded; see GET /api/portfolio/quality`);
    },

    isReady(): boolean {
      return state !== null;
    },

    getScorecard(): Scorecard {
      return structuredClone(ready().scorecard);
    },

    getSummary(): PortfolioSummary {
      return structuredClone(ready().scorecard.summary);
    },

    getInitiatives(filter: InitiativeFilter = {}): InitiativeMetrics[] {
      const sort = filter.sort ?? DEFAULT_SORT;
      const order = filter.order ?? "asc";
      return structuredClone(ready().scorecard.initiatives)
        .filter((i) => filter.status === undefined || i.status === filter.status)
        .filter((i) => filter.businessUnit === undefined || i.businessUnit === filter.businessUnit)
        .sort((a, b) => compareInitiatives(a, b, sort, order));
    },

    getInitiative(initiativeId: string): InitiativeMetrics | undefined {
      const found = ready().scorecard.initiatives.find((i) => i.initiativeId === initiativeId);
      return found ? structuredClone(found) : undefined;
    },

    getQualityReport(): DataQualityReport {
      return structuredClone(ready().quality);
    },
  };
}
