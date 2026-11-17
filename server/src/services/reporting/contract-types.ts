// TEMPORARY copy of the types reporting needs from docs/api-contracts.md §2.
// Delete this file and import from server/src/types/contracts.ts once Hem adds it.
// Do not change shapes here; change the contract first.

export type InitiativeStage = "discovery" | "pilot" | "scaling" | "production" | "paused";
export type InitiativeStatus = "on_track" | "at_risk" | "off_track";

export interface InitiativeMetrics {
  initiativeId: string;
  name: string;
  businessUnit: string;
  owner: string;
  stage: InitiativeStage;
  status: InitiativeStatus;
  spendToDate: number;
  valueRealised: number;
  roi: number | null;
  adoptionRate: number | null;
  paybackMonths: number | null;
  dataQualityIssueCount: number;
  asOf: string;
}

export interface PortfolioSummary {
  asOf: string;
  initiativeCount: number;
  totalSpend: number;
  totalValueRealised: number;
  portfolioRoi: number | null;
  averageAdoptionRate: number | null;
  negativeRoiCount: number;
  countsByStatus: Record<InitiativeStatus, number>;
}

export interface Scorecard {
  summary: PortfolioSummary;
  initiatives: InitiativeMetrics[];
}

export type ValidationStatus = "verified" | "unverified" | "insufficient_evidence";

export interface Citation {
  citationId: string;
  initiativeId: string;
  sourceFile: string;
  section: string;
  excerpt: string;
}

export interface Narrative {
  status: ValidationStatus | "unavailable";
  text: string | null;
  citations: Citation[];
}

// Body of GET /api/reports/weekly (contract §3.6).
export interface WeeklyBrief {
  weekEnding: string;
  generatedAt: string;
  summary: PortfolioSummary;
  flags: AttentionFlag[];
  narrative: Narrative;
}

// Only the parts of the other modules' services (contract §4) that reporting uses.
export interface PortfolioServiceLike {
  getScorecard(): Scorecard;
}

export interface AiServiceLike {
  generateNarrative(input: {
    purpose: "weekly_brief";
    summary: PortfolioSummary;
    flags: AttentionFlag[];
  }): Promise<Narrative>;
}

export interface AttentionFlag {
  flagId: string;
  initiativeId: string;
  initiativeName: string;
  rule: "negative_roi" | "low_adoption" | "long_payback" | "data_quality";
  severity: "high" | "medium" | "low";
  message: string;
  metrics: Partial<InitiativeMetrics>;
}
