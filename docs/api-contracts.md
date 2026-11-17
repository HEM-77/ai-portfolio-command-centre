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
| IDs | Initiative IDs look like `INIT-001`. Citation IDs look like `C1`, `C2`, … and are unique within one response. |
| Dates | ISO 8601. Date only: `2026-11-14`. Timestamp: `2026-11-17T09:30:00Z`. |
| Money | Plain numbers in one portfolio currency. No currency symbols. Currency is an [open decision](#8-open-decisions). |
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

## 5. Data contracts (between Spoorthy and Hem)

The RAG module reads files that Spoorthy produces, so their format is a contract too.

### 5.1 Charter files — `charters/` (PROPOSED)

- One file per initiative: `charters/<initiativeId>-<slug>.md`, e.g. `INIT-003-claims-triage.md`.
- Must start with front matter so RAG can attach metadata without guessing:

```markdown
---
initiativeId: INIT-003
name: Claims Triage Assistant
businessUnit: Operations
---

# Claims Triage Assistant

## Objective
## Business Problem
## Scope
## Success Metrics
## Risks
## Status Notes
## Lessons Learned
```

- Use `##` headings exactly as above. RAG chunks by these headings and uses the heading as `Evidence.section`.
- Charters explain **why**. Do not put scorecard numbers in charters that could contradict the CSV. Targets ("aim for 60 % adoption") are fine.

### 5.2 CSV files — `data/` (PROPOSED, Spoorthy finalises)

| File | One row per | Minimum columns |
|---|---|---|
| `data/initiatives.csv` | Initiative | `initiative_id, name, business_unit, owner, stage, start_date, target_users` |
| `data/monthly_metrics.csv` | Initiative per month | `initiative_id, month, spend, value_realised, active_users` |

Spoorthy documents the final columns and metric formulas in `data/README.md`. Some rows should be deliberately bad (missing values, negative users, unknown IDs) so the data-quality log has something to show.

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
| 1 | Portfolio currency | Single currency, unlabeled numbers; client shows `£`/`$` from one constant | Spoorthy + Seren |
| 2 | Exact ROI / adoption / payback formulas | ROI as in §2; adoption = latest month `active_users / target_users`; payback = months until cumulative value ≥ cumulative spend, else `null` | Spoorthy |
| 3 | `status` rule | `off_track` if ROI < 0 or adoption < 0.3; `at_risk` if ROI < 0.1 or adoption < 0.5; else `on_track` | Spoorthy + Animesh |
| 4 | Attention-flag thresholds | negative ROI → high; adoption < 0.3 → medium; payback > 24 months or `null` after 12 months of spend → medium; any data-quality error → low | Animesh |
| 5 | Embedding provider/model | To verify (see architecture §8) | Hem |
| 6 | OpenRouter model | To decide | Hem |
| 7 | Question router | Rules first (metric keywords + initiative names), LLM classification only if needed | Hem |
| 8 | Vector index file location | `server/storage/vector-index.json`, generated, git-ignored | Hem |
| 9 | Shared types | Server copy in `server/src/types/contracts.ts`; client mirrors in `client/src/types/api.ts` | Hem + Seren |
| 10 | Test runner and dev tooling | Vitest for tests, `tsx` for running TS, Vite for the client (confirmed when Hem scaffolds) | Hem |
| 11 | Weekly brief "week" | `weekEnding` = latest `asOf` in the data, not today's date | Animesh |
