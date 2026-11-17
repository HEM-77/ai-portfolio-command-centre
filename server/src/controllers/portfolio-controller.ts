import type { Request, Response } from "express";
import type {
  InitiativeFilter,
  InitiativeMetrics,
  InitiativeStatus,
  InitiativesResponse,
  PortfolioService,
} from "../types/contracts.js";
import { sendOk } from "./respond.js";
import { oneOf, optionalQueryString, requireReady, requireService } from "./validation.js";

// Allowed values for query validation. Written as Records so TypeScript fails the build if the
// contract types gain or lose a value and these lists are not updated.
const STATUS_VALUES: Record<InitiativeStatus, true> = { on_track: true, at_risk: true, off_track: true };
const SORT_FIELDS: Record<keyof InitiativeMetrics, true> = {
  initiativeId: true,
  name: true,
  businessUnit: true,
  owner: true,
  initiativeType: true,
  status: true,
  spendToDate: true,
  valueRealised: true,
  roi: true,
  adoptionRate: true,
  paybackMonths: true,
  dataQualityIssueCount: true,
  asOf: true,
};
const ORDER_VALUES = ["asc", "desc"] as const;

/** Validate §3.3 query parameters into a service filter. Defaults are applied by the service. */
export function parseInitiativeFilter(query: Record<string, unknown>): InitiativeFilter {
  const filter: InitiativeFilter = {};

  const status = optionalQueryString(query, "status");
  if (status !== undefined) filter.status = oneOf(status, keysOf(STATUS_VALUES), "status");

  const businessUnit = optionalQueryString(query, "businessUnit");
  if (businessUnit !== undefined) filter.businessUnit = businessUnit;

  const sort = optionalQueryString(query, "sort");
  if (sort !== undefined) filter.sort = oneOf(sort, keysOf(SORT_FIELDS), "sort");

  const order = optionalQueryString(query, "order");
  if (order !== undefined) filter.order = oneOf(order, ORDER_VALUES, "order");

  return filter;
}

function keysOf<K extends string>(record: Record<K, true>): K[] {
  return Object.keys(record) as K[];
}

/** Handlers for /api/portfolio/*. Each validates, calls one service method and wraps the result. */
export function createPortfolioController(portfolioService: PortfolioService | undefined) {
  function readyPortfolio(): PortfolioService {
    const portfolio = requireService(portfolioService, "Portfolio service");
    requireReady(portfolio, "Portfolio scorecard");
    return portfolio;
  }

  return {
    /** GET /api/portfolio/summary (§3.2) */
    getSummary(_req: Request, res: Response): void {
      sendOk(res, readyPortfolio().getSummary());
    },

    /** GET /api/portfolio/initiatives (§3.3) */
    getInitiatives(req: Request, res: Response): void {
      const filter = parseInitiativeFilter(req.query);
      const portfolio = readyPortfolio();
      const data: InitiativesResponse = {
        asOf: portfolio.getSummary().asOf,
        initiatives: portfolio.getInitiatives(filter),
      };
      sendOk(res, data);
    },

    /** GET /api/portfolio/quality (§3.4) */
    getQuality(_req: Request, res: Response): void {
      sendOk(res, readyPortfolio().getQualityReport());
    },
  };
}
