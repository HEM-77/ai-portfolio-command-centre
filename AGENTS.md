# AGENTS.md — Development Rules

General coding rules for everyone, human or AI assistant, working in this repository.
Project context, ownership and onboarding are in [CLAUDE.md](CLAUDE.md). Interfaces are in [docs/api-contracts.md](docs/api-contracts.md).

---

## 1. Non-negotiables

1. **No hardcoded API keys or secrets.** Keys come from environment variables only. Never commit `.env`. Never log keys.
2. **No invented data.** Metrics come from `data/*.csv` via the Portfolio module. Explanations come from `charters/*.md` via the RAG module. If neither has the answer, say so (`insufficient_evidence`). Never fill gaps with plausible-looking numbers or text, in code, fixtures shown in the demo, or LLM prompts.
3. **The LLM never calculates.** ROI, adoption, payback, totals, averages, rankings and flag thresholds are computed in TypeScript. The LLM only explains values it is given, and the AI module checks that every number in its answer matches the scorecard.
4. **Modules talk only through exported service interfaces.** Import from `services/<module>/index.ts`, never from another module's internal files.
5. **No unnecessary dependencies.** Prefer the standard library and what is already installed. No Python, no extra frameworks, no external databases.
6. **Follow the architecture and the contracts.** Do not redesign. Raise concerns with Hem.

---

## 2. TypeScript conventions

- `"strict": true`. Do not turn strict checks off to make an error go away.
- No `any`. Use `unknown` and narrow it, or define a type. `as` casts only after validation.
- Shared contract types come from `server/src/types/contracts.ts`. Do not redefine them in a module.
- Prefer `type`/`interface` + plain functions. Use classes only where they clearly help (e.g. a service holding loaded state).
- Use `async`/`await`, not `.then()` chains. Always `await` or return a promise; no floating promises.
- Use `const` by default; `let` only when reassigned.
- Keep functions small and pure where possible, especially calculations, so they are easy to unit test.
- ES modules (`import`/`export`). Use named exports; avoid default exports.
- Comments explain **why**, not what. Document every metric formula next to its function.

## 3. Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Files | `kebab-case.ts` | `vector-index.ts`, `calculate-roi.ts` |
| React components | `PascalCase.tsx` | `KpiCard.tsx` |
| Types / interfaces | `PascalCase` | `InitiativeMetrics` |
| Functions, variables | `camelCase` | `calculateRoi`, `topK` |
| Constants | `UPPER_SNAKE_CASE` | `LOW_ADOPTION_THRESHOLD` |
| JSON fields | `camelCase` | `spendToDate` |
| CSV columns | `snake_case` | `value_realised` |
| Env variables | `UPPER_SNAKE_CASE` | `OPENROUTER_API_KEY` |
| Tests | `<name>.test.ts` | `calculate-roi.test.ts` |
| Branches | `feature/<member>-<topic>` | `feature/spoorthy-portfolio-metrics` |

## 4. Error handling

- Validate at the edges (HTTP input, CSV rows, env vars, LLM output). Inside modules, trust typed data.
- Throw typed errors from services. Suggested: `AppError` with a `code` matching the API error codes (`VALIDATION_ERROR`, `NOT_FOUND`, `UPSTREAM_ERROR`, `NOT_READY`, `INTERNAL_ERROR`), defined once by Hem in `server/src/types/`.
- A single Express error middleware (Hem) turns errors into the `{ ok: false, error }` envelope. Controllers do not build error JSON by hand.
- **Never swallow errors silently.** If you catch, either recover meaningfully (and log) or rethrow.
- External calls (OpenRouter, embeddings) need a timeout and a clear `UPSTREAM_ERROR`. The UI must stay usable when the LLM is down: scorecard and flags still work.
- "No results" is not an error. `retrieve()` returns `[]`; the assistant returns `insufficient_evidence`.
- Bad CSV rows are **logged to the data-quality log**, not thrown. The server must start even with some bad rows.
- Error messages sent to the client must not contain stack traces, file system paths or secrets.

## 5. API response conventions

- Always use the envelope: `{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "code", "message" } }`.
- `camelCase` fields, ISO dates, ratios as decimals (`0.42`), unknown values as `null`.
- Use HTTP status codes as listed in [docs/api-contracts.md](docs/api-contracts.md) §1.
- Controllers are thin: validate input → call one service method → wrap result. No business logic in routes or controllers.
- Response shapes must match the contract exactly. Changing a shape means changing the contract first.

## 6. Environment variables

- Load once in `server/src/config/` (Hem) and export a typed `config` object. Other code imports `config`; it does not read `process.env` directly.
- Fail fast with a clear message on startup if a **required** variable is missing. AI/embedding keys may be optional at startup so the dashboard still works; `/api/health` reports them as not configured.
- `server/.env.example` lists every variable with an empty value and a comment. Keep it in sync when adding a variable (via Hem).
- Client variables must start with `VITE_` and must never contain secrets. The client never talks to OpenRouter directly.

## 7. Input validation

- Validate every request body and query parameter in the controller before calling a service (types, required fields, lengths, allowed enum values, known initiative IDs).
- Validate every CSV row (required fields, types, ranges, known IDs, dates) in the Portfolio module, and record failures in the data-quality log.
- Validate LLM output in the AI module: numbers must match `figures`, citations must match retrieved evidence. If not, use the code-built fallback and mark the answer `unverified`.
- Treat charter text and user questions as **untrusted data**. Put them in clearly delimited sections of the prompt. Never let them change system instructions (see prompt-injection tests in `tests/`).
- Hand-written validation is fine. Add a validation library only if Hem agrees it saves time.

## 8. Testing

- Every metric formula has a unit test with hand-calculated expected values, including edge cases (zero spend, missing month, negative values).
- Every endpoint has at least one test for its success shape and one for an error.
- Tests do not call real OpenRouter or embedding APIs. Use stubs. The evaluation script (`npm run eval`) is the only thing that may use real APIs, and only when keys are present.
- A task is not done until its tests pass locally.

## 9. Git hygiene

- Work on your own `feature/*` branch. PRs target `develop`. See [docs/team-workflow.md](docs/team-workflow.md).
- Small commits with clear messages: `portfolio: add ROI calculation and tests`.
- Never commit `.env`, `node_modules/`, `server/storage/` or build output.
