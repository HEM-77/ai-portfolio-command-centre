import type { AttentionFlag, InitiativeMetrics } from "./contract-types.ts";

// Thresholds: PROPOSED defaults from docs/api-contracts.md §8 #4. Animesh owns them.
export const LOW_ADOPTION_THRESHOLD = 0.3; // adoptionRate strictly below this is flagged
export const LONG_PAYBACK_MONTHS = 24; // paybackMonths strictly above this is flagged

type Rule = AttentionFlag["rule"];
type Severity = AttentionFlag["severity"];
type Candidate = Omit<AttentionFlag, "flagId">;

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const RULE_ORDER: Record<Rule, number> = { negative_roi: 0, low_adoption: 1, long_payback: 2, data_quality: 3 };

// Formats a decimal ratio for flag messages: -0.262 -> "-26.2%".
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

// ROI below zero: spend exceeds value realised. Null ROI (zero spend) is not flagged.
export function checkNegativeRoi(m: InitiativeMetrics): Candidate | null {
  if (m.roi === null || m.roi >= 0) return null;
  return {
    initiativeId: m.initiativeId,
    initiativeName: m.name,
    rule: "negative_roi",
    severity: "high",
    message: `ROI is ${formatPercent(m.roi)} on spend of ${m.spendToDate} (value realised ${m.valueRealised}).`,
    metrics: { roi: m.roi, spendToDate: m.spendToDate, valueRealised: m.valueRealised },
  };
}

export function checkLowAdoption(m: InitiativeMetrics): Candidate | null {
  if (m.adoptionRate === null || m.adoptionRate >= LOW_ADOPTION_THRESHOLD) return null;
  return {
    initiativeId: m.initiativeId,
    initiativeName: m.name,
    rule: "low_adoption",
    severity: "medium",
    message: `Adoption is ${formatPercent(m.adoptionRate)}, below the ${formatPercent(LOW_ADOPTION_THRESHOLD)} threshold.`,
    metrics: { adoptionRate: m.adoptionRate },
  };
}

// Only the "payback > 24 months" half of the proposed rule is implemented.
// The "null payback after 12 months of spend" half needs a months-of-spend value,
// which InitiativeMetrics does not carry yet (raised with Hem/Spoorthy).
export function checkLongPayback(m: InitiativeMetrics): Candidate | null {
  if (m.paybackMonths === null || m.paybackMonths <= LONG_PAYBACK_MONTHS) return null;
  return {
    initiativeId: m.initiativeId,
    initiativeName: m.name,
    rule: "long_payback",
    severity: "medium",
    message: `Payback period is ${m.paybackMonths} months, longer than ${LONG_PAYBACK_MONTHS} months.`,
    metrics: { paybackMonths: m.paybackMonths },
  };
}

// Contract carries only a total issue count (errors + warnings), so any issue raises a low flag.
export function checkDataQuality(m: InitiativeMetrics): Candidate | null {
  if (m.dataQualityIssueCount <= 0) return null;
  const n = m.dataQualityIssueCount;
  return {
    initiativeId: m.initiativeId,
    initiativeName: m.name,
    rule: "data_quality",
    severity: "low",
    message: `${n} data-quality ${n === 1 ? "issue" : "issues"} recorded for this initiative.`,
    metrics: { dataQualityIssueCount: n },
  };
}

const CHECKS = [checkNegativeRoi, checkLowAdoption, checkLongPayback, checkDataQuality];

// Pure: same scorecard in, same flags out. Sorted by severity, then initiative, then rule,
// so FLAG-001 is always the most serious item.
export function buildAttentionFlags(initiatives: InitiativeMetrics[]): AttentionFlag[] {
  const candidates = initiatives.flatMap((m) =>
    CHECKS.map((check) => check(m)).filter((c): c is Candidate => c !== null),
  );
  candidates.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.initiativeId.localeCompare(b.initiativeId) ||
      RULE_ORDER[a.rule] - RULE_ORDER[b.rule],
  );
  return candidates.map((c, i) => ({ flagId: `FLAG-${String(i + 1).padStart(3, "0")}`, ...c }));
}
