import { describe, it, expect } from "vitest";
import fc from "fast-check";

// Placeholder harness check for task 2.1. Confirms that the test runner resolves
// TypeScript + ESM, and that fast-check is wired up. The real property/unit tests
// for the readable-notes core are added in task 2.2.
describe("test harness", () => {
  it("runs vitest with TypeScript", () => {
    expect(1 + 1).toBe(2);
  });

  it("has fast-check available", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => n === n),
    );
  });
});
