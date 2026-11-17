export type InitiativeStage = 'discovery' | 'pilot' | 'scaling' | 'production' | 'paused';
export type InitiativeStatus = 'on_track' | 'at_risk' | 'off_track';
export interface InitiativeMetrics { initiativeId: string; name: string; businessUnit: string; owner: string; stage: InitiativeStage; status: InitiativeStatus; spendToDate: number; valueRealised: number; roi: number | null; adoptionRate: number | null; paybackMonths: number | null; dataQualityIssueCount: number; asOf: string }
export interface PortfolioSummary { asOf: string; initiativeCount: number; totalSpend: number; totalValueRealised: number; portfolioRoi: number | null; averageAdoptionRate: number | null; negativeRoiCount: number; countsByStatus: Record<InitiativeStatus, number> }
export interface Scorecard { summary: PortfolioSummary; initiatives: InitiativeMetrics[] }
export interface DataQualityIssue { issueId: string; sourceFile: string; row: number | null; initiativeId: string | null; field: string | null; severity: 'error' | 'warning'; action: 'rejected' | 'repaired' | 'flagged'; message: string }
export interface DataQualityReport { generatedAt: string; rowsRead: number; rowsAccepted: number; rowsRejected: number; issues: DataQualityIssue[] }
export interface Evidence { chunkId: string; initiativeId: string; sourceFile: string; section: string; text: string; score: number }
export type QuestionType = 'numerical' | 'narrative' | 'mixed';
export type ValidationStatus = 'verified' | 'unverified' | 'insufficient_evidence';
export interface Figure { initiativeId: string | null; metric: string; value: number | null; source: 'scorecard' }
export interface Citation { citationId: string; initiativeId: string; sourceFile: string; section: string; excerpt: string }
export interface AttentionFlag { flagId: string; initiativeId: string; initiativeName: string; rule: 'negative_roi' | 'low_adoption' | 'long_payback' | 'data_quality'; severity: 'high' | 'medium' | 'low'; message: string; metrics: Partial<InitiativeMetrics> }
export interface AskResult { questionType: QuestionType; answer: string; figures: Figure[]; citations: Citation[]; validation: { status: ValidationStatus; notes: string[] }; model: string | null; generatedAt: string }
export interface WeeklyBrief { weekEnding: string; generatedAt: string; summary: PortfolioSummary; flags: AttentionFlag[]; narrative: { status: ValidationStatus | 'unavailable'; text: string | null; citations: Citation[] } }
export interface InitiativesResponse { asOf: string; initiatives: InitiativeMetrics[] }
export type ApiErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'UPSTREAM_ERROR' | 'NOT_READY' | 'INTERNAL_ERROR';
export type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: ApiErrorCode; message: string } };
