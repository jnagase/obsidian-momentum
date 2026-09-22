import { describe, it, expect } from "vitest";
import { planNoteDuplicates } from "../src/gtSync";
import { collisionFreeRel } from "../src/data";
import type { Task } from "../src/types";

// =====================================================================================
// Feature: tasks dedup safety + case-insensitive unique paths
//
// Regression guard for the data-loss bug: the duplicate reconciliation used a number-stripped
// "base title", so "teste 1"/"teste 2"/… were treated as copies of "teste" and the extras were
// deleted. Grouping is now by EXACT title, so distinct numbered cards are never collapsed while
// genuine duplicates (same frontmatter title) still are.
// =====================================================================================

const COLS = ["backlog", "in progress", "done"];
const localStatus = (t: Task): "completed" | "needsAction" => (t.status === "done" ? "completed" : "needsAction");

let seq = 0;
function mk(title: string, o: Partial<Task> = {}): Task {
  return {
    id: o.id ?? `id-${seq++}`,
    title,
    status: o.status ?? "backlog",
    priority: "medium",
    kanbanName: o.kanbanName ?? "My Tasks",
    due: o.due ?? "",
    googleId: o.googleId,
    googleList: o.googleList,
    path: o.path ?? `Tasks/${o.kanbanName ?? "My Tasks"}/${title}.md`,
  } as Task;
}

describe("planNoteDuplicates — distinct numbered cards are NOT duplicates (the bug)", () => {
  it("keeps teste, teste 1..teste 5 as separate tasks (nothing to collapse)", () => {
    const tasks = ["teste", "teste 1", "teste 2", "teste 3", "teste 4", "teste 5"].map((t) => mk(t));
    expect(planNoteDuplicates(tasks, localStatus, COLS)).toEqual([]);
  });

  it("even with a plain base present, 'Cap 1'/'Cap 2' stay separate", () => {
    const tasks = [mk("Cap"), mk("Cap 1"), mk("Cap 2"), mk("Cap 3")];
    expect(planNoteDuplicates(tasks, localStatus, COLS)).toEqual([]);
  });
});

describe("planNoteDuplicates — genuine duplicates ARE collapsed", () => {
  it("two notes with the identical title collapse to one winner + one loser", () => {
    const linked = mk("teste 3", { googleId: "gid1" });
    const copy = mk("teste 3");
    const groups = planNoteDuplicates([linked, copy], localStatus, COLS);
    expect(groups).toHaveLength(1);
    expect(groups[0].winner).toBe(linked); // linked (has google_id) wins deterministically
    expect(groups[0].losers).toEqual([copy]);
  });

  it("is case-insensitive: 'Teste' and 'teste' are the same note", () => {
    const groups = planNoteDuplicates([mk("Teste"), mk("teste")], localStatus, COLS);
    expect(groups).toHaveLength(1);
    expect(groups[0].losers).toHaveLength(1);
  });

  it("keeps the most-advanced column on the winner", () => {
    const a = mk("Report", { status: "backlog", googleId: "g" });
    const b = mk("Report", { status: "in progress" });
    const groups = planNoteDuplicates([a, b], localStatus, COLS);
    expect(groups).toHaveLength(1);
    expect(groups[0].column).toBe("in progress");
  });
});

describe("planNoteDuplicates — separated by board / status / due", () => {
  it("same title in different boards is not a duplicate", () => {
    const g = planNoteDuplicates([mk("X", { kanbanName: "A" }), mk("X", { kanbanName: "B" })], localStatus, COLS);
    expect(g).toEqual([]);
  });

  it("same title with different done-bit (backlog vs done) is not a duplicate", () => {
    const g = planNoteDuplicates([mk("X", { status: "backlog" }), mk("X", { status: "done" })], localStatus, COLS);
    expect(g).toEqual([]);
  });

  it("backlog vs in-progress (same needsAction bit) IS a duplicate", () => {
    const g = planNoteDuplicates([mk("X", { status: "backlog" }), mk("X", { status: "in progress" })], localStatus, COLS);
    expect(g).toHaveLength(1);
  });

  it("same title with different due dates is not a duplicate", () => {
    const g = planNoteDuplicates([mk("X", { due: "2026-01-01" }), mk("X", { due: "2026-02-02" })], localStatus, COLS);
    expect(g).toEqual([]);
  });

  it("blank / untitled notes are never duplicates", () => {
    const g = planNoteDuplicates([mk("untitled"), mk("untitled"), mk("")], localStatus, COLS);
    expect(g).toEqual([]);
  });

  it("is deterministic regardless of input order", () => {
    const a = mk("Dup", { googleId: "b" });
    const b = mk("Dup", { googleId: "a" });
    const g1 = planNoteDuplicates([a, b], localStatus, COLS);
    const g2 = planNoteDuplicates([b, a], localStatus, COLS);
    expect(g1[0].winner.googleId).toBe("a"); // smallest google_id wins on both orderings
    expect(g2[0].winner.googleId).toBe("a");
  });
});

describe("collisionFreeRel — case-insensitive unique paths", () => {
  const id = (r: string) => r; // full path == rel for the test
  const taken = (paths: string[]) => new Set(paths.map((p) => p.toLowerCase()));

  it("returns base.md when nothing collides", () => {
    expect(collisionFreeRel("Tasks/My Tasks", "teste", taken([]), id)).toBe("Tasks/My Tasks/teste.md");
  });

  it("appends ' 2' on an exact collision", () => {
    expect(collisionFreeRel("Tasks/My Tasks", "teste", taken(["Tasks/My Tasks/teste.md"]), id))
      .toBe("Tasks/My Tasks/teste 2.md");
  });

  it("treats a different-case existing file as a collision (macOS/Windows FS)", () => {
    expect(collisionFreeRel("Tasks/My Tasks", "teste", taken(["Tasks/My Tasks/Teste.md"]), id))
      .toBe("Tasks/My Tasks/teste 2.md");
  });

  it("walks the numbered chain until a free name", () => {
    const t = taken(["Tasks/My Tasks/teste.md", "Tasks/My Tasks/teste 2.md", "Tasks/My Tasks/teste 3.md"]);
    expect(collisionFreeRel("Tasks/My Tasks", "teste", t, id)).toBe("Tasks/My Tasks/teste 4.md");
  });
});
