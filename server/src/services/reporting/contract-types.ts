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

export interface AttentionFlag {
  flagId: string;
  initiativeId: string;
  initiativeName: string;
  rule: "negative_roi" | "low_adoption" | "long_payback" | "data_quality";
  severity: "high" | "medium" | "low";
  message: string;
  metrics: Partial<InitiativeMetrics>;
}
