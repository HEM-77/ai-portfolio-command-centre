import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { query } from "../../config/database.js";
import { createTestDatabase, hasTestDatabase, type TestDatabase } from "../../testing/test-database.js";
import { FIXTURE_DIR } from "../__fixtures__/nimbus-sample.js";
import { DEFAULT_SOURCE_DIR, ingestNimbusDataset, IngestionError, type TableCounts } from "./ingest.js";

const counts = (c: Partial<TableCounts>): TableCounts => ({
  read: 0, inserted: 0, updated: 0, unchanged: 0, deleted: 0, rejected: 0, ...c,
});

async function tableSizes(db: TestDatabase) {
  const [row] = await query<Record<string, string>>(
    db.pool,
    `SELECT (SELECT count(*) FROM fx_rates) AS fx, (SELECT count(*) FROM initiatives) AS ini,
            (SELECT count(*) FROM weekly_usage) AS wu, (SELECT count(*) FROM cost_benefit) AS cb,
            (SELECT count(*) FROM ingestion_runs) AS runs`,
  );
  return Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, Number(v)]));
}

describe.skipIf(!hasTestDatabase)("ingestNimbusDataset with the synthetic fixture (PostgreSQL)", () => {
  let db: TestDatabase;
  let dir: string; // a writable copy of the fixture, so tests can change the files
  beforeEach(async () => {
    db = await createTestDatabase({ migrate: true });
    dir = await mkdtemp(join(tmpdir(), "nimbus-sample-"));
    await cp(FIXTURE_DIR, dir, { recursive: true });
  });
  afterEach(async () => {
    await db?.drop();
    await rm(dir, { recursive: true, force: true });
  });

  it("loads valid rows, reports every rejected row, and stores the issues", async () => {
    const report = await ingestNimbusDataset(db.pool, dir);

    expect(report.tables).toEqual({
      fx_rates: counts({ read: 3, inserted: 3 }),
      initiatives: counts({ read: 3, inserted: 2, rejected: 1 }),
      weekly_usage: counts({ read: 14, inserted: 6, rejected: 8 }),
      cost_benefit: counts({ read: 15, inserted: 9, rejected: 6 }),
    });
    expect(report.issueCounts).toEqual({ errors: 13, warnings: 3 });
    expect(await tableSizes(db)).toEqual({ fx: 3, ini: 2, wu: 6, cb: 9, runs: 1 });

    const issues = await query<{ source_file: string; source_row: number; action: string; message: string; raw_record: unknown }>(
      db.pool,
      "SELECT source_file, source_row, action, message, raw_record FROM ingestion_issues WHERE run_id = $1 ORDER BY issue_id",
      [report.runId],
    );
    expect(issues).toHaveLength(16);
    expect(issues.find((i) => i.message.includes("NMB-999"))).toMatchObject({
      source_file: "weekly_usage.csv",
      source_row: 9,
      action: "rejected",
      raw_record: { initiative_id: "NMB-999", week_ending: "2026-11-01", metric_name: "WAU", value: "5", unit: "users" },
    });
    const [run] = await query<{ finished_at: Date | null; summary: { issueCounts: unknown } }>(
      db.pool,
      "SELECT finished_at, summary FROM ingestion_runs WHERE run_id = $1",
      [report.runId],
    );
    expect(run?.finished_at).not.toBeNull();
    expect(run?.summary.issueCounts).toEqual({ errors: 13, warnings: 3 });
  });

  it("is idempotent: a second run with the same files inserts and updates nothing", async () => {
    await ingestNimbusDataset(db.pool, dir);
    const before = await query(db.pool, "SELECT * FROM cost_benefit ORDER BY initiative_id, measure, period_start");

    const second = await ingestNimbusDataset(db.pool, dir);
    expect(second.tables).toEqual({
      fx_rates: counts({ read: 3, unchanged: 3 }),
      initiatives: counts({ read: 3, unchanged: 2, rejected: 1 }),
      weekly_usage: counts({ read: 14, unchanged: 6, rejected: 8 }),
      cost_benefit: counts({ read: 15, unchanged: 9, rejected: 6 }),
    });
    expect(await query(db.pool, "SELECT * FROM cost_benefit ORDER BY initiative_id, measure, period_start")).toEqual(before);
    expect(await tableSizes(db)).toEqual({ fx: 3, ini: 2, wu: 6, cb: 9, runs: 2 });
  });

  it("updates a changed value and deletes a row that left the source file", async () => {
    await ingestNimbusDataset(db.pool, dir);
    const file = join(dir, "cost_benefit.csv");
    const text = await readFile(file, "utf8");
    await writeFile(
      file,
      text
        .replace("NMB-901,Feb-2026,Realised Benefit,25000,USD,monthly", "NMB-901,Feb-2026,Realised Benefit,26000,USD,monthly")
        .replace(/NMB-902,2026-12,Forecast Benefit,9000,USD,monthly\r?\n/, ""),
    );

    const report = await ingestNimbusDataset(db.pool, dir);
    expect(report.tables.cost_benefit).toEqual(counts({ read: 14, unchanged: 7, updated: 1, deleted: 1, rejected: 6 }));
    const rows = await query<{ measure: string; value: string }>(
      db.pool,
      "SELECT measure, value FROM cost_benefit WHERE measure IN ('realised_benefit', 'forecast_benefit') AND basis = 'monthly'",
    );
    expect(rows).toEqual([{ measure: "realised_benefit", value: "26000" }]);
  });

  it("changes nothing when a file has the wrong header (all-or-nothing)", async () => {
    await ingestNimbusDataset(db.pool, dir);
    const before = await tableSizes(db);
    await writeFile(join(dir, "weekly_usage.csv"), "initiative_id,week,metric_name,value,unit\nNMB-901,2026-11-01,WAU,1,users\n");

    await expect(ingestNimbusDataset(db.pool, dir)).rejects.toThrow(/weekly_usage.csv: header does not match/);
    expect(await tableSizes(db)).toEqual(before);
  });

  it("fails clearly when a source file is missing", async () => {
    await rm(join(dir, "fx_rates.csv"));
    await expect(ingestNimbusDataset(db.pool, dir)).rejects.toThrow(IngestionError);
    await expect(ingestNimbusDataset(db.pool, dir)).rejects.toThrow(/Cannot read fx_rates.csv/);
  });

  it("refuses to ingest before migrations have run", async () => {
    const empty = await createTestDatabase();
    try {
      await expect(ingestNimbusDataset(empty.pool, dir)).rejects.toThrow(/pending: 0001_initial_schema.sql.*db:migrate/);
    } finally {
      await empty.drop();
    }
  });
});

// The official files in data/raw/ (contract §8 #12). Expected counts were taken by reading the four
// CSVs directly, not from any evaluation material: 63 usage rows of which 2 are NMB-099 orphans and
// 1 an exact duplicate; 193 cost rows of which 2 are NMB-099 orphans and 1 an exact duplicate.
describe.skipIf(!hasTestDatabase || !existsSync(join(DEFAULT_SOURCE_DIR, "initiatives.csv")))(
  "ingestNimbusDataset with the official Nimbus CSVs (PostgreSQL)",
  () => {
    let db: TestDatabase;
    beforeAll(async () => {
      db = await createTestDatabase({ migrate: true });
    });
    afterAll(async () => {
      await db?.drop();
    });

    it("loads all 10 initiatives and reports exactly the orphan and duplicate rows", async () => {
      const report = await ingestNimbusDataset(db.pool);
      expect(report.tables).toEqual({
        fx_rates: counts({ read: 3, inserted: 3 }),
        initiatives: counts({ read: 10, inserted: 10 }),
        weekly_usage: counts({ read: 63, inserted: 60, rejected: 3 }),
        cost_benefit: counts({ read: 193, inserted: 190, rejected: 3 }),
      });
      expect(report.issues.filter((i) => i.severity === "error").map((i) => [i.sourceFile, i.initiativeId])).toEqual([
        ["weekly_usage.csv", "NMB-099"],
        ["weekly_usage.csv", "NMB-099"],
        ["cost_benefit.csv", "NMB-099"],
        ["cost_benefit.csv", "NMB-099"],
      ]);
      expect(report.issues.filter((i) => i.message.startsWith("exact duplicate")).map((i) => [i.sourceFile, i.initiativeId])).toEqual([
        ["weekly_usage.csv", "NMB-004"],
        ["cost_benefit.csv", "NMB-002"],
      ]);

      const ids = await query<{ initiative_id: string }>(db.pool, "SELECT initiative_id FROM initiatives ORDER BY 1");
      expect(ids.map((r) => r.initiative_id)).toEqual(Array.from({ length: 10 }, (_, i) => `NMB-${String(i + 1).padStart(3, "0")}`));
    });

    it("is idempotent on the official files", async () => {
      const report = await ingestNimbusDataset(db.pool);
      expect(Object.values(report.tables).every((t) => t.inserted === 0 && t.updated === 0 && t.deleted === 0)).toBe(true);
    });
  },
);
