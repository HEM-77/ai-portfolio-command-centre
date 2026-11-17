# Spoorthy — Data / Portfolio Engineer

## 1. Who and what

**Spoorthy**: Data / Portfolio Engineer. Spoorthy produces the data the whole demo stands on, and turns it into trustworthy, deterministic numbers.

## 2. Project objective

Build the **AI Portfolio Command Centre**: an assistant that answers executive questions about AI initiatives. It uses **deterministic scorecard numbers** and **cited evidence from initiative charters**. Every number shown on the dashboard, in the brief or in an assistant answer comes from Spoorthy's Portfolio module. See [docs/architecture.md](../docs/architecture.md).

## 3. What Spoorthy owns

| Path | Notes |
|---|---|
| `server/src/services/portfolio/` | Portfolio module: loading, validation, normalisation, metrics, scorecard, data-quality log |
| `data/` | CSV files, the TypeScript generator script (e.g. `data/scripts/generate.ts`), `data/README.md` |
| `charters/` | Markdown initiative charters |

Spoorthy does **not** edit routes, controllers, config, `package.json` (Hem), `client/` (Seren), `reporting/` or `tests/` (Animesh), or `rag/` / `ai/` (Hem) without the owner's approval.

## 4. Responsibilities

- Design the CSV schema and write it down in `data/README.md`
- Write a **TypeScript** generator that produces realistic synthetic data for about 10–15 initiatives over 6–12 months, with a deliberate mix of good, middling and **negative-ROI** initiatives and a few **deliberately bad rows**
- Write one Markdown charter per initiative in the agreed format, whose *Risks* / *Status Notes* / *Lessons Learned* plausibly **explain** each initiative's performance (this makes the headline demo question work)
- CSV ingestion and parsing
- Row validation (types, required fields, ranges, known IDs, dates), with failures written to the data-quality log, not thrown
- Normalisation (trim, case, enum mapping, date formats)
- Deterministic calculations: ROI, adoption, payback, status and portfolio totals
- Scorecard and `PortfolioService`
- Data-quality report

## 5. Dependencies on others

| Needs | From | Until it arrives |
|---|---|---|
| Server scaffold, `types/contracts.ts`, routes calling `portfolioService` | Hem | Write the module and tests standalone; it only needs the types |
| `npm run generate:data` script entry in `server/package.json` | Hem | Run the generator with `npx tsx data/scripts/generate.ts` |
| Agreement on charter format | Hem | Use [api-contracts.md §5.1](../docs/api-contracts.md#51-charter-files--charters-proposed) as is |
| Agreement on `status` rule and thresholds | Animesh | Use the PROPOSED defaults in api-contracts.md §8 |

**Who depends on Spoorthy (critical path):** Hem's AI module and Animesh's reporting need `PortfolioService`. Seren's dashboard needs the real data. Hem's RAG needs the charters. **Get CSV + charters into `develop` early, even if metrics come later.**

## 6. Inputs and outputs

| Inputs | Outputs |
|---|---|
| Generator settings (seed, number of initiatives, months) | `data/initiatives.csv`, `data/monthly_metrics.csv` |
| — | `charters/INIT-xxx-<slug>.md` (one per initiative) |
| CSV files | `Scorecard` (`PortfolioSummary` + `InitiativeMetrics[]`) |
| CSV files | `DataQualityReport` |

Use a **fixed random seed** so everyone gets the same numbers every run, and the demo is repeatable.

## 7. Contracts to follow

- `PortfolioService` in [api-contracts.md §4](../docs/api-contracts.md#4-service-level-contracts-inside-the-server)
- `InitiativeMetrics`, `PortfolioSummary`, `Scorecard`, `DataQualityIssue`, `DataQualityReport` in §2
- Response bodies of `/api/portfolio/summary`, `/initiatives`, `/quality` in §3.2–3.4
- Charter format §5.1 and CSV files §5.2
- Ratios as decimals, unknown values as `null`, never `0` for "unknown"

## 8. Recommended implementation order

1. **CSV schema** in `data/README.md` (15 min). Confirm formulas in api-contracts.md §8 (#2, #3).
2. **Generator** (`feature/spoorthy-synthetic-data`): seeded TypeScript script → both CSVs. Include 3+ negative-ROI initiatives and 3–5 bad rows. Merge early.
3. **Charters** (`feature/spoorthy-charters`): one per initiative, matching front matter and headings. The negative-ROI ones must contain concrete reasons. Merge early, because Hem's ingestion needs them.
4. **Portfolio module** (`feature/spoorthy-portfolio-metrics`):
   1. CSV loader
   2. validation + data-quality log
   3. normalisation
   4. pure metric functions (`calculateRoi`, `calculateAdoption`, `calculatePayback`, `deriveStatus`)
   5. scorecard + summary aggregation
   6. `PortfolioService` exported from `index.ts`
5. Ask Hem to wire `portfolioService` into the three portfolio routes → **Checkpoint 2**.
6. Help Animesh check metric test expectations; fix any data issues found in evaluation.

## 9. Testing requirements

- Each metric function has unit tests with **hand-calculated** expected values: normal case, zero spend (`roi: null`), missing month, never pays back (`paybackMonths: null`), adoption above 1 (flagged).
- Validation tests: each deliberately bad row ends up in the data-quality log with the right `action`.
- Scorecard test: totals equal the sum of the initiatives; `negativeRoiCount` is correct.
- Determinism: running the generator twice with the same seed gives identical files.
- Run: `npm run typecheck` and `npm test` (from `server/`).

## 10. Branch naming

`feature/spoorthy-<topic>`, e.g. `feature/spoorthy-synthetic-data`, `feature/spoorthy-charters`, `feature/spoorthy-portfolio-metrics`.

## 11. Definition of done

- [ ] `data/README.md` documents columns and formulas
- [ ] Generator is deterministic and produces both CSVs, including bad rows
- [ ] One charter per initiative, correct format, with real reasons for underperformers
- [ ] `PortfolioService` matches the contract exactly
- [ ] All metric and validation tests pass
- [ ] `/api/portfolio/summary`, `/initiatives`, `/quality` return real data (after Hem wires them)
- [ ] Numbers on the dashboard match a hand check of at least two initiatives

## Progress checklist

> Tick only what is merged **and** verified. Claude checks this against the code.

- [ ] CSV schema + `data/README.md`
- [ ] Synthetic data generator
- [ ] Charters
- [ ] CSV loader
- [ ] Validation + data-quality log
- [ ] Normalisation
- [ ] Metric functions + tests
- [ ] Scorecard + `PortfolioService`
- [ ] Wired into endpoints (with Hem)

---

## How Claude should assist this member

When the user says **"I am Spoorthy"**:

1. **Confirm the identity** and read `CLAUDE.md`, this file and `docs/api-contracts.md`.
2. **Inspect the project state:** `git status`, current branch, and what exists in `data/`, `charters/` and `server/src/services/portfolio/`. Check whether the server scaffold from Hem has landed on `develop`.
3. **Compare** the *Recommended implementation order* and *Progress checklist* with reality. Code that exists but has not been run or tested is not done.
4. **Explain the next task simply:** what it is, and why it matters. For example: "Hem cannot build the RAG index until charters exist, so charters come before metrics."
5. **Break it into small steps** and implement them one at a time, only inside `data/`, `charters/` and `server/src/services/portfolio/`.
6. **Explain why** each piece of code exists. For every metric, show the formula and a worked example with real numbers from the CSV.
7. **Run** the generator, typecheck and tests after each step, and show the results.
8. **Summarise:** changed files, what was verified and how, remaining work, a suggested commit message, and any **Landed** or **Need** message. A typical Need goes to Hem, for wiring a route or adding a script to `package.json`.
9. **Never assume a task is complete** just because code was generated.

Spoorthy-specific notes:

- **No invented numbers anywhere else.** If a teammate needs a number, it must come from `PortfolioService`.
- Charters must not contain scorecard figures that could contradict the CSV. They explain *why*, not *how much*.
- If a formula or threshold is still an open decision, use the PROPOSED default from api-contracts.md §8, keep it in one named constant, and tell Spoorthy that's what was done.
- If a route or `package.json` change is needed, draft the Need message to Hem instead of editing those files.
