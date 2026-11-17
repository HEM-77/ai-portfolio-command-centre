# Evaluation

## Current state

The checkout initially contains documentation only. There is no `server/package.json`,
shared contracts file, Portfolio/AI/RAG service, CSV data, charter corpus, or running API.
Reporting and application integration are blocked on those dependencies. No application
accuracy, retrieval, injection-resistance, or endpoint pass rate is claimed.

The initial deliverable is 20 evaluation questions, a live evaluation runner, evaluator
unit tests, and an isolated malicious charter fixture. All implementation is in Animesh's
owned paths. The role checklist remains unchecked because nothing has been merged.

## Commands

From the repository root, using Node's native TypeScript support (verified on Node 26):

```powershell
node --test tests/eval/check-answer.test.ts
node tests/eval/run-eval.ts --check
node tests/eval/run-eval.ts
node tests/eval/run-eval.ts --live
```

`--check` validates the manifest without writing results. The default run records SKIP
for every question and makes no network calls. `--live` explicitly enables calls to
`http://localhost:3001/api`. It first checks health; missing credentials or unavailable
dependencies produce an explicit SKIP. It never reads or prints keys. Each request has
a timeout. A baseline or case failure sets a nonzero exit code. Results below are replaced
by each run; no raw model responses or secrets are written to this report.

Hem must supply the documented `npm run typecheck`, `npm test`, and `npm run eval`
scripts. No package files were created on Hem's behalf. On this Windows machine use
`npm.cmd` if PowerShell blocks the `npm.ps1` wrapper.

Verification on this checkout:

- `node --test tests/eval/check-answer.test.ts`: 12 passed, 0 failed.
- `node tests/eval/run-eval.ts --check`: all 20 cases validated.
- Default execution: all live cases SKIP without API calls.
- `--live`: all cases SKIP because the local API is unavailable.
- Typechecking is not verified: there is no installed TypeScript compiler or server
  package. `node --check` rejected TypeScript annotations; native execution and the tests
  passed, but those commands do not replace static typechecking.
- Remote dependency state is unverified: the fetch did not complete and was interrupted;
  `origin/develop` is not available locally. No merge, commit, or push was performed.

## Method and expected results

The manifest covers the headline question, numerical, narrative, mixed, three missing-
evidence questions, and four question injection attempts. Expected figures are selected
from the live scorecard: portfolio totals, every negative-ROI initiative, or every
initiative below the proposed adoption threshold. No unverified initiative values or
charter filenames are invented. Exact initiative IDs, hand-calculated CSV figures, and
expected top-k sources must be pinned once Spoorthy's data and charters land.

The evaluator checks question type, validation status, required figures, exact equality
of returned figures to the scorecard, missing-evidence status, injection markers, citation
IDs, and excerpts within the named section of the correct charter. It rejects unknown
numeric metric fields, missing requested figures, fabricated sources, dangling citations,
duplicate IDs, and empty answers. Charter reads reject path traversal and symlink escapes.

Evaluator tests deliberately submit incorrect responses to prove these checks can fail.
They are tests of the evaluation tool, not tests of the future application. The isolated
fixture `tests/fixtures/charters/INIT-003-injection.md` must never be copied into `charters/`
or the demo index. A future stubbed RAG/AI test must retrieve it and assert the injected
instructions are ignored; merely adding this file does not establish injection resistance.

## Limits and remaining acceptance checks

- Matching figures to the API scorecard establishes consistency, not CSV metric accuracy.
  Add independent hand calculations from real CSV rows for zero spend, negative values,
  missing months, adoption, payback, totals, and status thresholds.
- The runner checks numeric tokens against figures, including rounded ratio percentages.
  It does not parse spelled-out numbers or prove that a number is used in the correct
  semantic context, that prose claims follow from citations, or that a quoted charter was
  among retrieved chunks. These need
  AI validation tests, retrieval top-k tests with stub embeddings, and human review.
- A PASS is an automated consistency result only. Narratives require semantic review;
  do not present these checks as complete groundedness verification.
- The full six-endpoint success/error contract suite remains pending the Express app.
- Reporting needs shared types and exported service interfaces. A scorecard contains
  no spend-history duration, so `paybackMonths: null` alone cannot establish the proposed
  “after 12 months of spend” flag. Need a contract decision from Hem and Spoorthy;
  do not substitute calendar time or silently flag every null payback.
- The proposed data-quality flag says “any error,” but scorecard rows only expose issue
  counts without severity. Need agreement on whether all issues trigger it or the
  Portfolio quality report must be consulted.
- No live demo rehearsal or screenshots are possible until the app is available.

## Owner handoff drafts

**Need — Hem:** Add `server/src/types/contracts.ts` and exported Portfolio/AI interfaces
from contract §4, then wire `/api/reports/weekly` after ReportingService exists. Add the
three package scripts above; the evaluation entry point is `../tests/eval/run-eval.ts --live`
relative to `server/`. Select the shared test runner and include repository-level tests.
Agree how Reporting receives spend duration and severity information for the two rules.

**Need — Spoorthy:** Supply CSVs, charter corpus, documented payback semantics, and the
Portfolio service. Then pin evaluation expectations to actual initiative IDs, charter
sources, and hand-calculated numeric values. No metric results are available to verify yet.

## Demo rehearsal plan (not yet performed)

1. Open health and show readiness checks without exposing keys.
2. Compare overview totals with independent CSV hand checks.
3. Ask the headline question; inspect negative-ROI figures and open each cited source.
4. Ask a missing-evidence question and show `insufficient_evidence`.
5. Try a question injection; verify the figures and citations remain grounded.
6. Open Weekly Brief with the AI service available, then with a stubbed unavailable
   narrative; confirm summary and flags still render. Capture backup screenshots from
   actual verified screens when they exist.

## Latest automated evaluation

<!-- evaluation-results:start -->

Run: 2026-11-17T08:14:22.082Z

| Case | Result | Notes |
|---|---|---|
| headline | SKIP | Local API is unavailable or its health response is invalid. |
| total-spend | SKIP | Local API is unavailable or its health response is invalid. |
| total-value | SKIP | Local API is unavailable or its health response is invalid. |
| portfolio-roi | SKIP | Local API is unavailable or its health response is invalid. |
| average-adoption | SKIP | Local API is unavailable or its health response is invalid. |
| initiative-count | SKIP | Local API is unavailable or its health response is invalid. |
| negative-count | SKIP | Local API is unavailable or its health response is invalid. |
| negative-list | SKIP | Local API is unavailable or its health response is invalid. |
| objectives | SKIP | Local API is unavailable or its health response is invalid. |
| risks | SKIP | Local API is unavailable or its health response is invalid. |
| lessons | SKIP | Local API is unavailable or its health response is invalid. |
| scope | SKIP | Local API is unavailable or its health response is invalid. |
| adoption-reasons | SKIP | Local API is unavailable or its health response is invalid. |
| missing-market | SKIP | Local API is unavailable or its health response is invalid. |
| missing-forecast | SKIP | Local API is unavailable or its health response is invalid. |
| missing-personal | SKIP | Local API is unavailable or its health response is invalid. |
| inject-roi | SKIP | Local API is unavailable or its health response is invalid. |
| inject-system | SKIP | Local API is unavailable or its health response is invalid. |
| inject-citation | SKIP | Local API is unavailable or its health response is invalid. |
| inject-policy | SKIP | Local API is unavailable or its health response is invalid. |

<!-- evaluation-results:end -->
