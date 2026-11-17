import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createMockPortfolioService } from "../mocks/mock-portfolio-service.js";
import { expectError, expectOk, mockDependencies, testConfig } from "../testing/test-app.js";
import type {
  DataQualityReport,
  InitiativeFilter,
  InitiativesResponse,
  PortfolioService,
  PortfolioSummary,
} from "../types/contracts.js";

const app = createApp(mockDependencies());

async function initiativeIds(query: string): Promise<string[]> {
  const data = expectOk<InitiativesResponse>(await request(app).get(`/api/portfolio/initiatives${query}`));
  return data.initiatives.map((i) => i.initiativeId);
}

describe("GET /api/portfolio/summary", () => {
  it("returns the portfolio summary in the contract shape", async () => {
    const data = expectOk<PortfolioSummary>(await request(app).get("/api/portfolio/summary"));

    expect(Object.keys(data).sort()).toEqual(
      [
        "asOf",
        "averageAdoptionRate",
        "countsByStatus",
        "initiativeCount",
        "negativeRoiCount",
        "portfolioRoi",
        "totalSpend",
        "totalValueRealised",
      ],
    );
    expect(data.initiativeCount).toBe(4);
    expect(data.countsByStatus).toEqual({ on_track: 1, at_risk: 2, off_track: 1 });
  });
});

describe("GET /api/portfolio/initiatives", () => {
  it("returns asOf plus the initiative rows", async () => {
    const data = expectOk<InitiativesResponse>(await request(app).get("/api/portfolio/initiatives"));

    expect(data.asOf).toBe("2026-11-14");
    expect(data.initiatives).toHaveLength(4);
    expect(Object.keys(data.initiatives[0] ?? {}).sort()).toEqual(
      [
        "adoptionRate",
        "asOf",
        "businessUnit",
        "dataQualityIssueCount",
        "initiativeId",
        "initiativeType",
        "name",
        "owner",
        "paybackMonths",
        "roi",
        "spendToDate",
        "status",
        "valueRealised",
      ],
    );
  });

  describe("sorting", () => {
    it("defaults to initiativeId ascending", async () => {
      expect(await initiativeIds("")).toEqual(["INIT-001", "INIT-002", "INIT-003", "INIT-004"]);
    });

    it("sorts ascending with null last", async () => {
      // roi: 003 = -0.262, 002 = 0.057, 001 = 0.5, 004 = null
      expect(await initiativeIds("?sort=roi")).toEqual(["INIT-003", "INIT-002", "INIT-001", "INIT-004"]);
      expect(await initiativeIds("?sort=roi&order=asc")).toEqual(["INIT-003", "INIT-002", "INIT-001", "INIT-004"]);
    });

    it("sorts descending with null still last", async () => {
      expect(await initiativeIds("?sort=roi&order=desc")).toEqual(["INIT-001", "INIT-002", "INIT-003", "INIT-004"]);
    });

    it("keeps several nulls last, ordered by initiativeId", async () => {
      // paybackMonths: 001 = 14, 002 = 20, 003 = null, 004 = null
      expect(await initiativeIds("?sort=paybackMonths")).toEqual(["INIT-001", "INIT-002", "INIT-003", "INIT-004"]);
      expect(await initiativeIds("?sort=paybackMonths&order=desc")).toEqual([
        "INIT-002",
        "INIT-001",
        "INIT-003",
        "INIT-004",
      ]);
    });

    it("sorts text fields", async () => {
      expect(await initiativeIds("?sort=name&order=desc")).toEqual(["INIT-001", "INIT-002", "INIT-004", "INIT-003"]);
    });
  });

  describe("filtering", () => {
    it("filters by status", async () => {
      expect(await initiativeIds("?status=at_risk")).toEqual(["INIT-002", "INIT-004"]);
    });

    it("filters by businessUnit", async () => {
      expect(await initiativeIds("?businessUnit=Legal")).toEqual(["INIT-004"]);
    });

    it("combines a filter with sorting", async () => {
      expect(await initiativeIds("?status=at_risk&sort=roi&order=desc")).toEqual(["INIT-002", "INIT-004"]);
    });

    it("returns an empty list, not an error, when nothing matches", async () => {
      expect(await initiativeIds("?businessUnit=Nowhere")).toEqual([]);
    });
  });

  describe("query validation", () => {
    it.each([
      ["unknown sort field", "?sort=bogus"],
      ["unknown order", "?order=up"],
      ["unknown status", "?status=done"],
      ["repeated parameter", "?sort=roi&sort=name"],
      ["blank parameter", "?businessUnit=%20"],
    ])("rejects %s with 400 VALIDATION_ERROR", async (_label, query) => {
      expectError(await request(app).get(`/api/portfolio/initiatives${query}`), 400, "VALIDATION_ERROR");
    });
  });

  it("passes the validated filter to the injected service without adding defaults", async () => {
    const received: (InitiativeFilter | undefined)[] = [];
    const real = createMockPortfolioService();
    const spy: PortfolioService = {
      ...real,
      getInitiatives: (filter) => {
        received.push(filter);
        return real.getInitiatives(filter);
      },
    };
    const spyApp = createApp({ config: testConfig(), portfolio: spy });

    await request(spyApp).get("/api/portfolio/initiatives");
    await request(spyApp).get("/api/portfolio/initiatives?sort=roi&order=desc&status=off_track");

    // Defaults live in the service, so the controller sends an empty filter.
    expect(received).toEqual([{}, { sort: "roi", order: "desc", status: "off_track" }]);
  });
});

describe("GET /api/portfolio/quality", () => {
  it("returns the data-quality report", async () => {
    const data = expectOk<DataQualityReport>(await request(app).get("/api/portfolio/quality"));

    expect(Object.keys(data).sort()).toEqual(["generatedAt", "issues", "rowsAccepted", "rowsRead", "rowsRejected"]);
    expect(data.issues[0]).toMatchObject({ issueId: "DQ-0001", initiativeId: "INIT-003", action: "rejected" });
  });
});
