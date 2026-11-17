import { describe, expect, it } from "vitest";
import type { CostBenefitRecord, InitiativeRecord, IngestionRunRecord, WeeklyUsageRecord } from "../../db/index.js";
import { buildPortfolio, type PortfolioInput } from "./build-scorecard.js";

// Synthetic records (test-only IDs NMB-9xx) with hand-calculated expectations for every rule.

const initiative = (id: string, overrides: Partial<InitiativeRecord> = {}): InitiativeRecord => ({
  initiativeId: id, sourceInitiativeId: id, initiativeName: `Fixture ${id}`, initiativeType: "Copilot", businessUnit: "Ops",
  goLiveDate: "2026-07-01", goLiveDateSource: "2026-07-01", monthsLiveReported: "4", plannedAnnualBenefit: 100000,
  planUnit: "USD", charterFile: `charters/${id}_X.md`, sourceRow: 1, ...overrides,
});

let row = 100;
const cost = (id: string, start: string, measure: CostBenefitRecord["measure"], value: number | null, extra: Partial<CostBenefitRecord> = {}): CostBenefitRecord => ({
  initiativeId: id, sourceInitiativeId: id, periodStart: start, periodEnd: start, measure,
  basis: measure === "one_time_cost" ? "one-time" : measure === "cumulative_benefit" ? "cumulative" : "monthly",
  value, currency: "USD", sourceMeasure: measure, sourcePeriod: start.slice(0, 7), sourceValue: String(value ?? ""), sourceRow: row++, ...extra,
});

const usage = (id: string, week: string, metric: WeeklyUsageRecord["metric"], value: number | null): WeeklyUsageRecord => ({
  initiativeId: id, sourceInitiativeId: id, weekEnding: week, metric, value, unit: metric === "weekly_adoption_rate" ? "%" : "users",
  sourceMetricName: metric, sourceWeekEnding: week, sourceRow: row++,
});

const weeks = ["2026-11-01", "2026-11-08", "2026-11-15"];
const steadyUsage = (id: string, licensed: number, wau: number) =>
  weeks.flatMap((w) => [usage(id, w, "licensed_users", licensed), usage(id, w, "weekly_active_users", wau)]);

const run = (overrides: Partial<IngestionRunRecord> = {}): IngestionRunRecord => ({
  runId: 7, startedAt: "2026-11-17T09:00:00.000Z", finishedAt: "2026-11-17T09:00:01.000Z", sourceDir: "data/raw",
  summary: { tables: { a: { read: 10, rejected: 1 }, b: { read: 5, rejected: 0 } } }, issues: [], ...overrides,
});

const fxRates = [
  { currency: "USD", rateToUsd: 1, note: null },
  { currency: "EUR", rateToUsd: 1.08, note: null },
  { currency: "USD thousands", rateToUsd: 1000, note: null },
];

function build(input: Partial<PortfolioInput>) {
  return buildPortfolio({ initiatives: [], usage: [], costBenefit: [], fxRates, ingestionRun: run(), ...input });
}

const messages = (result: ReturnType<typeof build>, id: string) =>
  result.quality.issues.filter((i) => i.initiativeId === id).map((i) => [i.action, i.message]);

describe("buildPortfolio", () => {
  it("calculates a clean initiative by hand: spend, value, ROI, adoption, payback, status", () => {
    // go-live 2026-07 -> 4 months live. Spend 10000 + 4 x 2000 = 18000. Value 4500 + 6000 + 7500 + 9000 = 27000.
    const id = "NMB-901";
    const result = build({
      initiatives: [initiative(id)],
      costBenefit: [
        cost(id, "2026-07-01", "one_time_cost", 10000),
        ...["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].map((m) => cost(id, m, "monthly_cost", 2000)),
        ...[["2026-07-01", 4500], ["2026-08-01", 6000], ["2026-09-01", 7500], ["2026-10-01", 9000]].map(([m, v]) =>
          cost(id, m as string, "realised_benefit", v as number),
        ),
        cost(id, "2026-11-01", "forecast_benefit", 99999), // never an actual
        cost(id, "2026-11-01", "realised_benefit", 50000), // after the closed actuals month
      ],
      usage: steadyUsage(id, 200, 130),
    });

    // spend 18000, value 27000, ROI 9000/18000 = 0.5, adoption 130/200 = 0.65, payback 18000/(27000/4) = 2.6667
    expect(result.scorecard.initiatives).toEqual([
      {
        initiativeId: id, name: "Fixture NMB-901", businessUnit: "Ops", owner: null, initiativeType: "Copilot", status: "on_track",
        spendToDate: 18000, valueRealised: 27000, roi: 0.5, adoptionRate: 0.65, paybackMonths: 18000 / 6750,
        dataQualityIssueCount: 0, asOf: "2026-11-15",
      },
    ]);
    expect(result.quality.issues).toEqual([]);
  });

  it("converts currencies with fx_rates and rounds to cents", () => {
    const id = "NMB-902";
    const result = build({
      initiatives: [initiative(id)],
      costBenefit: [
        cost(id, "2026-07-01", "one_time_cost", 150000, { currency: "EUR" }), // 162000 USD
        cost(id, "2026-07-01", "monthly_cost", 1.3, { currency: "USD thousands" }), // 1300 USD
        cost(id, "2026-07-01", "realised_benefit", 30600, { currency: "EUR" }), // 33048 USD
      ],
      usage: steadyUsage(id, 10, 5),
    });
    expect(result.scorecard.initiatives[0]).toMatchObject({ spendToDate: 163300, valueRealised: 33048 });
  });

  it("counts a negative cost as its positive amount and logs the repair", () => {
    const id = "NMB-903";
    const result = build({
      initiatives: [initiative(id)],
      costBenefit: [cost(id, "2026-07-01", "monthly_cost", 3000), cost(id, "2026-08-01", "monthly_cost", -3000)],
      usage: steadyUsage(id, 10, 5),
    });
    expect(result.scorecard.initiatives[0]?.spendToDate).toBe(6000);
    expect(messages(result, id)).toEqual([["repaired", "negative cost -3000 USD (monthly_cost, 2026-08) counted as 3000"]]);
  });

  it("uses the latest cumulative snapshot instead of summing snapshots", () => {
    const id = "NMB-904";
    const result = build({
      initiatives: [initiative(id)],
      costBenefit: [
        cost(id, "2026-07-01", "monthly_cost", 1000),
        cost(id, "2026-08-01", "cumulative_benefit", 2000),
        cost(id, "2026-09-01", "cumulative_benefit", 5000),
        cost(id, "2026-10-01", "cumulative_benefit", 9000),
      ],
      usage: steadyUsage(id, 10, 5),
    });
    expect(result.scorecard.initiatives[0]?.valueRealised).toBe(9000); // not 16000
  });

  it("counts a quarter closed by the actuals month and flags one that runs past it", () => {
    const id = "NMB-905";
    const quarter = (start: string, end: string, value: number) =>
      cost(id, start, "realised_benefit", value, { periodEnd: end, basis: "quarterly", sourcePeriod: `${start}..${end}` });
    const result = build({
      initiatives: [initiative(id)],
      costBenefit: [cost(id, "2026-07-01", "monthly_cost", 1000), quarter("2026-08-01", "2026-10-01", 9000), quarter("2026-10-01", "2026-12-01", 7000)],
      usage: steadyUsage(id, 10, 5),
    });
    expect(result.scorecard.initiatives[0]?.valueRealised).toBe(9000);
    expect(messages(result, id)).toEqual([["flagged", "period 2026-10-01..2026-12-01 runs past the closed actuals month; not counted"]]);
  });

  it("flags a missing month of running cost without inventing a value", () => {
    const id = "NMB-906";
    const result = build({
      initiatives: [initiative(id)],
      costBenefit: [cost(id, "2026-07-01", "monthly_cost", 1000), cost(id, "2026-09-01", "monthly_cost", 1000)],
      usage: steadyUsage(id, 10, 5),
    });
    expect(result.scorecard.initiatives[0]?.spendToDate).toBe(2000);
    expect(messages(result, id)).toEqual([["flagged", "no monthly running cost recorded for 2026-08; spend may be understated (not filled)"]]);
  });

  it("derives months live from go-live and flags a disagreeing months_live_reported", () => {
    const id = "NMB-907";
    const result = build({
      initiatives: [initiative(id, { monthsLiveReported: "26 weeks" })],
      costBenefit: [cost(id, "2026-07-01", "monthly_cost", 1000), cost(id, "2026-07-01", "realised_benefit", 2000)],
      usage: steadyUsage(id, 10, 5),
    });
    expect(result.scorecard.initiatives[0]?.paybackMonths).toBe(2); // 1000 / (2000 / 4)
    expect(messages(result, id)).toEqual([
      ["flagged", 'months_live_reported "26 weeks" disagrees with go-live 2026-07; 4 months derived from the go-live date are used'],
    ]);
  });

  it("carries a blank licence count forward and logs it", () => {
    const id = "NMB-908";
    const result = build({
      initiatives: [initiative(id)],
      usage: [
        usage(id, "2026-11-01", "licensed_users", 1200), usage(id, "2026-11-01", "weekly_active_users", 330),
        usage(id, "2026-11-08", "licensed_users", 1200), usage(id, "2026-11-08", "weekly_active_users", 310),
        usage(id, "2026-11-15", "licensed_users", null), usage(id, "2026-11-15", "weekly_active_users", 300),
      ],
    });
    expect(result.scorecard.initiatives[0]?.adoptionRate).toBe(0.25); // 300 / 1200
    expect(messages(result, id)).toEqual([["repaired", "licensed users missing for week 2026-11-15; carried forward 1200 from week 2026-11-08"]]);
  });

  it("converts an adoption percentage to weekly active users", () => {
    const id = "NMB-909";
    const result = build({
      initiatives: [initiative(id)],
      usage: weeks.flatMap((w) => [usage(id, w, "licensed_users", 800), usage(id, w, "weekly_adoption_rate", 75)]),
    });
    expect(result.scorecard.initiatives[0]?.adoptionRate).toBe(0.75); // 75% x 800 / 100 = 600 -> 600 / 800
    expect(result.quality.issues).toEqual([]);
  });

  it("treats WAU above licences as a 10x digit slip, and leaves adoption unknown if that does not fit", () => {
    const slip = "NMB-910";
    const impossible = "NMB-911";
    const result = build({
      initiatives: [initiative(slip), initiative(impossible)],
      usage: [...steadyUsage(slip, 350, 262).slice(0, 4), usage(slip, "2026-11-15", "licensed_users", 350), usage(slip, "2026-11-15", "weekly_active_users", 2800),
        ...steadyUsage(impossible, 10, 5).slice(0, 4), usage(impossible, "2026-11-15", "licensed_users", 10), usage(impossible, "2026-11-15", "weekly_active_users", 500)],
    });
    expect(result.scorecard.initiatives.map((i) => i.adoptionRate)).toEqual([0.8, null]); // 280 / 350
    expect(messages(result, slip)).toEqual([
      ["repaired", "weekly active users 2800 exceed licensed users 350 for week 2026-11-15; treated as a 10x digit slip (280)"],
    ]);
    expect(messages(result, impossible).map(([action]) => action)).toEqual(["flagged", "flagged"]);
  });

  it("maps ingestion issues into the report and counts issues per initiative", () => {
    const id = "NMB-912";
    const result = build({
      initiatives: [initiative(id)],
      costBenefit: [cost(id, "2026-07-01", "monthly_cost", -5)],
      usage: steadyUsage(id, 10, 5),
      ingestionRun: run({
        issues: [
          { sourceFile: "weekly_usage.csv", sourceRow: 9, initiativeId: "NMB-999", field: "initiative_id", severity: "error", action: "rejected", message: "orphan" },
          { sourceFile: "weekly_usage.csv", sourceRow: 4, initiativeId: id, field: "value", severity: "warning", action: "loaded", message: "blank" },
        ],
      }),
    });
    expect(result.quality).toMatchObject({ generatedAt: "2026-11-17T09:00:01.000Z", rowsRead: 15, rowsAccepted: 14, rowsRejected: 1 });
    expect(result.quality.issues.map((i) => [i.issueId, i.sourceFile, i.row, i.initiativeId, i.action])).toEqual([
      ["DQ-0001", "data/raw/weekly_usage.csv", 9, "NMB-999", "rejected"],
      ["DQ-0002", "data/raw/weekly_usage.csv", 4, id, "flagged"],
      ["DQ-0003", "data/raw/cost_benefit.csv", expect.any(Number), id, "repaired"],
    ]);
    expect(result.scorecard.initiatives[0]?.dataQualityIssueCount).toBe(2); // orphans belong to no initiative
  });

  it("summarises the portfolio from the initiative rows", () => {
    const a = "NMB-913";
    const b = "NMB-914";
    const result = build({
      initiatives: [initiative(a), initiative(b)],
      costBenefit: [
        cost(a, "2026-07-01", "monthly_cost", 1000), cost(a, "2026-07-01", "realised_benefit", 3000),
        cost(b, "2026-07-01", "monthly_cost", 3000), cost(b, "2026-07-01", "realised_benefit", 1000),
      ],
      usage: [...steadyUsage(a, 100, 70), ...steadyUsage(b, 100, 20)],
    });
    const { averageAdoptionRate, ...rest } = result.scorecard.summary;
    expect(averageAdoptionRate).toBeCloseTo(0.45, 12); // (0.7 + 0.2) / 2, up to floating-point noise
    expect(rest).toEqual({
      asOf: "2026-11-15", initiativeCount: 2, totalSpend: 4000, totalValueRealised: 4000, portfolioRoi: 0,
      negativeRoiCount: 1, countsByStatus: { on_track: 1, at_risk: 0, off_track: 1 },
    });
  });

  it("leaves out an initiative with an unknown type and reports it", () => {
    const result = build({ initiatives: [initiative("NMB-915", { initiativeType: "Robot" })] });
    expect(result.scorecard.initiatives).toEqual([]);
    expect(result.quality.issues[0]).toMatchObject({ initiativeId: "NMB-915", action: "rejected", field: "initiative_type" });
  });
});
