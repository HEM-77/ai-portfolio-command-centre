"""Validate, normalize, and score the Nimbus portfolio workbook.

Run from any directory with:
    python "data/spoorthi.py"

Outputs are written to data/outputs_spoorthi by default. Existing output files
are protected if their contents would change; pass --overwrite to replace them.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd


AS_OF_DATE = pd.Timestamp("2026-11-01")
LATEST_USAGE_WEEK = pd.Timestamp("2026-11-15")
EXPECTED_USAGE_WEEKS = 3
OUTPUT_FILES = (
    "initiatives_clean.csv",
    "weekly_usage_clean.csv",
    "cost_benefit_clean.csv",
    "governed_scorecard.csv",
    "data_quality_log.csv",
    "data_quality_log.json",
)

REQUIRED_COLUMNS = {
    "initiatives": {
        "initiative_id", "initiative_name", "initiative_type", "business_unit",
        "go_live_date", "months_live_reported", "planned_annual_benefit", "plan_unit",
    },
    "weekly_usage": {"initiative_id", "week_ending", "metric_name", "value", "unit"},
    "cost_benefit": {"initiative_id", "period", "measure", "value", "unit", "basis"},
    "fx_rates": {"currency", "rate_to_usd"},
}

METRIC_ALIASES = {
    "licensed users": "licensed_users", "licensed_users": "licensed_users",
    "licences": "licensed_users", "seats": "licensed_users",
    "weekly active users": "wau", "wau": "wau", "active_users_wk": "wau",
    "weekly adoption rate": "adoption_rate_pct",
}
MEASURE_ALIASES = {
    "benefit realised": "realised_benefit", "realised benefit": "realised_benefit",
    "realized benefit": "realised_benefit", "realized_benefit": "realised_benefit",
    "cumulative benefit to date": "cumulative_benefit",
    "build cost": "cost", "implementation cost": "cost", "capex_one_time": "cost",
    "run cost": "cost", "operating cost": "cost", "opex_monthly": "cost",
    "forecast benefit": "forecast_benefit",
}


class DataValidationError(ValueError):
    """Raised when required workbook structure or values are invalid."""


class QualityLog:
    def __init__(self) -> None:
        self.entries: list[dict[str, str]] = []

    def add(self, code: str, table: str, initiative_id: Any, description: str, impact: str) -> None:
        self.entries.append({
            "issue_code": code,
            "table": table,
            "initiative_id": str(initiative_id),
            "description": description,
            "impact": impact,
        })


def normalize_id(value: Any) -> Any:
    if pd.isna(value):
        return pd.NA
    compact = re.sub(r"[^A-Z0-9]", "", str(value).upper())
    match = re.fullmatch(r"([A-Z]+)(\d+)", compact)
    return f"{match.group(1)}-{int(match.group(2)):03d}" if match else compact


def parse_date(value: Any) -> pd.Timestamp:
    if pd.isna(value):
        return pd.NaT
    if isinstance(value, (pd.Timestamp, datetime)):
        return pd.Timestamp(value).normalize()
    return pd.to_datetime(str(value).strip(), errors="coerce", dayfirst=False).normalize()


def parse_period(value: Any) -> str:
    text = str(value).strip()
    try:
        return pd.Period(pd.to_datetime(text, errors="raise"), freq="M").strftime("%Y-%m")
    except (ValueError, TypeError):
        # Quarter ranges in this dataset represent the quarter-end month.
        match = re.fullmatch(r"(.+?)\s+(\d{4})", text)
        if match:
            months = re.findall(r"[A-Za-z]+", match.group(1))
            if "-" in match.group(1) and months:
                try:
                    return pd.to_datetime(f"{months[-1]} {match.group(2)}").strftime("%Y-%m")
                except ValueError:
                    pass
        return text


def numeric_series(values: pd.Series, table: str, column: str) -> pd.Series:
    result = pd.to_numeric(values, errors="coerce")
    invalid = values.notna() & result.isna()
    if invalid.any():
        raise DataValidationError(f"{table}.{column} contains non-numeric values: {values[invalid].head(3).tolist()}")
    if not result.dropna().map(math.isfinite).all():
        raise DataValidationError(f"{table}.{column} contains a non-finite value")
    return result


def load_workbook(path: Path) -> dict[str, pd.DataFrame]:
    if not path.is_file():
        raise FileNotFoundError(f"Input workbook not found: {path}")
    sheets = pd.read_excel(path, sheet_name=None)
    for name, required in REQUIRED_COLUMNS.items():
        if name not in sheets:
            raise DataValidationError(f"Workbook is missing required sheet '{name}'")
        missing = required - set(sheets[name].columns)
        if missing:
            raise DataValidationError(f"Sheet '{name}' is missing columns: {', '.join(sorted(missing))}")
        if sheets[name].empty:
            raise DataValidationError(f"Sheet '{name}' has no data rows")
    return sheets


def normalize_initiatives(raw: pd.DataFrame, fx: dict[str, float], log: QualityLog) -> pd.DataFrame:
    df = raw.copy()
    df["initiative_id"] = df["initiative_id"].map(normalize_id)
    if df["initiative_id"].isna().any() or df["initiative_id"].duplicated().any():
        raise DataValidationError("initiatives has a missing or duplicate normalized initiative_id")
    df["go_live_dt"] = df["go_live_date"].map(parse_date)
    if df["go_live_dt"].isna().any():
        raise DataValidationError("initiatives.go_live_date contains an invalid or missing date")
    if (df["go_live_dt"] >= AS_OF_DATE).any():
        raise DataValidationError("go_live_date must precede the reporting cutoff")
    df["months_live_derived"] = (
        (AS_OF_DATE.year - df["go_live_dt"].dt.year) * 12
        + AS_OF_DATE.month - df["go_live_dt"].dt.month
    )
    df["months_live"] = df["months_live_derived"]
    for _, row in df.iterrows():
        stated = str(row["months_live_reported"]).strip()
        derived = int(row["months_live"])
        if not stated.isdigit() or int(stated) != derived:
            code = "DQ-18" if not stated.isdigit() else "DQ-19"
            log.add(code, "initiatives", row["initiative_id"],
                    f"Reported tenure '{stated}' replaced with {derived} full months derived from go_live_date.",
                    "Monthly benefit uses date-derived tenure; confirm conflicting reported tenure with the owner.")
    df["planned_annual_benefit"] = numeric_series(df["planned_annual_benefit"], "initiatives", "planned_annual_benefit")
    if (df["planned_annual_benefit"] < 0).any():
        raise DataValidationError("planned_annual_benefit cannot be negative")
    df["plan_unit"] = df["plan_unit"].astype(str).str.strip()
    unknown = sorted(set(df["plan_unit"]) - set(fx))
    if unknown:
        raise DataValidationError(f"No FX rate found for plan unit(s): {', '.join(unknown)}")
    df["planned_annual_benefit_usd"] = [v * fx[u] for v, u in zip(df["planned_annual_benefit"], df["plan_unit"])]
    if (df["plan_unit"] != "USD").any():
        ids = ", ".join(df.loc[df["plan_unit"] != "USD", "initiative_id"].astype(str))
        log.add("DQ-15/16", "initiatives", ids, "Converted planned benefit to USD using the workbook FX table.",
                "All plan targets are comparable in USD.")
    return df


def normalize_usage(raw: pd.DataFrame, valid_ids: set[str], log: QualityLog) -> pd.DataFrame:
    df = raw.copy()
    original_ids = df["initiative_id"].astype(str)
    df["initiative_id"] = df["initiative_id"].map(normalize_id)
    changed = original_ids.str.strip().str.upper().ne(df["initiative_id"].astype(str))
    if changed.any():
        log.add("DQ-08", "weekly_usage", "multiple", f"Normalized {int(changed.sum())} initiative ID variants.",
                "Avoids mismatches when joining usage to the initiative master.")
    df["week_ending_dt"] = df["week_ending"].map(parse_date)
    if df["week_ending_dt"].isna().any():
        raise DataValidationError("weekly_usage.week_ending contains an invalid or missing date")
    df["canonical_metric"] = df["metric_name"].astype(str).str.strip().str.lower().map(METRIC_ALIASES)
    unknown_metrics = df.loc[df["canonical_metric"].isna(), "metric_name"].dropna().unique().tolist()
    if unknown_metrics:
        raise DataValidationError(f"Unknown weekly usage metric name(s): {unknown_metrics}")
    values = df["value"].astype("string").str.replace(",", "", regex=False).str.replace("%", "", regex=False).str.strip()
    df["value_num"] = numeric_series(values, "weekly_usage", "value")
    if (df["value_num"].dropna() < 0).any():
        raise DataValidationError("weekly_usage.value cannot be negative")
    if df["value_num"].isna().any():
        log.add("DQ-03", "weekly_usage", "multiple", f"Found {int(df['value_num'].isna().sum())} missing usage observation(s); downstream checks determine whether each is recoverable.",
                "Missing values are only used when a valid prior license count or non-scoring middle week allows it.")
    orphan = ~df["initiative_id"].isin(valid_ids)
    if orphan.any():
        ids = ", ".join(sorted(df.loc[orphan, "initiative_id"].dropna().unique()))
        log.add("DQ-09", "weekly_usage", ids, f"Excluded {int(orphan.sum())} row(s) for IDs absent from initiatives.",
                "Orphan rows cannot create scorecard entries.")
        df = df.loc[~orphan].copy()
    dup_keys = ["initiative_id", "week_ending_dt", "canonical_metric"]
    duplicate_mask = df.duplicated(dup_keys, keep=False)
    if duplicate_mask.any():
        duplicated = df.loc[duplicate_mask]
        conflicts = duplicated.groupby(dup_keys, dropna=False)["value_num"].nunique().gt(1)
        if conflicts.any():
            raise DataValidationError("weekly_usage has conflicting values for the same initiative/week/metric")
        df = df.drop_duplicates(dup_keys)
        log.add("DQ-01", "weekly_usage", "multiple", f"Removed {int(duplicate_mask.sum() - len(duplicated.drop_duplicates(dup_keys)))} exact duplicate metric row(s).",
                "Prevents duplicate usage observations from affecting the scorecard.")
    if df["canonical_metric"].nunique() > 1:
        log.add("DQ-06", "weekly_usage", "all", "Mapped raw usage metric aliases to canonical metric names.",
                "Creates a consistent usage schema.")
    wide = df.pivot(index=["initiative_id", "week_ending_dt"], columns="canonical_metric", values="value_num").reset_index()
    wide.columns.name = None
    for col in ("licensed_users", "wau", "adoption_rate_pct"):
        if col not in wide:
            wide[col] = float("nan")
    wide = wide.sort_values(["initiative_id", "week_ending_dt"])
    missing_licenses = wide["licensed_users"].isna()
    if missing_licenses.any():
        affected = wide.loc[missing_licenses, "initiative_id"].unique()
        for iid in affected:
            log.add("DQ-02", "weekly_usage", iid, "Forward-filled missing licensed user counts from the nearest prior week.",
                    "Provides a denominator for adoption where a prior count is available.")
        wide["licensed_users"] = wide.groupby("initiative_id")["licensed_users"].ffill()
    if wide["licensed_users"].isna().any():
        raise DataValidationError("licensed_users is missing and cannot be filled from a prior observation")
    if (wide["licensed_users"] <= 0).any():
        raise DataValidationError("licensed_users must be greater than zero")
    rate_mask = wide["wau"].isna() & wide["adoption_rate_pct"].notna()
    if rate_mask.any():
        wide.loc[rate_mask, "wau"] = wide.loc[rate_mask, "adoption_rate_pct"] * wide.loc[rate_mask, "licensed_users"] / 100
        log.add("DQ-05", "weekly_usage", "multiple", "Converted weekly adoption percentages to WAU counts using licensed users.",
                "Standardizes weekly activity to user counts.")
    endpoint = wide["week_ending_dt"].isin([pd.Timestamp("2026-11-01"), LATEST_USAGE_WEEK])
    invalid_wau = endpoint & (wide["wau"].isna() | (wide["wau"] < 0))
    if invalid_wau.any():
        raise DataValidationError("WAU is missing or negative in the first or latest reporting week")
    anomaly = wide["wau"].notna() & (wide["wau"] > wide["licensed_users"])
    for idx, row in wide.loc[anomaly].iterrows():
        corrected = row["wau"] / 10
        if corrected > row["licensed_users"]:
            raise DataValidationError(f"WAU still exceeds licensed users for {row['initiative_id']} after digit-slip correction")
        log.add("DQ-04", "weekly_usage", row["initiative_id"],
                f"WAU {row['wau']:g} exceeded licensed users on {row['week_ending_dt']:%Y-%m-%d}; corrected a 10x digit slip to {corrected:g}.",
                "Keeps WAU within the licensed-user population.")
        wide.loc[idx, "wau"] = corrected
    counts = wide.groupby("initiative_id")["week_ending_dt"].agg(["nunique", "min", "max"])
    invalid_period = counts[(counts["nunique"] != EXPECTED_USAGE_WEEKS) | (counts["min"] != pd.Timestamp("2026-11-01")) | (counts["max"] != LATEST_USAGE_WEEK)]
    if not invalid_period.empty:
        raise DataValidationError(f"Each initiative must have exactly the three reporting weeks; invalid IDs: {invalid_period.index.tolist()}")
    return wide.sort_values(["initiative_id", "week_ending_dt"]).reset_index(drop=True)


def normalize_financials(raw: pd.DataFrame, valid_ids: set[str], fx: dict[str, float], log: QualityLog) -> pd.DataFrame:
    df = raw.copy()
    duplicate_mask = df.duplicated(keep="first")
    if duplicate_mask.any():
        df = df.loc[~duplicate_mask].copy()
        log.add("DQ-01", "cost_benefit", "multiple", f"Removed {int(duplicate_mask.sum())} exact duplicate financial row(s).",
                "Prevents duplicate costs or benefits from being counted twice.")
    df["initiative_id"] = df["initiative_id"].map(normalize_id)
    orphan = ~df["initiative_id"].isin(valid_ids)
    if orphan.any():
        log.add("DQ-09", "cost_benefit", ", ".join(sorted(df.loc[orphan, "initiative_id"].dropna().unique())),
                f"Excluded {int(orphan.sum())} row(s) for IDs absent from initiatives.", "Prevents orphan financial records from entering totals.")
        df = df.loc[~orphan].copy()
    df["canonical_measure"] = df["measure"].astype(str).str.strip().str.lower().map(MEASURE_ALIASES)
    unknown = df.loc[df["canonical_measure"].isna(), "measure"].dropna().unique().tolist()
    if unknown:
        raise DataValidationError(f"Unknown financial measure(s): {unknown}")
    df["period_norm"] = df["period"].map(parse_period)
    values = df["value"].astype("string").str.replace(r"[$,\s]", "", regex=True)
    df["value_clean"] = numeric_series(values, "cost_benefit", "value")
    if df["value_clean"].isna().any():
        raise DataValidationError("cost_benefit.value contains a missing value")
    negative_benefits = df["canonical_measure"].isin(["realised_benefit", "cumulative_benefit"]) & (df["value_clean"] < 0)
    if negative_benefits.any():
        raise DataValidationError("realised benefit values cannot be negative")
    negative_costs = (df["canonical_measure"] == "cost") & (df["value_clean"] < 0)
    for _, row in df.loc[negative_costs].iterrows():
        log.add("DQ-10", "cost_benefit", row["initiative_id"],
                f"Corrected negative cost ({row['value_clean']:g}) in {row['period_norm']} to its positive amount.",
                "Prevents a malformed cost sign from understating total cost and inflating ROI.")
    df.loc[negative_costs, "value_clean"] = df.loc[negative_costs, "value_clean"].abs()
    df["unit"] = df["unit"].astype(str).str.strip()
    unknown_units = sorted(set(df["unit"]) - set(fx))
    if unknown_units:
        raise DataValidationError(f"No FX rate found for financial unit(s): {', '.join(unknown_units)}")
    df["value_usd"] = [v * fx[u] for v, u in zip(df["value_clean"], df["unit"])]
    # Reporting closes through October 2026. Forecast and cumulative snapshots are
    # excluded because benefits and costs are summed from realized period records.
    df = df[(df["period_norm"] <= "2026-10") & df["canonical_measure"].isin(["realised_benefit", "cumulative_benefit", "cost"])].copy()
    # Monthly operating costs are recurring. Fill missing months inside an
    # initiative's observed operating-cost span using that initiative's median
    # monthly cost, and write each inference to the quality log.
    recurring = df[(df["canonical_measure"] == "cost") & (df["basis"].astype(str).str.strip().str.lower() == "monthly")]
    for iid, rows in recurring.groupby("initiative_id"):
        valid_periods = sorted(set(p for p in rows["period_norm"] if re.fullmatch(r"\d{4}-\d{2}", str(p))))
        if len(valid_periods) < 2:
            continue
        period_range = pd.period_range(valid_periods[0], valid_periods[-1], freq="M")
        present = set(valid_periods)
        missing_periods = [str(p) for p in period_range if str(p) not in present]
        if not missing_periods:
            continue
        monthly_usd = rows["value_usd"].median()
        for period in missing_periods:
            template = rows.iloc[0].copy()
            template["period"] = period
            template["period_norm"] = period
            template["value_clean"] = monthly_usd / fx[template["unit"]]
            template["value_usd"] = monthly_usd
            template["measure"] = "Imputed monthly operating cost"
            template["imputed"] = True
            df = pd.concat([df, template.to_frame().T], ignore_index=True)
            log.add("DQ-13", "cost_benefit", iid,
                    f"Filled missing recurring operating cost for {period} using the initiative's median observed monthly run cost.",
                    "Includes the recurring monthly cost in total cost to date; validate the inferred month with the owner.")
    if "imputed" not in df.columns:
        df["imputed"] = False
    else:
        df["imputed"] = df["imputed"].fillna(False)
    return df


def build_scorecard(initiatives: pd.DataFrame, usage: pd.DataFrame, finances: pd.DataFrame) -> pd.DataFrame:
    first_week = usage.loc[usage["week_ending_dt"] == usage["week_ending_dt"].min(), ["initiative_id", "wau"]].rename(columns={"wau": "wau_first"})
    latest = usage.loc[usage["week_ending_dt"] == LATEST_USAGE_WEEK].rename(columns={"wau": "wau_latest", "licensed_users": "licensed_users_latest"})
    score = initiatives.merge(first_week, on="initiative_id", validate="one_to_one").merge(
        latest[["initiative_id", "licensed_users_latest", "wau_latest"]], on="initiative_id", validate="one_to_one")
    monthly = finances[finances["canonical_measure"].isin(["realised_benefit", "cost"])]
    totals = monthly.pivot_table(index="initiative_id", columns="canonical_measure", values="value_usd", aggfunc="sum", fill_value=0)
    # Cumulative-to-date rows are snapshots. Use the latest snapshot instead of
    # summing snapshots, which would count the same benefit repeatedly.
    cumulative = finances[finances["canonical_measure"] == "cumulative_benefit"]
    if not cumulative.empty:
        latest_cumulative = cumulative.sort_values("period_norm").groupby("initiative_id").tail(1).set_index("initiative_id")["value_usd"]
        totals.loc[latest_cumulative.index, "realised_benefit"] = latest_cumulative
    for col in ("realised_benefit", "cost"):
        if col not in totals:
            totals[col] = 0.0
    score = score.merge(totals[["realised_benefit", "cost"]].rename(columns={
        "realised_benefit": "realised_benefit_usd", "cost": "total_cost_usd"}),
        left_on="initiative_id", right_index=True, how="left", validate="one_to_one")
    score[["realised_benefit_usd", "total_cost_usd"]] = score[["realised_benefit_usd", "total_cost_usd"]].fillna(0.0)
    score["adoption"] = score["wau_latest"] / score["licensed_users_latest"]
    score["wau_change"] = (score["wau_latest"] - score["wau_first"]) / score["wau_first"].replace(0, float("nan"))
    score["roi"] = (score["realised_benefit_usd"] - score["total_cost_usd"]) / score["total_cost_usd"].replace(0, float("nan"))
    score["avg_monthly_benefit_usd"] = score["realised_benefit_usd"] / score["months_live"]
    score["payback_months"] = score["total_cost_usd"] / score["avg_monthly_benefit_usd"].replace(0, float("nan"))
    score["runrate_vs_plan"] = score["avg_monthly_benefit_usd"] * 12 / score["planned_annual_benefit_usd"].replace(0, float("nan"))
    def status(row: pd.Series) -> str:
        if row["adoption"] < 0.30 or row["roi"] < 0:
            return "Red"
        if row["adoption"] >= 0.60 and row["roi"] > 0:
            return "Green"
        return "Amber"
    score["status"] = score.apply(status, axis=1)
    if score[["roi", "wau_change", "payback_months", "runrate_vs_plan"]].isna().any().any():
        raise DataValidationError("A scorecard metric is undefined (check zero WAU, cost, or planned benefit denominators)")
    columns = ["initiative_id", "initiative_name", "business_unit", "initiative_type",
               "licensed_users_latest", "wau_first", "wau_latest", "adoption", "wau_change",
               "realised_benefit_usd", "total_cost_usd", "roi", "months_live",
               "avg_monthly_benefit_usd", "payback_months", "planned_annual_benefit_usd",
               "runrate_vs_plan", "status"]
    return score[columns].sort_values("initiative_id").reset_index(drop=True)


def process(input_path: Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, QualityLog]:
    sheets = load_workbook(input_path)
    log = QualityLog()
    fx_table = sheets["fx_rates"].copy()
    fx_table["currency"] = fx_table["currency"].astype(str).str.strip()
    fx_table["rate_to_usd"] = numeric_series(fx_table["rate_to_usd"], "fx_rates", "rate_to_usd")
    if fx_table["currency"].duplicated().any() or (fx_table["rate_to_usd"] <= 0).any():
        raise DataValidationError("fx_rates must have unique currencies and positive rates")
    fx = dict(zip(fx_table["currency"], fx_table["rate_to_usd"]))
    initiatives = normalize_initiatives(sheets["initiatives"], fx, log)
    ids = set(initiatives["initiative_id"])
    usage = normalize_usage(sheets["weekly_usage"], ids, log)
    finances = normalize_financials(sheets["cost_benefit"], ids, fx, log)
    return initiatives, usage, finances, build_scorecard(initiatives, usage, finances), log


def write_outputs(output_dir: Path, initiatives: pd.DataFrame, usage: pd.DataFrame,
                  finances: pd.DataFrame, scorecard: pd.DataFrame, log: QualityLog,
                  overwrite: bool = False) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = [output_dir / name for name in OUTPUT_FILES]
    quality = pd.DataFrame(log.entries, columns=["issue_code", "table", "initiative_id", "description", "impact"])
    tables = [initiatives, usage, finances, scorecard, quality]
    payloads = {
        name: table.to_csv(index=False).replace("\r\n", "\n")
        for name, table in zip(OUTPUT_FILES[:5], tables)
    }
    payloads[OUTPUT_FILES[5]] = json.dumps(log.entries, indent=2, ensure_ascii=False)
    changed_existing = [
        path.name for path in paths
        if path.exists() and path.read_text(encoding="utf-8").replace("\r\n", "\n") != payloads[path.name]
    ]
    if changed_existing and not overwrite:
        raise FileExistsError(
            f"Refusing to replace changed output(s): {', '.join(changed_existing)}. "
            "Use --overwrite to replace them or --output-dir to choose another directory."
        )
    for path in paths:
        if overwrite or not path.exists():
            path.write_text(payloads[path.name], encoding="utf-8", newline="")


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=script_dir / "portfolio_data.xlsx", help="Input Excel workbook")
    parser.add_argument("--output-dir", type=Path, default=script_dir / "outputs_spoorthi", help="Directory for normalized tables, scorecard, and quality log")
    parser.add_argument("--overwrite", action="store_true", help="Replace output files that already exist")
    args = parser.parse_args()
    try:
        initiatives, usage, finances, scorecard, log = process(args.input)
        write_outputs(args.output_dir, initiatives, usage, finances, scorecard, log, args.overwrite)
    except (DataValidationError, FileNotFoundError, FileExistsError, ValueError) as exc:
        parser.error(str(exc))
    print(f"Processed {len(scorecard)} initiatives; wrote {len(log.entries)} data-quality log entries to {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
