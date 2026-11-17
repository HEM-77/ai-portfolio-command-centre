# Hem — Tech Lead + AI/RAG Engineer

## 1. Who and what

**Hem**: Tech Lead and AI/RAG Engineer. Hem builds the retrieval and question-answering core, owns the shared server files, and keeps the four modules fitting together.

## 2. Project objective

Build the **AI Portfolio Command Centre**: an assistant that answers executive questions about AI initiatives. It uses **deterministic scorecard numbers** and **cited evidence from initiative charters**, and never invents either. See [docs/architecture.md](../docs/architecture.md).

## 3. What Hem owns

| Path | Notes |
|---|---|
| `server/src/services/rag/` | RAG module |
| `server/src/services/ai/` | AI module |
| `server/src/index.ts`, `server/src/app.ts` | Entry point, Express app, error middleware |
| `server/src/routes/`, `server/src/controllers/` | Thin HTTP layer for **all** endpoints |
| `server/src/config/` | Typed env loading |
| `server/src/types/contracts.ts` | Shared types from the contract |
| `server/package.json`, `server/tsconfig.json`, `server/.env.example`, `.gitignore` | Shared config |
| `server/storage/` | Generated vector index (git-ignored) |
| `CLAUDE.md`, `AGENTS.md`, `docs/*.md` (except `docs/evaluation.md`), `team/TEAM_GUIDE.md` | Project docs |

Hem does **not** edit `server/src/services/portfolio/`, `data/`, `charters/`, `client/`, `server/src/services/reporting/` or `tests/` without the owner's approval.

## 4. Responsibilities

- Repository setup: GitHub repo, `develop` branch, branch protection, `.gitignore` (see [team-workflow.md §3](../docs/team-workflow.md#3-one-time-setup-hem-before-the-build-starts))
- Server scaffold with mock endpoints that match the contract, so everyone can start
- Markdown charter ingestion: front matter, text extraction, chunking by `##` section
- Embedding generation through the verified embedding provider
- Local JSON vector index: build, save, load
- Similarity retrieval (cosine, top-k, optional initiative filter, minimum score)
- Question classification: numerical / narrative / mixed
- OpenRouter integration (timeout, error mapping)
- Grounded prompt construction (scorecard values + evidence, untrusted text clearly delimited)
- Answer validation (numbers match `figures`, `[Cn]` match citations) and the code-built fallback
- `generateNarrative()` for the Reporting module
- Integration coordination: contract owner, PR merges, checkpoints

## 5. Dependencies on others

| Needs | From | Until it arrives |
|---|---|---|
| `PortfolioService` (`getScorecard`, `getInitiatives`, …) | Spoorthy | Stub in `services/ai/` returning contract-shaped sample data |
| Charter files in `charters/` with front matter | Spoorthy | 2–3 throwaway test charters under `server/src/services/rag/__fixtures__/` |
| Evaluation questions + injection cases | Animesh | Use the headline negative-ROI question |
| Feedback on how answers render | Seren | — |

**Who depends on Hem:** everyone needs the scaffold and mock routes first. Seren needs `/api/assistant/ask`. Animesh needs `generateNarrative()`.

## 6. Inputs and outputs

| Inputs | Outputs |
|---|---|
| `charters/*.md` | `server/storage/vector-index.json` (chunks + vectors + metadata) |
| User question (+ optional `initiativeIds`) | `AskResult` (answer, `questionType`, `figures`, `citations`, `validation`) |
| `PortfolioService` scorecard | Grounded prompts to OpenRouter |
| `PortfolioSummary` + `AttentionFlag[]` | Weekly-brief narrative |
| Env: `OPENROUTER_*`, `EMBEDDING_*` | `/api/health` readiness checks |

## 7. Contracts to follow

- `RagService` and `AiService` in [api-contracts.md §4](../docs/api-contracts.md#4-service-level-contracts-inside-the-server)
- `POST /api/assistant/ask` and `GET /api/health` in §3
- All six routes + envelope + error codes (Hem's HTTP layer serves everyone's services)
- Charter format in §5.1 (agree it with Spoorthy early)
- Env variable names in §6

## 8. Recommended implementation order

1. **Confirm open decisions** in api-contracts.md §8 with the team (10 min). Verify the embedding provider with one test call.
2. **Repo setup** (`feature/hem-scaffold`): standalone repo, `main` + `develop`, `.gitignore`, protection.
3. **Server scaffold:** Express + TS, `config/`, `types/contracts.ts`, error middleware, all six routes returning **contract-example mock data**, `/api/health`. Merge quickly → **Checkpoint 1**.
4. **RAG ingestion** (`feature/hem-rag-ingestion`): read charters, parse front matter, chunk by section, embed, write JSON index; `npm run ingest`.
5. **RAG retrieval** (`feature/hem-rag-retrieval`): load index, embed query, cosine top-k with initiative filter; run the latency feasibility check.
6. **AI module** (`feature/hem-ai-assistant`): rule-based router → context from Portfolio/RAG → prompt → OpenRouter → validation → fallback / `insufficient_evidence`.
7. **Wire real services** into controllers as each module lands (replace mocks).
8. `generateNarrative()` for Reporting → **Checkpoint 3**.
9. Merge `develop` → `main` at each checkpoint; support the demo.

## 9. Testing requirements

- Chunker: correct sections and metadata from a fixture charter
- Cosine similarity: known vectors give the expected order
- Retrieval: initiative filter works; returns `[]` below `minScore`
- Router: sample numerical / narrative / mixed questions classified correctly
- Validation: an answer containing a number not in `figures` is marked `unverified`; an unknown `[C9]` is caught
- No-evidence question → `insufficient_evidence`, no LLM guess
- All tests stub OpenRouter and embeddings. Only `npm run eval` uses real keys.
- Coordinate with Animesh: Hem writes unit tests next to the module **or** in `tests/` as Animesh prefers. Animesh owns the integration and evaluation tests.

## 10. Branch naming

`feature/hem-<topic>`, e.g. `feature/hem-scaffold`, `feature/hem-rag-ingestion`, `feature/hem-rag-retrieval`, `feature/hem-ai-assistant`.

## 11. Definition of done

- [ ] All six endpoints return contract-shaped JSON from **real** services
- [ ] `npm run ingest` builds the index from `charters/`; retrieval is fast enough (feasibility check recorded)
- [ ] The headline mixed question returns correct negative-ROI initiatives with valid citations
- [ ] Wrong numbers or fake citations in an LLM draft are caught and marked `unverified`
- [ ] App still works (dashboard + flags) with no OpenRouter key
- [ ] Typecheck and tests pass; no secrets in the repo
- [ ] `main` holds the demo-ready build

## Progress checklist

> Tick only what is merged **and** verified. Claude checks this against the code.

- [x] Architecture docs and diagrams
- [x] Team onboarding docs
- [ ] Open decisions confirmed
- [ ] GitHub repo + `develop` + protection
- [ ] Server scaffold with mock endpoints
- [ ] RAG ingestion
- [ ] RAG retrieval + feasibility check
- [ ] Question router
- [ ] OpenRouter + grounded prompts
- [ ] Answer validation + fallback
- [ ] `generateNarrative()`
- [ ] Real services wired into all endpoints

---

## How Claude should assist this member

When the user says **"I am Hem"**:

1. **Confirm the identity** and read `CLAUDE.md`, this file and `docs/api-contracts.md`.
2. **Inspect the project state.** Run `git rev-parse --show-toplevel` first: this project must be its own repository, not the home-folder repo. Then run `git status` and the current branch. Check what exists in `server/`, the RAG and AI folders, and what others have merged into `develop`.
3. **Compare** the *Recommended implementation order* and *Progress checklist* with reality. Code that exists but has not been run or tested is not done.
4. **Explain the next task simply:** what it is, why it is needed (Hem's scaffold and mock routes unblock all three teammates, so they come first), and which files it touches.
5. **Break it into small steps** and implement them one at a time, inside Hem's owned paths only.
6. **Explain why** each piece of code exists, especially validation and fallback logic, because Hem will present it.
7. **Run** typecheck and the relevant tests after each step; hit the endpoint with `curl` where possible.
8. **Summarise:** changed files, what was verified and how, remaining work, a suggested commit message, and any **Landed** or **Need** message for the team.
9. **Never assume a task is complete** just because code was generated.

Hem-specific notes:

- As Tech Lead, Hem may ask Claude to **review** teammates' PRs. Review against the contract and ownership rules, but do not edit their files.
- When a teammate needs a shared-file change (route, config, `package.json`), Hem decides. Claude implements it only when Hem asks.
- Contract changes: update `docs/api-contracts.md` first, then code, and remind Hem to tell affected members.
- Prefer a working rule-based router and simple cosine search over clever approaches. Time is short.
