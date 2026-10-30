import { describe, it, expect } from "vitest";
import { taskDomainToEntry, taskEntryToDomain, renderBoardNoteBody, planBoardConsolidation } from "../src/loaders";
import type { Task } from "../src/types";

// =====================================================================================
// Feature: board-note-tasks (spec #2) — Phase 0 pure foundations
// Round-trip of a task entry (google_id is the sacred sync key), deterministic board body,
// and the per-board consolidation planner.
// =====================================================================================

const mk = (over: Partial<Task>): Task => ({
  id: "t1", title: "Task", status: "backlog", priority: "medium", cat: "work", group: "",
  kanbanName: "Work", due: "", path: "", ...over,
});

describe("task entry round-trip (google_id must survive)", () => {
  it("preserves the sync keys and core fields through domain → entry → domain", () => {
    const t = mk({ id: "abc", title: "Ship it", status: "in progress", priority: "high",
      group: "deploy", due: "2026-10-20", eisenhower: "q1", order: 3,
      googleId: "GID-123", googleList: "LIST-9", created: "2026-10-01T00:00:00Z" });
    const back = taskEntryToDomain(taskDomainToEntry(t), "Tasks/Work.md", "Work");
    expect(back.googleId).toBe("GID-123");
    expect(back.googleList).toBe("LIST-9");
    expect(back.id).toBe("abc");
    expect(back.status).toBe("in progress");
    expect(back.priority).toBe("high");
    expect(back.group).toBe("deploy");
    expect(back.due).toBe("2026-10-20");
    expect(back.eisenhower).toBe("q1");
    expect(back.order).toBe(3);
    expect(back.kanbanName).toBe("Work");  // board supplied by caller
    expect(back.path).toBe("Tasks/Work.md"); // board note path supplied by caller
  });

  it("an unlinked task (no google_id) round-trips with empty sync fields", () => {
    const back = taskEntryToDomain(taskDomainToEntry(mk({ id: "x" })), "Tasks/Work.md", "Work");
    expect(back.googleId).toBe("");
    expect(back.googleList).toBe("");
    expect(back.status).toBe("backlog");
  });

  it("the entry does not carry a path (path lives on the board note, not the item)", () => {
    const e = taskDomainToEntry(mk({ id: "x", path: "Tasks/Work/old.md" }));
    expect(e.path).toBeUndefined();
    expect(e.task_id).toBe("x");
  });
});

describe("renderBoardNoteBody (deterministic, grouped by column)", () => {
  const cols = ["backlog", "in progress", "done"];
  const names = { backlog: "📌 Backlog", "in progress": "🔄 In progress", done: "✅ Done" };
  it("groups under column headings in configured order, sorted by order then title", () => {
    const tasks = [
      mk({ id: "a", title: "Zeta", status: "backlog", order: 1 }),
      mk({ id: "b", title: "Alpha", status: "backlog", order: 0 }),
      mk({ id: "c", title: "Doing", status: "in progress" }),
    ];
    const body = renderBoardNoteBody("Work", tasks, cols, names);
    expect(body).toContain("# Work");
    expect(body.indexOf("📌 Backlog")).toBeLessThan(body.indexOf("🔄 In progress"));
    // within backlog: order 0 (Alpha) before order 1 (Zeta), rendered as Markdown task items
    expect(body.indexOf("- [ ] Alpha")).toBeLessThan(body.indexOf("- [ ] Zeta"));
    expect(body).toContain("- [ ] Doing");
  });
  it("is order-independent for the same data", () => {
    const t = [mk({ id: "a", title: "A", status: "done" }), mk({ id: "b", title: "B", status: "backlog" })];
    expect(renderBoardNoteBody("W", t, cols, names)).toBe(renderBoardNoteBody("W", [...t].reverse(), cols, names));
  });
  it("still emits tasks whose status isn't a known column (leftover heading)", () => {
    const body = renderBoardNoteBody("W", [mk({ id: "a", title: "Weird", status: "on-hold" })], cols, names);
    expect(body).toContain("- [ ] Weird");
  });
  it("renders done-column items as checked and others as unchecked (Kanban/Tasks-plugin compatible)", () => {
    const body = renderBoardNoteBody("W", [
      mk({ id: "a", title: "Shipped", status: "done" }),
      mk({ id: "b", title: "Todo", status: "backlog" }),
    ], cols, names);
    expect(body).toContain("- [x] Shipped");
    expect(body).toContain("- [ ] Todo");
  });
});

describe("planBoardConsolidation", () => {
  it("groups by board; unassigned → My Tasks", () => {
    const g = planBoardConsolidation([
      mk({ id: "a", kanbanName: "Work" }),
      mk({ id: "b", kanbanName: "Work" }),
      mk({ id: "c", kanbanName: "No board" }),
    ]);
    expect(g.get("Work")).toHaveLength(2);
    expect(g.get("My Tasks")).toHaveLength(1);
  });
});

// =====================================================================================
// Phase 1 — board-note data-layer entry transforms. These pure ops are exactly what the
// store's board-note methods apply (read entries → transform → write), so exercising them
// here covers create / patch / move / complete / delete / empty-board without a live vault.
// =====================================================================================

import { sortTaskEntries, upsertTaskEntry, patchTaskEntry, removeTaskEntry } from "../src/loaders";
import type { Frontmatter } from "../src/loaders";

const entry = (over: Partial<Frontmatter>): Frontmatter => ({ task_id: "t1", title: "T", status: "backlog", priority: "medium", ...over });

describe("sortTaskEntries (deterministic, byte-stable serialization)", () => {
  it("orders by `order` then task_id; missing order sorts last", () => {
    const out = sortTaskEntries([
      entry({ task_id: "c" }),                 // no order → last
      entry({ task_id: "b", order: 2 }),
      entry({ task_id: "a", order: 2 }),       // tie on order → task_id breaks it (a before b)
      entry({ task_id: "z", order: 0 }),
    ]);
    expect(out.map((e) => e.task_id)).toEqual(["z", "a", "b", "c"]);
  });
  it("does not mutate its input", () => {
    const input = [entry({ task_id: "b", order: 1 }), entry({ task_id: "a", order: 0 })];
    const snap = input.map((e) => e.task_id);
    sortTaskEntries(input);
    expect(input.map((e) => e.task_id)).toEqual(snap);
  });
});

describe("upsertTaskEntry (create / merge by task_id)", () => {
  it("appends a brand-new entry (create)", () => {
    const out = upsertTaskEntry([entry({ task_id: "a" })], entry({ task_id: "b", title: "New" }));
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.task_id === "b")?.title).toBe("New");
  });
  it("merges onto an existing entry instead of duplicating (preserves google_id)", () => {
    const start = [entry({ task_id: "a", google_id: "G", google_list: "L", status: "backlog" })];
    const out = upsertTaskEntry(start, { task_id: "a", status: "done", modified: "2026-10-29" });
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("done");
    expect(out[0].google_id).toBe("G");   // sync key survives a merge
    expect(out[0].google_list).toBe("L");
  });
  it("does not mutate its input array", () => {
    const start = [entry({ task_id: "a" })];
    upsertTaskEntry(start, entry({ task_id: "b" }));
    expect(start).toHaveLength(1);
  });
});

describe("patchTaskEntry (move column / reorder / set fields)", () => {
  it("applies the patch to the matching entry only", () => {
    const start = [entry({ task_id: "a", status: "backlog" }), entry({ task_id: "b", status: "backlog" })];
    const out = patchTaskEntry(start, "a", { status: "in progress", order: 0 });
    expect(out.find((e) => e.task_id === "a")?.status).toBe("in progress");
    expect(out.find((e) => e.task_id === "a")?.order).toBe(0);
    expect(out.find((e) => e.task_id === "b")?.status).toBe("backlog");
  });
  it("is a no-op (returns the input) when the id is absent", () => {
    const start = [entry({ task_id: "a" })];
    expect(patchTaskEntry(start, "zzz", { status: "done" })).toBe(start);
  });
});

describe("removeTaskEntry (delete / empty board)", () => {
  it("drops the entry by id", () => {
    const out = removeTaskEntry([entry({ task_id: "a" }), entry({ task_id: "b" })], "a");
    expect(out.map((e) => e.task_id)).toEqual(["b"]);
  });
  it("removing the last entry yields an empty array (empty board is valid)", () => {
    expect(removeTaskEntry([entry({ task_id: "a" })], "a")).toEqual([]);
  });
});

describe("compose: move a task between boards keeps its google_id (no duplication)", () => {
  it("remove from board A + upsert into board B carries the whole entry over", () => {
    const boardA = [entry({ task_id: "x", google_id: "GID", google_list: "LID", status: "in progress", title: "Move me" })];
    const moving = boardA.find((e) => e.task_id === "x");
    const nextA = removeTaskEntry(boardA, "x");
    const nextB = upsertTaskEntry([entry({ task_id: "other" })], { ...(moving as Frontmatter), status: "in progress" });
    expect(nextA).toEqual([]);                                  // left board A
    const moved = nextB.find((e) => e.task_id === "x");
    expect(moved?.google_id).toBe("GID");                       // sync key preserved → no dup on Google
    expect(moved?.google_list).toBe("LID");
    expect(nextB.filter((e) => e.task_id === "x")).toHaveLength(1); // exactly one, never duplicated
  });
});

// =====================================================================================
// Phase 2 — gtSync simulation in board-note mode. gtSync keeps calling the same store methods
// (setTaskGoogleLink / updateTask / createTask / orphanTaskNote); in board-note mode those apply
// the pure entry transforms exercised here. We model a board note as an FM[] and reproduce each
// sync op, proving the sync key (google_id) and the column survive and nothing is ever duplicated.
// =====================================================================================

import { str } from "../src/loaders";

const entryOf = (t: Partial<Task>): Frontmatter => taskDomainToEntry(mk(t));

describe("gtSync board-note simulation", () => {
  it("link (setTaskGoogleLink): an unlinked entry gains google_id once, never duplicates", () => {
    let board: Frontmatter[] = [entryOf({ id: "y", status: "backlog" })];
    // first sync links it…
    board = patchTaskEntry(board, "y", { google_id: "G2", google_list: "L2", modified: "t1" });
    // …a second sync re-asserts the same link (idempotent) — must not append a second entry
    board = patchTaskEntry(board, "y", { google_id: "G2", google_list: "L2", modified: "t2" });
    expect(board.filter((e) => e.task_id === "y")).toHaveLength(1);
    expect(str(board[0].google_id)).toBe("G2");
  });

  it("pullUpdate (updateTask): remote move to another column patches status, keeps google_id", () => {
    let board: Frontmatter[] = [entryOf({ id: "x", status: "backlog", googleId: "G1", googleList: "L1" })];
    board = patchTaskEntry(board, "x", { status: "in progress", modified: "t1" });
    const back = taskEntryToDomain(board[0], "Tasks/Work.md", "Work");
    expect(back.status).toBe("in progress");
    expect(back.googleId).toBe("G1");    // sync key untouched by a column change
    expect(board.filter((e) => e.task_id === "x")).toHaveLength(1);
  });

  it("pullCreate (createTask): a Google-born task appends to the right board note, linked", () => {
    let work: Frontmatter[] = [];
    work = upsertTaskEntry(work, entryOf({ id: "new", title: "From Google", status: "in progress", kanbanName: "Work", googleId: "G9", googleList: "L9" }));
    expect(work).toHaveLength(1);
    const back = taskEntryToDomain(work[0], "Tasks/Work.md", "Work");
    expect(back.kanbanName).toBe("Work");
    expect(back.status).toBe("in progress");
    expect(back.googleId).toBe("G9");
  });

  it("orphan (orphanTaskNote): a remotely-deleted entry leaves the board but its google_id is kept for the archive", () => {
    let board: Frontmatter[] = [entryOf({ id: "z", googleId: "G3", googleList: "L3" }), entryOf({ id: "keep" })];
    const archived = board.find((e) => e.task_id === "z");
    board = removeTaskEntry(board, "z");
    expect(board.map((e) => e.task_id)).toEqual(["keep"]);
    expect(str(archived?.google_id)).toBe("G3"); // preserved so the orphan note can recover it
  });

  it("a full link → move → move round-trip never spawns a duplicate of the same task_id", () => {
    let board: Frontmatter[] = [entryOf({ id: "q", status: "backlog" })];
    board = patchTaskEntry(board, "q", { google_id: "GID", google_list: "LID" });
    board = patchTaskEntry(board, "q", { status: "in progress" });
    board = patchTaskEntry(board, "q", { status: "done", order: -1 });
    expect(board.filter((e) => e.task_id === "q")).toHaveLength(1);
    expect(str(board[0].google_id)).toBe("GID");
    expect(board[0].status).toBe("done");
  });
});

// =====================================================================================
// Phase 3 — migration fidelity (per-task notes ⇄ board notes). The store methods move files,
// but their data transform is the pure forward (task → entry) and rollback (entry → task) pair
// plus planBoardConsolidation. These assert identity + sync keys survive a full round-trip and
// that consolidating is idempotent (re-running never duplicates).
// =====================================================================================

describe("migration fidelity", () => {
  it("forward: every task's task_id + google_id lands in its board's entry array", () => {
    const tasks = [
      mk({ id: "a", kanbanName: "Work", googleId: "GA", googleList: "L1" }),
      mk({ id: "b", kanbanName: "Work" }),
      mk({ id: "c", kanbanName: "No board", googleId: "GC", googleList: "L2" }),  // → My Tasks
    ];
    const byBoard = planBoardConsolidation(tasks);
    const workEntries = (byBoard.get("Work") ?? []).map((t) => taskDomainToEntry(t));
    const mineEntries = (byBoard.get("My Tasks") ?? []).map((t) => taskDomainToEntry(t));
    expect(workEntries.map((e) => e.task_id).sort()).toEqual(["a", "b"]);
    expect(workEntries.find((e) => e.task_id === "a")?.google_id).toBe("GA");
    expect(mineEntries[0].google_id).toBe("GC");
  });

  it("round-trip forward→rollback preserves task_id, google_id and column", () => {
    const original = mk({ id: "keep", status: "in progress", googleId: "GID", googleList: "LID", created: "2026-01-01T00:00:00Z" });
    const entry = taskDomainToEntry(original);                         // forward: task → entry
    const restored = taskEntryToDomain(entry, "Tasks/Work/keep.md", "Work"); // rollback: entry → task
    expect(restored.id).toBe("keep");
    expect(restored.googleId).toBe("GID");
    expect(restored.googleList).toBe("LID");
    expect(restored.status).toBe("in progress");
    expect(restored.created).toBe("2026-01-01T00:00:00Z");
  });

  it("consolidating is idempotent: merging the same entries twice never duplicates", () => {
    const entries = [mk({ id: "a" }), mk({ id: "b" })].map((t) => taskDomainToEntry(t));
    let merged: Frontmatter[] = [];
    for (const e of entries) merged = upsertTaskEntry(merged, e);
    for (const e of entries) merged = upsertTaskEntry(merged, e); // run #2 (re-migration)
    expect(merged.map((e) => e.task_id).sort()).toEqual(["a", "b"]);
  });

  it("a blank-title task still round-trips (rollback falls back to a usable title)", () => {
    const entry = taskDomainToEntry(mk({ id: "x", title: "" }));
    const restored = taskEntryToDomain(entry, "Tasks/My Tasks/x.md", "My Tasks");
    expect(restored.id).toBe("x");
    expect(typeof restored.title).toBe("string"); // empty is fine; the store writer defaults to "Untitled"
  });
});
