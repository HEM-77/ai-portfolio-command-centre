import { parseCsvTable, type CsvRow } from "./csv.js";
import {
  canonicalBasis,
  canonicalMeasure,
  canonicalUsageMetric,
  normaliseInitiativeId,
  parseDate,
  parseNumber,
  parsePeriod,
  type FinancialBasis,
  type FinancialMeasure,
  type UsageMetric,
} from "./normalise.js";

// Turns the four official CSV files into typed rows ready for the database, plus a list of
// issues for every row that was rejected or loaded with a warning. Pure: no I/O.

/** The official columns of each file (contract §5.3). The header must match exactly. */
export const SOURCE_FILES = {
  fxRates: { file: "fx_rates.csv", columns: ["currency", "rate_to_usd", "note"] },
  initiatives: {
    file: "initiatives.csv",
    columns: [
      "initiative_id", "initiative_name", "initiative_type", "business_unit", "go_live_date",
      "months_live_reported", "planned_annual_benefit", "plan_unit", "charter_file",
    ],
  },
  weeklyUsage: { file: "weekly_usage.csv", columns: ["initiative_id", "week_ending", "metric_name", "value", "unit"] },
  costBenefit: { file: "cost_benefit.csv", columns: ["initiative_id", "period", "measure", "value", "unit", "basis"] },
} as const;

const USAGE_UNITS = ["users", "%"] as const;

export interface FxRateRow {
  currency: string;
  rateToUsd: string;
  note: string | null;
  sourceRow: number;
}

export interface InitiativeRow {
  initiativeId: string;
  sourceInitiativeId: string;
  initiativeName: string;
  initiativeType: string;
  businessUnit: string;
  goLiveDate: string;
  goLiveDateSource: string;
  monthsLiveReported: string | null;
  plannedAnnualBenefit: string | null;
  planUnit: string;
  charterFile: string;
  sourceRow: number;
}

export interface WeeklyUsageRow {
  initiativeId: string;
  weekEnding: string;
  sourceInitiativeId: string;
  metric: UsageMetric;
  value: string | null;
  unit: string;
  sourceMetricName: string;
  sourceWeekEnding: string;
  sourceRow: number;
}

export interface CostBenefitRow {
  initiativeId: string;
  periodStart: string;
  sourceInitiativeId: string;
  periodEnd: string;
  measure: FinancialMeasure;
  basis: FinancialBasis;
  value: string | null;
  currency: string;
  sourceMeasure: string;
  sourcePeriod: string;
  sourceValue: string;
  sourceRow: number;
}

export interface IngestionIssue {
  sourceFile: string;
  sourceRow: number | null;
  initiativeId: string | null;
  field: string | null;
  severity: "error" | "warning";
  action: "rejected" | "loaded";
  message: string;
  rawRecord: Record<string, string> | string[] | null;
}

export interface SourceTexts {
  fxRates: string;
  initiatives: string;
  weeklyUsage: string;
  costBenefit: string;
}

export interface NormalisedDataset {
  fxRates: FxRateRow[];
  initiatives: InitiativeRow[];
  weeklyUsage: WeeklyUsageRow[];
  costBenefit: CostBenefitRow[];
  /** Data rows read per file, including rejected and malformed ones. */
  rowsRead: Record<keyof SourceTexts, number>;
  issues: IngestionIssue[];
}

/** Collects issues for one file; `reject` returns null so callers can `return reject(...)`. */
function issueLog(issues: IngestionIssue[], sourceFile: string) {
  const add = (
    row: CsvRow,
    severity: IngestionIssue["severity"],
    action: IngestionIssue["action"],
    field: string | null,
    message: string,
    initiativeId: string | null = null,
  ) => {
    issues.push({ sourceFile, sourceRow: row.row, initiativeId, field, severity, action, message, rawRecord: row.cells });
  };
  return {
    reject: (row: CsvRow, field: string | null, message: string, initiativeId: string | null = null): null => {
      add(row, "error", "rejected", field, message, initiativeId);
      return null;
    },
    warn: (row: CsvRow, field: string | null, message: string, initiativeId: string | null = null): void => {
      add(row, "warning", "loaded", field, message, initiativeId);
    },
    duplicate: (row: CsvRow, firstRow: number, identical: boolean, initiativeId: string | null): void => {
      if (identical) {
        add(row, "warning", "rejected", null, `exact duplicate of row ${firstRow}; loaded once`, initiativeId);
      } else {
        add(row, "error", "rejected", null, `conflicts with row ${firstRow} for the same key; row ${firstRow} was kept`, initiativeId);
      }
    },
    malformed: (row: number, cells: string[], expected: number): void => {
      issues.push({
        sourceFile, sourceRow: row, initiativeId: null, field: null, severity: "error", action: "rejected",
        message: `has ${cells.length} cells, expected ${expected}`, rawRecord: cells,
      });
    },
  };
}

/**
 * Keep the first row per key. A later row with the same key is reported, never loaded twice:
 * identical content is a warning (exact duplicate), different content is an error (conflict).
 */
function dedupe<T extends { sourceRow: number }>(
  candidates: { row: CsvRow; value: T; key: string; content: string; initiativeId: string | null }[],
  log: ReturnType<typeof issueLog>,
): T[] {
  const seen = new Map<string, { sourceRow: number; content: string }>();
  const kept: T[] = [];
  for (const { row, value, key, content, initiativeId } of candidates) {
    const first = seen.get(key);
    if (first) {
      log.duplicate(row, first.sourceRow, first.content === content, initiativeId);
      continue;
    }
    seen.set(key, { sourceRow: value.sourceRow, content });
    kept.push(value);
  }
  return kept;
}

function parseFile(text: string, spec: { file: string; columns: readonly string[] }, issues: IngestionIssue[]) {
  const table = parseCsvTable(text, spec.columns, spec.file);
  const log = issueLog(issues, spec.file);
  for (const bad of table.malformedRows) log.malformed(bad.row, bad.cells, spec.columns.length);
  return { rows: table.rows, log, read: table.rows.length + table.malformedRows.length };
}

const cell = (row: CsvRow, column: string): string => row.cells[column] ?? "";

/**
 * Normalise all four files. Throws CsvFormatError for a file-level problem (bad header,
 * unterminated quote); row-level problems become issues and the row is skipped or flagged.
 */
export function normaliseDataset(texts: SourceTexts): NormalisedDataset {
  const issues: IngestionIssue[] = [];

  // fx_rates.csv
  const fx = parseFile(texts.fxRates, SOURCE_FILES.fxRates, issues);
  const fxRates = dedupe(
    fx.rows.flatMap((row) => {
      const currency = cell(row, "currency").trim();
      if (currency === "") return fx.log.reject(row, "currency", "currency is blank") ?? [];
      const rate = parseNumber(cell(row, "rate_to_usd"));
      if (rate.kind !== "number" || Number(rate.value) <= 0) {
        return fx.log.reject(row, "rate_to_usd", `rate_to_usd "${cell(row, "rate_to_usd")}" is not a positive number`) ?? [];
      }
      const value: FxRateRow = { currency, rateToUsd: rate.value, note: cell(row, "note").trim() || null, sourceRow: row.row };
      return [{ row, value, key: currency, content: `${rate.value}|${value.note}`, initiativeId: null }];
    }),
    fx.log,
  );
  const currencies = new Set(fxRates.map((r) => r.currency));

  // initiatives.csv
  const ini = parseFile(texts.initiatives, SOURCE_FILES.initiatives, issues);
  const initiatives = dedupe(
    ini.rows.flatMap((row) => {
      const rawId = cell(row, "initiative_id");
      const id = normaliseInitiativeId(rawId);
      if (!id) return ini.log.reject(row, "initiative_id", `initiative_id "${rawId}" is not an NMB-xxx ID`) ?? [];
      for (const field of ["initiative_name", "initiative_type", "business_unit", "charter_file"]) {
        if (cell(row, field).trim() === "") return ini.log.reject(row, field, `${field} is blank`, id) ?? [];
      }
      const goLive = parseDate(cell(row, "go_live_date"));
      if (!goLive) return ini.log.reject(row, "go_live_date", `go_live_date "${cell(row, "go_live_date")}" is not a recognised date`, id) ?? [];
      const planUnit = cell(row, "plan_unit").trim();
      if (!currencies.has(planUnit)) return ini.log.reject(row, "plan_unit", `plan_unit "${planUnit}" is not in fx_rates.csv`, id) ?? [];
      const benefit = parseNumber(cell(row, "planned_annual_benefit"));
      if (benefit.kind === "invalid") {
        return ini.log.reject(row, "planned_annual_benefit", `planned_annual_benefit "${cell(row, "planned_annual_benefit")}" is not a number`, id) ?? [];
      }
      if (benefit.kind === "blank") ini.log.warn(row, "planned_annual_benefit", "planned_annual_benefit is blank; stored as NULL", id);

      const value: InitiativeRow = {
        initiativeId: id,
        sourceInitiativeId: rawId,
        initiativeName: cell(row, "initiative_name").trim(),
        initiativeType: cell(row, "initiative_type").trim(),
        businessUnit: cell(row, "business_unit").trim(),
        goLiveDate: goLive,
        goLiveDateSource: cell(row, "go_live_date"),
        monthsLiveReported: cell(row, "months_live_reported").trim() || null,
        plannedAnnualBenefit: benefit.kind === "number" ? benefit.value : null,
        planUnit,
        charterFile: cell(row, "charter_file").trim(),
        sourceRow: row.row,
      };
      const { sourceRow: _r, sourceInitiativeId: _s, goLiveDateSource: _g, ...content } = value;
      return [{ row, value, key: id, content: JSON.stringify(content), initiativeId: id }];
    }),
    ini.log,
  );
  const initiativeIds = new Set(initiatives.map((i) => i.initiativeId));

  /** Shared ID check for the two fact files: canonical form, and known in initiatives.csv. */
  const factId = (row: CsvRow, log: ReturnType<typeof issueLog>): string | null => {
    const rawId = cell(row, "initiative_id");
    const id = normaliseInitiativeId(rawId);
    if (!id) return log.reject(row, "initiative_id", `initiative_id "${rawId}" is not an NMB-xxx ID`);
    if (!initiativeIds.has(id)) return log.reject(row, "initiative_id", `${id} is not in initiatives.csv (orphan)`, id);
    return id;
  };

  // weekly_usage.csv
  const wu = parseFile(texts.weeklyUsage, SOURCE_FILES.weeklyUsage, issues);
  const weeklyUsage = dedupe(
    wu.rows.flatMap((row) => {
      const id = factId(row, wu.log);
      if (!id) return [];
      const week = parseDate(cell(row, "week_ending"));
      if (!week) return wu.log.reject(row, "week_ending", `week_ending "${cell(row, "week_ending")}" is not a recognised date`, id) ?? [];
      const metric = canonicalUsageMetric(cell(row, "metric_name"));
      if (!metric) return wu.log.reject(row, "metric_name", `metric_name "${cell(row, "metric_name")}" is not a known usage metric`, id) ?? [];
      const unit = cell(row, "unit").trim();
      if (!(USAGE_UNITS as readonly string[]).includes(unit)) return wu.log.reject(row, "unit", `unit "${unit}" is not users or %`, id) ?? [];
      const parsed = parseNumber(cell(row, "value"));
      if (parsed.kind === "invalid") return wu.log.reject(row, "value", `value "${cell(row, "value")}" is not a number`, id) ?? [];
      if (parsed.kind === "blank") wu.log.warn(row, "value", "value is blank; stored as NULL", id);

      const value: WeeklyUsageRow = {
        initiativeId: id,
        weekEnding: week,
        sourceInitiativeId: cell(row, "initiative_id"),
        metric,
        value: parsed.kind === "number" ? parsed.value : null,
        unit,
        sourceMetricName: cell(row, "metric_name"),
        sourceWeekEnding: cell(row, "week_ending"),
        sourceRow: row.row,
      };
      return [{ row, value, key: `${id}|${week}|${metric}`, content: `${value.value}|${unit}`, initiativeId: id }];
    }),
    wu.log,
  );

  // cost_benefit.csv
  const cb = parseFile(texts.costBenefit, SOURCE_FILES.costBenefit, issues);
  const costBenefit = dedupe(
    cb.rows.flatMap((row) => {
      const id = factId(row, cb.log);
      if (!id) return [];
      const period = parsePeriod(cell(row, "period"));
      if (!period) return cb.log.reject(row, "period", `period "${cell(row, "period")}" is not a recognised month or range`, id) ?? [];
      const measure = canonicalMeasure(cell(row, "measure"));
      if (!measure) return cb.log.reject(row, "measure", `measure "${cell(row, "measure")}" is not a known measure`, id) ?? [];
      const basis = canonicalBasis(cell(row, "basis"));
      if (!basis) return cb.log.reject(row, "basis", `basis "${cell(row, "basis")}" is not one-time, monthly, quarterly or cumulative`, id) ?? [];
      if ((basis === "quarterly") !== (period.months === 3) || (period.months > 1 && basis !== "quarterly")) {
        return cb.log.reject(row, "period", `period "${cell(row, "period")}" covers ${period.months} month(s) but basis is ${basis}`, id) ?? [];
      }
      const currency = cell(row, "unit").trim();
      if (!currencies.has(currency)) return cb.log.reject(row, "unit", `unit "${currency}" is not in fx_rates.csv`, id) ?? [];
      const parsed = parseNumber(cell(row, "value"));
      if (parsed.kind === "invalid") return cb.log.reject(row, "value", `value "${cell(row, "value")}" is not a number`, id) ?? [];
      if (parsed.kind === "blank") cb.log.warn(row, "value", "value is blank; stored as NULL", id);

      const value: CostBenefitRow = {
        initiativeId: id,
        periodStart: period.start,
        sourceInitiativeId: cell(row, "initiative_id"),
        periodEnd: period.end,
        measure,
        basis,
        value: parsed.kind === "number" ? parsed.value : null,
        currency,
        sourceMeasure: cell(row, "measure"),
        sourcePeriod: cell(row, "period"),
        sourceValue: cell(row, "value"),
        sourceRow: row.row,
      };
      return [{
        row,
        value,
        key: `${id}|${measure}|${period.start}|${period.end}`,
        content: `${value.value}|${currency}|${basis}`,
        initiativeId: id,
      }];
    }),
    cb.log,
  );

  return {
    fxRates,
    initiatives,
    weeklyUsage,
    costBenefit,
    rowsRead: { fxRates: fx.read, initiatives: ini.read, weeklyUsage: wu.read, costBenefit: cb.read },
    issues,
  };
}
