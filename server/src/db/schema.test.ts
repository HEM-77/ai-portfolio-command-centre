import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query } from "../config/database.js";
import { createTestDatabase, hasTestDatabase, type TestDatabase } from "../testing/test-database.js";

// The database itself enforces keys, references and allowed values, so a bug in ingestion
// cannot store an orphan, a malformed ID or an unknown measure.

describe.skipIf(!hasTestDatabase)("schema constraints (PostgreSQL)", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase({ migrate: true });
    await query(db.pool, "INSERT INTO fx_rates (currency, rate_to_usd, note, source_row) VALUES ('USD', 1, null, 1)");
    await query(
      db.pool,
      `INSERT INTO initiatives (initiative_id, source_initiative_id, initiative_name, initiative_type, business_unit,
         go_live_date, go_live_date_source, months_live_reported, planned_annual_benefit, plan_unit, charter_file, source_row)
       VALUES ('NMB-901', 'NMB-901', 'Fixture', 'Copilot', 'Ops', '2026-01-01', '2026-01-01', '10', 1000, 'USD', 'x.md', 1)`,
    );
  });
  afterAll(async () => {
    await db?.drop();
  });

  /** Run a statement that must fail and return the Postgres error code (e.g. 23505). */
  async function violation(sql: string): Promise<string | undefined> {
    const error = await db.pool.query(sql).then(() => null, (e: unknown) => e);
    expect(error).not.toBeNull();
    return (error as { code?: string }).code;
  }

  const usage = (id: string, week: string, metric: string, unit = "users") =>
    `INSERT INTO weekly_usage (initiative_id, week_ending, source_initiative_id, metric, value, unit,
       source_metric_name, source_week_ending, source_row)
     VALUES ('${id}', '${week}', '${id}', '${metric}', 1, '${unit}', 'x', 'x', 1)`;

  const cost = (overrides: Partial<Record<"id" | "start" | "end" | "measure" | "basis" | "currency", string>> = {}) => {
    const v = { id: "NMB-901", start: "2026-01-01", end: "2026-01-01", measure: "monthly_cost", basis: "monthly", currency: "USD", ...overrides };
    return `INSERT INTO cost_benefit (initiative_id, period_start, source_initiative_id, period_end, measure, basis, value,
              currency, source_measure, source_period, source_value, source_row)
            VALUES ('${v.id}', '${v.start}', '${v.id}', '${v.end}', '${v.measure}', '${v.basis}', 1, '${v.currency}', 'x', 'x', '1', 1)`;
  };

  it("accepts a valid usage row and a valid cost row", async () => {
    await query(db.pool, usage("NMB-901", "2026-11-01", "licensed_users"));
    await query(db.pool, cost());
  });

  it("rejects a malformed initiative ID (check constraint)", async () => {
    expect(
      await violation(
        `INSERT INTO initiatives (initiative_id, source_initiative_id, initiative_name, initiative_type, business_unit,
           go_live_date, go_live_date_source, plan_unit, charter_file, source_row)
         VALUES ('nmb-1', 'nmb-1', 'X', 'Copilot', 'Ops', '2026-01-01', 'x', 'USD', 'x.md', 2)`,
      ),
    ).toBe("23514");
  });

  it("rejects a usage or cost row for an unknown initiative (foreign key)", async () => {
    expect(await violation(usage("NMB-999", "2026-11-01", "licensed_users"))).toBe("23503");
    expect(await violation(cost({ id: "NMB-999" }))).toBe("23503");
  });

  it("rejects a currency that is not in fx_rates (foreign key)", async () => {
    expect(await violation(cost({ start: "2026-02-01", end: "2026-02-01", currency: "GBP" }))).toBe("23503");
  });

  it("rejects a second row with the same natural key (primary key)", async () => {
    expect(await violation(usage("NMB-901", "2026-11-01", "licensed_users"))).toBe("23505");
    expect(await violation(cost())).toBe("23505");
  });

  it("rejects unknown metrics, measures, bases and units", async () => {
    expect(await violation(usage("NMB-901", "2026-11-08", "daily_users"))).toBe("23514");
    expect(await violation(usage("NMB-901", "2026-11-08", "licensed_users", "seats"))).toBe("23514");
    expect(await violation(cost({ start: "2026-03-01", end: "2026-03-01", measure: "marketing" }))).toBe("23514");
    expect(await violation(cost({ start: "2026-03-01", end: "2026-03-01", basis: "weekly" }))).toBe("23514");
  });

  it("rejects periods that are not whole months or run backwards", async () => {
    expect(await violation(cost({ start: "2026-03-15", end: "2026-03-15" }))).toBe("23514");
    expect(await violation(cost({ start: "2026-05-01", end: "2026-03-01", basis: "quarterly" }))).toBe("23514");
  });

  it("refuses to delete an initiative that still has usage or cost rows", async () => {
    expect(await violation("DELETE FROM initiatives WHERE initiative_id = 'NMB-901'")).toBe("23503");
  });

  it("stores money as exact numeric, not floating point", async () => {
    const [row] = await query<{ value: string }>(db.pool, "SELECT (0.1::numeric + 0.2::numeric)::text AS value");
    expect(row?.value).toBe("0.3");
    const [type] = await query<{ data_type: string }>(
      db.pool,
      "SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'cost_benefit' AND column_name = 'value'",
      [db.schema],
    );
    expect(type?.data_type).toBe("numeric");
  });
});
