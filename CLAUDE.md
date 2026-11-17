# CLAUDE.md — AI Portfolio Command Centre

Instructions for Claude Code in this repository. Read this whole file before doing anything.

@AGENTS.md

---

## 1. Who am I talking to? (do this first, every session)

This repository is built by a four-person hackathon team. **Every piece of work belongs to one member.** Before writing or changing any file:

1. **Identify the member.** Look for phrases like "I am Hem", "I'm Spoorthy", "This is Seren", "Animesh here".

   | Member | Role | Role file |
   |---|---|---|
   | Hem | Tech Lead + AI/RAG Engineer | [team/hem.md](team/hem.md) |
   | Spoorthy | Data / Portfolio Engineer | [team/spoorthy.md](team/spoorthy.md) |
   | Seren | Frontend Engineer | [team/seren.md](team/seren.md) |
   | Animesh | Reporting + QA Engineer | [team/animesh.md](team/animesh.md) |

   If no name has been given, or the name is not in this table, **ask:** *"Which team member are you: Hem, Spoorthy, Seren or Animesh?"* Do not edit files until you know.
   You may answer general questions about the project before that.

2. **Read** that member's role file in `team/`, then [docs/api-contracts.md](docs/api-contracts.md). Skim [docs/architecture.md](docs/architecture.md) if you have not already.

3. **Inspect the real project state.** Do not trust the checklists alone:
   - `git status`, `git branch --show-current`, `git log --oneline -10`
   - `git fetch` and then `git log --oneline origin/develop -10`, if a remote exists, to see what others have merged
   - List the member's owned folders and see what already exists and whether it works (build, tests).

4. **Work out what is done and what is not.** Compare the role file's *Recommended implementation order* and *Progress checklist* against the actual code. A checklist item is done only if the code exists **and** works. Generated-but-untested code is **not** done.

5. **Give the immediate next task** in plain language:
   - what it is, and why it is needed (what breaks or who is blocked without it)
   - which files it touches (exact paths)
   - the small steps to get there
   - how we will know it works

   Then **implement it**, unless the member asked only for guidance.

6. **Implement in small steps.** After each step, run the relevant build/test command and report the result honestly.

7. **Finish with a short summary:** files changed, what was verified (and how), what is still left, and the suggested commit message. Update the member's *Progress checklist* in their role file only for items that are verified.

Ask clarifying questions **only** when the answer changes what you build (for example an open decision in `docs/api-contracts.md` §8 that blocks this task). Otherwise use the documented PROPOSED default and say so.

---

## 2. Ownership rules (strict)

| Path | Owner |
|---|---|
| `server/src/services/rag/`, `server/src/services/ai/` | Hem |
| `server/src/index.ts`, `server/src/app.ts`, `server/src/routes/`, `server/src/controllers/`, `server/src/config/`, `server/src/types/`, `server/package.json`, `server/tsconfig.json`, `server/.env.example`, `server/storage/`, `.gitignore` | Hem (shared files: coordinated by Hem) |
| `server/src/services/portfolio/`, `data/`, `charters/` | Spoorthy |
| `client/` | Seren |
| `server/src/services/reporting/`, `tests/`, `docs/evaluation.md` | Animesh |
| `CLAUDE.md`, `AGENTS.md`, `docs/architecture.md`, `docs/api-contracts.md`, `docs/team-workflow.md`, `team/TEAM_GUIDE.md` | Hem (anyone may propose changes) |
| `team/<member>.md` | That member (progress checklist), Hem (scope) |

- **Never change files owned by another member** unless that member, or Hem for shared files, has explicitly approved it in this conversation.
- If the current task needs a change outside the member's ownership, **stop and say so**. Write the exact change needed as a message the member can send to the owner (see [team/TEAM_GUIDE.md](team/TEAM_GUIDE.md) §5).
- Reading any file is always fine. Writing is restricted.
- Do not duplicate work. If another member's module already provides something, use its exported service; do not re-implement it.
- While a dependency is not ready, use a **stub or mock inside the member's own folder** that matches `docs/api-contracts.md` exactly.

---

## 3. Project summary

**AI Portfolio Command Centre** is an Enterprise RAG Value Intelligence Assistant. It helps executives understand how AI initiatives are performing. It combines:

- **structured portfolio metrics** (synthetic CSV), which are calculated deterministically
- **unstructured initiative charters** (Markdown), which are retrieved with RAG and cited

The full design is in [docs/architecture.md](docs/architecture.md). **Follow it. Do not change the architecture.** If something seems wrong with it, raise it with Hem instead of working around it.

### Confirmed stack (do not add alternatives)

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript, Tailwind CSS, Recharts (`client/`) |
| Backend | Node.js + Express + TypeScript (`server/`) |
| Data | Synthetic CSV generated by TypeScript scripts; Markdown charters |
| LLM | Claude (`claude-sonnet-5-5`) via the Anthropic API and the official `@anthropic-ai/sdk`; OpenRouter as configured alternative |
| Embeddings | `openai/text-embedding-3-small` via OpenRouter (the Anthropic API has no embeddings endpoint) |
| Vectors | Local JSON vector index |
| VCS | GitHub |

**Never introduce** Python, FastAPI, Pandas, LangChain or LlamaIndex, any external database or hosted vector DB, Docker, microservices, queues, or a second UI framework.

### Backend modules (modular monolith)

| Module | Owner | Does |
|---|---|---|
| Portfolio | Spoorthy | CSV load → validation → normalisation → deterministic metrics → scorecard; data-quality log |
| RAG | Hem | Charters → extraction → chunking → embeddings → JSON vector index → similarity retrieval → evidence with source metadata |
| AI | Hem | Question routing (numerical / narrative / mixed), context assembly, grounded prompts, OpenRouter call, answer and citation validation |
| Reporting | Animesh | Rule-based attention flags; weekly executive brief (narrative via AI module) |

Frontend screens: **Portfolio Overview**, **Portfolio Intelligence Assistant**, **Weekly Executive Brief**.

### Planned layout

```
client/                     React app (Seren)
server/
  src/
    index.ts, app.ts        entry point + Express app (Hem)
    config/                 env loading (Hem)
    routes/, controllers/   HTTP layer, thin (Hem)
    types/contracts.ts      shared types from docs/api-contracts.md (Hem)
    services/
      portfolio/            Spoorthy
      rag/                  Hem
      ai/                   Hem
      reporting/            Animesh
  storage/                  generated vector index (git-ignored)
data/                       CSV + generator script + README (Spoorthy)
charters/                   Markdown charters (Spoorthy)
tests/                      tests + eval set (Animesh)
docs/                       architecture, contracts, workflow
team/                       onboarding guides
```

---

## 4. API contracts

[docs/api-contracts.md](docs/api-contracts.md) is the source of truth for every endpoint, JSON shape, service interface, data file format and environment variable.

- Implement shapes **exactly** as documented: field names, `null` handling, and the `{ ok, data }` / `{ ok, error }` envelope.
- Do not add, rename or remove fields in code first. Contract changes go through Hem and are made in `docs/api-contracts.md` before code changes (§7 of that file).
- Items marked PROPOSED or listed in §8 *Open decisions* may change. Keep them easy to change (one constant, one function).

---

## 5. Working safely with existing code

- Inspect before editing. Read a file before changing it; never overwrite a file you have not read.
- Make the smallest change that completes the task. No drive-by refactors or reformatting of untouched code.
- Do not delete or rename other people's files, tests or docs.
- Do not install a new dependency without stating why, and check that no existing dependency already does the job. Shared `package.json` changes go through Hem.
- **Git:** do not commit, push, merge, rebase, reset or create remotes unless the member explicitly asks. When they ask, follow [docs/team-workflow.md](docs/team-workflow.md): work on their `feature/*` branch and never push to `main` or `develop`.
- Never print, log or commit API keys or the contents of `.env`.
- Report honestly. If a test fails or a step was skipped, say so.

> **Local setup warning:** on Hem's machine this folder sits inside a Git repository rooted at the user's home directory, with an unrelated remote. Before any Git command, check that `git rev-parse --show-toplevel` prints this project's folder. If it does not, stop and tell the member. Do not commit.

---

## 6. Running and testing

> The app has **not been scaffolded yet**. The commands below are the **planned** ones; Hem confirms them when scaffolding. If a command does not exist yet, say so instead of inventing a replacement.

```bash
# Server (http://localhost:3001)
cd server
npm install
cp .env.example .env        # then fill in keys locally
npm run dev

# Client (http://localhost:5173)
cd client
npm install
npm run dev

# Data and index (run from server/)
npm run generate:data       # writes data/*.csv  (Spoorthy's generator)
npm run ingest              # builds server/storage/vector-index.json (Hem's RAG ingestion)

# Checks (run from server/ and client/)
npm run typecheck
npm test                    # unit + integration tests, including tests/
npm run eval                # evaluation question set (Animesh)
```

**Definition of "works":** the relevant `typecheck` and tests pass **and** the endpoint or screen has been exercised once by hand (for example `curl http://localhost:3001/api/health`).

---

## 7. Hackathon priorities (about 6 hours)

1. **Working end-to-end demo beats completeness.** Mock first, then replace mocks with real modules.
2. Numbers must be correct and traceable. A wrong ROI on stage is worse than a missing feature.
3. Every assistant answer shows its sources, or clearly says there is not enough evidence.
4. Keep process light: small PRs, frequent merges into `develop`, a short message to the team when something lands.
