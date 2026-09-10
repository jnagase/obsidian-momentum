import { describe, it, expect } from "vitest";
import { colRank, mostAdvancedCol, pullCreateStatus } from "../src/gtSync";
import { planBoardDeletions } from "../src/data";
import type { Task } from "../src/types";

// =====================================================================================
// Feature: google-sync-column-and-board-deletion
//
// Pure-logic tests for:
//  - column precedence (Req 1.5): keep the most-advanced column when collapsing duplicates
//  - pullCreate column choice (Req 1.1/1.2/1.3): completed→done, equivalent→inherit, else first
//  - board-deletion planning + sanity shield (Req 2/3/6): init, debounce, mass guard, My Tasks
// =====================================================================================

const COLS = ["backlog", "in progress", "done"];
const t = (status: string): Task => ({ title: "x", status, priority: "medium", path: "p" } as Task);

describe("colRank / mostAdvancedCol (Req 1.5)", () => {
  it("ranks by configured order; unknown column is -1", () => {
    expect(colRank("backlog", COLS)).toBe(0);
    expect(colRank("in progress", COLS)).toBe(1);
    expect(colRank("done", COLS)).toBe(2);
    expect(colRank("weird", COLS)).toBe(-1);
  });

  it("picks the most-advanced column of a group", () => {
    expect(mostAdvancedCol([t("backlog"), t("in progress")], COLS)).toBe("in progress");
    expect(mostAdvancedCol([t("in progress"), t("backlog")], COLS)).toBe("in progress");
    expect(mostAdvancedCol([t("backlog"), t("backlog")], COLS)).toBe("backlog");
    expect(mostAdvancedCol([t("done"), t("done")], COLS)).toBe("done");
  });

  it("is order-independent (deterministic)", () => {
    const g = [t("backlog"), t("in progress"), t("backlog")];
    expect(mostAdvancedCol(g, COLS)).toBe(mostAdvancedCol([...g].reverse(), COLS));
  });

  it("falls back to the first member when no column is known", () => {
    expect(mostAdvancedCol([t("weird"), t("alsoweird")], COLS)).toBe("weird");
  });
});

describe("pullCreateStatus (Req 1.1/1.2/1.3)", () => {
  const firstCol = "backlog";
  const doneCol = "done";

  it("completed remote → done column", () => {
    expect(pullCreateStatus("completed", "sig", new Map(), firstCol, doneCol)).toBe("done");
  });

  it("inherits an equivalent local note's column when one exists", () => {
    const m = new Map([["sig-a", "in progress"]]);
    expect(pullCreateStatus("needsAction", "sig-a", m, firstCol, doneCol)).toBe("in progress");
  });

  it("falls back to the first column for a genuinely new task", () => {
    expect(pullCreateStatus("needsAction", "unknown-sig", new Map(), firstCol, doneCol)).toBe("backlog");
  });

  it("completed wins even if a local column is known", () => {
    const m = new Map([["sig-a", "in progress"]]);
    expect(pullCreateStatus("completed", "sig-a", m, firstCol, doneCol)).toBe("done");
  });
});

describe("planBoardDeletions — sanity shield (Req 2/3/6)", () => {
  it("first observation only initializes; never deletes (Req 6.1)", () => {
    const p = planBoardDeletions(["AWS", "Work"], [], [], [], 2);
    expect(p.toTombstone).toEqual([]);
    expect(new Set(p.nextBoards)).toEqual(new Set(["AWS", "Work"]));
    expect(p.suspicious).toBe(false);
  });

  it("debounce: missing for the first time is only a candidate, not a deletion", () => {
    // known has AWS+Work; AWS folder gone; not in previous pendingRemoval.
    const p = planBoardDeletions(["Work"], ["AWS", "Work"], [], [], 2);
    expect(p.toTombstone).toEqual([]);
    expect(p.nextPending).toEqual(["AWS"]); // becomes a candidate for next sweep
  });

  it("debounce: missing two sweeps in a row → tombstone", () => {
    const p = planBoardDeletions(["Work"], ["AWS", "Work"], ["AWS"], [], 2);
    expect(p.toTombstone).toEqual(["AWS"]);
    expect(p.nextBoards).toEqual(["Work"]);
    expect(p.nextPending).toEqual([]);
  });

  it("a board that reappears drops out of pendingRemoval without deletion", () => {
    const p = planBoardDeletions(["AWS", "Work"], ["AWS", "Work"], ["AWS"], [], 2);
    expect(p.toTombstone).toEqual([]);
    expect(p.nextPending).toEqual([]);
  });

  it("mass disappearance → suspicious, tombstone nothing automatically (Req 3.1)", () => {
    const known = ["a", "b", "c", "d", "e"];
    const prev = ["a", "b", "c", "d"]; // all confirmed missing (2nd sweep)
    const p = planBoardDeletions(["e"], known, prev, [], 2);
    expect(p.suspicious).toBe(true);
    expect(p.toTombstone).toEqual([]);
    expect(new Set(p.suspiciousBoards)).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("vault-empty case is handled by the caller, but My Tasks is never a candidate (Req 2.4)", () => {
    const p = planBoardDeletions(["Work"], ["My Tasks", "Work", "AWS"], ["AWS"], [], 2);
    expect(p.toTombstone).toEqual(["AWS"]);
    expect(p.nextBoards).not.toContain("My Tasks");
  });

  it("already-tombstoned boards are excluded from missing", () => {
    const p = planBoardDeletions(["Work"], ["AWS", "Work"], ["AWS"], ["AWS"], 2);
    expect(p.toTombstone).toEqual([]);
    expect(p.nextPending).toEqual([]);
  });

  it("learns newly-present boards into the registry", () => {
    const p = planBoardDeletions(["Work", "New"], ["Work"], [], [], 2);
    expect(new Set(p.nextBoards)).toEqual(new Set(["Work", "New"]));
    expect(p.toTombstone).toEqual([]);
  });
});
