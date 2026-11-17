import type { Pool } from "pg";
import { query } from "../config/database.js";
import type { FinancialBasis, FinancialMeasure, UsageMetric } from "./ingest/normalise.js";

// Read access to the structured portfolio data loaded by `npm run db:ingest`.
//
// Integration point for the Portfolio module (Spoorthy): PortfolioService.load() can read these
// records once at startup, apply the business rules (contract §5.3/§5.4 and
// services/portfolio/README.md) and calculate the scorecard in TypeScript. Nothing here
// calculates metrics, converts currencies or repairs values.
//
// Numbers: Postgres `numeric` arrives as a string and is converted with Number(). The dataset's
// values (at most millions, at most two decimals) are exact in a double.

export interface InitiativeRecord {
  initiativeId: string;
  sourceInitiativeId: string;
  initiativeName: string;
  initiativeType: string;
  businessUnit: string;
  goLiveDate: string; // ISO date
  goLiveDateSource: string;
  monthsLiveReported: string | null; // verbatim, e.g. "26 weeks"; not authoritative
  plannedAnnualBenefit: number | null; // in planUnit
  planUnit: string;
  charterFile: string;
  sourceRow: number;
}

export interface WeeklyUsageRecord {
  initiativeId: string;
  sourceInitiativeId: string;
  weekEnding: string; // ISO date
  metric: UsageMetric;
  value: number | null; // as in the source; null when the cell was blank
  unit: string; // "users" or "%"
  sourceMetricName: string;
  sourceWeekEnding: string;
  sourceRow: number;
}

export interface CostBenefitRecord {
  initiativeId: string;
  sourceInitiativeId: string;
  periodStart: string; // ISO date, first day of the first month
  periodEnd: string; // ISO date, first day of the last month
  measure: FinancialMeasure;
  basis: FinancialBasis;
  value: number | null; // source currency and sign
  currency: string; // key into fx_rates
  sourceMeasure: string;
  sourcePeriod: string;
  sourceValue: string;
  sourceRow: number;
}

export interface FxRateRecord {
  currency: string;
  rateToUsd: number;
  note: string | null;
}

export interface IngestionIssueRecord {
  sourceFile: string;
  sourceRow: number | null;
  initiativeId: string | null;
  field: string | null;
  severity: "error" | "warning";
  action: "rejected" | "loaded";
  message: string;
}

export interface IngestionRunRecord {
  runId: number;
  startedAt: string; // ISO timestamp
  finishedAt: string | null;
  sourceDir: string;
  summary: unknown;
  issues: IngestionIssueRecord[];
}

export interface UsageFilter {
  initiativeIds?: readonly string[];
  from?: string; // inclusive ISO date
  to?: string; // inclusive ISO date
}

export interface CostBenefitFilter {
  initiativeIds?: readonly string[];
  measures?: readonly FinancialMeasure[];
  /** Rows whose period overlaps [from, to] (ISO dates). */
  from?: string;
  to?: string;
}

export interface PortfolioRepository {
  listInitiatives(): Promise<InitiativeRecord[]>;
  getInitiative(initiativeId: string): Promise<InitiativeRecord | undefined>;
  listWeeklyUsage(filter?: UsageFilter): Promise<WeeklyUsageRecord[]>;
  listCostBenefit(filter?: CostBenefitFilter): Promise<CostBenefitRecord[]>;
  listFxRates(): Promise<FxRateRecord[]>;
  /** The most recent finished ingestion run with its issues, or undefined if none has run. */
  getLatestIngestionRun(): Promise<IngestionRunRecord | undefined>;
}

const toNumber = (value: string | null): number | null => (value === null ? null : Number(value));

/** Builds "WHERE a AND b" from optional conditions, numbering parameters in order. */
function whereClause(conditions: { sql: (param: string) => string; value: unknown }[]) {
  const params: unknown[] = [];
  const parts = conditions.map(({ sql, value }) => {
    params.push(value);
    return sql(`$${params.length}`);
  });
  return { where: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

const INITIATIVE_COLUMNS = `initiative_id, source_initiative_id, initiative_name, initiative_type, business_unit,
  go_live_date, go_live_date_source, months_live_reported, planned_annual_benefit, plan_unit, charter_file, source_row`;

interface InitiativeRow {
  initiative_id: string;
  source_initiative_id: string;
  initiative_name: string;
  initiative_type: string;
  business_unit: string;
  go_live_date: string;
  go_live_date_source: string;
  months_live_reported: string | null;
  planned_annual_benefit: string | null;
  plan_unit: string;
  charter_file: string;
  source_row: number;
}

function toInitiative(r: InitiativeRow): InitiativeRecord {
  return {
    initiativeId: r.initiative_id,
    sourceInitiativeId: r.source_initiative_id,
    initiativeName: r.initiative_name,
    initiativeType: r.initiative_type,
    businessUnit: r.business_unit,
    goLiveDate: r.go_live_date,
    goLiveDateSource: r.go_live_date_source,
    monthsLiveReported: r.months_live_reported,
    plannedAnnualBenefit: toNumber(r.planned_annual_benefit),
    planUnit: r.plan_unit,
    charterFile: r.charter_file,
    sourceRow: r.source_row,
  };
}

export function createPortfolioRepository(pool: Pool): PortfolioRepository {
  return {
    async listInitiatives() {
      const rows = await query<InitiativeRow>(pool, `SELECT ${INITIATIVE_COLUMNS} FROM initiatives ORDER BY initiative_id`);
      return rows.map(toInitiative);
    },

    async getInitiative(initiativeId) {
      const [row] = await query<InitiativeRow>(
        pool,
        `SELECT ${INITIATIVE_COLUMNS} FROM initiatives WHERE initiative_id = $1`,
        [initiativeId],
      );
      return row ? toInitiative(row) : undefined;
    },

    async listWeeklyUsage(filter = {}) {
      const { where, params } = whereClause([
        ...(filter.initiativeIds ? [{ sql: (p: string) => `initiative_id = ANY(${p}::text[])`, value: filter.initiativeIds }] : []),
        ...(filter.from ? [{ sql: (p: string) => `week_ending >= ${p}::date`, value: filter.from }] : []),
        ...(filter.to ? [{ sql: (p: string) => `week_ending <= ${p}::date`, value: filter.to }] : []),
      ]);
      const rows = await query<{
        initiative_id: string; source_initiative_id: string; week_ending: string; metric: UsageMetric;
        value: string | null; unit: string; source_metric_name: string; source_week_ending: string; source_row: number;
      }>(
        pool,
        `SELECT initiative_id, source_initiative_id, week_ending, metric, value, unit, source_metric_name,
                source_week_ending, source_row
         FROM weekly_usage ${where} ORDER BY initiative_id, week_ending, metric`,
        params,
      );
      return rows.map((r) => ({
        initiativeId: r.initiative_id,
        sourceInitiativeId: r.source_initiative_id,
        weekEnding: r.week_ending,
        metric: r.metric,
        value: toNumber(r.value),
        unit: r.unit,
        sourceMetricName: r.source_metric_name,
        sourceWeekEnding: r.source_week_ending,
        sourceRow: r.source_row,
      }));
    },

    async listCostBenefit(filter = {}) {
      const { where, params } = whereClause([
        ...(filter.initiativeIds ? [{ sql: (p: string) => `initiative_id = ANY(${p}::text[])`, value: filter.initiativeIds }] : []),
        ...(filter.measures ? [{ sql: (p: string) => `measure = ANY(${p}::text[])`, value: filter.measures }] : []),
        ...(filter.from ? [{ sql: (p: string) => `period_end >= date_trunc('month', ${p}::date)::date`, value: filter.from }] : []),
        ...(filter.to ? [{ sql: (p: string) => `period_start <= ${p}::date`, value: filter.to }] : []),
      ]);
      const rows = await query<{
        initiative_id: string; source_initiative_id: string; period_start: string; period_end: string;
        measure: FinancialMeasure; basis: FinancialBasis; value: string | null; currency: string;
        source_measure: string; source_period: string; source_value: string; source_row: number;
      }>(
        pool,
        `SELECT initiative_id, source_initiative_id, period_start, period_end, measure, basis, value, currency,
                source_measure, source_period, source_value, source_row
         FROM cost_benefit ${where} ORDER BY initiative_id, period_start, measure`,
        params,
      );
      return rows.map((r) => ({
        initiativeId: r.initiative_id,
        sourceInitiativeId: r.source_initiative_id,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        measure: r.measure,
        basis: r.basis,
        value: toNumber(r.value),
        currency: r.currency,
        sourceMeasure: r.source_measure,
        sourcePeriod: r.source_period,
        sourceValue: r.source_value,
        sourceRow: r.source_row,
      }));
    },

    async listFxRates() {
      const rows = await query<{ currency: string; rate_to_usd: string; note: string | null }>(
        pool,
        "SELECT currency, rate_to_usd, note FROM fx_rates ORDER BY currency",
      );
      return rows.map((r) => ({ currency: r.currency, rateToUsd: Number(r.rate_to_usd), note: r.note }));
    },

    async getLatestIngestionRun() {
      const [run] = await query<{
        run_id: string; started_at: Date; finished_at: Date | null; source_dir: string; summary: unknown;
      }>(
        pool,
        `SELECT run_id, started_at, finished_at, source_dir, summary FROM ingestion_runs
         WHERE finished_at IS NOT NULL ORDER BY run_id DESC LIMIT 1`,
      );
      if (!run) return undefined;
      const issues = await query<{
        source_file: string; source_row: number | null; initiative_id: string | null; field: string | null;
        severity: "error" | "warning"; action: "rejected" | "loaded"; message: string;
      }>(
        pool,
        `SELECT source_file, source_row, initiative_id, field, severity, action, message
         FROM ingestion_issues WHERE run_id = $1 ORDER BY issue_id`,
        [run.run_id],
      );
      return {
        runId: Number(run.run_id),
        startedAt: run.started_at.toISOString(),
        finishedAt: run.finished_at ? run.finished_at.toISOString() : null,
        sourceDir: run.source_dir,
        summary: run.summary,
        issues: issues.map((i) => ({
          sourceFile: i.source_file,
          sourceRow: i.source_row,
          initiativeId: i.initiative_id,
          field: i.field,
          severity: i.severity,
          action: i.action,
          message: i.message,
        })),
      };
    },
  };
}
