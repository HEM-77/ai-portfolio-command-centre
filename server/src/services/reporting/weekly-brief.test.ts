// node --experimental-strip-types --test server/src/services/reporting/weekly-brief.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReportingService } from "./index.ts";
import type { AiServiceLike, Narrative, Scorecard } from "./contract-types.ts";

// Test-only scorecard. Not shown in the demo.
const scorecard: Scorecard = {
  summary: {
    asOf: "2026-11-14",
    initiativeCount: 2,
    totalSpend: 520000,
    totalValueRealised: 460000,
    portfolioRoi: -0.115,
    averageAdoptionRate: 0.435,
    negativeRoiCount: 1,
    countsByStatus: { on_track: 1, at_risk: 0, off_track: 1 },
  },
  initiatives: [
    {
      initiativeId: "INIT-001", name: "Healthy", businessUnit: "Finance", owner: "A", stage: "production",
      status: "on_track", spendToDate: 100000, valueRealised: 150000, roi: 0.5, adoptionRate: 0.6,
      paybackMonths: 8, dataQualityIssueCount: 0, asOf: "2026-11-14",
    },
    {
      initiativeId: "INIT-003", name: "Claims Triage Assistant", businessUnit: "Operations", owner: "B",
      stage: "pilot", status: "off_track", spendToDate: 420000, valueRealised: 310000, roi: -0.262,
      adoptionRate: 0.27, paybackMonths: null, dataQualityIssueCount: 0, asOf: "2026-11-14",
    },
  ],
};

const portfolio = { getScorecard: () => scorecard };
const fixedNow = () => new Date("2026-11-17T09:00:00.123Z");

function aiReturning(n: Narrative): AiServiceLike & { calls: number } {
  const ai = { calls: 0, async generateNarrative() { ai.calls++; return n; } };
  return ai;
}

test("brief with a real narrative", async () => {
  const narrative: Narrative = { status: "verified", text: "One initiative needs attention.", citations: [] };
  const ai = aiReturning(narrative);
  const brief = await createReportingService({ portfolio, ai, now: fixedNow }).getWeeklyBrief();

  assert.equal(brief.weekEnding, "2026-11-14");
  assert.equal(brief.generatedAt, "2026-11-17T09:00:00Z");
  assert.deepEqual(brief.summary, scorecard.summary);
  assert.deepEqual(brief.flags.map((f) => [f.initiativeId, f.rule]), [
    ["INIT-003", "negative_roi"],
    ["INIT-003", "low_adoption"],
  ]);
  assert.deepEqual(brief.narrative, narrative);
  assert.equal(ai.calls, 1);
  assert.deepEqual(Object.keys(brief).sort(), ["flags", "generatedAt", "narrative", "summary", "weekEnding"]);
});

test("brief still renders when the AI returns unavailable", async () => {
  const ai = aiReturning({ status: "unavailable", text: null, citations: [] });
  const brief = await createReportingService({ portfolio, ai, now: fixedNow }).getWeeklyBrief();
  assert.equal(brief.narrative.status, "unavailable");
  assert.equal(brief.narrative.text, null);
  assert.equal(brief.flags.length, 2);
});

test("brief still renders when the AI throws", async () => {
  const ai: AiServiceLike = { async generateNarrative() { throw new Error("OpenRouter timeout"); } };
  const brief = await createReportingService({ portfolio, ai, now: fixedNow }).getWeeklyBrief();
  assert.deepEqual(brief.narrative, { status: "unavailable", text: null, citations: [] });
  assert.equal(brief.summary.asOf, "2026-11-14");
  assert.equal(brief.flags.length, 2);
});

test("getAttentionFlags uses the scorecard and never calls the AI", () => {
  const ai = aiReturning({ status: "verified", text: "x", citations: [] });
  const flags = createReportingService({ portfolio, ai }).getAttentionFlags();
  assert.equal(flags.length, 2);
  assert.equal(ai.calls, 0);
});
