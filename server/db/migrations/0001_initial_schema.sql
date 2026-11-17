-- 0001: structured portfolio data loaded from the four official Nimbus CSVs (data/raw/).
--
-- Principles (see server/db/README.md):
-- * Source facts only. Nothing derived (ROI, adoption, payback, status, USD totals) is stored;
--   the Portfolio module calculates those in TypeScript.
-- * Values are stored as the source states them, in the source currency and sign. Business
--   repairs (negative cost, digit slips, carry-forward of blank licences, forecast exclusion,
--   currency conversion) belong to the Portfolio module, not to ingestion.
-- * Only syntactic normalisation happens on load: canonical IDs, ISO dates, YYYY-MM periods,
--   canonical metric/measure names, numbers parsed from "$60,000"-style text. The original text
--   is kept next to each normalised value, with the CSV row number, for traceability.
-- * Rows that cannot be loaded are recorded in ingestion_issues, never dropped silently.

-- fx_rates.csv: currency,rate_to_usd,note
CREATE TABLE fx_rates (
  currency     text PRIMARY KEY,                 -- verbatim: 'USD', 'EUR', 'USD thousands'
  rate_to_usd  numeric NOT NULL CHECK (rate_to_usd > 0),
  note         text,
  source_row   integer NOT NULL
);

-- initiatives.csv: initiative_id,initiative_name,initiative_type,business_unit,go_live_date,
--                  months_live_reported,planned_annual_benefit,plan_unit,charter_file
CREATE TABLE initiatives (
  initiative_id           text PRIMARY KEY CHECK (initiative_id ~ '^NMB-[0-9]{3}$'),
  source_initiative_id    text NOT NULL,         -- ID as written, e.g. 'NMB-001'
  initiative_name         text NOT NULL CHECK (initiative_name <> ''),
  initiative_type         text NOT NULL CHECK (initiative_type <> ''),
  business_unit           text NOT NULL CHECK (business_unit <> ''),
  go_live_date            date NOT NULL,
  go_live_date_source     text NOT NULL,         -- e.g. '1 Dec 2025' as written
  months_live_reported    text,                  -- verbatim, e.g. '12' or '26 weeks'; not authoritative
  planned_annual_benefit  numeric,               -- in plan_unit, as written
  plan_unit               text NOT NULL REFERENCES fx_rates (currency),
  charter_file            text NOT NULL,
  source_row              integer NOT NULL
);

-- weekly_usage.csv: initiative_id,week_ending,metric_name,value,unit (long format)
CREATE TABLE weekly_usage (
  initiative_id       text NOT NULL REFERENCES initiatives (initiative_id),
  week_ending         date NOT NULL,
  source_initiative_id text NOT NULL,           -- ID as written, e.g. 'nmb-001 ' or 'NMB001'
  metric              text NOT NULL CHECK (metric IN ('licensed_users', 'weekly_active_users', 'weekly_adoption_rate')),
  value               numeric,                   -- NULL when the source cell is blank
  unit                text NOT NULL CHECK (unit IN ('users', '%')),
  source_metric_name  text NOT NULL,             -- e.g. 'Seats', 'WAU', 'active_users_wk'
  source_week_ending  text NOT NULL,             -- e.g. 'Nov 1, 2026'
  source_row          integer NOT NULL,
  PRIMARY KEY (initiative_id, week_ending, metric)
);
CREATE INDEX weekly_usage_week_ending_idx ON weekly_usage (week_ending);

-- cost_benefit.csv: initiative_id,period,measure,value,unit,basis (long format)
CREATE TABLE cost_benefit (
  initiative_id   text NOT NULL REFERENCES initiatives (initiative_id),
  period_start    date NOT NULL,                 -- first day of the first month covered
  source_initiative_id text NOT NULL,            -- ID as written, e.g. 'nmb-007 '
  period_end      date NOT NULL,                 -- first day of the last month covered (= start unless quarterly)
  measure         text NOT NULL CHECK (measure IN (
                    'one_time_cost', 'monthly_cost', 'realised_benefit', 'cumulative_benefit', 'forecast_benefit')),
  basis           text NOT NULL CHECK (basis IN ('one-time', 'monthly', 'quarterly', 'cumulative')),
  value           numeric,                       -- source currency and sign; NULL when blank
  currency        text NOT NULL REFERENCES fx_rates (currency),
  source_measure  text NOT NULL,                 -- e.g. 'Run Cost', 'opex_monthly'
  source_period   text NOT NULL,                 -- e.g. 'Feb-2026', 'Aug-Oct 2025'
  source_value    text NOT NULL,                 -- e.g. '$60,000'
  source_row      integer NOT NULL,
  PRIMARY KEY (initiative_id, measure, period_start, period_end),
  CHECK (period_start = date_trunc('month', period_start)::date),
  CHECK (period_end = date_trunc('month', period_end)::date),
  CHECK (period_end >= period_start)
);
CREATE INDEX cost_benefit_period_idx ON cost_benefit (period_start, period_end);

-- One row per ingestion run, with the counts reported to the operator.
CREATE TABLE ingestion_runs (
  run_id       bigserial PRIMARY KEY,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  source_dir   text NOT NULL,
  summary      jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Rows that were rejected (not loaded) or loaded with a warning, per run.
CREATE TABLE ingestion_issues (
  issue_id       bigserial PRIMARY KEY,
  run_id         bigint NOT NULL REFERENCES ingestion_runs (run_id) ON DELETE CASCADE,
  source_file    text NOT NULL,                  -- e.g. 'weekly_usage.csv'
  source_row     integer,                        -- 1-based data row; NULL for file-level issues
  initiative_id  text,                           -- no FK: orphan IDs are exactly what is reported here
  field          text,
  severity       text NOT NULL CHECK (severity IN ('error', 'warning')),
  action         text NOT NULL CHECK (action IN ('rejected', 'loaded')),
  message        text NOT NULL,
  raw_record     jsonb                           -- the CSV cells as read, so nothing is lost
);
CREATE INDEX ingestion_issues_run_idx ON ingestion_issues (run_id);
