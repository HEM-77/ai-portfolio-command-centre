import type { Figure, InitiativeMetrics, PortfolioSummary } from "../../types/contracts.js";

// Scorecard values as figures, each with the exact display text the LLM must use (it never formats
// or calculates numbers itself). Pure functions.

export type FigureKind = "money" | "ratio" | "months" | "count";

export interface DisplayFigure {
  figure: Figure;
  kind: FigureKind;
  display: string; // e.g. "$780,000", "188.5%", "4.2 months", "3"
}

const STATUS_LABEL = { on_track: "on track (Green)", at_risk: "at risk (Amber)", off_track: "off track (Red)" } as const;

export function formatValue(value: number | null, kind: FigureKind): string {
  if (value === null) return "unknown";
  switch (kind) {
    case "money":
      return `$${Math.round(value).toLocaleString("en-US")}`;
    case "ratio":
      return `${(value * 100).toFixed(1)}%`;
    case "months":
      return `${value.toFixed(1)} months`;
    case "count":
      return String(value);
  }
}

function figure(initiativeId: string | null, metric: string, value: number | null, kind: FigureKind): DisplayFigure {
  return { figure: { initiativeId, metric, value, source: "scorecard" }, kind, display: formatValue(value, kind) };
}

export function initiativeFigures(m: InitiativeMetrics): DisplayFigure[] {
  return [
    figure(m.initiativeId, "spendToDate", m.spendToDate, "money"),
    figure(m.initiativeId, "valueRealised", m.valueRealised, "money"),
    figure(m.initiativeId, "roi", m.roi, "ratio"),
    figure(m.initiativeId, "adoptionRate", m.adoptionRate, "ratio"),
    figure(m.initiativeId, "paybackMonths", m.paybackMonths, "months"),
    figure(m.initiativeId, "dataQualityIssueCount", m.dataQualityIssueCount, "count"),
  ];
}

export function summaryFigures(s: PortfolioSummary): DisplayFigure[] {
  return [
    figure(null, "initiativeCount", s.initiativeCount, "count"),
    figure(null, "totalSpend", s.totalSpend, "money"),
    figure(null, "totalValueRealised", s.totalValueRealised, "money"),
    figure(null, "portfolioRoi", s.portfolioRoi, "ratio"),
    figure(null, "averageAdoptionRate", s.averageAdoptionRate, "ratio"),
    figure(null, "negativeRoiCount", s.negativeRoiCount, "count"),
    figure(null, "countsByStatus.on_track", s.countsByStatus.on_track, "count"),
    figure(null, "countsByStatus.at_risk", s.countsByStatus.at_risk, "count"),
    figure(null, "countsByStatus.off_track", s.countsByStatus.off_track, "count"),
  ];
}

/** One scorecard line per initiative, using the display texts above. */
export function scorecardLine(m: InitiativeMetrics): string {
  const f = Object.fromEntries(initiativeFigures(m).map((d) => [d.figure.metric, d.display]));
  return (
    `${m.initiativeId} ${m.name} (${m.initiativeType}, ${m.businessUnit}): status ${STATUS_LABEL[m.status]}; ` +
    `spend to date ${f.spendToDate}; value realised ${f.valueRealised}; ROI ${f.roi}; adoption ${f.adoptionRate}; ` +
    `payback ${f.paybackMonths}; data-quality issues ${f.dataQualityIssueCount}`
  );
}

export function summaryLine(s: PortfolioSummary): string {
  const f = Object.fromEntries(summaryFigures(s).map((d) => [d.figure.metric, d.display]));
  return (
    `Portfolio as of ${s.asOf}: ${f.initiativeCount} initiatives; total spend ${f.totalSpend}; total value realised ` +
    `${f.totalValueRealised}; portfolio ROI ${f.portfolioRoi}; average adoption ${f.averageAdoptionRate}; ` +
    `${f.negativeRoiCount} with negative ROI; ${f["countsByStatus.on_track"]} on track (Green), ` +
    `${f["countsByStatus.at_risk"]} at risk (Amber), ${f["countsByStatus.off_track"]} off track (Red)`
  );
}

export function statusLabel(status: InitiativeMetrics["status"]): string {
  return STATUS_LABEL[status];
}
