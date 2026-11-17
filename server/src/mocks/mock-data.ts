import type {
  AskResult,
  AttentionFlag,
  DataQualityReport,
  InitiativeMetrics,
  PortfolioSummary,
  WeeklyBriefNarrative,
} from "../types/contracts.js";

// MOCK DATA ONLY. Lets the client and tests run against contract-shaped responses before the
// real Portfolio, AI and Reporting modules land. These values are NOT from data/*.csv and must
// never be shown in the demo. Each mock is replaced by the real service in src/index.ts.
//
// The values are hand-made but internally consistent, so the screens do not contradict
// themselves. INIT-003 matches the examples in docs/api-contracts.md. INIT-004 has null ROI,
// adoption and payback so the client and sorting can be tested with nulls.

export const MOCK_AS_OF = "2026-11-14";

export const MOCK_INITIATIVES: InitiativeMetrics[] = [
  {
    initiativeId: "INIT-001",
    name: "Invoice Processing Copilot",
    businessUnit: "Finance",
    owner: "Head of Finance Operations",
    initiativeType: "Copilot",
    status: "on_track",
    spendToDate: 600000,
    valueRealised: 900000,
    roi: 0.5, // (900000 - 600000) / 600000
    adoptionRate: 0.72,
    paybackMonths: 14,
    dataQualityIssueCount: 0,
    asOf: MOCK_AS_OF,
  },
  {
    initiativeId: "INIT-002",
    name: "Customer Service Knowledge Assistant",
    businessUnit: "Customer Service",
    owner: "Director of Customer Service",
    initiativeType: "Conversational Bot",
    status: "at_risk",
    spendToDate: 350000,
    valueRealised: 370000,
    roi: 0.057, // (370000 - 350000) / 350000 = 0.0571
    adoptionRate: 0.45,
    paybackMonths: 20,
    dataQualityIssueCount: 0,
    asOf: MOCK_AS_OF,
  },
  {
    initiativeId: "INIT-003",
    name: "Claims Triage Assistant",
    businessUnit: "Operations",
    owner: "Head of Claims",
    initiativeType: "Copilot",
    status: "off_track",
    spendToDate: 420000,
    valueRealised: 310000,
    roi: -0.262, // (310000 - 420000) / 420000 = -0.2619
    adoptionRate: 0.27,
    paybackMonths: null,
    dataQualityIssueCount: 1,
    asOf: MOCK_AS_OF,
  },
  {
    initiativeId: "INIT-004",
    name: "Contract Review Assistant",
    businessUnit: "Legal",
    owner: "General Counsel",
    initiativeType: "Predictive Model",
    status: "at_risk",
    spendToDate: 0,
    valueRealised: 0,
    roi: null, // spend is 0
    adoptionRate: null, // no users yet
    paybackMonths: null,
    dataQualityIssueCount: 0,
    asOf: MOCK_AS_OF,
  },
];

/** Hand-totalled from MOCK_INITIATIVES. */
export const MOCK_SUMMARY: PortfolioSummary = {
  asOf: MOCK_AS_OF,
  initiativeCount: 4,
  totalSpend: 1370000,
  totalValueRealised: 1580000,
  portfolioRoi: 0.153, // (1580000 - 1370000) / 1370000 = 0.1533
  averageAdoptionRate: 0.48, // mean of the three non-null rates: (0.72 + 0.45 + 0.27) / 3
  negativeRoiCount: 1,
  countsByStatus: { on_track: 1, at_risk: 2, off_track: 1 },
};

export const MOCK_QUALITY_REPORT: DataQualityReport = {
  generatedAt: "2026-11-17T09:00:00Z",
  rowsRead: 52,
  rowsAccepted: 51,
  rowsRejected: 1,
  issues: [
    {
      issueId: "DQ-0001",
      sourceFile: "data/monthly_metrics.csv",
      row: 42,
      initiativeId: "INIT-003",
      field: "activeUsers",
      severity: "error",
      action: "rejected",
      message: "activeUsers is negative (-15)",
    },
  ],
};

/** The headline mixed question, answered from the mock values above. */
export const MOCK_ASK_RESULT: Omit<AskResult, "generatedAt"> = {
  questionType: "mixed",
  answer:
    "One initiative has negative ROI. Claims Triage Assistant (ROI -26.2%) has low adoption (27%) " +
    "because adjusters were not trained before rollout [C1], and integration with the claims system " +
    "was delayed [C2].",
  figures: [
    { initiativeId: "INIT-003", metric: "roi", value: -0.262, source: "scorecard" },
    { initiativeId: "INIT-003", metric: "adoptionRate", value: 0.27, source: "scorecard" },
  ],
  citations: [
    {
      citationId: "C1",
      initiativeId: "INIT-003",
      sourceFile: "charters/INIT-003-claims-triage.md",
      section: "Risks",
      excerpt: "Adjuster training is scheduled after go-live...",
    },
    {
      citationId: "C2",
      initiativeId: "INIT-003",
      sourceFile: "charters/INIT-003-claims-triage.md",
      section: "Status Notes",
      excerpt: "Claims system API integration delayed to Q3...",
    },
  ],
  validation: { status: "verified", notes: [] },
  model: "mock",
};

export const MOCK_FLAGS: AttentionFlag[] = [
  {
    flagId: "FLAG-001",
    initiativeId: "INIT-003",
    initiativeName: "Claims Triage Assistant",
    rule: "negative_roi",
    severity: "high",
    message: "ROI is -26.2% on spend to date of 420000.",
    metrics: { roi: -0.262, spendToDate: 420000 },
  },
  {
    flagId: "FLAG-002",
    initiativeId: "INIT-003",
    initiativeName: "Claims Triage Assistant",
    rule: "low_adoption",
    severity: "medium",
    message: "Adoption is 27%, below the 30% threshold.",
    metrics: { adoptionRate: 0.27 },
  },
];

export const MOCK_NARRATIVE: WeeklyBriefNarrative = {
  status: "verified",
  text:
    "Portfolio ROI is 15.3% across 4 initiatives. One initiative has negative ROI: " +
    "Claims Triage Assistant (-26.2%), which also has adoption of 27%.",
  citations: [],
};
