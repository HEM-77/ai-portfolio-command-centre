import type {
  DataQualityReport,
  InitiativeFilter,
  InitiativeMetrics,
  PortfolioService,
  PortfolioSummary,
  Scorecard,
} from "../types/contracts.js";
import { MOCK_INITIATIVES, MOCK_QUALITY_REPORT, MOCK_SUMMARY } from "./mock-data.js";

const DEFAULT_SORT: keyof InitiativeMetrics = "initiativeId";

/**
 * Compare two initiatives on one field. null always sorts last, whatever the order
 * (contract §3.3 and §4). Ties fall back to initiativeId ascending so the order is stable.
 */
function compareInitiatives(
  a: InitiativeMetrics,
  b: InitiativeMetrics,
  sort: keyof InitiativeMetrics,
  order: "asc" | "desc",
): number {
  const left = a[sort];
  const right = b[sort];

  if (left === null && right === null) return a.initiativeId.localeCompare(b.initiativeId);
  if (left === null) return 1;
  if (right === null) return -1;

  const direction = order === "asc" ? 1 : -1;
  const result =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right));

  return result !== 0 ? result * direction : a.initiativeId.localeCompare(b.initiativeId);
}

/**
 * Mock of Spoorthy's PortfolioService. Serves fixed data from mock-data.ts, but filters and
 * sorts like the real service must, so the HTTP layer and client behave the same after the swap.
 * Returns copies so callers cannot change the mock data.
 */
export function createMockPortfolioService(): PortfolioService {
  return {
    async load(): Promise<void> {
      // Nothing to load: the data is in memory.
    },
    isReady(): boolean {
      return true;
    },
    getScorecard(): Scorecard {
      return structuredClone({ summary: MOCK_SUMMARY, initiatives: MOCK_INITIATIVES });
    },
    getSummary(): PortfolioSummary {
      return structuredClone(MOCK_SUMMARY);
    },
    getInitiatives(filter: InitiativeFilter = {}): InitiativeMetrics[] {
      const sort = filter.sort ?? DEFAULT_SORT;
      const order = filter.order ?? "asc";
      return structuredClone(MOCK_INITIATIVES)
        .filter((i) => filter.status === undefined || i.status === filter.status)
        .filter((i) => filter.businessUnit === undefined || i.businessUnit === filter.businessUnit)
        .sort((a, b) => compareInitiatives(a, b, sort, order));
    },
    getInitiative(initiativeId: string): InitiativeMetrics | undefined {
      const found = MOCK_INITIATIVES.find((i) => i.initiativeId === initiativeId);
      return found ? structuredClone(found) : undefined;
    },
    getQualityReport(): DataQualityReport {
      return structuredClone(MOCK_QUALITY_REPORT);
    },
  };
}
