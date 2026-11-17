import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Pool, PoolClient } from "pg";
import { query, withTransaction } from "../../config/database.js";
import { pendingMigrations } from "../migrate.js";
import { normaliseDataset, SOURCE_FILES, type IngestionIssue, type NormalisedDataset, type SourceTexts } from "./records.js";

// Loads the four official Nimbus CSVs into PostgreSQL in ONE transaction: either the database
// matches the files afterwards, or nothing changed. Re-running with the same files changes nothing.

/** data/raw at the repository root (contract §8 #12), resolved from this file for src/ and dist/. */
export const DEFAULT_SOURCE_DIR = resolve(import.meta.dirname, "..", "..", "..", "..", "data", "raw");

export interface TableCounts {
  read: number; // data rows in the file
  inserted: number;
  updated: number; // key existed, content changed
  unchanged: number; // key existed, identical content
  deleted: number; // in the database but no longer in the file
  rejected: number; // not loaded; see issues
}

export type TableName = "fx_rates" | "initiatives" | "weekly_usage" | "cost_benefit";

export interface IngestionReport {
  runId: number;
  sourceDir: string;
  tables: Record<TableName, TableCounts>;
  issueCounts: { errors: number; warnings: number };
  issues: IngestionIssue[];
}

export class IngestionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "IngestionError";
  }
}

/** One table's upsert plan: natural key, the other columns, and the rows as column -> value. */
interface TablePlan {
  table: TableName;
  file: string;
  key: readonly string[];
  keyTypes: readonly string[]; // Postgres array element types for the stale-row delete
  columns: readonly string[];
  rows: Record<string, unknown>[];
}

export async function readSourceFiles(sourceDir: string): Promise<SourceTexts> {
  const read = async (file: string) => {
    try {
      return await readFile(join(sourceDir, file), "utf8");
    } catch (error) {
      throw new IngestionError(`Cannot read ${file} in ${sourceDir}. Extract the official CSVs to data/raw/ first.`, {
        cause: error,
      });
    }
  };
  return {
    fxRates: await read(SOURCE_FILES.fxRates.file),
    initiatives: await read(SOURCE_FILES.initiatives.file),
    weeklyUsage: await read(SOURCE_FILES.weeklyUsage.file),
    costBenefit: await read(SOURCE_FILES.costBenefit.file),
  };
}

/** Read, validate and load the dataset. Throws (and changes nothing) on a file-level problem. */
export async function ingestNimbusDataset(pool: Pool, sourceDir: string = DEFAULT_SOURCE_DIR): Promise<IngestionReport> {
  const pending = await pendingMigrations(pool);
  if (pending.length > 0) {
    throw new IngestionError(`Database schema is not up to date (pending: ${pending.join(", ")}). Run npm run db:migrate first.`);
  }

  let dataset: NormalisedDataset;
  try {
    dataset = normaliseDataset(await readSourceFiles(sourceDir));
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    throw new IngestionError(error instanceof Error ? error.message : String(error), { cause: error });
  }

  const plans = buildPlans(dataset);
  return withTransaction(pool, async (client) => {
    const [run] = await query<{ run_id: string }>(
      client,
      "INSERT INTO ingestion_runs (source_dir) VALUES ($1) RETURNING run_id",
      [sourceDir],
    );
    const runId = Number(run?.run_id);

    const tables = {} as Record<TableName, TableCounts>;
    // Parents before children for inserts; children before parents for deletes (foreign keys).
    for (const plan of plans) tables[plan.table] = await upsertTable(client, plan, dataset);
    for (const plan of [...plans].reverse()) tables[plan.table].deleted = await deleteStaleRows(client, plan);

    for (const issue of dataset.issues) {
      await client.query(
        `INSERT INTO ingestion_issues
           (run_id, source_file, source_row, initiative_id, field, severity, action, message, raw_record)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [runId, issue.sourceFile, issue.sourceRow, issue.initiativeId, issue.field, issue.severity, issue.action,
          issue.message, issue.rawRecord === null ? null : JSON.stringify(issue.rawRecord)],
      );
    }

    const issueCounts = {
      errors: dataset.issues.filter((i) => i.severity === "error").length,
      warnings: dataset.issues.filter((i) => i.severity === "warning").length,
    };
    await client.query("UPDATE ingestion_runs SET finished_at = now(), summary = $2 WHERE run_id = $1", [
      runId,
      JSON.stringify({ tables, issueCounts }),
    ]);
    return { runId, sourceDir, tables, issueCounts, issues: dataset.issues };
  });
}

function buildPlans(d: NormalisedDataset): TablePlan[] {
  return [
    {
      table: "fx_rates", file: SOURCE_FILES.fxRates.file, key: ["currency"], keyTypes: ["text"],
      columns: ["rate_to_usd", "note", "source_row"],
      rows: d.fxRates.map((r) => ({ currency: r.currency, rate_to_usd: r.rateToUsd, note: r.note, source_row: r.sourceRow })),
    },
    {
      table: "initiatives", file: SOURCE_FILES.initiatives.file, key: ["initiative_id"], keyTypes: ["text"],
      columns: [
        "source_initiative_id", "initiative_name", "initiative_type", "business_unit", "go_live_date", "go_live_date_source",
        "months_live_reported", "planned_annual_benefit", "plan_unit", "charter_file", "source_row",
      ],
      rows: d.initiatives.map((r) => ({
        initiative_id: r.initiativeId, source_initiative_id: r.sourceInitiativeId, initiative_name: r.initiativeName,
        initiative_type: r.initiativeType, business_unit: r.businessUnit, go_live_date: r.goLiveDate,
        go_live_date_source: r.goLiveDateSource, months_live_reported: r.monthsLiveReported,
        planned_annual_benefit: r.plannedAnnualBenefit, plan_unit: r.planUnit, charter_file: r.charterFile,
        source_row: r.sourceRow,
      })),
    },
    {
      table: "weekly_usage", file: SOURCE_FILES.weeklyUsage.file,
      key: ["initiative_id", "week_ending", "metric"], keyTypes: ["text", "date", "text"],
      columns: ["source_initiative_id", "value", "unit", "source_metric_name", "source_week_ending", "source_row"],
      rows: d.weeklyUsage.map((r) => ({
        initiative_id: r.initiativeId, week_ending: r.weekEnding, metric: r.metric, source_initiative_id: r.sourceInitiativeId,
        value: r.value, unit: r.unit, source_metric_name: r.sourceMetricName, source_week_ending: r.sourceWeekEnding,
        source_row: r.sourceRow,
      })),
    },
    {
      table: "cost_benefit", file: SOURCE_FILES.costBenefit.file,
      key: ["initiative_id", "measure", "period_start", "period_end"], keyTypes: ["text", "text", "date", "date"],
      columns: ["source_initiative_id", "basis", "value", "currency", "source_measure", "source_period", "source_value", "source_row"],
      rows: d.costBenefit.map((r) => ({
        initiative_id: r.initiativeId, measure: r.measure, period_start: r.periodStart, period_end: r.periodEnd,
        source_initiative_id: r.sourceInitiativeId, basis: r.basis, value: r.value, currency: r.currency,
        source_measure: r.sourceMeasure, source_period: r.sourcePeriod, source_value: r.sourceValue, source_row: r.sourceRow,
      })),
    },
  ];
}

const ROWS_READ_KEY: Record<TableName, keyof NormalisedDataset["rowsRead"]> = {
  fx_rates: "fxRates",
  initiatives: "initiatives",
  weekly_usage: "weeklyUsage",
  cost_benefit: "costBenefit",
};

/**
 * Insert new keys and update changed ones. The UPDATE runs only when a value differs, so an
 * identical re-run touches nothing; `xmax = 0` tells a fresh insert from an update.
 * Table and column names come from the fixed plans above, never from input.
 */
async function upsertTable(client: PoolClient, plan: TablePlan, d: NormalisedDataset): Promise<TableCounts> {
  const all = [...plan.key, ...plan.columns];
  const placeholders = all.map((_, i) => `$${i + 1}`).join(", ");
  const assignments = plan.columns.map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  const changed = `(${plan.columns.map((c) => `${plan.table}.${c}`).join(", ")}) IS DISTINCT FROM (${plan.columns
    .map((c) => `EXCLUDED.${c}`)
    .join(", ")})`;
  const sql = `INSERT INTO ${plan.table} (${all.join(", ")}) VALUES (${placeholders})
               ON CONFLICT (${plan.key.join(", ")}) DO UPDATE SET ${assignments} WHERE ${changed}
               RETURNING (xmax = 0) AS inserted`;

  const counts: TableCounts = {
    read: d.rowsRead[ROWS_READ_KEY[plan.table]],
    inserted: 0,
    updated: 0,
    unchanged: 0,
    deleted: 0,
    rejected: d.issues.filter((i) => i.sourceFile === plan.file && i.action === "rejected").length,
  };
  for (const row of plan.rows) {
    const result = await client.query<{ inserted: boolean }>(sql, all.map((c) => row[c] ?? null));
    const [returned] = result.rows;
    if (!returned) counts.unchanged++;
    else if (returned.inserted) counts.inserted++;
    else counts.updated++;
  }
  return counts;
}

/** Delete rows whose key is no longer in the source file, so the table mirrors the CSV. */
async function deleteStaleRows(client: PoolClient, plan: TablePlan): Promise<number> {
  const keyList = plan.key.join(", ");
  const unnest = plan.key.map((_, i) => `$${i + 1}::${plan.keyTypes[i]}[]`).join(", ");
  const params = plan.key.map((k) => plan.rows.map((r) => r[k]));
  const result = await client.query(
    `DELETE FROM ${plan.table} WHERE (${keyList}) NOT IN (SELECT * FROM unnest(${unnest}))`,
    params,
  );
  return result.rowCount ?? 0;
}
