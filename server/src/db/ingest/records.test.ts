import { beforeAll, describe, expect, it } from "vitest";
import { readFixture } from "../__fixtures__/nimbus-sample.js";
import { CsvFormatError } from "./csv.js";
import { normaliseDataset, type NormalisedDataset, type SourceTexts } from "./records.js";

// Pure normalisation of the synthetic fixture (no database). Expected values are written by hand
// from server/src/db/__fixtures__/nimbus-sample/*.csv.

let texts: SourceTexts;
let dataset: NormalisedDataset;
beforeAll(async () => {
  texts = await readFixture();
  dataset = normaliseDataset(texts);
});

const messages = (file: string) =>
  dataset.issues.filter((i) => i.sourceFile === file).map((i) => [i.sourceRow, i.severity, i.action, i.message]);

describe("normaliseDataset on the fixture", () => {
  it("counts rows read per file, including rejected and malformed rows", () => {
    expect(dataset.rowsRead).toEqual({ fxRates: 3, initiatives: 3, weeklyUsage: 14, costBenefit: 15 });
  });

  it("loads fx rates verbatim, with quoted notes", () => {
    expect(dataset.fxRates).toEqual([
      { currency: "USD", rateToUsd: "1.0", note: "Base reporting currency", sourceRow: 1 },
      { currency: "EUR", rateToUsd: "1.08", note: "Fixed rate, test fixture only", sourceRow: 2 },
      { currency: "USD thousands", rateToUsd: "1000.0", note: "Multiply by 1,000 to get USD", sourceRow: 3 },
    ]);
  });

  it("normalises initiative IDs and dates, keeps reported fields verbatim, rejects an impossible date", () => {
    expect(dataset.initiatives.map((i) => [i.initiativeId, i.sourceInitiativeId, i.goLiveDate, i.monthsLiveReported])).toEqual([
      ["NMB-901", "NMB-901", "2026-01-01", "10"],
      ["NMB-902", "nmb902 ", "2026-02-01", "9 weeks"],
    ]);
    expect(dataset.initiatives[1]).toMatchObject({ plannedAnnualBenefit: "500", planUnit: "USD thousands", goLiveDateSource: "1 Feb 2026" });
    expect(messages("initiatives.csv")).toEqual([[3, "error", "rejected", 'go_live_date "31 Feb 2026" is not a recognised date']]);
  });

  it("loads the six valid usage rows with canonical metrics; blanks become null with a warning", () => {
    expect(dataset.weeklyUsage.map((u) => [u.initiativeId, u.weekEnding, u.metric, u.value, u.unit])).toEqual([
      ["NMB-901", "2026-11-01", "licensed_users", "100", "users"],
      ["NMB-901", "2026-11-01", "weekly_active_users", "40", "users"],
      ["NMB-901", "2026-11-08", "licensed_users", "100", "users"],
      ["NMB-901", "2026-11-08", "weekly_active_users", null, "users"],
      ["NMB-902", "2026-11-01", "licensed_users", "50", "users"],
      ["NMB-902", "2026-11-01", "weekly_adoption_rate", "80.0", "%"],
    ]);
  });

  it("reports every rejected or flagged usage row, and never loads one silently", () => {
    expect(messages("weekly_usage.csv")).toEqual([
      [14, "error", "rejected", "has 4 cells, expected 5"],
      [4, "warning", "loaded", "value is blank; stored as NULL"],
      [9, "error", "rejected", "NMB-999 is not in initiatives.csv (orphan)"],
      [10, "error", "rejected", 'metric_name "Daily Users" is not a known usage metric'],
      [11, "error", "rejected", 'week_ending "15/11/2026" is not a recognised date'],
      [12, "error", "rejected", 'value "lots" is not a number'],
      [13, "error", "rejected", "NMB-903 is not in initiatives.csv (orphan)"],
      [7, "warning", "rejected", "exact duplicate of row 6; loaded once"],
      [8, "error", "rejected", "conflicts with row 5 for the same key; row 5 was kept"],
    ]);
    const accounted = dataset.weeklyUsage.length + dataset.issues.filter((i) => i.sourceFile === "weekly_usage.csv" && i.action === "rejected").length;
    expect(accounted).toBe(dataset.rowsRead.weeklyUsage);
  });

  it("parses periods, quoted money and signs, and keeps the source currency", () => {
    expect(
      dataset.costBenefit.map((c) => [c.initiativeId, c.periodStart, c.periodEnd, c.measure, c.basis, c.value, c.currency, c.sourceValue]),
    ).toEqual([
      ["NMB-901", "2026-01-01", "2026-01-01", "one_time_cost", "one-time", "100000", "USD", "$100,000"],
      ["NMB-901", "2026-01-01", "2026-01-01", "monthly_cost", "monthly", "10000", "USD", "10,000 "],
      ["NMB-901", "2026-02-01", "2026-02-01", "monthly_cost", "monthly", "-10000", "USD", "-10000"],
      ["NMB-901", "2026-02-01", "2026-02-01", "realised_benefit", "monthly", "25000", "USD", "25000"],
      ["NMB-901", "2026-08-01", "2026-10-01", "realised_benefit", "quarterly", "90000", "USD", "90000"],
      ["NMB-901", "2026-11-01", "2027-01-01", "realised_benefit", "quarterly", "99000", "USD", "99000"],
      ["NMB-902", "2026-02-01", "2026-02-01", "monthly_cost", "monthly", "5", "USD thousands", "5"],
      ["NMB-902", "2026-02-01", "2026-02-01", "cumulative_benefit", "cumulative", "7000", "EUR", "7000"],
      ["NMB-902", "2026-12-01", "2026-12-01", "forecast_benefit", "monthly", "9000", "USD", "9000"],
    ]);
  });

  it("reports every rejected cost/benefit row", () => {
    expect(messages("cost_benefit.csv")).toEqual([
      [11, "error", "rejected", 'period "Aug-Sep 2026" covers 2 month(s) but basis is quarterly'],
      [12, "error", "rejected", 'unit "GBP" is not in fx_rates.csv'],
      [13, "error", "rejected", 'period "2026-13" is not a recognised month or range'],
      [14, "error", "rejected", 'measure "Marketing Spend" is not a known measure'],
      [15, "error", "rejected", 'basis "weekly" is not one-time, monthly, quarterly or cumulative'],
      [10, "warning", "rejected", "exact duplicate of row 1; loaded once"],
    ]);
  });

  it("keeps the raw cells of every issue so nothing is lost", () => {
    const orphan = dataset.issues.find((i) => i.initiativeId === "NMB-999");
    expect(orphan?.rawRecord).toEqual({ initiative_id: "NMB-999", week_ending: "2026-11-01", metric_name: "WAU", value: "5", unit: "users" });
  });
});

describe("file-level problems stop normalisation", () => {
  it("throws on a header that does not match the official columns", () => {
    const bad = { ...texts, costBenefit: texts.costBenefit.replace("basis", "frequency") };
    expect(() => normaliseDataset(bad)).toThrow(CsvFormatError);
    expect(() => normaliseDataset(bad)).toThrow(/cost_benefit.csv: header does not match .*missing basis.*unexpected frequency/);
  });
});
