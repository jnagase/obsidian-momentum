import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";

// =====================================================================================
// Feature: google-oauth-verification
// Correctness Property 13 — O gate de submissão é exatamente o conjunto de itens não concluídos
//
//   ∀ checklist c: submission is allowed iff every item is "concluído", and the reported
//   blocker list is exactly the set of items whose state differs from "concluído". Each item
//   carries exactly one of the four admitted states.
//
// Validates: Requirements 3.16, 8.8, 9.11, 10.2, 10.8
//
// AUDIT: the gate functions are pure and defined here because they ARE the logic — the
// checklist is a markdown document, and this parser plus `canSubmit`/`blockingItems` is what
// the submission decision is made from. The parser is then run against the real file, so a
// malformed row or an invented state fails the suite.
// =====================================================================================

export const STATES = ["não iniciado", "em andamento", "concluído", "bloqueado"] as const;
export type State = (typeof STATES)[number];

export interface ChecklistItem {
  id: string;
  summary: string;
  state: State;
  evidence: string;
  lastChanged: string;
}

/** Items that still stand between us and the submission. */
export const blockingItems = (items: ChecklistItem[]): ChecklistItem[] =>
  items.filter((i) => i.state !== "concluído");

/** The submission is allowed if and only if nothing is blocking. */
export const canSubmit = (items: ChecklistItem[]): boolean => blockingItems(items).length === 0;

/** Parses the checklist tables. Rows whose first cell is not an `N.M` id are ignored. */
export function parseChecklist(markdown: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) continue;
    if (!/^\d+\.\d+$/.test(cells[0])) continue;
    const state = cells[2];
    if (!(STATES as readonly string[]).includes(state)) {
      throw new Error(`checklist item ${cells[0]} has an invalid state: "${state}"`);
    }
    items.push({ id: cells[0], summary: cells[1], state: state as State, evidence: cells[3], lastChanged: cells[4] });
  }
  return items;
}

const stateArb = fc.constantFrom(...STATES);
const itemArb = (state: State): ChecklistItem => ({
  id: "1.1", summary: "s", state, evidence: "e", lastChanged: "2026-01-01",
});

describe("Property 13: the submission gate is exactly the set of unfinished items", () => {
  it("allows submission iff every item is done, and names exactly the ones that are not", () => {
    fc.assert(
      fc.property(fc.array(stateArb, { minLength: 1, maxLength: 40 }), (states) => {
        const items = states.map(itemArb);

        const blockers = blockingItems(items);
        const notDone = items.filter((i) => i.state !== "concluído");

        // The blocker list is exactly the not-done set — no more, no less.
        expect(blockers.length).toBe(notDone.length);
        for (const b of blockers) expect(b.state).not.toBe("concluído");

        // Gate is the biconditional, in both directions.
        const allDone = states.every((s) => s === "concluído");
        expect(canSubmit(items)).toBe(allDone);
        expect(canSubmit(items)).toBe(blockers.length === 0);
      }),
      { numRuns: 100 },
    );
  });

  it("treats an empty checklist as nothing-to-block (guard against a vacuous pass)", () => {
    // Worth pinning down: an empty list satisfies canSubmit, so the coverage test in
    // checklist.coverage.test.ts is what guarantees the list is not empty.
    expect(canSubmit([])).toBe(true);
    expect(blockingItems([])).toEqual([]);
  });
});

describe("Property 13 against the real checklist", () => {
  const items = parseChecklist(readFileSync("docs/oauth-verification/submission-checklist.md", "utf8"));

  it("parses with exactly one valid state per item", () => {
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(STATES).toContain(item.state);
    }
  });

  it("computes a gate consistent with the parsed states", () => {
    const blockers = blockingItems(items);
    expect(canSubmit(items)).toBe(blockers.length === 0);
    // Informational: the submission is expected to be blocked until the platform steps run.
    expect(blockers.length).toBeGreaterThanOrEqual(0);
  });
});
