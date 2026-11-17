import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPortfolioRepository, DEFAULT_SOURCE_DIR, ingestNimbusDataset, type PortfolioRepository } from "../../db/index.js";
import { createTestDatabase, hasTestDatabase, type TestDatabase } from "../../testing/test-database.js";
import type { PortfolioService } from "../../types/contracts.js";
import { createPortfolioService } from "./portfolio-service.js";

const silent = { warn: () => {} };

/** A repository returning fixed records, so service behaviour is tested without a database. */
function fakeRepository(overrides: Partial<PortfolioRepository> = {}): PortfolioRepository {
  const usage = (id: string, licensed: number | null, wau: number) =>
    ["licensed_users", "weekly_active_users"].map((metric, i) => ({
      initiativeId: id, sourceInitiativeId: id, weekEnding: "2026-11-15", metric: metric as "licensed_users",
      value: i === 0 ? licensed : wau, unit: "users", sourceMetricName: metric, sourceWeekEnding: "2026-11-15", sourceRow: 1,
    }));
  const initiative = (id: string, unit: string) => ({
    initiativeId: id, sourceInitiativeId: id, initiativeName: `Fixture ${id}`, initiativeType: "Copilot", businessUnit: unit,
    goLiveDate: "2026-07-01", goLiveDateSource: "2026-07-01", monthsLiveReported: null, plannedAnnualBenefit: null,
    planUnit: "USD", charterFile: "x.md", sourceRow: 1,
  });
  const money = (id: string, measure: "monthly_cost" | "realised_benefit", value: number) => ({
    initiativeId: id, sourceInitiativeId: id, periodStart: "2026-07-01", periodEnd: "2026-07-01", measure, basis: "monthly" as const,
    value, currency: "USD", sourceMeasure: measure, sourcePeriod: "2026-07", sourceValue: String(value), sourceRow: 1,
  });
  return {
    listInitiatives: async () => [initiative("NMB-902", "Finance"), initiative("NMB-901", "Ops"), initiative("NMB-903", "Ops")],
    getInitiative: async () => undefined,
    listWeeklyUsage: async () => [...usage("NMB-901", 100, 70), ...usage("NMB-902", 100, 20), ...usage("NMB-903", null, 5)],
    listCostBenefit: async () => [
      money("NMB-901", "monthly_cost", 1000), money("NMB-901", "realised_benefit", 3000),
      money("NMB-902", "monthly_cost", 1000), money("NMB-902", "realised_benefit", 500),
      money("NMB-903", "monthly_cost", 1000), money("NMB-903", "realised_benefit", 1200),
    ],
    listFxRates: async () => [{ currency: "USD", rateToUsd: 1, note: null }],
    getLatestIngestionRun: async () => ({ runId: 1, startedAt: "2026-11-17T09:00:00.000Z", finishedAt: "2026-11-17T09:00:01.000Z", sourceDir: "x", summary: {}, issues: [] }),
    ...overrides,
  };
}

describe("createPortfolioService", () => {
  it("is not ready before load(), and its getters say NOT_READY", () => {
    const service = createPortfolioService({ repository: fakeRepository(), logger: silent });
    expect(service.isReady()).toBe(false);
    expect(() => service.getSummary()).toThrow(/not loaded/);
  });

  it("stays not ready when the database has no ingested data", async () => {
    const service = createPortfolioService({ repository: fakeRepository({ getLatestIngestionRun: async () => undefined }), logger: silent });
    await expect(service.load()).rejects.toThrow(/db:ingest/);
    expect(service.isReady()).toBe(false);
  });

  it("stays not ready when the database fails", async () => {
    const service = createPortfolioService({
      repository: fakeRepository({ listInitiatives: async () => { throw new Error("connection refused"); } }),
      logger: silent,
    });
    await expect(service.load()).rejects.toThrow("connection refused");
    expect(service.isReady()).toBe(false);
  });

  describe("after load()", () => {
    let service: PortfolioService;
    beforeAll(async () => {
      service = createPortfolioService({ repository: fakeRepository(), logger: silent });
      await service.load();
    });

    it("sorts by initiativeId by default", () => {
      expect(service.getInitiatives().map((i) => i.initiativeId)).toEqual(["NMB-901", "NMB-902", "NMB-903"]);
    });

    it("filters by status and business unit", () => {
      expect(service.getInitiatives({ status: "off_track" }).map((i) => i.initiativeId)).toEqual(["NMB-902"]); // ROI -0.5
      expect(service.getInitiatives({ businessUnit: "Ops" }).map((i) => i.initiativeId)).toEqual(["NMB-901", "NMB-903"]);
    });

    it("sorts null values last in both orders", () => {
      // adoption: NMB-901 0.7, NMB-902 0.2, NMB-903 null (no licence count)
      expect(service.getInitiatives({ sort: "adoptionRate" }).map((i) => i.initiativeId)).toEqual(["NMB-902", "NMB-901", "NMB-903"]);
      expect(service.getInitiatives({ sort: "adoptionRate", order: "desc" }).map((i) => i.initiativeId)).toEqual(["NMB-901", "NMB-902", "NMB-903"]);
    });

    it("finds one initiative and returns copies callers cannot change", () => {
      const found = service.getInitiative("NMB-901");
      expect(found?.roi).toBe(2);
      if (found) found.roi = 99;
      expect(service.getInitiative("NMB-901")?.roi).toBe(2);
      expect(service.getInitiative("NMB-999")).toBeUndefined();
    });
  });
});

// The official Nimbus files, ingested into a throwaway schema. Expected values were calculated by
// hand from data/raw/*.csv (shown next to each assertion), not taken from any evaluation material.
describe.skipIf(!hasTestDatabase || !existsSync(join(DEFAULT_SOURCE_DIR, "initiatives.csv")))(
  "PortfolioService on the official Nimbus data (PostgreSQL)",
  () => {
    let db: TestDatabase;
    let service: PortfolioService;
    beforeAll(async () => {
      db = await createTestDatabase({ migrate: true });
      await ingestNimbusDataset(db.pool);
      service = createPortfolioService({ repository: createPortfolioRepository(db.pool), logger: silent });
      await service.load();
    });
    afterAll(async () => {
      await db?.drop();
    });

    it("NMB-001: 300000 + 12 x 40000 spend; 12 monthly benefits = 2250000", () => {
      const m = service.getInitiative("NMB-001");
      expect(m).toMatchObject({ spendToDate: 780000, valueRealised: 2250000, adoptionRate: 1260 / 2000, status: "on_track" });
      expect(m?.roi).toBeCloseTo(1470000 / 780000, 10);
      expect(m?.paybackMonths).toBeCloseTo(780000 / (2250000 / 12), 10);
    });

    it("NMB-004: the -30000 run cost counts as 30000 (logged)", () => {
      const m = service.getInitiative("NMB-004");
      expect(m).toMatchObject({ spendToDate: 140000 + 7 * 30000, valueRealised: 420000, adoptionRate: 140 / 400, status: "at_risk" });
      expect(m?.roi).toBeCloseTo(0.2, 10);
      expect(service.getQualityReport().issues.some((i) => i.initiativeId === "NMB-004" && i.action === "repaired")).toBe(true);
    });

    it("NMB-008: EUR at 1.08; adoption from the 75% rate", () => {
      const m = service.getInitiative("NMB-008");
      expect(m).toMatchObject({ spendToDate: (150000 + 8 * 42000) * 1.08, valueRealised: 400000 * 1.08, adoptionRate: 0.75, status: "off_track" });
      expect(m?.roi).toBeCloseTo((432000 - 524880) / 524880, 10);
    });

    it("NMB-009: USD thousands x 1000; WAU 2800 treated as a digit slip (280 of 350)", () => {
      const m = service.getInitiative("NMB-009");
      expect(m).toMatchObject({ spendToDate: (1300 + 13 * 100) * 1000, valueRealised: 3900 * 1000, adoptionRate: 0.8 });
      expect(m?.paybackMonths).toBeCloseTo(2600000 / (3900000 / 13), 10);
    });

    it("summary totals equal the sum of the initiative rows", () => {
      const summary = service.getSummary();
      const rows = service.getInitiatives();
      expect(summary.initiativeCount).toBe(10);
      expect(summary.asOf).toBe("2026-11-15");
      expect(summary.totalSpend).toBeCloseTo(rows.reduce((s, i) => s + i.spendToDate, 0), 2);
      expect(summary.totalValueRealised).toBeCloseTo(rows.reduce((s, i) => s + i.valueRealised, 0), 2);
      expect(Object.values(summary.countsByStatus).reduce((a, b) => a + b, 0)).toBe(10);
      expect(rows.every((i) => i.owner === null)).toBe(true); // no dataset column: nothing invented
    });

    it("the quality report accounts for every source row", () => {
      const quality = service.getQualityReport();
      expect(quality).toMatchObject({ rowsRead: 3 + 10 + 63 + 193, rowsAccepted: 263, rowsRejected: 6 });
      expect(quality.issues.every((i, n) => i.issueId === `DQ-${String(n + 1).padStart(4, "0")}`)).toBe(true);
    });
  },
);
