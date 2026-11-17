import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SourceTexts } from "../ingest/records.js";

// Test helpers only (excluded from the production build). See nimbus-sample/README.md.

export const FIXTURE_DIR = resolve(import.meta.dirname, "nimbus-sample");

export const FIXTURE_FILES = ["fx_rates.csv", "initiatives.csv", "weekly_usage.csv", "cost_benefit.csv"] as const;

export async function readFixture(): Promise<SourceTexts> {
  const read = (file: string) => readFile(join(FIXTURE_DIR, file), "utf8");
  return {
    fxRates: await read("fx_rates.csv"),
    initiatives: await read("initiatives.csv"),
    weeklyUsage: await read("weekly_usage.csv"),
    costBenefit: await read("cost_benefit.csv"),
  };
}
