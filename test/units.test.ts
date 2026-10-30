import { describe, it, expect } from "vitest";
import { weightUnit, kgToDisplay, displayToKg } from "../src/loaders";

// =====================================================================================
// Weight units — storage is ALWAYS kg; these pure helpers convert for display/input only.
// =====================================================================================

describe("weightUnit", () => {
  it("labels each system", () => {
    expect(weightUnit("metric")).toBe("kg");
    expect(weightUnit("imperial")).toBe("lb");
  });
});

describe("metric is a pass-through (never converts, just rounds to 0.1)", () => {
  it("kgToDisplay / displayToKg are identity in metric", () => {
    expect(kgToDisplay(80, "metric")).toBe(80);
    expect(displayToKg(80, "metric")).toBe(80);
    expect(kgToDisplay(72.37, "metric")).toBe(72.4); // 0.1 rounding
  });
});

describe("imperial converts kg <-> lb", () => {
  it("kgToDisplay shows pounds", () => {
    expect(kgToDisplay(100, "imperial")).toBe(220.5); // 100 / 0.45359237 = 220.46 → 220.5
    expect(kgToDisplay(0, "imperial")).toBe(0);
  });
  it("displayToKg stores kilograms", () => {
    expect(displayToKg(220, "imperial")).toBeCloseTo(99.8, 1);
    expect(displayToKg(0, "imperial")).toBe(0);
  });
});

describe("round-trips", () => {
  it("metric round-trips exactly", () => {
    for (const kg of [0, 60, 72.4, 83.1, 120]) {
      expect(displayToKg(kgToDisplay(kg, "metric"), "metric")).toBe(kg);
    }
  });
  it("imperial round-trips within the 0.1 storage precision", () => {
    for (const kg of [60, 72.5, 83.1, 100, 120]) {
      const back = displayToKg(kgToDisplay(kg, "imperial"), "imperial");
      expect(Math.abs(back - kg)).toBeLessThanOrEqual(0.15);
    }
  });
});
