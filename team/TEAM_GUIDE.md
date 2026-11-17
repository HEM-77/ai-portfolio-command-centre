# Team Guide — AI Portfolio Command Centre

Start here. This page explains who does what, how to begin, and how to work with Claude Code without stepping on each other.

---

## 1. Team and responsibilities

| Member | Role | Owns | Builds |
|---|---|---|---|
| **Hem** | Tech Lead + AI/RAG Engineer | `server/src/services/rag/`, `server/src/services/ai/`, plus shared server files (entry point, routes, controllers, config, types) | Server scaffold, charter ingestion, embeddings, JSON vector index, retrieval, question routing, OpenRouter, grounded answers, citation validation, integration |
| **Spoorthy** | Data / Portfolio Engineer | `server/src/services/portfolio/`, `data/`, `charters/` | Synthetic CSV + generator, charters, CSV ingestion, validation, normalisation, ROI / adoption / payback, scorecard, data-quality log |
| **Seren** | Frontend Engineer | `client/` | React app: Portfolio Overview (KPIs, charts, table), Assistant screen, Weekly Brief screen, API integration |
| **Animesh** | Reporting + QA Engineer | `server/src/services/reporting/`, `tests/`, `docs/evaluation.md` | Attention flags, weekly brief, evaluation question set, tests for metrics / retrieval / citations / fallback / prompt injection, demo support |

Personal guides: [hem.md](hem.md) · [spoorthy.md](spoorthy.md) · [seren.md](seren.md) · [animesh.md](animesh.md)

Shared reading (15 minutes, before writing code):

1. [docs/architecture.md](../docs/architecture.md): what we are building
2. [docs/api-contracts.md](../docs/api-contracts.md): the shapes everyone builds against
3. [docs/team-workflow.md](../docs/team-workflow.md): branches and PRs
4. Your own file in `team/`

## 2. How to start working

1. Clone the repo and switch to `develop` (see [team-workflow.md §3](../docs/team-workflow.md#3-one-time-setup-hem-before-the-build-starts)).
2. Open the folder in VS Code and start Claude Code in the **repository root**, the folder that contains `CLAUDE.md`. Claude reads `CLAUDE.md` automatically.
3. Introduce yourself (next section).
4. Let Claude tell you your next task, then create your feature branch and build.

## 3. Identifying yourself to Claude Code

Your **first message in every new Claude Code session** should say who you are:

> I am Spoorthy. How should I move forward?

Claude will then:

1. read `CLAUDE.md` and your `team/<name>.md`
2. check Git status and what already exists in your folders
3. tell you what is done, what is not, and your **next task**, with the reason
4. break it into small steps, implement them in your folders only, and run the tests
5. summarise changed files and remaining work

Other useful messages:

- "I am Seren. Spoorthy's portfolio endpoints are merged. What should I change?"
- "I am Animesh. Just explain my next task; don't write code yet."
- "I am Hem. Review the PR from feature/spoorthy-portfolio-metrics against the contract."

If you forget to say who you are, Claude will ask before editing anything.

## 4. Feature branches

Always work on your own branch, created from the latest `develop`:

```bash
git checkout develop
git pull origin develop
git checkout -b feature/<yourname>-<topic>      # e.g. feature/seren-overview
```

Open PRs into **`develop`**. Never push directly to `main` or `develop`. Full details are in [team-workflow.md](../docs/team-workflow.md).

## 5. Communicating with other members

Use the team chat. Keep messages short and specific. Three message types cover almost everything:

**Landed:** when your PR merges

> ✅ Landed: `GET /api/portfolio/summary` returns real data on develop. Seren, you can switch the KPI cards off mocks.

**Need:** when you need something from another member's files

> 🔧 Need (Spoorthy → Hem): please add route `GET /api/portfolio/initiatives?status=` to `routes/portfolio.ts`, calling `portfolioService.getInitiatives({ status })`. Contract §3.3 already covers it.

**Blocked:** when you cannot continue

> ⛔ Blocked (Seren): `/api/assistant/ask` returns `citations` as strings, but the contract says objects. Hem, which is right?

Claude can draft these for you: "Write a Need message to Hem for this change."

## 6. Requesting integration

1. Your code typechecks, your tests pass, and you tried it by hand.
2. Merge the latest `develop` into your branch and re-test.
3. Open a PR to `develop` using the template in [team-workflow.md §4](../docs/team-workflow.md#open-a-pull-request).
4. Post a **Landed** message once Hem merges it.

Hem runs the integration checkpoints (about hours 1, 3 and 4.5) and merges `develop` → `main` when everything works together.

## 7. Not editing other members' files

- Your owned folders are listed in §1 and in your role file. **Only change those.**
- Need a change elsewhere? Send a **Need** message to the owner. Shared server files (routes, controllers, config, `package.json`, types) go to **Hem**.
- Waiting on someone? Build against a **mock in your own folder** that matches `docs/api-contracts.md`, then swap it for the real thing later.
- Before committing, run `git status` and make sure every changed file is yours.
- Claude enforces this. If it says a change is outside your ownership, it is not being difficult; send the Need message.

## 8. Running the application and tests

> Planned commands. They work once Hem has scaffolded `server/` and Seren has scaffolded `client/`.

```bash
# Terminal 1: server, http://localhost:3001
cd server && npm install && cp .env.example .env && npm run dev

# Terminal 2: client, http://localhost:5173
cd client && npm install && npm run dev

# Data and charter index (from server/)
npm run generate:data
npm run ingest

# Checks
npm run typecheck
npm test
npm run eval

# Quick check that the server is up
curl http://localhost:3001/api/health
```

API keys: ask Hem for the OpenRouter and embedding keys and put them in **your local** `server/.env`. Never commit them or paste them in chat.

## 9. Timeline (about 6 hours)

| Time | Everyone is aiming for |
|---|---|
| 0:00–0:15 | Read docs. Hem confirms open decisions in `docs/api-contracts.md` §8. |
| 0:15–1:00 | Hem: server scaffold + mock endpoints. Spoorthy: CSV schema + generator. Seren: client shell with mocks. Animesh: evaluation questions. |
| **1:00** | **Checkpoint 1:** client shows mock data from the real server |
| 1:00–3:00 | Real modules: portfolio metrics, RAG ingestion, dashboard, attention flags |
| **3:00** | **Checkpoint 2:** dashboard shows real portfolio data |
| 3:00–4:30 | Assistant end to end, weekly brief, tests |
| **4:30** | **Checkpoint 3:** assistant answers with citations; brief renders |
| 4:30–5:00 | Fix bugs found by tests and evaluation |
| **5:00** | **Feature freeze** |
| 5:00–6:00 | Demo script, rehearsal, final fixes |

## 10. Expected final deliverable

A working, locally running app on `main` that lets an executive:

1. see the **Portfolio Overview**: KPI cards, charts and an initiative table from deterministic calculations, plus a data-quality summary
2. ask the **Portfolio Intelligence Assistant** numerical, narrative and mixed questions, and get answers with scorecard figures and charter citations, or an honest "not enough evidence"
3. read the **Weekly Executive Brief**: attention flags plus a short narrative

It must also have:

- passing tests for metrics, retrieval, citations, missing-evidence fallback and prompt injection
- an evaluation report in `docs/evaluation.md`
- the architecture docs and diagrams for the presentation
- a 5-minute demo script with the headline question: *"Which initiatives have negative ROI, and what are the reasons behind their performance?"*
