import { describe, it, expect } from "vitest";
import {
  taskDomainToEntry, taskEntryToDomain, planBoardConsolidation,
  upsertTaskEntry, sortTaskEntries, boardNoteGoogleIds,
} from "../src/loaders";
import type { Frontmatter } from "../src/loaders";
import type { Task } from "../src/types";

// =====================================================================================
// Board-note regression simulations — each targets a failure class that actually bit us while
// bringing up the board-note model, so these are the guards that would have caught them:
//   1. deletion shield losing google_ids in board-note mode (→ tasks deleted on Google)
//   2. the forward migration dropping / mis-grouping tasks or losing the "in progress" column
//   3. the recovery dedup losing a task when the same id lived in several files
//   4. the UI drag keying on `path` (shared by every card in a board) instead of task_id
//   5. the board-note `tasks` serialization not round-tripping through the read-back parse
// =====================================================================================

let seq = 0;
const mk = (o: Partial<Task> = {}): Task => ({
  id: o.id ?? `id-${seq++}`, title: o.title ?? "T", status: o.status ?? "backlog",
  priority: o.priority ?? "medium", kanbanName: o.kanbanName ?? "My Tasks", due: o.due ?? "",
  path: o.path ?? "", ...o,
});

// A realistic mixed fixture (boards, columns, linked + unlinked), like a real vault.
const fixture = (): Task[] => [
  mk({ id: "w1", title: "Deploy", status: "in progress", kanbanName: "Work", googleId: "GW1", googleList: "LW" }),
  mk({ id: "w2", title: "Review", status: "backlog", kanbanName: "Work", googleId: "GW2", googleList: "LW" }),
  mk({ id: "w3", title: "Ship", status: "done", kanbanName: "Work" }),
  mk({ id: "c1", title: "Home page", status: "backlog", kanbanName: "Coding Projects" }),
  mk({ id: "c2", title: "Fitbit", status: "done", kanbanName: "Coding Projects", googleId: "GC2", googleList: "LC" }),
  mk({ id: "u1", title: "Buy milk", status: "done", kanbanName: "" }),          // unassigned → My Tasks
  mk({ id: "u2", title: "Call mom", status: "backlog", kanbanName: "No board" }), // → My Tasks
];

// ------------------------------------------------------------------------------------
describe("1. deletion shield: boardNoteGoogleIds extracts EVERY linked id from a board note", () => {
  const serialize = (entries: Frontmatter[]) => `---\ntype: task-board\nboard: "Work"\ntasks: ${JSON.stringify(entries)}\n---\n# Work\n`;

  it("returns all google_ids a board note holds (not 0, not just the first)", () => {
    const raw = serialize([
      taskDomainToEntry(mk({ id: "a", googleId: "GID1", googleList: "L" })),
      taskDomainToEntry(mk({ id: "b", googleId: "GID2", googleList: "L" })),
      taskDomainToEntry(mk({ id: "c" })), // unlinked, no google_id
    ]);
    expect(boardNoteGoogleIds(raw).sort()).toEqual(["GID1", "GID2"]);
  });

  it("still finds ids even if the frontmatter block is malformed around them (the whole point)", () => {
    const raw = `---\ntasks: [{"task_id":"a","google_id":"GID1"} GARBAGE {"google_id":"GID2"\n---`;
    expect(boardNoteGoogleIds(raw)).toEqual(["GID1", "GID2"]);
  });

  it("a board note with linked tasks never yields an empty shield (the data-loss trigger)", () => {
    const raw = serialize([taskDomainToEntry(mk({ id: "a", googleId: "G", googleList: "L" }))]);
    expect(boardNoteGoogleIds(raw).length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------------
describe("2. forward migration fidelity (folder → board notes)", () => {
  it("loses no task, groups by board, and preserves every status incl. 'in progress'", () => {
    const tasks = fixture();
    const byBoard = planBoardConsolidation(tasks);
    const allEntries = [...byBoard.values()].flat();
    // nothing lost
    expect(allEntries.length).toBe(tasks.length);
    // grouping
    expect(byBoard.get("Work")).toHaveLength(3);
    expect(byBoard.get("Coding Projects")).toHaveLength(2);
    expect(byBoard.get("My Tasks")).toHaveLength(2); // u1 + u2 folded in
    // statuses survive — "in progress" must not collapse to backlog
    const work = (byBoard.get("Work") ?? []).map((t) => taskDomainToEntry(t));
    const statuses = work.map((e) => e.status).sort();
    expect(statuses).toEqual(["backlog", "done", "in progress"]);
    // sync keys survive
    expect(work.find((e) => e.task_id === "w1")?.google_id).toBe("GW1");
  });

  it("is idempotent: consolidating the produced entries again never duplicates or drops", () => {
    const tasks = fixture();
    const board = "Work";
    const first = (planBoardConsolidation(tasks).get(board) ?? []).map((t) => taskDomainToEntry(t));
    let again: Frontmatter[] = first.slice();
    for (const e of first) again = upsertTaskEntry(again, e); // re-run merges onto itself
    expect(again.map((e) => e.task_id).sort()).toEqual(first.map((e) => e.task_id).sort());
  });
});

// ------------------------------------------------------------------------------------
describe("3. recovery dedup: the same task_id across several files must survive exactly once", () => {
  it("merging duplicated entries by task_id keeps one per id and preserves the sync key", () => {
    // Simulates the tangle: the real data was spread across a root note and a stray folder dup.
    const rootFragment = [taskDomainToEntry(mk({ id: "x", status: "backlog" }))]; // partial write, no google_id
    const folderRich = [taskDomainToEntry(mk({ id: "x", status: "in progress", googleId: "GX", googleList: "L" }))];
    let merged: Frontmatter[] = [];
    for (const e of [...folderRich, ...rootFragment]) merged = upsertTaskEntry(merged, e);
    expect(merged).toHaveLength(1);               // exactly one survives
    expect(merged[0].google_id).toBe("GX");       // sync key not lost to the fragment
  });

  it("unions distinct ids from multiple files without dropping any", () => {
    const fileA = [mk({ id: "a" }), mk({ id: "b" })].map((t) => taskDomainToEntry(t));
    const fileB = [mk({ id: "b" }), mk({ id: "c" })].map((t) => taskDomainToEntry(t)); // b overlaps
    let merged: Frontmatter[] = [];
    for (const e of [...fileA, ...fileB]) merged = upsertTaskEntry(merged, e);
    expect(merged.map((e) => e.task_id).sort()).toEqual(["a", "b", "c"]);
  });
});

// ------------------------------------------------------------------------------------
describe("4. card identity: within one board note every card shares a path but has a unique id", () => {
  it("so the UI must key drag/search on task_id, never on path", () => {
    const notePath = "Tasks/Work.md";
    const entries = (planBoardConsolidation(fixture()).get("Work") ?? []).map((t) => taskDomainToEntry(t));
    const cards = entries.map((e) => taskEntryToDomain(e, notePath, "Work"));
    expect(new Set(cards.map((c) => c.path)).size).toBe(1);        // all share the board-note path
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length); // every id distinct
  });
});

// ------------------------------------------------------------------------------------
describe("5. board-note tasks array round-trips through the read-back parse", () => {
  // readBoardEntries reads `tasks:` as a single-line JSON array; prove serialize→line-parse is exact.
  it("JSON.stringify on one line + /^tasks:/ parse recovers the entries, in sorted order", () => {
    const entries = sortTaskEntries([
      taskDomainToEntry(mk({ id: "b", order: 1, status: "done", googleId: "G2" })),
      taskDomainToEntry(mk({ id: "a", order: 0, status: "in progress", googleId: "G1" })),
    ]);
    const fmText = `type: "task-board"\nboard: "Work"\ntasks: ${JSON.stringify(entries)}`;
    const m = /^tasks:\s*(.*)$/m.exec(fmText);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(m![1]) as Frontmatter[];
    expect(parsed.map((e) => e.task_id)).toEqual(["a", "b"]); // order 0 before 1
    expect(parsed.find((e) => e.task_id === "a")?.google_id).toBe("G1");
    expect(parsed.find((e) => e.task_id === "a")?.status).toBe("in progress");
  });
});
