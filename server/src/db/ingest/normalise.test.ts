import { describe, expect, it } from "vitest";
import {
  canonicalBasis,
  canonicalMeasure,
  canonicalUsageMetric,
  normaliseInitiativeId,
  parseDate,
  parseNumber,
  parsePeriod,
} from "./normalise.js";

describe("normaliseInitiativeId", () => {
  it.each([
    ["NMB-001", "NMB-001"],
    ["nmb-001 ", "NMB-001"],
    ["NMB001", "NMB-001"],
    [" nmb010", "NMB-010"],
  ])("%j -> %s", (raw, expected) => {
    expect(normaliseInitiativeId(raw)).toBe(expected);
  });

  it.each(["NMB-1", "NMB-0001", "INIT-001", "NMB_001", ""])("rejects %j", (raw) => {
    expect(normaliseInitiativeId(raw)).toBeNull();
  });
});

describe("parseDate", () => {
  it.each([
    ["2026-11-01", "2026-11-01"],
    ["01-Nov-2026", "2026-11-01"],
    ["Nov 1, 2026", "2026-11-01"],
    ["Nov 15, 2026", "2026-11-15"],
    ["1 Dec 2025", "2025-12-01"],
    [" 2026-02-28 ", "2026-02-28"],
  ])("%j -> %s", (raw, expected) => {
    expect(parseDate(raw)).toBe(expected);
  });

  it.each(["31 Feb 2026", "2026-13-01", "15/11/2026", "Nov 2026", "Foo 1, 2026", ""])("rejects %j", (raw) => {
    expect(parseDate(raw)).toBeNull();
  });
});

describe("parsePeriod", () => {
  it.each([
    ["2025-11", { start: "2025-11-01", end: "2025-11-01", months: 1 }],
    ["Feb-2026", { start: "2026-02-01", end: "2026-02-01", months: 1 }],
    ["February 2026", { start: "2026-02-01", end: "2026-02-01", months: 1 }],
    ["Aug-Oct 2025", { start: "2025-08-01", end: "2025-10-01", months: 3 }],
    ["Nov 2025-Jan 2026", { start: "2025-11-01", end: "2026-01-01", months: 3 }],
  ])("%j", (raw, expected) => {
    expect(parsePeriod(raw)).toEqual(expected);
  });

  it.each(["2026-13", "Oct-Aug 2025", "Jan 2026-Nov 2025", "Q3 2026", "2026", ""])("rejects %j", (raw) => {
    expect(parsePeriod(raw)).toBeNull();
  });
});

describe("parseNumber", () => {
  it.each([
    ["60000", "60000"],
    ["$60,000", "60000"],
    ["60,000 ", "60000"],
    ["-30000", "-30000"],
    ["85.0", "85.0"],
    ["1000.0", "1000.0"],
  ])("%j -> exact decimal %s", (raw, value) => {
    expect(parseNumber(raw)).toEqual({ kind: "number", value });
  });

  it("reports blanks separately from invalid text", () => {
    expect(parseNumber("  ")).toEqual({ kind: "blank" });
    expect(parseNumber("lots")).toEqual({ kind: "invalid" });
    expect(parseNumber("1.2.3")).toEqual({ kind: "invalid" });
  });
});

describe("aliases", () => {
  it("maps every observed usage metric name", () => {
    for (const name of ["Licensed Users", "licensed_users", "licences", "Seats"]) {
      expect(canonicalUsageMetric(name)).toBe("licensed_users");
    }
    for (const name of ["Weekly Active Users", "WAU", "active_users_wk"]) {
      expect(canonicalUsageMetric(name)).toBe("weekly_active_users");
    }
    expect(canonicalUsageMetric("Weekly Adoption Rate")).toBe("weekly_adoption_rate");
    expect(canonicalUsageMetric("Daily Users")).toBeNull();
  });

  it("maps every observed financial measure", () => {
    const expected = {
      "Build Cost": "one_time_cost",
      "Implementation cost": "one_time_cost",
      capex_one_time: "one_time_cost",
      "Run Cost": "monthly_cost",
      "Operating cost": "monthly_cost",
      opex_monthly: "monthly_cost",
      "Realised Benefit": "realised_benefit",
      "Benefit Realised": "realised_benefit",
      realized_benefit: "realised_benefit",
      "Cumulative Benefit to Date": "cumulative_benefit",
      "Forecast Benefit": "forecast_benefit",
    };
    for (const [raw, canonical] of Object.entries(expected)) expect(canonicalMeasure(raw)).toBe(canonical);
    expect(canonicalMeasure("Marketing Spend")).toBeNull();
  });

  it("accepts only the four bases", () => {
    expect(["one-time", "monthly", "quarterly", "cumulative"].map(canonicalBasis)).toEqual([
      "one-time", "monthly", "quarterly", "cumulative",
    ]);
    expect(canonicalBasis("weekly")).toBeNull();
  });
});
