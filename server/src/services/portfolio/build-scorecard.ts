import type {
  CostBenefitRecord,
  FxRateRecord,
  IngestionIssueRecord,
  InitiativeRecord,
  IngestionRunRecord,
  WeeklyUsageRecord,
} from "../../db/index.js";
import type {
  DataQualityIssue,
  DataQualityReport,
  InitiativeMetrics,
  InitiativeType,
  PortfolioSummary,
  Scorecard,
} from "../../types/contracts.js";
import {
  ACTUALS_THROUGH_MONTH,
  calculateAdoption,
  calculateMonthsLive,
  calculatePaybackMonths,
  calculateRoi,
  deriveStatus,
  roundCents,
} from "./calculations.js";

// Builds the scorecard and the data-quality report from the records loaded into PostgreSQL.
// Pure: no I/O. Business rules follow contract §5.3/§5.4 and services/portfolio/README.md.
// Every repair or exclusion becomes a DataQualityIssue; source values are never changed silently.

export interface PortfolioInput {
  initiatives: InitiativeRecord[];
  usage: WeeklyUsageRecord[];
  costBenefit: CostBenefitRecord[];
  fxRates: FxRateRecord[];
  ingestionRun: IngestionRunRecord;
}

export interface PortfolioBuild {
  scorecard: Scorecard;
  quality: DataQualityReport;
}

const INITIATIVE_TYPES: readonly InitiativeType[] = ["Copilot", "Conversational Bot", "Predictive Model", "AI-enabled Automation"];
const SOURCE_DIR = "data/raw";
const FILES = {
  initiatives: `${SOURCE_DIR}/initiatives.csv`,
  usage: `${SOURCE_DIR}/weekly_usage.csv`,
  costBenefit: `${SOURCE_DIR}/cost_benefit.csv`,
} as const;

type IssueDraft = Omit<DataQualityIssue, "issueId">;

const month = (isoDate: string) => isoDate.slice(0, 7); // "2026-07-01" -> "2026-07"

function isInitiativeType(value: string): value is InitiativeType {
  return (INITIATIVE_TYPES as readonly string[]).includes(value);
}

/** Load-time issues from ingestion, in contract form. "loaded with a warning" is reported as flagged. */
function fromIngestionIssue(issue: IngestionIssueRecord): IssueDraft {
  return {
    sourceFile: `${SOURCE_DIR}/${issue.sourceFile}`,
    row: issue.sourceRow,
    initiativeId: issue.initiativeId,
    field: issue.field,
    severity: issue.severity,
    action: issue.action === "rejected" ? "rejected" : "flagged",
    message: issue.message,
  };
}

/** Row counts recorded by the ingestion run (ingestion_runs.summary), validated before use. */
function rowCounts(summary: unknown): { read: number; rejected: number } {
  const tables = (summary as { tables?: unknown } | null)?.tables;
  if (typeof tables !== "object" || tables === null) return { read: 0, rejected: 0 };
  let read = 0;
  let rejected = 0;
  for (const counts of Object.values(tables as Record<string, unknown>)) {
    const c = counts as { read?: unknown; rejected?: unknown };
    if (typeof c?.read === "number") read += c.read;
    if (typeof c?.rejected === "number") rejected += c.rejected;
  }
  return { read, rejected };
}

export function buildPortfolio(input: PortfolioInput): PortfolioBuild {
  const issues: IssueDraft[] = input.ingestionRun.issues.map(fromIngestionIssue);
  const fx = new Map(input.fxRates.map((r) => [r.currency, r.rateToUsd]));
  const weeks = [...new Set(input.usage.map((u) => u.weekEnding))].sort();
  const asOf = weeks.at(-1) ?? input.ingestionRun.finishedAt?.slice(0, 10) ?? ACTUALS_THROUGH_MONTH;

  const toUsd = (value: number, currency: string): number => roundCents(value * (fx.get(currency) ?? Number.NaN));

  const initiatives: InitiativeMetrics[] = [];
  for (const record of input.initiatives) {
    const id = record.initiativeId;
    if (!isInitiativeType(record.initiativeType)) {
      issues.push({
        sourceFile: FILES.initiatives, row: record.sourceRow, initiativeId: id, field: "initiative_type", severity: "error",
        action: "rejected", message: `initiative_type "${record.initiativeType}" is not a known type; initiative left out of the scorecard`,
      });
      continue;
    }

    // Months live: derived from go-live, never taken from months_live_reported (contract §5.4).
    const monthsLive = calculateMonthsLive(record.goLiveDate);
    const reported = record.monthsLiveReported;
    if (reported !== null && !(/^\d+$/.test(reported) && Number(reported) === monthsLive)) {
      issues.push({
        sourceFile: FILES.initiatives, row: record.sourceRow, initiativeId: id, field: "months_live_reported", severity: "warning",
        action: "flagged",
        message: `months_live_reported "${reported}" disagrees with go-live ${month(record.goLiveDate)}; ${monthsLive} months derived from the go-live date are used`,
      });
    }

    // Spend: one-time + monthly costs closed through the actuals month, in USD.
    const rows = input.costBenefit.filter((c) => c.initiativeId === id && c.periodEnd <= ACTUALS_THROUGH_MONTH);
    let spend = 0;
    for (const cost of rows.filter((c) => c.measure === "one_time_cost" || c.measure === "monthly_cost")) {
      if (cost.value === null) {
        issues.push({
          sourceFile: FILES.costBenefit, row: cost.sourceRow, initiativeId: id, field: "value", severity: "warning",
          action: "flagged", message: `${cost.sourceMeasure} for ${cost.sourcePeriod} is blank; not counted in spend`,
        });
        continue;
      }
      if (cost.value < 0) {
        issues.push({
          sourceFile: FILES.costBenefit, row: cost.sourceRow, initiativeId: id, field: "value", severity: "warning",
          action: "repaired",
          message: `negative cost ${cost.sourceValue.trim()} ${cost.currency} (${cost.sourceMeasure}, ${cost.sourcePeriod}) counted as ${Math.abs(cost.value)}`,
        });
      }
      spend += toUsd(Math.abs(cost.value), cost.currency);
    }

    // Missing months inside the monthly-cost span are reported, not filled with invented values.
    const costMonths = rows.filter((c) => c.measure === "monthly_cost").map((c) => month(c.periodStart)).sort();
    if (costMonths.length > 1) {
      const present = new Set(costMonths);
      const [y0, m0] = (costMonths[0] ?? "").split("-").map(Number);
      const [y1, m1] = (costMonths.at(-1) ?? "").split("-").map(Number);
      for (let n = (y0 ?? 0) * 12 + (m0 ?? 1) - 1; n <= (y1 ?? 0) * 12 + (m1 ?? 1) - 1; n++) {
        const key = `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
        if (!present.has(key)) {
          issues.push({
            sourceFile: FILES.costBenefit, row: null, initiativeId: id, field: "period", severity: "warning", action: "flagged",
            message: `no monthly running cost recorded for ${key}; spend may be understated (not filled)`,
          });
        }
      }
    }

    // Value realised: sum of realised benefit (monthly or quarterly) through the actuals month, or the
    // latest cumulative snapshot when only snapshots exist. Forecasts are never actuals.
    const realised = rows.filter((c) => c.measure === "realised_benefit");
    const snapshots = rows.filter((c) => c.measure === "cumulative_benefit" && c.value !== null);
    let value = 0;
    if (realised.length > 0) {
      for (const benefit of realised) {
        if (benefit.value === null) {
          issues.push({
            sourceFile: FILES.costBenefit, row: benefit.sourceRow, initiativeId: id, field: "value", severity: "warning",
            action: "flagged", message: `${benefit.sourceMeasure} for ${benefit.sourcePeriod} is blank; not counted in value realised`,
          });
          continue;
        }
        value += toUsd(benefit.value, benefit.currency);
      }
      if (snapshots.length > 0) {
        issues.push({
          sourceFile: FILES.costBenefit, row: null, initiativeId: id, field: "measure", severity: "warning", action: "flagged",
          message: "has both period benefits and cumulative snapshots; the period benefits are used and the snapshots ignored",
        });
      }
    } else if (snapshots.length > 0) {
      const latest = [...snapshots].sort((a, b) => a.periodStart.localeCompare(b.periodStart)).at(-1);
      if (latest && latest.value !== null) value = toUsd(latest.value, latest.currency);
    }
    for (const straddling of input.costBenefit.filter(
      (c) => c.initiativeId === id && c.periodStart <= ACTUALS_THROUGH_MONTH && c.periodEnd > ACTUALS_THROUGH_MONTH && c.measure !== "forecast_benefit",
    )) {
      issues.push({
        sourceFile: FILES.costBenefit, row: straddling.sourceRow, initiativeId: id, field: "period", severity: "warning",
        action: "flagged", message: `period ${straddling.sourcePeriod} runs past the closed actuals month; not counted`,
      });
    }

    // Adoption in the latest week: weekly active users / licensed users.
    const usage = input.usage.filter((u) => u.initiativeId === id);
    const initiativeWeeks = new Set(usage.map((u) => u.weekEnding));
    if (initiativeWeeks.size < weeks.length) {
      issues.push({
        sourceFile: FILES.usage, row: null, initiativeId: id, field: "week_ending", severity: "warning", action: "flagged",
        message: `usage reported for ${initiativeWeeks.size} of ${weeks.length} weeks`,
      });
    }
    const at = (week: string, metric: WeeklyUsageRecord["metric"]) => usage.find((u) => u.weekEnding === week && u.metric === metric);

    const licensedRow = at(asOf, "licensed_users");
    let licensed = licensedRow?.value ?? null;
    if (licensed === null) {
      // Carry the licence count forward from the most recent earlier week that has one.
      const earlier = usage
        .filter((u) => u.metric === "licensed_users" && u.weekEnding < asOf && u.value !== null)
        .sort((a, b) => a.weekEnding.localeCompare(b.weekEnding))
        .at(-1);
      if (earlier?.value != null) {
        licensed = earlier.value;
        issues.push({
          sourceFile: FILES.usage, row: licensedRow?.sourceRow ?? null, initiativeId: id, field: "value", severity: "warning",
          action: "repaired", message: `licensed users missing for week ${asOf}; carried forward ${earlier.value} from week ${earlier.weekEnding}`,
        });
      }
    }

    const wauRow = at(asOf, "weekly_active_users");
    const rateRow = at(asOf, "weekly_adoption_rate");
    let wau: number | null = wauRow?.value ?? null;
    if (wau === null && rateRow?.value != null && licensed !== null) {
      wau = (rateRow.value * licensed) / 100; // adoption % reported instead of WAU (contract §5.3)
    }
    if (wau !== null && licensed !== null && wau > licensed) {
      const corrected = wau / 10;
      if (corrected <= licensed) {
        issues.push({
          sourceFile: FILES.usage, row: wauRow?.sourceRow ?? null, initiativeId: id, field: "value", severity: "warning",
          action: "repaired",
          message: `weekly active users ${wau} exceed licensed users ${licensed} for week ${asOf}; treated as a 10x digit slip (${corrected})`,
        });
        wau = corrected;
      } else {
        issues.push({
          sourceFile: FILES.usage, row: wauRow?.sourceRow ?? null, initiativeId: id, field: "value", severity: "error",
          action: "flagged", message: `weekly active users ${wau} exceed licensed users ${licensed} for week ${asOf}; adoption left unknown`,
        });
        wau = null;
      }
    }
    if (wau === null || licensed === null) {
      issues.push({
        sourceFile: FILES.usage, row: null, initiativeId: id, field: "value", severity: "warning", action: "flagged",
        message: `adoption for week ${asOf} is unknown (${licensed === null ? "licensed users" : "weekly active users"} missing)`,
      });
    }

    const spendToDate = roundCents(spend);
    const valueRealised = roundCents(value);
    const adoptionRate = calculateAdoption(wau, licensed);
    const roi = calculateRoi(spendToDate, valueRealised);
    initiatives.push({
      initiativeId: id,
      name: record.initiativeName,
      businessUnit: record.businessUnit,
      owner: null, // contract §8 #13: no dataset column; nothing is invented
      initiativeType: record.initiativeType,
      status: deriveStatus(adoptionRate, roi),
      spendToDate,
      valueRealised,
      roi,
      adoptionRate,
      paybackMonths: calculatePaybackMonths(spendToDate, valueRealised, monthsLive),
      dataQualityIssueCount: 0, // filled in below, once every issue is known
      asOf,
    });
  }

  const numbered: DataQualityIssue[] = issues.map((issue, i) => ({ issueId: `DQ-${String(i + 1).padStart(4, "0")}`, ...issue }));
  for (const metrics of initiatives) {
    metrics.dataQualityIssueCount = numbered.filter((i) => i.initiativeId === metrics.initiativeId).length;
  }

  const totalSpend = roundCents(initiatives.reduce((sum, i) => sum + i.spendToDate, 0));
  const totalValueRealised = roundCents(initiatives.reduce((sum, i) => sum + i.valueRealised, 0));
  const adoptions = initiatives.map((i) => i.adoptionRate).filter((a): a is number => a !== null);
  const summary: PortfolioSummary = {
    asOf,
    initiativeCount: initiatives.length,
    totalSpend,
    totalValueRealised,
    portfolioRoi: calculateRoi(totalSpend, totalValueRealised),
    averageAdoptionRate: adoptions.length > 0 ? adoptions.reduce((a, b) => a + b, 0) / adoptions.length : null,
    negativeRoiCount: initiatives.filter((i) => i.roi !== null && i.roi < 0).length,
    countsByStatus: {
      on_track: initiatives.filter((i) => i.status === "on_track").length,
      at_risk: initiatives.filter((i) => i.status === "at_risk").length,
      off_track: initiatives.filter((i) => i.status === "off_track").length,
    },
  };

  const counts = rowCounts(input.ingestionRun.summary);
  return {
    scorecard: { summary, initiatives },
    quality: {
      generatedAt: input.ingestionRun.finishedAt ?? input.ingestionRun.startedAt,
      rowsRead: counts.read,
      rowsAccepted: counts.read - counts.rejected,
      rowsRejected: counts.rejected,
      issues: numbered,
    },
  };
}
