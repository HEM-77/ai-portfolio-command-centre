// Syntactic normalisation of raw Nimbus cell values (contract §5.1, §5.3). Pure functions.
// Each returns null when the text cannot be read, so the caller can record an issue.
// Nothing here repairs or reinterprets a value: business rules belong to the Portfolio module.

export type UsageMetric = "licensed_users" | "weekly_active_users" | "weekly_adoption_rate";
export type FinancialMeasure =
  | "one_time_cost"
  | "monthly_cost"
  | "realised_benefit"
  | "cumulative_benefit"
  | "forecast_benefit";
export type FinancialBasis = "one-time" | "monthly" | "quarterly" | "cumulative";

/** Every metric_name variant observed in weekly_usage.csv (contract §5.3), lower-cased. */
const USAGE_METRIC_ALIASES: Record<string, UsageMetric> = {
  "licensed users": "licensed_users",
  licensed_users: "licensed_users",
  licences: "licensed_users",
  seats: "licensed_users",
  "weekly active users": "weekly_active_users",
  wau: "weekly_active_users",
  active_users_wk: "weekly_active_users",
  "weekly adoption rate": "weekly_adoption_rate",
};

/** Every measure variant observed in cost_benefit.csv (contract §5.3), lower-cased. */
const MEASURE_ALIASES: Record<string, FinancialMeasure> = {
  "build cost": "one_time_cost",
  "implementation cost": "one_time_cost",
  capex_one_time: "one_time_cost",
  "run cost": "monthly_cost",
  "operating cost": "monthly_cost",
  opex_monthly: "monthly_cost",
  "realised benefit": "realised_benefit",
  "benefit realised": "realised_benefit",
  realized_benefit: "realised_benefit",
  "cumulative benefit to date": "cumulative_benefit",
  "forecast benefit": "forecast_benefit",
};

const BASES: readonly FinancialBasis[] = ["one-time", "monthly", "quarterly", "cumulative"];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FULL_MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "nmb001 ", "NMB001", "nmb-001" -> "NMB-001". Anything else -> null. */
export function normaliseInitiativeId(raw: string): string | null {
  const match = /^NMB-?(\d{3})$/.exec(raw.trim().toUpperCase());
  return match ? `NMB-${match[1]}` : null;
}

export function canonicalUsageMetric(raw: string): UsageMetric | null {
  return USAGE_METRIC_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function canonicalMeasure(raw: string): FinancialMeasure | null {
  return MEASURE_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function canonicalBasis(raw: string): FinancialBasis | null {
  const value = raw.trim().toLowerCase();
  return (BASES as readonly string[]).includes(value) ? (value as FinancialBasis) : null;
}

function monthIndex(name: string): number | null {
  const lower = name.toLowerCase();
  const short = MONTHS.indexOf(lower);
  if (short >= 0) return short;
  const full = FULL_MONTHS.indexOf(lower);
  return full >= 0 ? full : null;
}

function isoDate(year: number, monthZeroBased: number, day: number): string | null {
  const date = new Date(Date.UTC(year, monthZeroBased, day));
  // Reject impossible dates such as 31 Feb, which Date would roll over into March.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthZeroBased || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function monthStart(year: number, monthZeroBased: number): string {
  return `${year}-${String(monthZeroBased + 1).padStart(2, "0")}-01`;
}

/**
 * Dates in the four observed formats -> "YYYY-MM-DD":
 * "2026-11-01", "01-Nov-2026", "Nov 1, 2026", "1 Dec 2025".
 */
export function parseDate(raw: string): string | null {
  const text = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) return isoDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text);
  if (m?.[2]) {
    const month = monthIndex(m[2]);
    return month === null ? null : isoDate(Number(m[3]), month, Number(m[1]));
  }

  m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(text);
  if (m?.[1]) {
    const month = monthIndex(m[1]);
    return month === null ? null : isoDate(Number(m[3]), month, Number(m[2]));
  }

  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(text);
  if (m?.[2]) {
    const month = monthIndex(m[2]);
    return month === null ? null : isoDate(Number(m[3]), month, Number(m[1]));
  }
  return null;
}

export interface Period {
  start: string; // first day of the first month, "YYYY-MM-01"
  end: string; // first day of the last month
  months: number; // months covered, inclusive
}

/**
 * Periods in the observed formats -> first and last month:
 * "2025-11", "Feb-2026", "February 2026", "Aug-Oct 2025", "Nov 2025-Jan 2026".
 */
export function parsePeriod(raw: string): Period | null {
  const text = raw.trim();
  const single = (year: number, month: number | null): Period | null =>
    month === null || month < 0 || month > 11 ? null : { start: monthStart(year, month), end: monthStart(year, month), months: 1 };

  let m = /^(\d{4})-(\d{2})$/.exec(text);
  if (m) return single(Number(m[1]), Number(m[2]) - 1);

  m = /^([A-Za-z]+)[-\s](\d{4})$/.exec(text);
  if (m?.[1]) return single(Number(m[2]), monthIndex(m[1]));

  // Range within one year: "Aug-Oct 2025". The end month must not be before the start month.
  m = /^([A-Za-z]+)-([A-Za-z]+)\s+(\d{4})$/.exec(text);
  if (m?.[1] && m[2]) {
    const from = monthIndex(m[1]);
    const to = monthIndex(m[2]);
    if (from === null || to === null || to < from) return null;
    const year = Number(m[3]);
    return { start: monthStart(year, from), end: monthStart(year, to), months: to - from + 1 };
  }

  // Range across years: "Nov 2025-Jan 2026".
  m = /^([A-Za-z]+)\s+(\d{4})\s*-\s*([A-Za-z]+)\s+(\d{4})$/.exec(text);
  if (m?.[1] && m[3]) {
    const from = monthIndex(m[1]);
    const to = monthIndex(m[3]);
    if (from === null || to === null) return null;
    const months = (Number(m[4]) - Number(m[2])) * 12 + (to - from) + 1;
    if (months < 1) return null;
    return { start: monthStart(Number(m[2]), from), end: monthStart(Number(m[4]), to), months };
  }
  return null;
}

export type ParsedNumber = { kind: "blank" } | { kind: "number"; value: string } | { kind: "invalid" };

/**
 * "60000", "$60,000", "60,000 ", "-30000", "85.0" -> an exact decimal string for a Postgres
 * `numeric` (no floating-point rounding). The sign is preserved. A blank cell is reported as blank.
 */
export function parseNumber(raw: string): ParsedNumber {
  const text = raw.trim();
  if (text === "") return { kind: "blank" };
  const compact = text.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(compact)) return { kind: "invalid" };
  return { kind: "number", value: compact };
}
