import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, hasTestDatabase, type TestDatabase } from "../testing/test-database.js";
import { FIXTURE_DIR } from "./__fixtures__/nimbus-sample.js";
import { ingestNimbusDataset } from "./ingest/ingest.js";
import { createPortfolioRepository, type PortfolioRepository } from "./portfolio-repository.js";

// Expected values come from server/src/db/__fixtures__/nimbus-sample/*.csv.

describe.skipIf(!hasTestDatabase)("portfolio repository (PostgreSQL)", () => {
  let db: TestDatabase;
  let repo: PortfolioRepository;

  beforeAll(async () => {
    db = await createTestDatabase({ migrate: true });
    repo = createPortfolioRepository(db.pool);
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("returns nothing before any ingestion", async () => {
    expect(await repo.listInitiatives()).toEqual([]);
    expect(await repo.getLatestIngestionRun()).toBeUndefined();
  });

  describe("after ingesting the fixture", () => {
    beforeAll(async () => {
      await ingestNimbusDataset(db.pool, FIXTURE_DIR);
    });

    it("lists initiatives with typed, camelCase fields", async () => {
      expect(await repo.listInitiatives()).toEqual([
        {
          initiativeId: "NMB-901", sourceInitiativeId: "NMB-901", initiativeName: "Fixture Copilot", initiativeType: "Copilot",
          businessUnit: "Operations", goLiveDate: "2026-01-01", goLiveDateSource: "2026-01-01", monthsLiveReported: "10",
          plannedAnnualBenefit: 1200000, planUnit: "USD", charterFile: "charters/NMB-901_Fixture_Copilot.md", sourceRow: 1,
        },
        {
          initiativeId: "NMB-902", sourceInitiativeId: "nmb902 ", initiativeName: "Fixture Bot", initiativeType: "Conversational Bot",
          businessUnit: "Finance", goLiveDate: "2026-02-01", goLiveDateSource: "1 Feb 2026", monthsLiveReported: "9 weeks",
          plannedAnnualBenefit: 500, planUnit: "USD thousands", charterFile: "charters/NMB-902_Fixture_Bot.md", sourceRow: 2,
        },
      ]);
    });

    it("gets one initiative by canonical ID, or undefined", async () => {
      expect((await repo.getInitiative("NMB-902"))?.initiativeName).toBe("Fixture Bot");
      expect(await repo.getInitiative("NMB-903")).toBeUndefined(); // rejected at ingestion
      expect(await repo.getInitiative("nmb-902")).toBeUndefined(); // lookups use the canonical form
    });

    it("lists weekly usage, filtered by initiative and date range; blanks stay null", async () => {
      const all = await repo.listWeeklyUsage();
      expect(all).toHaveLength(6);
      const filtered = await repo.listWeeklyUsage({ initiativeIds: ["NMB-901"], from: "2026-11-08", to: "2026-11-08" });
      expect(filtered.map((u) => [u.weekEnding, u.metric, u.value, u.sourceMetricName])).toEqual([
        ["2026-11-08", "licensed_users", 100, "Seats"],
        ["2026-11-08", "weekly_active_users", null, "active_users_wk"],
      ]);
      expect((await repo.listWeeklyUsage({ initiativeIds: ["NMB-902"] })).find((u) => u.metric === "weekly_adoption_rate")).toMatchObject({
        value: 80,
        unit: "%",
      });
    });

    it("lists cost/benefit rows by measure and overlapping period, in source currency and sign", async () => {
      const costs = await repo.listCostBenefit({ initiativeIds: ["NMB-901"], measures: ["monthly_cost"] });
      expect(costs.map((c) => [c.periodStart, c.value, c.currency, c.sourceValue])).toEqual([
        ["2026-01-01", 10000, "USD", "10,000 "],
        ["2026-02-01", -10000, "USD", "-10000"],
      ]);
      // A quarter overlaps a range that touches any of its months.
      const quarters = await repo.listCostBenefit({ measures: ["realised_benefit"], from: "2026-10-15", to: "2026-11-30" });
      expect(quarters.map((c) => [c.periodStart, c.periodEnd, c.value])).toEqual([
        ["2026-08-01", "2026-10-01", 90000],
        ["2026-11-01", "2027-01-01", 99000],
      ]);
      // Ordered by initiative, period, then measure name.
      expect((await repo.listCostBenefit({ initiativeIds: ["NMB-902"] })).map((c) => [c.measure, c.currency])).toEqual([
        ["cumulative_benefit", "EUR"],
        ["monthly_cost", "USD thousands"],
        ["forecast_benefit", "USD"],
      ]);
    });

    it("lists fx rates as numbers", async () => {
      expect((await repo.listFxRates()).map((r) => [r.currency, r.rateToUsd])).toEqual([
        ["EUR", 1.08],
        ["USD", 1],
        ["USD thousands", 1000],
      ]);
    });

    it("returns the latest ingestion run with its issues", async () => {
      const run = await repo.getLatestIngestionRun();
      expect(run?.finishedAt).not.toBeNull();
      expect(run?.issues).toHaveLength(16);
      expect(run?.issues.filter((i) => i.action === "rejected")).toHaveLength(15);
    });
  });
});
