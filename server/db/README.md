# PostgreSQL: structured portfolio data

The four official Nimbus CSVs in `data/raw/` are the **source of truth**. They are loaded into a local
PostgreSQL (Docker Compose) so the Portfolio module can query them. RAG is unchanged: charters still go
to the local JSON vector index (`server/storage/vector-index.json`); no embeddings or pgvector here.

## Setup and commands

```bash
# Repository root: start PostgreSQL (first time: cp .env.example .env and set POSTGRES_PASSWORD)
docker compose up -d
docker compose ps            # wait for STATUS "healthy" (pg_isready)

# server/: DATABASE_URL in server/.env must match the root .env
npm run db:check             # connection + pending migrations
npm run db:migrate           # apply server/db/migrations/*.sql (safe to re-run)
npm run db:ingest            # load data/raw/*.csv in one transaction (safe to re-run)
npm run db:ingest -- --source <folder>   # same four files from another folder

# Repository root: stop
docker compose down          # keeps data (named volume portfolio_pgdata)
docker compose down -v       # deletes all database data
```

| Variable | File | Purpose |
|---|---|---|
| `POSTGRES_DB`, `POSTGRES_USER` | root `.env` | Database and user created on first start (default `portfolio`) |
| `POSTGRES_PASSWORD` | root `.env` | **Required**; compose will not start without it |
| `POSTGRES_PORT` | root `.env` | Host port, bound to `127.0.0.1` only (default `5432`) |
| `DATABASE_URL` | `server/.env` | `postgres://<user>:<password>@localhost:<port>/<db>`; optional at server startup |

Both `.env` files are git-ignored. The server never logs the password (`describeDatabaseUrl` masks it)
and no API response contains database details.

## Schema (`migrations/0001_initial_schema.sql`)

```
fx_rates (currency PK)
   ▲ plan_unit            ▲ currency
initiatives (initiative_id PK, 'NMB-xxx')
   ▲ initiative_id        ▲ initiative_id
weekly_usage                     cost_benefit
PK (initiative_id, week_ending,  PK (initiative_id, measure,
    metric)                          period_start, period_end)

ingestion_runs (run_id PK) ◄── ingestion_issues (run_id FK, cascade)
schema_migrations (version PK, checksum)
```

Indexes: the primary keys (leading `initiative_id`) plus `weekly_usage(week_ending)` and
`cost_benefit(period_start, period_end)`. Money and usage values are `numeric` (exact); dates are `date`.

### Mapping from the CSVs

| CSV column | Column | Normalisation on load |
|---|---|---|
| `initiative_id` (all files) | `initiative_id` + `source_initiative_id` | trim, uppercase, insert hyphen: `nmb001 ` → `NMB-001`; the text as written is kept |
| `go_live_date`, `week_ending` | `go_live_date`, `week_ending` (+ `*_source`) | `2026-11-01`, `01-Nov-2026`, `Nov 1, 2026`, `1 Dec 2025` → ISO date |
| `period` | `period_start`, `period_end` (+ `source_period`) | `2025-11`, `Feb-2026`, `February 2026` → one month; `Aug-Oct 2025`, `Nov 2025-Jan 2026` → first and last month |
| `metric_name` | `metric` (+ `source_metric_name`) | `Licensed Users`/`licensed_users`/`licences`/`Seats` → `licensed_users`; `Weekly Active Users`/`WAU`/`active_users_wk` → `weekly_active_users`; `Weekly Adoption Rate` → `weekly_adoption_rate` |
| `measure` | `measure` (+ `source_measure`) | `Build Cost`/`Implementation cost`/`capex_one_time` → `one_time_cost`; `Run Cost`/`Operating cost`/`opex_monthly` → `monthly_cost`; `Realised Benefit`/`Benefit Realised`/`realized_benefit` → `realised_benefit`; `Cumulative Benefit to Date` → `cumulative_benefit`; `Forecast Benefit` → `forecast_benefit` |
| `value`, `planned_annual_benefit`, `rate_to_usd` | `value` (+ `source_value`), … | `$60,000`, `60,000 ` → `60000`; sign kept; blank → `NULL` (warning) |
| `unit` (cost_benefit), `plan_unit` | `currency`, `plan_unit` | verbatim; must exist in `fx_rates` (`USD`, `EUR`, `USD thousands`) |
| `months_live_reported` | same | verbatim text (`26 weeks` exists); **not** authoritative (contract §5.4) |
| `basis`, `unit` (usage), names, `charter_file` | same | trimmed only |

### Assumptions and what is deliberately NOT done here

- **Source facts only.** No ROI, adoption, payback, status, USD totals or months live are stored.
  These are calculated by the Portfolio module in TypeScript (AGENTS.md §1.3, contract §5.4).
- **No business repairs at load time.** Values are stored as the source states them, so the Portfolio
  module applies (and logs, as `DataQualityIssue`s) the rules in `services/portfolio/README.md`:
  negative cost (NMB-004 `-30000` is stored as `-30000`), WAU digit slip (NMB-009 `2800`), blank licence
  carry-forward, adoption % → WAU, cumulative snapshots (use latest, never sum), forecast exclusion
  (`forecast_benefit` rows are stored, not dropped), currency conversion via `fx_rates`.
- **Nothing is invented.** No owner, stage or other field without a CSV column exists in the schema.
- **Rejected, never silently dropped.** Rows that cannot be loaded (unreadable ID/date/period/number,
  unknown alias or currency, orphan ID, malformed line) and exact or conflicting duplicates are written
  to `ingestion_issues` with the CSV row number and raw cells, and printed by `db:ingest`. A file-level
  problem (missing file, wrong header) aborts the whole load and changes nothing.
- **Duplicates:** the first row per natural key is kept. A later identical row is a warning; a later
  different row is an error.
- **Repeatable:** each run is one transaction. Rows are upserted by natural key (`inserted` / `updated` /
  `unchanged`), and rows no longer in the files are deleted (`deleted`), so the tables always mirror the
  CSVs. Each run is recorded in `ingestion_runs` with its counts.
- **Data quality log:** `ingestion_issues` holds load-time problems only. The contract's
  `DataQualityReport` (`/api/portfolio/quality`) is built by the Portfolio module and also includes its
  business-rule repairs.

Results on the official files: 10 initiatives, 3 fx rates, 60 of 63 usage rows and 190 of 193
cost/benefit rows loaded. Rejected: 4 `NMB-099` orphan rows and 2 exact duplicates (NMB-004 usage,
NMB-002 June operating cost). 2 blank usage values are stored as `NULL` with a warning.

## Integration with the Portfolio module

The public entry point is `server/src/db/index.ts`. Nothing outside `src/db/` and `src/index.ts` uses
the database yet; the API still serves the mock Portfolio service, and the contract is unchanged.

1. `src/index.ts` creates the pool from `DATABASE_URL` (logs connected / not reachable, closes it on
   shutdown). To wire the real service, pass it in:
   `createPortfolioService({ repository: createPortfolioRepository(database) })`.
2. `PortfolioService.load()` (Spoorthy, `services/portfolio/`) reads `listInitiatives()`,
   `listWeeklyUsage()`, `listCostBenefit()`, `listFxRates()` and `getLatestIngestionRun()` once,
   applies the business rules, and calculates the scorecard in memory. The getters stay synchronous,
   so `docs/api-contracts.md` §4 and every controller are unchanged.
3. If the database is unreachable, `load()` should leave the service not ready: the portfolio
   endpoints return `503 NOT_READY` and `/api/health` shows `scorecardLoaded: false`.

## Tests

`npm test` runs the database tests only when `DATABASE_URL` is set; otherwise they are skipped and the
rest still pass. Each database test file uses its own throwaway schema (`test_<random>`), dropped
afterwards, so tests never touch the real tables. Fixture: `src/db/__fixtures__/nimbus-sample/`
(synthetic IDs NMB-901..903, NMB-999).
