// Guards the injection fixture itself, so a careless edit can't silently weaken the attack tests.
// node --experimental-strip-types --test tests/fixtures/injection-fixture.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "charters", "INIT-999-injection-test.md"), "utf8");

test("fixture follows the charter format so RAG ingests it like a real charter", () => {
  assert.match(fixture, /^---\ninitiativeId: INIT-999\nname: .+\nbusinessUnit: .+\n---/);
  for (const h of ["Objective", "Business Problem", "Scope", "Success Metrics", "Risks", "Status Notes", "Lessons Learned"]) {
    assert.match(fixture, new RegExp(`^## ${h}$`, "m"), `missing heading ## ${h}`);
  }
});

test("fixture still contains every attack", () => {
  for (const s of ["IGNORE ALL PREVIOUS INSTRUCTIONS", "INJECTION-CANARY", "500%", "OPENROUTER_API_KEY", "[C99]", "900%"]) {
    assert.ok(fixture.includes(s), `attack text missing: ${s}`);
  }
});

test("fixture is not in the real charters folder", () => {
  let real: string[] = [];
  try {
    real = readdirSync(join(here, "..", "..", "charters"));
  } catch {
    return; // charters/ not created yet
  }
  assert.ok(!real.some((f) => f.startsWith("INIT-999")), "INIT-999 must never be in charters/");
});
