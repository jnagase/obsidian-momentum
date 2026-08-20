import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseChecklist } from "./checklist.property.test";

// =====================================================================================
// Feature: google-oauth-verification
// Example test — the checklist covers every acceptance criterion
//
// Property 13 is satisfied by an EMPTY checklist, so this is the test that makes the gate mean
// something: every criterion of Requirements 1–9 must appear exactly once. A forgotten criterion
// would otherwise let the submission go out with an unverified requirement.
//
// Validates: Requirements 10.1
// =====================================================================================

/** Criteria count per requirement, taken from requirements.md. */
const EXPECTED: Record<number, number> = {
  1: 9,
  2: 10,
  3: 16,
  4: 7,
  5: 8,
  6: 11,
  7: 11,
  8: 8,
  9: 11,
};

const items = parseChecklist(readFileSync("docs/oauth-verification/submission-checklist.md", "utf8"));
const ids = items.map((i) => i.id);

describe("the checklist covers Requirements 1 to 9", () => {
  it("lists every expected criterion exactly once", () => {
    const missing: string[] = [];
    const duplicated: string[] = [];

    for (const [req, count] of Object.entries(EXPECTED)) {
      for (let n = 1; n <= count; n++) {
        const id = `${req}.${n}`;
        const occurrences = ids.filter((i) => i === id).length;
        if (occurrences === 0) missing.push(id);
        if (occurrences > 1) duplicated.push(`${id} (${occurrences}x)`);
      }
    }

    expect(missing).toEqual([]);
    expect(duplicated).toEqual([]);
  });

  it("lists nothing beyond Requirements 1 to 9", () => {
    const expectedIds = new Set(
      Object.entries(EXPECTED).flatMap(([req, count]) =>
        Array.from({ length: count }, (_, i) => `${req}.${i + 1}`),
      ),
    );
    const unexpected = ids.filter((id) => !expectedIds.has(id));
    expect(unexpected).toEqual([]);
  });

  it("has the expected total number of items", () => {
    const total = Object.values(EXPECTED).reduce((a, b) => a + b, 0);
    expect(items.length).toBe(total);
  });

  it("gives every item an evidence cell and a date once it is done", () => {
    for (const item of items.filter((i) => i.state === "concluído")) {
      expect(item.evidence).not.toBe("");
      expect(item.evidence).not.toBe("—");
      expect(item.lastChanged).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
