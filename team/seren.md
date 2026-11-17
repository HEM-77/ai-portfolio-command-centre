# Seren — Frontend Engineer

## 1. Who and what

**Seren**: Frontend Engineer. Seren builds everything the executive sees and clicks: the face of the demo.

## 2. Project objective

Build the **AI Portfolio Command Centre**: an assistant that answers executive questions about AI initiatives. It uses **deterministic scorecard numbers** and **cited evidence from initiative charters**. The frontend must make numbers easy to read and make **sources visible**, so an executive can trust what they see. See [docs/architecture.md](../docs/architecture.md).

## 3. What Seren owns

| Path | Notes |
|---|---|
| `client/` | The entire React + TypeScript app: `package.json`, config, components, pages, API client, mocks, styles |

Suggested structure inside `client/src/`:

```
api/          client.ts (fetch wrapper + envelope handling), one file per area
types/api.ts  copy of the contract types
mocks/        JSON copied from docs/api-contracts.md examples
pages/        PortfolioOverview.tsx, Assistant.tsx, WeeklyBrief.tsx
components/   KpiCard, InitiativeTable, RoiChart, AnswerCard, CitationList, FlagList, …
```

Seren does **not** edit anything under `server/`, `data/`, `charters/` or `tests/` without the owner's approval.

## 4. Responsibilities

- React + TypeScript app with Tailwind CSS and Recharts (Vite, PROPOSED in api-contracts.md §8 #10)
- Simple navigation between three screens
- **Portfolio Overview:** KPI cards (total spend, value realised, portfolio ROI, average adoption, negative-ROI count), charts (e.g. ROI by initiative, status breakdown), a sortable initiative table, and a data-quality summary
- **Portfolio Intelligence Assistant:** question box, example questions, answer with highlighted `[C1]` markers, a figures table, a citation list (file + section + excerpt), loading state, and clear banners for `unverified` and `insufficient_evidence`
- **Weekly Executive Brief:** headline KPIs, attention flags grouped by severity, narrative (with a fallback when `narrative.status` is `unavailable`)
- **API integration:** one typed client that handles the `{ ok, data }` / `{ ok, error }` envelope; loading, error and empty states on every screen
- Formatting helpers: ratios → percentages, money, dates

## 5. Dependencies on others

| Needs | From | Until it arrives |
|---|---|---|
| Running server with mock endpoints + CORS for `http://localhost:5173` | Hem | Local mocks in `client/src/mocks/` |
| Real portfolio data | Spoorthy (via Hem's routes) | Mocks |
| Real `/api/assistant/ask` | Hem | Mocks: one `verified`, one `unverified`, one `insufficient_evidence` |
| Real `/api/reports/weekly` | Animesh (via Hem's routes) | Mock, including the `narrative.status: "unavailable"` case |

**Who depends on Seren:** the demo. Hem and Animesh will want to see their output on screen for integration checks.

## 6. Inputs and outputs

| Inputs | Outputs |
|---|---|
| JSON from the six endpoints (contract §3) | Three screens |
| `VITE_API_BASE_URL` from `client/.env` | `POST /api/assistant/ask` requests `{ question, initiativeIds? }` |

The frontend **never** calculates business metrics. It only formats values from the API (e.g. `0.42` → `42%`). Sorting and filtering the table client-side is fine.

## 7. Contracts to follow

- All response shapes in [api-contracts.md §2–3](../docs/api-contracts.md#2-shared-data-types). Copy the types into `client/src/types/api.ts` exactly.
- Envelope and error codes in §1. Show `error.message` to the user; handle `NOT_READY` (server still loading) gracefully.
- `validation.status` and `narrative.status` handling in §3.5 and §3.6.
- `VITE_API_BASE_URL` in §6. No secrets in the client, ever.

## 8. Recommended implementation order

1. **Client shell** (`feature/seren-client-shell`): Vite + React + TS + Tailwind, three routes/tabs, `types/api.ts`, `api/client.ts` with a **mock/real switch**, mocks from the contract examples. → **Checkpoint 1**
2. **Portfolio Overview** (`feature/seren-overview`): KPI cards → initiative table → one or two Recharts charts → data-quality panel.
3. **Assistant** (`feature/seren-assistant-ui`): input + submit + loading → answer + figures → citations → status banners → example question buttons (include the headline negative-ROI question).
4. **Weekly Brief** (`feature/seren-weekly-brief`): flags by severity → summary KPIs → narrative with fallback.
5. **Switch to real API** screen by screen as each endpoint lands (watch for **Landed** messages).
6. Polish for the demo: consistent spacing, readable at projector size, no console errors.

## 9. Testing requirements

- `npm run typecheck` and `npm run build` pass with no errors.
- Each screen checked by hand against mocks **and** the real API: loading, success, error (stop the server), and empty states.
- Assistant screen checked with all three `validation.status` values.
- Weekly Brief checked with `narrative.status: "unavailable"`.
- Formatting helpers (percent, money) get small unit tests if a test runner is available in `client/`.
- No numbers on screen that do not come from an API response.

## 10. Branch naming

`feature/seren-<topic>`, e.g. `feature/seren-client-shell`, `feature/seren-overview`, `feature/seren-assistant-ui`, `feature/seren-weekly-brief`.

## 11. Definition of done

- [ ] Three screens work against the **real** API on `develop`
- [ ] Types match the contract; no `any`
- [ ] Every assistant answer shows its citations, and unverified / no-evidence answers are clearly labelled
- [ ] Loading, error and empty states everywhere
- [ ] Weekly Brief renders even without the LLM narrative
- [ ] Typecheck and build pass; no console errors during the demo flow

## Progress checklist

> Tick only what is merged **and** verified. Claude checks this against the code.

- [ ] Client shell + API client + mocks
- [ ] Portfolio Overview: KPI cards
- [ ] Portfolio Overview: initiative table
- [ ] Portfolio Overview: charts
- [ ] Portfolio Overview: data-quality panel
- [ ] Assistant screen
- [ ] Weekly Brief screen
- [ ] Switched to real API (all screens)
- [ ] Demo polish

---

## How Claude should assist this member

When the user says **"I am Seren"**:

1. **Confirm the identity** and read `CLAUDE.md`, this file and `docs/api-contracts.md`.
2. **Inspect the project state:** `git status`, current branch, and what exists in `client/`. Check which server endpoints are real on `develop` and which still return mocks: look at `server/src/controllers/` (read only) or `curl` the running server.
3. **Compare** the *Recommended implementation order* and *Progress checklist* with reality. A screen that has not been opened in the browser is not done.
4. **Explain the next task simply:** what the executive will see, why it matters for the demo, and which files it touches.
5. **Break it into small steps** (one component at a time) and implement them only inside `client/`.
6. **Explain why** each piece of code exists. For example, explain why a shared API client handles the envelope in one place.
7. **Run** `npm run typecheck` / `npm run build` after each step and tell Seren exactly what to open in the browser to check it.
8. **Summarise:** changed files, what was verified and how, remaining work, a suggested commit message, and any **Need** message. For example, a field that seems missing from an API goes to Hem.
9. **Never assume a task is complete** just because code was generated.

Seren-specific notes:

- If the real API response differs from the contract, **do not adapt the client to the wrong shape.** Draft a **Blocked** message to Hem with the difference.
- Do not compute ROI, totals or flags in the browser. If a number is missing, it is a Need for the server.
- Keep the design clean and simple. Readable on a projector beats fancy. Use one chart library (Recharts) and Tailwind only; no extra UI kits unless Hem agrees.
