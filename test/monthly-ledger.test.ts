import { describe, it, expect } from "vitest";
import {
  txToEntry, entryToTransaction, mealLogToEntry, entryToMealLog, workoutToEntry, entryToWorkout,
  renderFinanceTable, renderNutritionTable, renderFitnessTable, planMonthlyConsolidation, monthLabel,
  sortEntriesByDateId, mergeEntriesById,
} from "../src/loaders";
import type { Transaction, MealLog, Workout } from "../src/types";

// =====================================================================================
// Feature: monthly-ledger-consolidation — Phase 0 (pure foundations)
// Round-trip serializers, deterministic table renderers, and the month-grouping planner.
// =====================================================================================

describe("domain ⇄ entry round-trip (no field loss)", () => {
  it("transaction survives domain → entry → domain (path is the only carried-in field)", () => {
    const t: Transaction = { id: "t1", date: "2026-10-03", type: "expense", amount: 84.2, category: "Food", note: "Market", path: "x" };
    expect(entryToTransaction(txToEntry(t), "Finance/Months/Finance 2026-10 October.md")).toEqual({
      ...t, path: "Finance/Months/Finance 2026-10 October.md",
    });
  });

  it("income transaction with empty note round-trips", () => {
    const t: Transaction = { id: "t2", date: "2026-10-05", type: "income", amount: 5000, category: "Salary", note: "", path: "" };
    const back = entryToTransaction(txToEntry(t), "m.md");
    expect(back.type).toBe("income");
    expect(back.amount).toBe(5000);
    expect(back.note).toBe("");
  });

  it("meal log round-trips (totals + items)", () => {
    const l: MealLog = {
      id: "m1", date: "2026-10-03", mealId: "lunch", totalCal: 620, totalProtein: 40, totalCarbs: 70,
      items: [{ name: "Rice", qty: 100, unit: "g", cal: 130, protein: 3, carbs: 28 }], path: "x",
    };
    expect(entryToMealLog(mealLogToEntry(l), "m.md")).toEqual({ ...l, path: "m.md" });
  });

  it("workout round-trips (exercises + kind)", () => {
    const w: Workout = {
      id: "w1", date: "2026-10-03", split: "A", duration: 45, kind: "strength",
      exercises: [{ exercise: "Bench", weight: 60, sets: "3x10" }], path: "x",
    };
    expect(entryToWorkout(workoutToEntry(w), "m.md")).toEqual({ ...w, path: "m.md" });
  });
});

describe("renderFinanceTable (deterministic)", () => {
  const items: Transaction[] = [
    { id: "b", date: "2026-10-05", type: "income", amount: 5000, category: "Salary", note: "", path: "" },
    { id: "a", date: "2026-10-03", type: "expense", amount: 84.2, category: "Food", note: "Market", path: "" },
  ];
  it("has a month header, totals and one row per item, sorted by date", () => {
    const out = renderFinanceTable(items, "$", "2026-10");
    expect(out).toContain("# Finance — October 2026");
    expect(out).toContain("Balance:");
    const rows = out.split("\n").filter((l) => l.startsWith("| 2026-"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("2026-10-03"); // earliest first
    expect(rows[1]).toContain("2026-10-05");
  });
  it("is stable regardless of input order", () => {
    expect(renderFinanceTable(items, "$", "2026-10")).toBe(renderFinanceTable([...items].reverse(), "$", "2026-10"));
  });
  it("escapes a pipe in a note so the table row stays intact", () => {
    const out = renderFinanceTable([{ id: "a", date: "2026-10-01", type: "expense", amount: 1, category: "X", note: "a|b", path: "" }], "$", "2026-10");
    expect(out).toContain("a\\|b");
  });
});

describe("renderNutritionTable / renderFitnessTable", () => {
  it("nutrition renders totals + rows and resolves meal labels", () => {
    const logs: MealLog[] = [{ id: "m1", date: "2026-10-02", mealId: "lunch", totalCal: 620, totalProtein: 40, totalCarbs: 70, items: [], path: "" }];
    const out = renderNutritionTable(logs, "2026-10", (id) => (id === "lunch" ? "Lunch" : id));
    expect(out).toContain("# Nutrition — October 2026");
    expect(out).toContain("| 2026-10-02 | Lunch | 620 | 40 | 70 |");
  });
  it("fitness renders session summary + resolves split labels", () => {
    const ws: Workout[] = [{ id: "w1", date: "2026-10-02", split: "A", duration: 45, kind: "strength", exercises: [{ exercise: "Bench", weight: 60, sets: "3x10" }], path: "" }];
    const out = renderFitnessTable(ws, "2026-10", (id) => (id === "A" ? "Push" : id));
    expect(out).toContain("# Fitness — October 2026");
    expect(out).toContain("| 2026-10-02 | Push | 45 | strength | Bench |");
  });
});

describe("planMonthlyConsolidation", () => {
  it("groups items by month key", () => {
    const items = [{ date: "2026-10-03" }, { date: "2026-10-20" }, { date: "2026-09-30" }];
    const g = planMonthlyConsolidation(items);
    expect([...g.keys()].sort()).toEqual(["2026-09", "2026-10"]);
    expect(g.get("2026-10")).toHaveLength(2);
    expect(g.get("2026-09")).toHaveLength(1);
  });
  it("drops items with an empty/invalid date (never silently miscategorised)", () => {
    const g = planMonthlyConsolidation([{ date: "" }, { date: "2026-10-01" }]);
    expect(g.has("")).toBe(false);
    expect(g.get("2026-10")).toHaveLength(1);
  });
});

describe("monthLabel", () => {
  it("formats a key; falls back to the raw key when invalid", () => {
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(monthLabel("bogus")).toBe("bogus");
  });
});

describe("sortEntriesByDateId (byte-stable month note)", () => {
  it("orders by date then id, independent of input order", () => {
    const a = { id: "z", date: "2026-10-01" };
    const b = { id: "a", date: "2026-10-01" };
    const c = { id: "m", date: "2026-10-02" };
    const s1 = sortEntriesByDateId([a, b, c]).map((e) => e.id);
    const s2 = sortEntriesByDateId([c, a, b]).map((e) => e.id);
    expect(s1).toEqual(["a", "z", "m"]); // same date → id asc; later date last
    expect(s1).toEqual(s2); // order-independent → two devices serialise identically
  });
});

describe("mergeEntriesById (idempotent consolidation)", () => {
  const e = (id: string, date = "2026-10-01") => ({ id, date });
  it("adds only new ids; reports the count added", () => {
    const r = mergeEntriesById([e("a"), e("b")], [e("b"), e("c")]);
    expect(r.merged.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(r.added).toBe(1);
  });
  it("is idempotent: merging the same incoming twice adds nothing the second time", () => {
    const first = mergeEntriesById([e("a")], [e("b"), e("c")]);
    expect(first.added).toBe(2);
    const second = mergeEntriesById(first.merged, [e("b"), e("c")]);
    expect(second.added).toBe(0);
    expect(second.merged.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("prefers the existing entry on an id clash (never overwrites consolidated data)", () => {
    const r = mergeEntriesById([{ id: "a", date: "2026-10-01", amount: 1 }], [{ id: "a", date: "2026-10-01", amount: 999 }]);
    expect(r.added).toBe(0);
    expect(r.merged).toHaveLength(1);
    expect((r.merged[0] as { amount: number }).amount).toBe(1);
  });
});
