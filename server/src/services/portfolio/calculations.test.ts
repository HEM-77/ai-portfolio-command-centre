import { describe, expect, it } from "vitest";
import {
  calculateAdoption,
  calculateMonthsLive,
  calculatePaybackMonths,
  calculateRoi,
  deriveStatus,
  roundCents,
} from "./calculations.js";

// Hand-calculated expected values (AGENTS.md §8).

describe("calculateRoi", () => {
  it("is (value - spend) / spend", () => {
    expect(calculateRoi(780000, 2250000)).toBeCloseTo(1.884615, 6); // 1470000 / 780000
    expect(calculateRoi(350000, 420000)).toBeCloseTo(0.2, 10); // 70000 / 350000
    expect(calculateRoi(210000, 60000)).toBeCloseTo(-0.714286, 6); // -150000 / 210000
  });

  it("is exactly 0 when value equals spend, and null when spend is 0", () => {
    expect(calculateRoi(660000, 660000)).toBe(0);
    expect(calculateRoi(0, 1000)).toBeNull();
  });
});

describe("calculateAdoption", () => {
  it("is weekly active users / licensed users", () => {
    expect(calculateAdoption(1260, 2000)).toBe(0.63);
    expect(calculateAdoption(3000, 5000)).toBe(0.6);
    expect(calculateAdoption(75, 250)).toBe(0.3);
  });

  it("is null when either value is unknown or there are no licences", () => {
    expect(calculateAdoption(null, 100)).toBeNull();
    expect(calculateAdoption(10, null)).toBeNull();
    expect(calculateAdoption(10, 0)).toBeNull();
  });
});

describe("calculateMonthsLive", () => {
  it("counts full months from the go-live month to 2026-11-01", () => {
    expect(calculateMonthsLive("2025-11-01")).toBe(12);
    expect(calculateMonthsLive("2026-01-01")).toBe(10);
    expect(calculateMonthsLive("2026-08-01")).toBe(3);
    expect(calculateMonthsLive("2025-12-01")).toBe(11);
  });

  it("never goes negative for a future go-live", () => {
    expect(calculateMonthsLive("2027-01-01")).toBe(0);
  });
});

describe("calculatePaybackMonths", () => {
  it("is spend / (value / months live)", () => {
    expect(calculatePaybackMonths(780000, 2250000, 12)).toBeCloseTo(4.16, 10); // 780000 / 187500
    expect(calculatePaybackMonths(350000, 420000, 7)).toBeCloseTo(5.833333, 6); // 350000 / 60000
  });

  it("is null without realised benefit or months live", () => {
    expect(calculatePaybackMonths(100, 0, 5)).toBeNull();
    expect(calculatePaybackMonths(100, 50, 0)).toBeNull();
  });
});

describe("deriveStatus (Red / Amber / Green)", () => {
  it.each([
    [0.63, 1.88, "on_track"],
    [0.6, 0.5, "on_track"], // adoption exactly 0.60 is Green
    [0.35, 0.2, "at_risk"],
    [0.65, 0, "at_risk"], // ROI exactly 0 is not > 0
    [0.3, 0.1, "at_risk"], // adoption exactly 0.30 is not < 0.30
    [0.25, 0.1, "off_track"], // low adoption, positive ROI
    [0.75, -0.177, "off_track"], // high adoption, negative ROI
  ] as const)("adoption %s, ROI %s -> %s", (adoption, roi, status) => {
    expect(deriveStatus(adoption, roi)).toBe(status);
  });

  it("never reports Green on unknown values", () => {
    expect(deriveStatus(null, 0.5)).toBe("at_risk");
    expect(deriveStatus(0.9, null)).toBe("at_risk");
    expect(deriveStatus(null, -0.1)).toBe("off_track");
    expect(deriveStatus(0.1, null)).toBe("off_track");
  });
});

describe("roundCents", () => {
  it("removes floating-point noise from FX conversion", () => {
    expect(roundCents(486000 * 1.08)).toBe(524880);
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
  });
});
