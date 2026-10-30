import { describe, it, expect } from "vitest";
import { colRank, mostAdvancedCol, pullCreateStatus, shouldMaterializeBoard, encodeCol, decodeCol } from "../src/gtSync";
import { isObsidianConfigSyncPath } from "../src/driveSync";
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

// =====================================================================================
// SIMULATION — the 0.8.13 cross-device column round-trip (the "In progress → Backlog" bug).
//
// Google Tasks has no column, so Momentum carries it in the task `notes` (encodeCol on push,
// decodeCol on pull). This models the full trip: device A creates a task in some column → the
// push writes the notes marker → Google stores it → device B (which has NO local note yet) pulls
// and must land it in the SAME column. Before the fix, B always fell back to the first column.
// =====================================================================================
describe("SIMULATION: Kanban column survives a Google Tasks round-trip across devices", () => {
  const COLS = ["backlog", "in progress", "done"];
  const firstCol = "backlog";
  const doneCol = "done";

  /** What Google holds after device A pushes a task in `localCol` (status is the done-bit). */
  function pushToGoogle(localCol: string): { notes: string; status: "needsAction" | "completed" } {
    return { notes: encodeCol(localCol), status: localCol === doneCol ? "completed" : "needsAction" };
  }
  /** The column a FRESH device B assigns when it pulls that Google task (no local note yet). */
  function pullOnFreshDevice(gt: { notes: string; status: "needsAction" | "completed" }): string {
    const notesCol = decodeCol(gt.notes, COLS);
    return pullCreateStatus(gt.status, "sig-new", new Map<string, string>(), firstCol, doneCol, notesCol);
  }

  it("'in progress' made on the phone lands in 'in progress' on the PC (the reported bug)", () => {
    expect(pullOnFreshDevice(pushToGoogle("in progress"))).toBe("in progress");
  });

  it("preserves every non-done column across the trip", () => {
    for (const col of ["backlog", "in progress"]) {
      expect(pullOnFreshDevice(pushToGoogle(col))).toBe(col);
    }
  });

  it("a done task round-trips to the done column", () => {
    expect(pullOnFreshDevice(pushToGoogle("done"))).toBe("done");
  });

  it("a legacy Google task with NO marker falls back to the first column (old behaviour, no crash)", () => {
    expect(pullOnFreshDevice({ notes: "", status: "needsAction" })).toBe("backlog");
  });

  it("a marker naming a column this device doesn't have is ignored (falls back safely)", () => {
    expect(pullOnFreshDevice({ notes: encodeCol("doing"), status: "needsAction" })).toBe("backlog");
  });

  it("a user-typed note around the marker still decodes (marker is found, not the whole notes)", () => {
    const notes = `remember the thing\n${encodeCol("in progress")}`;
    expect(pullOnFreshDevice({ notes, status: "needsAction" })).toBe("in progress");
  });

  it("encodeCol/decodeCol is an exact round-trip for every configured column", () => {
    for (const col of COLS) expect(decodeCol(encodeCol(col), COLS)).toBe(col);
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

// -------------------------------------------------------------------------------------
// Bug 1: a Google Tasks list (even an EMPTY one) must surface as a local board. Previously
// a board only appeared once its first task was pulled, so a new empty list stayed invisible.
// shouldMaterializeBoard decides which discovered lists get a board folder created now.
// -------------------------------------------------------------------------------------
describe("shouldMaterializeBoard — empty Google list becomes a board (bug 1)", () => {
  const none = new Set<string>();

  it("materializes a brand-new list (the reported 'Shopping' case)", () => {
    expect(shouldMaterializeBoard("Shopping", none, none)).toBe(true);
  });

  it("does not duplicate a board that already exists locally", () => {
    expect(shouldMaterializeBoard("Work", new Set(["Work"]), none)).toBe(false);
  });

  it("never resurrects a tombstoned (user-deleted) board", () => {
    expect(shouldMaterializeBoard("Deleted", none, new Set(["Deleted"]))).toBe(false);
  });

  it("skips the permanent 'My Tasks' list (handled separately)", () => {
    expect(shouldMaterializeBoard("My Tasks", none, none)).toBe(false);
  });
});

describe("isObsidianConfigSyncPath — allowlist-only (.obsidian config sync, Pro)", () => {
  it("NEVER syncs secrets or per-device state (the safety-critical property)", () => {
    expect(isObsidianConfigSyncPath(".obsidian/plugins/momentum-life/data.json", ".obsidian")).toBe(false);
    expect(isObsidianConfigSyncPath(".obsidian/plugins/any-plugin/data.json", ".obsidian")).toBe(false);
    expect(isObsidianConfigSyncPath(".obsidian/data.json", ".obsidian")).toBe(false);
    expect(isObsidianConfigSyncPath(".obsidian/workspace.json", ".obsidian")).toBe(false);
    expect(isObsidianConfigSyncPath(".obsidian/workspace-mobile.json", ".obsidian")).toBe(false);
    // Honours a custom config dir too.
    expect(isObsidianConfigSyncPath("my-config/plugins/x/data.json", "my-config")).toBe(false);
    expect(isObsidianConfigSyncPath("my-config/appearance.json", "my-config")).toBe(true);
  });

  it("allows the safe config files, snippets, themes, and plugin CODE only", () => {
    expect(isObsidianConfigSyncPath(".obsidian/appearance.json", ".obsidian")).toBe(true);
    expect(isObsidianConfigSyncPath(".obsidian/community-plugins.json", ".obsidian")).toBe(true);
    expect(isObsidianConfigSyncPath(".obsidian/hotkeys.json", ".obsidian")).toBe(true);
    expect(isObsidianConfigSyncPath(".obsidian/snippets/my.css", ".obsidian")).toBe(true);
    expect(isObsidianConfigSyncPath(".obsidian/themes/Catppuccin/theme.css", ".obsidian")).toBe(true);
    expect(isObsidianConfigSyncPath(".obsidian/plugins/dataview/manifest.json", ".obsidian")).toBe(true);
    expect(isObsidianConfigSyncPath(".obsidian/plugins/dataview/main.js", ".obsidian")).toBe(true);
    expect(isObsidianConfigSyncPath(".obsidian/plugins/dataview/styles.css", ".obsidian")).toBe(true);
  });

  it("refuses anything outside the config dir and unknown plugin files", () => {
    expect(isObsidianConfigSyncPath("Books/Antifrágil.md", ".obsidian")).toBe(false);
    expect(isObsidianConfigSyncPath(".obsidian/plugins/x/cache.db", ".obsidian")).toBe(false);
    expect(isObsidianConfigSyncPath(".obsidian/plugins/x/secret.json", ".obsidian")).toBe(false);
    expect(isObsidianConfigSyncPath(".obsidian/unknown-config.json", ".obsidian")).toBe(false);
  });
});
