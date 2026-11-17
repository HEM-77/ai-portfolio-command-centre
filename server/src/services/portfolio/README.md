# Portfolio module (planned)

**Owner:** Spoorthy. **Status:** not implemented yet. This README is the specification for the TypeScript
`PortfolioService`. Until it exists, the server uses `src/mocks/mock-portfolio-service.ts`.

## Contract

Implements `PortfolioService` from `src/types/contracts.ts` (contract §4). Import types from there; do not copy them.

```ts
load(): Promise<void>;                 // read + validate + normalise + calculate, once at startup
isReady(): boolean;
getScorecard(): Scorecard;
getSummary(): PortfolioSummary;
getInitiatives(filter?: InitiativeFilter): InitiativeMetrics[];   // filter + sort
getInitiative(initiativeId: string): InitiativeMetrics | undefined;
getQualityReport(): DataQualityReport;
```

`getInitiatives` sorting: default `initiativeId` ascending, `null` values **last in both orders**,
ties broken by `initiativeId` (same behaviour as the mock, which the route tests use).

## Input

The official Nimbus raw tables (`initiatives`, `weekly_usage`, `cost_benefit`, `fx_rates`); see
`data/README.md` and contract §5. Where they are read from is contract §8 #12.
**No Python.** `data/spoorthi.py` and its outputs are a reference for checking results, not an input.

## Processing (port of the reference rules in `data/spoorthi.py`)

Every repair or exclusion adds a `DataQualityIssue` (with `action` `repaired`, `rejected` or `flagged`). Bad rows are logged, never thrown.

1. **IDs:** trim, uppercase, insert the hyphen (`nmb001` -> `NMB-001`). Rows whose ID is not in `initiatives` are rejected (orphans).
2. **Dates and periods:** parse every observed format to an ISO date / `YYYY-MM`. Quarter ranges cover their 3 months.
3. **Aliases:** map usage metric names and financial measure names to canonical ones (contract §5.3). An unknown alias is an error.
4. **Values:** strip `$`, `,` and `%`. Convert to USD with `fx_rates` (`EUR` x 1.08, `USD thousands` x 1000).
5. **Duplicates:** drop exact duplicates. Conflicting duplicates are an error.
6. **Usage:**
   - Forward-fill a missing licence count from the prior week.
   - Convert an adoption % to WAU (% x licensed / 100).
   - A WAU above licensed users is treated as a 10x digit slip and divided by 10.
   - Each initiative must have the 3 reporting weeks.
7. **Financials:**
   - Keep actuals through 2026-10; drop forecasts.
   - A negative cost is corrected to its absolute value.
   - Cumulative snapshots: use the latest, never sum.
   - Missing months inside a monthly running-cost span: fill with that initiative's median monthly cost, and log it.
8. **Months live:** derived from `go_live_date` to 2026-11-01. A conflicting `months_live_reported` is flagged.

## Calculations

Pure functions, each with unit tests using hand-calculated values. Formulas, status mapping and
null rules are in contract §5.4. In short:

- `roi = (value - spend) / spend` (null if spend is 0)
- `adoptionRate = latest WAU / latest licensed users`
- `paybackMonths = spend / (value / monthsLive)` (null if no benefit)
- `status`: Red (`off_track`) if adoption < 0.30 or ROI < 0; Green (`on_track`) if adoption >= 0.60 and ROI > 0; else Amber (`at_risk`)

Check the TypeScript results against `data/outputs_spoorthi/governed_scorecard.csv` in tests.

## Open items

- Contract §8 #12: location of the raw tables.
- Contract §8 #13: `owner` and `stage` have no dataset column.
