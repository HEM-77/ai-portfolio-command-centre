import type { InitiativeStatus } from "../../types/contracts.js";

// Deterministic scorecard formulas (contract §5.4). Pure functions; the LLM never calculates.

/** Reporting basis of the Nimbus dataset (contract §5.4, data/README.md). */
export const ACTUALS_THROUGH_MONTH = "2026-10-01"; // financial actuals are closed through October 2026
export const MONTHS_LIVE_REFERENCE_DATE = "2026-11-01"; // months live are counted up to this date

/** Status thresholds (contract §5.4): Red / Amber / Green -> off_track / at_risk / on_track. */
export const RED_ADOPTION_BELOW = 0.3;
export const GREEN_ADOPTION_FROM = 0.6;

/** Round a USD amount to cents, so FX multiplication noise (e.g. x 1.08) never shows up in totals. */
export function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** ROI = (value realised - spend) / spend. null when spend is 0: a ratio over nothing is undefined. */
export function calculateRoi(spendToDate: number, valueRealised: number): number | null {
  return spendToDate > 0 ? (valueRealised - spendToDate) / spendToDate : null;
}

/** Adoption = weekly active users / licensed users. null when either is unknown or licences are 0. */
export function calculateAdoption(weeklyActiveUsers: number | null, licensedUsers: number | null): number | null {
  if (weeklyActiveUsers === null || licensedUsers === null || licensedUsers <= 0) return null;
  return weeklyActiveUsers / licensedUsers;
}

/**
 * Full months from the go-live month (counted from its 1st) to the reference date.
 * Example: go-live 2025-11-01 -> 12 months to 2026-11-01.
 */
export function calculateMonthsLive(goLiveDate: string, referenceDate: string = MONTHS_LIVE_REFERENCE_DATE): number {
  const [gy, gm] = goLiveDate.split("-").map(Number);
  const [ry, rm] = referenceDate.split("-").map(Number);
  return Math.max(0, ((ry ?? 0) - (gy ?? 0)) * 12 + ((rm ?? 0) - (gm ?? 0)));
}

/**
 * Payback = spend / average monthly benefit, where average monthly benefit = value / months live.
 * null when there is no realised benefit or no month live: the initiative is not paying back yet.
 */
export function calculatePaybackMonths(spendToDate: number, valueRealised: number, monthsLive: number): number | null {
  if (valueRealised <= 0 || monthsLive <= 0) return null;
  return spendToDate / (valueRealised / monthsLive);
}

/**
 * off_track (Red) if adoption < 0.30 or ROI < 0; on_track (Green) if adoption >= 0.60 and ROI > 0;
 * otherwise at_risk (Amber). An unknown (null) value never satisfies a comparison, so it can make an
 * initiative Amber but never Green.
 */
export function deriveStatus(adoptionRate: number | null, roi: number | null): InitiativeStatus {
  if ((adoptionRate !== null && adoptionRate < RED_ADOPTION_BELOW) || (roi !== null && roi < 0)) return "off_track";
  if (adoptionRate !== null && adoptionRate >= GREEN_ADOPTION_FROM && roi !== null && roi > 0) return "on_track";
  return "at_risk";
}
