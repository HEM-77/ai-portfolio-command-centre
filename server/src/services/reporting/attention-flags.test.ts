// Runs with Node's built-in runner until Vitest is scaffolded:
//   node --experimental-strip-types --test server/src/services/reporting/attention-flags.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAttentionFlags,
  checkDataQuality,
  checkLongPayback,
  checkLowAdoption,
  checkNegativeRoi,
  formatPercent,
} from "./attention-flags.ts";
import type { InitiativeMetrics } from "./contract-types.ts";

// A healthy initiative that triggers no rule; each test changes one field.
function initiative(overrides: Partial<InitiativeMetrics> = {}): InitiativeMetrics {
  return {
    initiativeId: "INIT-900",
    name: "Test Initiative",
    businessUnit: "Ops",
    owner: "Tester",
    stage: "pilot",
    status: "on_track",
    spendToDate: 100000,
    valueRealised: 150000,
    roi: 0.5,
    adoptionRate: 0.6,
    paybackMonths: 10,
    dataQualityIssueCount: 0,
    asOf: "2026-11-14",
    ...overrides,
  };
}

test("negative_roi: below, at and above zero", () => {
  const below = checkNegativeRoi(initiative({ roi: -0.001 }));
  assert.equal(below?.severity, "high");
  assert.equal(checkNegativeRoi(initiative({ roi: 0 })), null);
  assert.equal(checkNegativeRoi(initiative({ roi: 0.001 })), null);
  assert.equal(checkNegativeRoi(initiative({ roi: null })), null);
});

test("negative_roi message matches hand-written example", () => {
  const f = checkNegativeRoi(initiative({ roi: -0.262, spendToDate: 420000, valueRealised: 310000 }));
  assert.equal(f?.message, "ROI is -26.2% on spend of 420000 (value realised 310000).");
  assert.deepEqual(f?.metrics, { roi: -0.262, spendToDate: 420000, valueRealised: 310000 });
});

test("low_adoption: just below, at and just above 0.3", () => {
  assert.equal(checkLowAdoption(initiative({ adoptionRate: 0.299 }))?.severity, "medium");
  assert.equal(checkLowAdoption(initiative({ adoptionRate: 0.3 })), null);
  assert.equal(checkLowAdoption(initiative({ adoptionRate: 0.301 })), null);
  assert.equal(checkLowAdoption(initiative({ adoptionRate: null })), null);
});

test("long_payback: just below, at and just above 24 months", () => {
  assert.equal(checkLongPayback(initiative({ paybackMonths: 23 })), null);
  assert.equal(checkLongPayback(initiative({ paybackMonths: 24 })), null);
  assert.equal(checkLongPayback(initiative({ paybackMonths: 25 }))?.severity, "medium");
  assert.equal(checkLongPayback(initiative({ paybackMonths: null })), null);
});

test("data_quality: 0, 1 and many issues", () => {
  assert.equal(checkDataQuality(initiative({ dataQualityIssueCount: 0 })), null);
  assert.equal(checkDataQuality(initiative({ dataQualityIssueCount: 1 }))?.message, "1 data-quality issue recorded for this initiative.");
  assert.equal(checkDataQuality(initiative({ dataQualityIssueCount: 3 }))?.severity, "low");
});

test("healthy portfolio produces no flags", () => {
  assert.deepEqual(buildAttentionFlags([initiative(), initiative({ initiativeId: "INIT-901" })]), []);
});

test("flags are ordered by severity, then initiative, with sequential IDs", () => {
  const flags = buildAttentionFlags([
    initiative({ initiativeId: "INIT-002", dataQualityIssueCount: 1 }),
    initiative({ initiativeId: "INIT-003", roi: -0.1, adoptionRate: 0.2 }),
    initiative({ initiativeId: "INIT-001", roi: -0.5 }),
  ]);
  assert.deepEqual(
    flags.map((f) => [f.flagId, f.initiativeId, f.rule]),
    [
      ["FLAG-001", "INIT-001", "negative_roi"],
      ["FLAG-002", "INIT-003", "negative_roi"],
      ["FLAG-003", "INIT-003", "low_adoption"],
      ["FLAG-004", "INIT-002", "data_quality"],
    ],
  );
});

test("formatPercent", () => {
  assert.equal(formatPercent(-0.262), "-26.2%");
  assert.equal(formatPercent(0.3), "30.0%");
});
