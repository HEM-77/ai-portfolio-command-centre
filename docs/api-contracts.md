# API and Service Contracts

This is the **single source of truth** for the interfaces between modules and between the client and the server. It builds on [architecture.md](architecture.md) and does not change it.

- **Owner:** Hem (Tech Lead). Changes go through Hem. See [Changing a contract](#7-changing-a-contract).
- **Status labels:** **AGREED** means build against it now. **PROPOSED** means build against it, but it may change after the kickoff check. The [open decisions](#8-open-decisions) list everything not yet settled.

---

## 1. General conventions (AGREED)

| Topic | Rule |
|---|---|
| Base URL | Server runs on `http://localhost:3001`. All routes are under `/api`. |
| Format | JSON only, UTF-8, `camelCase` field names. |
| IDs | Initiative IDs are the official Nimbus IDs `NMB-001` … `NMB-010` (§5.1). Citation IDs look like `C1`, `C2`, … and are unique within one response. JSON examples in §3 that show `INIT-xxx` IDs and values are illustrative shapes only. |
| Dates | ISO 8601. Date only: `2026-11-14`. Timestamp: `2026-11-17T09:30:00Z`. |
| Money | Plain numbers in **USD**, converted with the dataset's `fx_rates.csv` (§5.3). No currency symbols. |
| Ratios | Decimals, not percentages: `0.42` means 42 %. `-0.26` means −26 % ROI. The client formats them for display. |
| Missing values | `null`. Never `0`, `""` or `"N/A"` to mean "unknown". |

### Response envelope

Every endpoint returns one of these two shapes.

**Success**

```json
{ "ok": true, "data": { } }
```

**Error**

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "question must be between 3 and 1000 characters"
  }
}
```

| HTTP status | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Request body or query is invalid |
| 404 | `NOT_FOUND` | Unknown route or initiative ID |
| 502 | `UPSTREAM_ERROR` | OpenRouter or the embedding provider failed |
| 503 | `NOT_READY` | Scorecard or vector index not loaded yet |
| 500 | `INTERNAL_ERROR` | Anything else. The message must not leak stack traces or keys. |

---

## 2. Shared data types

These are the TypeScript shapes behind the JSON. **PROPOSED** location: `server/src/types/contracts.ts` (owned by Hem). The client keeps a matching copy in `client/src/types/api.ts` (owned by Seren).

```ts
type InitiativeStage = "discovery" | "pilot" | "scaling" | "production" | "paused";
type InitiativeStatus = "on_track" | "at_risk" | "off_track";

/** One row of the portfolio scorecard. All numbers are calculated by the Portfolio module. */
interface InitiativeMetrics {
  initiativeId: string;          // "INIT-001"
  name: string;
  businessUnit: string;
  owner: string;
  stage: InitiativeStage;
  status: InitiativeStatus;      // derived by rule, see §8
  spendToDate: number;
  valueRealised: number;
  roi: number | null;            // (valueRealised - spendToDate) / spendToDate; null if spend is 0
  adoptionRate: number | null;   // activeUsers / targetUsers
  paybackMonths: number | null;  // null if not yet paying back
  dataQualityIssueCount: number;
  asOf: string;                  // date of the latest data point
}

interface PortfolioSummary {
  asOf: string;
  initiativeCount: number;
  totalSpend: number;
  totalValueRealised: number;
  portfolioRoi: number | null;
  averageAdoptionRate: number | null;
  negativeRoiCount: number;
  countsByStatus: Record<InitiativeStatus, number>;
}

interface Scorecard {
  summary: PortfolioSummary;
  initiatives: InitiativeMetrics[];
}

interface DataQualityIssue {
  issueId: string;               // "DQ-0001"
  sourceFile: string;            // "data/initiatives.csv"
  row: number | null;            // 1-based data row, null for file-level issues
  initiativeId: string | null;
  field: string | null;
  severity: "error" | "warning";
  action: "rejected" | "repaired" | "flagged";
  message: string;
}

interface DataQualityReport {
  generatedAt: string;
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  issues: DataQualityIssue[];
}

/** One retrieved charter chunk. Returned by the RAG module. */
interface Evidence {
  chunkId: string;               // "INIT-003#risks-2"
  initiativeId: string;
  sourceFile: string;            // "charters/INIT-003-claims-triage.md"
  section: string;               // heading the chunk came from, e.g. "Risks"
  text: string;
  score: number;                 // similarity, 0..1, higher is better
}

type QuestionType = "numerical" | "narrative" | "mixed";
type ValidationStatus = "verified" | "unverified" | "insufficient_evidence";

interface Figure {
  initiativeId: string | null;   // null for portfolio-level figures
  metric: string;                // must be a field name of InitiativeMetrics or PortfolioSummary
  value: number | null;
  source: "scorecard";           // figures always come from the scorecard, never the LLM
}

interface Citation {
  citationId: string;            // "C1", referenced in the answer text as [C1]
  initiativeId: string;
  sourceFile: string;
  section: string;
  excerpt: string;               // short quote from Evidence.text
}

interface AttentionFlag {
  flagId: string;                // "FLAG-001"
  initiativeId: string;
  initiativeName: string;
  rule: "negative_roi" | "low_adoption" | "long_payback" | "data_quality";
  severity: "high" | "medium" | "low";
  message: string;               // plain-English, generated by code, not the LLM
  metrics: Partial<InitiativeMetrics>;
}
```

---

## 3. HTTP endpoints

| Method | Path | Served by | Status |
|---|---|---|---|
| GET | `/api/health` | App (Hem) | AGREED |
| GET | `/api/portfolio/summary` | Portfolio | AGREED |
| GET | `/api/portfolio/initiatives` | Portfolio | AGREED |
| GET | `/api/portfolio/quality` | Portfolio | AGREED |
| POST | `/api/assistant/ask` | AI | AGREED |
| GET | `/api/reports/weekly` | Reporting | AGREED |

Routes and controllers live in `server/src/routes/` and `server/src/controllers/` (owned by Hem). Controllers only validate input, call one service and wrap the result in the envelope. They contain no business logic.

### 3.1 `GET /api/health`

Shows whether the server and its dependencies are ready. It never returns secrets.

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "uptimeSeconds": 512,
    "checks": {
      "scorecardLoaded": true,
      "initiativeCount": 12,
      "vectorIndexLoaded": true,
      "chunkCount": 148,
      "openRouterConfigured": true,
      "embeddingConfigured": true
    }
  }
}
```

`status` is `"degraded"` when any check is false. The endpoint still returns HTTP 200, so the client can show what is missing.

### 3.2 `GET /api/portfolio/summary`

```json
{
  "ok": true,
  "data": {
    "asOf": "2026-11-14",
    "initiativeCount": 12,
    "totalSpend": 4850000,
    "totalValueRealised": 5320000,
    "portfolioRoi": 0.097,
    "averageAdoptionRate": 0.58,
    "negativeRoiCount": 3,
    "countsByStatus": { "on_track": 6, "at_risk": 3, "off_track": 3 }
  }
}
```

### 3.3 `GET /api/portfolio/initiatives`

Optional query parameters (all PROPOSED):

| Param | Example | Meaning |
|---|---|---|
| `status` | `off_track` | Filter by status |
| `businessUnit` | `Operations` | Filter by business unit |
| `sort` | `roi` | Sort field; default `initiativeId` |
| `order` | `asc` | `asc` or `desc`; default `asc` |

The controller validates these and passes them to `PortfolioService.getInitiatives()`, which does the filtering and sorting (§4). `null` values sort last in both orders.

```json
{
  "ok": true,
  "data": {
    "asOf": "2026-11-14",
    "initiatives": [
      {
        "initiativeId": "INIT-003",
        "name": "Claims Triage Assistant",
        "businessUnit": "Operations",
        "owner": "Head of Claims",
        "stage": "pilot",
        "status": "off_track",
        "spendToDate": 420000,
        "valueRealised": 310000,
        "roi": -0.262,
        "adoptionRate": 0.27,
        "paybackMonths": null,
        "dataQualityIssueCount": 1,
        "asOf": "2026-11-14"
      }
    ]
  }
}
```

### 3.4 `GET /api/portfolio/quality`

```json
{
  "ok": true,
  "data": {
    "generatedAt": "2026-11-17T09:00:00Z",
    "rowsRead": 150,
    "rowsAccepted": 147,
    "rowsRejected": 3,
    "issues": [
      {
        "issueId": "DQ-0001",
        "sourceFile": "data/monthly_metrics.csv",
        "row": 42,
        "initiativeId": "INIT-007",
        "field": "activeUsers",
        "severity": "error",
        "action": "rejected",
        "message": "activeUsers is negative (-15)"
      }
    ]
  }
}
```

### 3.5 `POST /api/assistant/ask`

**Request**

```json
{
  "question": "Which initiatives have negative ROI, and what are the reasons behind their performance?",
  "initiativeIds": ["INIT-003"]
}
```

| Field | Rule |
|---|---|
| `question` | Required string, 3–1000 characters after trimming |
| `initiativeIds` | Optional array of known initiative IDs to limit the search to |

**Response**

```json
{
  "ok": true,
  "data": {
    "questionType": "mixed",
    "answer": "Three initiatives have negative ROI. Claims Triage Assistant (ROI −26.2 %) has low adoption because adjusters were not trained before rollout [C1], and integration with the claims system slipped by two months [C2]. ...",
    "figures": [
      { "initiativeId": "INIT-003", "metric": "roi", "value": -0.262, "source": "scorecard" },
      { "initiativeId": "INIT-003", "metric": "adoptionRate", "value": 0.27, "source": "scorecard" }
    ],
    "citations": [
      {
        "citationId": "C1",
        "initiativeId": "INIT-003",
        "sourceFile": "charters/INIT-003-claims-triage.md",
        "section": "Risks",
        "excerpt": "Adjuster training is scheduled after go-live..."
      },
      {
        "citationId": "C2",
        "initiativeId": "INIT-003",
        "sourceFile": "charters/INIT-003-claims-triage.md",
        "section": "Status Notes",
        "excerpt": "Claims system API integration delayed to Q3..."
      }
    ],
    "validation": {
      "status": "verified",
      "notes": []
    },
    "model": "provider/model-name",
    "generatedAt": "2026-11-17T09:31:12Z"
  }
}
```

**Validation rules (AGREED)**

| `validation.status` | Meaning | What the client shows |
|---|---|---|
| `verified` | Every number in `answer` matches a `figures` entry, and every `[Cn]` matches a `citations` entry | Normal answer |
| `unverified` | The LLM answer failed a check. `answer` holds a fallback built by code from `figures` and `citations`. `notes` explain what failed. | Warning banner |
| `insufficient_evidence` | No relevant scorecard data or charter evidence was found | "Not enough evidence to answer" message. Never a guess. |

`model` is the OpenRouter model ID that drafted the answer, or `null` when no LLM was called (for example `insufficient_evidence`).

`questionType` for numerical questions may come back with an empty `citations` array. Narrative questions may come back with an empty `figures` array.

### 3.6 `GET /api/reports/weekly`

```json
{
  "ok": true,
  "data": {
    "weekEnding": "2026-11-14",
    "generatedAt": "2026-11-17T09:00:00Z",
    "summary": { "...": "PortfolioSummary, same shape as /api/portfolio/summary" },
    "flags": [
      {
        "flagId": "FLAG-001",
        "initiativeId": "INIT-003",
        "initiativeName": "Claims Triage Assistant",
        "rule": "negative_roi",
        "severity": "high",
        "message": "ROI is -26.2% after 9 months of spend.",
        "metrics": { "roi": -0.262, "spendToDate": 420000 }
      }
    ],
    "narrative": {
      "status": "verified",
      "text": "The portfolio returned 9.7% overall this week. Three initiatives need attention...",
      "citations": []
    }
  }
}
```

`narrative.status` uses the same values as `validation.status`, plus `"unavailable"` when the LLM call fails. In that case `text` is `null`. **The brief must still render using `summary` and `flags` alone.**

---

## 4. Service-level contracts (inside the server)

Each module exposes **one service object** from its `index.ts`. Other modules import only from that file, never from internal files.

```ts
// server/src/services/portfolio/index.ts — Spoorthy
export interface PortfolioService {
  load(): Promise<void>;                          // read CSV, validate, normalise, calculate (on startup)
  isReady(): boolean;
  getScorecard(): Scorecard;                      // validated, calculated data only
  getSummary(): PortfolioSummary;
  getInitiatives(filter?: {
    status?: InitiativeStatus;
    businessUnit?: string;
    sort?: keyof InitiativeMetrics;               // default "initiativeId"
    order?: "asc" | "desc";                       // default "asc"; null values always sort last
  }): InitiativeMetrics[];                        // filtering and sorting happen here, not in the controller
  getInitiative(initiativeId: string): InitiativeMetrics | undefined;
  getQualityReport(): DataQualityReport;
}

// server/src/services/rag/index.ts — Hem
export interface RagService {
  buildIndex(): Promise<{ chunkCount: number }>;  // ingestion: charters -> chunks -> embeddings -> JSON index
  loadIndex(): Promise<void>;                     // on startup
  isReady(): boolean;
  getChunkCount(): number;                        // chunks in the loaded index; 0 when not loaded (for /api/health)
  retrieve(query: string, options?: {
    initiativeIds?: string[];                     // restrict to these initiatives
    topK?: number;                                // default 5
    minScore?: number;                            // drop weak matches
  }): Promise<Evidence[]>;                        // [] when nothing relevant; never throws for "no results"
}

// server/src/services/ai/index.ts — Hem
export interface AiService {
  ask(input: { question: string; initiativeIds?: string[] }): Promise<AskResult>;   // body of 3.5 data
  generateNarrative(input: {
    purpose: "weekly_brief";
    summary: PortfolioSummary;
    flags: AttentionFlag[];
  }): Promise<{ status: ValidationStatus | "unavailable"; text: string | null; citations: Citation[] }>;
}

// server/src/services/reporting/index.ts — Animesh
export interface ReportingService {
  getAttentionFlags(): AttentionFlag[];           // pure rules over the scorecard, no LLM
  getWeeklyBrief(): Promise<WeeklyBrief>;         // body of 3.6 data
}
```

### Who calls whom

| Caller | May call | Must not |
|---|---|---|
| Portfolio | (nothing) | Call AI, RAG or any LLM |
| RAG | Embedding provider | Calculate metrics, call OpenRouter |
| AI | Portfolio, RAG, OpenRouter | Calculate metrics itself, or return numbers not taken from the scorecard |
| Reporting | Portfolio, AI (`generateNarrative` only) | Call OpenRouter directly; ask the LLM to compute flags |

The four service contracts above are the ones you asked for:

- **Portfolio** returns validated scorecard data.
- **RAG** returns evidence with source metadata.
- **AI** combines the two.
- **Reporting** consumes the scorecard and, when needed, AI narrative.

---

## 5. Data contracts: the official Nimbus dataset (AGREED)

**Source of truth:** the official hackathon dataset, `data/nimbus_synthetic_dataset.zip` ("Nimbus Group"). It is used **as provided**: no extra history is generated and no official file is edited. Its raw files are deliberately messy, so cleaning them is part of the Portfolio module's job. Details and the extraction procedure are in [`data/README.md`](../data/README.md).

| Path inside the zip | Used by | Where it lives in the repo |
|---|---|---|
| `ds/charters/NMB-xxx_<Name>.md` (10 files) | RAG | Extracted unchanged to `charters/` |
| `ds/data/initiatives.csv`, `weekly_usage.csv`, `cost_benefit.csv`, `fx_rates.csv` | Portfolio | Inside the zip only, for now (see §8 #12) |
| `ds/portfolio_data.xlsx` | — | Same tables as the CSVs; also at `data/portfolio_data.xlsx`. Not read by code. |
| `ds/evaluation/**` | **Nobody** | Judges' answer key and test material. **Never extract, index, or feed it to the assistant.** |

### 5.1 Initiative IDs

- Ten initiatives, `NMB-001` … `NMB-010`. The canonical form is `NMB-` plus 3 digits.
- Raw files also contain `NMB001`, lowercase `nmb-001` and IDs with trailing spaces. The Portfolio module normalises them by trimming, uppercasing and inserting the hyphen.
- IDs that are not in `initiatives.csv` (e.g. `NMB-099`) are orphans. They are logged to the data-quality report and excluded from every total.

### 5.2 Charter files: `charters/` (official format, used unchanged)

- File name: `charters/NMB-xxx_<Name_With_Underscores>.md`, e.g. `NMB-004_Contract_Review_Assistant.md`. This matches the `charter_file` column in `initiatives.csv`.
- Format: **no front matter.** Metadata is in bold label lines under the title:

```markdown
# Project Charter: <Initiative name> (NMB-xxx)

**Initiative ID:** NMB-xxx
**Initiative type:** <Copilot | Conversational Bot | Predictive Model | AI-enabled Automation>
**Business unit:** <business unit>
**Executive sponsor:** <name (role)>
**Delivery lead:** <name (role)>
**Go-live:** <Month YYYY>

## 1. Purpose and Business Case
## 2. Scope
## 3. Target Users and Adoption Approach
## 4. Benefits Measurement Approach
## 5. Risks and Dependencies
## 6. Governance and Next Steps
```

- RAG takes `initiativeId`, the name and the business unit from these lines. It chunks by `##` heading. `Evidence.section` is the heading text without its number, e.g. `Risks and Dependencies`.
- Charters contain **targets and other narrative numbers** (e.g. an adoption target). These may be quoted with a citation, but they are never scorecard figures. Scorecard figures come only from the Portfolio module.
- Some charters contain **planted prompt-injection text**, as an official test. Charter text is untrusted data: it is quoted and cited, never obeyed (AGENTS.md §7).

### 5.3 Raw tables (columns exactly as in the dataset)

| File | Columns | Shape and coverage |
|---|---|---|
| `initiatives.csv` | `initiative_id, initiative_name, initiative_type, business_unit, go_live_date, months_live_reported, planned_annual_benefit, plan_unit, charter_file` | One row per initiative (10). Go-live dates run from 2025-08 to 2026-08. |
| `weekly_usage.csv` | `initiative_id, week_ending, metric_name, value, unit` | Long format. **Three weeks only:** week ending 2026-11-01, 2026-11-08 and 2026-11-15. No other usage history exists, and none is generated. |
| `cost_benefit.csv` | `initiative_id, period, measure, value, unit, basis` | Long format. **Monthly** financials from each initiative's go-live month; actuals are closed through **2026-10**. |
| `fx_rates.csv` | `currency, rate_to_usd, note` | `USD` 1.0; `EUR` 1.08 (fixed group planning rate, all periods); `USD thousands` 1000. |

Raw values the Portfolio module must normalise (all observed in the files):

| Topic | Raw variants | Canonical meaning |
|---|---|---|
| Dates (`week_ending`, `go_live_date`) | `2026-11-01`, `01-Nov-2026`, `Nov 1, 2026`, `1 Dec 2025` | ISO date |
| Periods (`period`) | `2025-11`, `Feb-2026`, `February 2026`, and quarter ranges such as `Aug-Oct 2025` (basis `quarterly`) | `YYYY-MM`; a quarter covers its 3 months |
| Usage metrics (`metric_name`) | `Licensed Users`, `licensed_users`, `licences`, `Seats` | licensed users |
| | `Weekly Active Users`, `WAU`, `active_users_wk` | weekly active users (WAU) |
| | `Weekly Adoption Rate` (unit `%`, NMB-008 only) | adoption % (WAU = % × licensed users / 100) |
| Financial measures (`measure`) | `Build Cost`, `Implementation cost`, `capex_one_time` (basis `one-time`) | one-time cost |
| | `Run Cost`, `Operating cost`, `opex_monthly` (basis `monthly`) | monthly running cost |
| | `Realised Benefit`, `Benefit Realised`, `realized_benefit` | realised benefit for the period |
| | `Cumulative Benefit to Date` (basis `cumulative`, NMB-005) | snapshot: use the latest one, **never sum** |
| | `Forecast Benefit` (NMB-010, periods after 2026-10) | forecast, **excluded** from actuals |
| Currency (`unit`, `plan_unit`) | `USD`, `EUR` (NMB-008), `USD thousands` (NMB-009) | USD via `fx_rates.csv` |
| Values | Plain numbers, `$60,000`-style strings, blanks | number, or missing (logged) |

Known data-quality cases in the raw files: blank usage values, a missing licence count, a WAU larger than licensed users, an exact duplicate row, a negative cost, an orphan ID, and `months_live_reported` that disagrees with the go-live date (including a value in weeks). The handling rules belong to the Portfolio module and are listed in `server/src/services/portfolio/README.md`. Each repair or exclusion produces a `DataQualityIssue` (§2).

### 5.4 Calculations and status (scorecard semantics)

| Metric | Definition |
|---|---|
| As-of | Latest usage week, `2026-11-15`. Financial actuals are through `2026-10`. Months live = full months from go-live (1st of the month) to `2026-11-01`, derived from `go_live_date` and not from `months_live_reported`. |
| `spendToDate` | Sum of one-time and monthly costs through 2026-10, in USD |
| `valueRealised` | Sum of realised benefit through 2026-10, or the latest cumulative snapshot where only snapshots exist, in USD |
| `roi` | `(valueRealised − spendToDate) / spendToDate`; `null` if spend is 0 |
| `adoptionRate` | WAU / licensed users in the latest week (2026-11-15) |
| `paybackMonths` | `spendToDate / (valueRealised / monthsLive)`; `null` if there is no realised benefit |
| `status` | `off_track` (**Red**) if adoption < 0.30 or ROI < 0; `on_track` (**Green**) if adoption ≥ 0.60 and ROI > 0; otherwise `at_risk` (**Amber**) |

Status labels: the dataset says Green, Amber and Red; the API always uses the §2 values `on_track`, `at_risk` and `off_track`. The client may show the colour names.

### 5.5 Representation (backend and frontend)

- **IDs:** canonical `NMB-xxx` everywhere: API, citations, charters, logs.
- **Money:** USD numbers, no symbols (§1). The client formats them, e.g. `$1.2M`.
- **Ratios:** decimals (`0.42`, `-0.26`). Unknown values are `null`; the client shows `—`, and a real `0` stays `0`.
- **Dates:** `asOf` and `weekEnding` are `2026-11-15`.
- **Field mapping to §2 `InitiativeMetrics`:**
  - `initiativeId` ← `initiative_id`
  - `name` ← `initiative_name`
  - `businessUnit` ← `business_unit`
  - `spendToDate`, `valueRealised`, `roi`, `adoptionRate`, `paybackMonths` and `status` as in §5.4
  - `dataQualityIssueCount` = the number of `DataQualityIssue`s for that initiative
  - `owner` and `stage` have **no column in the dataset**. See §8 #13; nothing is invented until that is decided.
- **Python:** `data/spoorthi.py` is a **reference only**. Production calculations are implemented in TypeScript in the Portfolio module. The backend never runs Python.

---

## 6. Environment variables (AGREED names)

Defined in `server/.env` (never committed). `server/.env.example` is committed with blank values. Owned by Hem.

| Variable | Used by | Example |
|---|---|---|
| `PORT` | App | `3001` |
| `CLIENT_ORIGIN` | App (CORS) | `http://localhost:5173` |
| `OPENROUTER_API_KEY` | AI | *(secret)* |
| `OPENROUTER_MODEL` | AI | *(to be decided)* |
| `EMBEDDING_API_KEY` | RAG | *(secret)* |
| `EMBEDDING_BASE_URL` | RAG | *(to be decided)* |
| `EMBEDDING_MODEL` | RAG | *(to be decided)* |
| `VITE_API_BASE_URL` | Client (`client/.env`) | `http://localhost:3001/api` |

---

## 7. Changing a contract

1. Tell Hem what you need and why, in the team chat.
2. Hem updates this file **first**, in its own small PR to `develop`.
3. Only then change code on both sides.
4. Never "quietly" add or rename a field in code. Seren's screens and Animesh's tests depend on these shapes.

---

## 8. Open decisions

These are **not settled**. Build against the PROPOSED defaults and keep them easy to change.

| # | Decision | Proposed default | Who decides |
|---|---|---|---|
| 1 | Portfolio currency | **Decided:** USD via the dataset's `fx_rates.csv` (§5.3) | Spoorthy + Seren |
| 2 | Exact ROI / adoption / payback formulas | **Decided:** as in §5.4, following the official dataset's definitions | Spoorthy |
| 3 | `status` rule | **Decided:** as in §5.4 (Red / Amber / Green mapped to `off_track` / `at_risk` / `on_track`) | Spoorthy + Animesh |
| 4 | Attention-flag thresholds | negative ROI → high; adoption < 0.3 → medium; payback > 24 months or `null` after 12 months of spend → medium; any data-quality error → low | Animesh |
| 5 | Embedding provider/model | To verify (see architecture §8) | Hem |
| 6 | OpenRouter model | To decide | Hem |
| 7 | Question router | Rules first (metric keywords + initiative names), LLM classification only if needed | Hem |
| 8 | Vector index file location | `server/storage/vector-index.json`, generated, git-ignored | Hem |
| 9 | Shared types | Server copy in `server/src/types/contracts.ts`; client mirrors in `client/src/types/api.ts` | Hem + Seren |
| 10 | Test runner and dev tooling | Vitest for tests, `tsx` for running TS, Vite for the client (confirmed when Hem scaffolds) | Hem |
| 11 | Weekly brief "week" | `weekEnding` = latest `asOf` in the data (`2026-11-15`), not today's date | Animesh |
| 12 | Where the Portfolio module reads raw tables | Proposed: extract the 4 `ds/data/*.csv` files **unchanged** to `data/raw/`. Until approved, they stay inside the zip. | Hem + Spoorthy |
| 13 | `InitiativeMetrics.owner` and `.stage` (no dataset column) | Proposed: replace `stage` with `initiativeType` (from `initiative_type`). `owner` becomes the charter's "Delivery lead", or is removed. A contract change; Seren and Animesh are affected. | Hem |
| 14 | Extra dataset metrics (WAU change, average monthly benefit, run-rate vs plan, months live) | Proposed: add them to `InitiativeMetrics` only if a screen or answer needs them | Hem |
