import { describe, it, expect } from "vitest";
import { parseLedgerDoc, mergeKeyed, mergeLedgerTexts, conflictOriginalPath } from "../src/ledgerMerge";

const doc = (type: string, month: string, entries: unknown[]) =>
  `---\ntype: ${JSON.stringify(type)}\nmonth: ${JSON.stringify(month)}\nentries: ${JSON.stringify(entries)}\n---\n\n# body\n`;
const health = (month: string, days: Record<string, unknown>) =>
  `---\ntype: "health-month"\nmonth: ${JSON.stringify(month)}\nsource: "google-health"\ndays: ${JSON.stringify(days)}\n---\n\nbody\n`;

const w = (id: string, date: string, extra: Record<string, unknown> = {}) => ({ id, date, name: `w${id}`, ...extra });

describe("parseLedgerDoc", () => {
  it("parses entries keyed by id", () => {
    const d = parseLedgerDoc(doc("fitness-month", "2026-11", [w("a", "2026-11-01"), w("b", "2026-11-02")]));
    expect(d?.kind).toBe("entries");
    expect([...d!.items.keys()]).toEqual(["a", "b"]);
  });
  it("parses health days and keeps extra fields", () => {
    const d = parseLedgerDoc(health("2026-11", { "2026-11-01": { steps: 1 } }));
    expect(d?.kind).toBe("days");
    expect(d?.extra.source).toBe("google-health");
  });
  it("rejects non-ledger notes and entries without id", () => {
    expect(parseLedgerDoc("---\ntype: task-board\nmonth: \"x\"\n---\n")).toBeNull();
    expect(parseLedgerDoc("no frontmatter")).toBeNull();
    expect(parseLedgerDoc(doc("fitness-month", "2026-11", [{ date: "2026-11-01" }]))).toBeNull();
  });
});

describe("mergeKeyed", () => {
  const m = (o: Record<string, unknown>) => new Map(Object.entries(o));
  it("no base → union, local wins on the same key", () => {
    const out = mergeKeyed(undefined, m({ a: 1, b: 2 }), m({ b: 9, c: 3 }));
    expect(Object.fromEntries(out)).toEqual({ a: 1, b: 2, c: 3 });
  });
  it("with base → keeps adds on both sides, honours a one-sided delete", () => {
    const out = mergeKeyed(m({ a: 1, x: 5 }), m({ a: 1, l: 2 }), m({ a: 1, x: 5, r: 3 }));
    expect(Object.fromEntries(out)).toEqual({ a: 1, l: 2, r: 3 }); // x deleted locally, r/l added
  });
  it("edit beats delete", () => {
    const out = mergeKeyed(m({ x: 1 }), m({}), m({ x: 2 }));
    expect(Object.fromEntries(out)).toEqual({ x: 2 });
  });
  it("only-remote edit is taken; both-edit → local wins", () => {
    expect(Object.fromEntries(mergeKeyed(m({ a: 1 }), m({ a: 1 }), m({ a: 2 })))).toEqual({ a: 2 });
    expect(Object.fromEntries(mergeKeyed(m({ a: 1 }), m({ a: 3 }), m({ a: 2 })))).toEqual({ a: 3 });
  });
});

describe("mergeLedgerTexts", () => {
  it("merges two devices' workouts in the same month (the hidden-pilates case)", () => {
    const local = doc("fitness-month", "2026-11", [w("a", "2026-11-01")]);
    const remote = doc("fitness-month", "2026-11", [w("a", "2026-11-01"), w("pilates", "2026-11-12", { duration: 53 })]);
    const r = mergeLedgerTexts(undefined, local, remote);
    expect(r?.entries.map((e) => e.id).sort()).toEqual(["a", "pilates"]);
  });
  it("refuses different months or types", () => {
    expect(mergeLedgerTexts(undefined, doc("fitness-month", "2026-11", [w("a", "x")]), doc("fitness-month", "2026-10", [w("a", "x")]))).toBeNull();
    expect(mergeLedgerTexts(undefined, doc("fitness-month", "2026-11", [w("a", "x")]), doc("nutrition-month", "2026-11", [w("a", "x")]))).toBeNull();
    expect(mergeLedgerTexts(undefined, "plain note", "other")).toBeNull();
  });
  it("merges health days, sorted", () => {
    const r = mergeLedgerTexts(undefined, health("2026-11", { "2026-11-02": { s: 2 } }), health("2026-11", { "2026-11-01": { s: 1 } }));
    expect(Object.keys(r!.days)).toEqual(["2026-11-01", "2026-11-02"]);
  });
});

describe("conflictOriginalPath", () => {
  it("maps conflict copies back to the original", () => {
    expect(conflictOriginalPath("Momentum Life/Fitness/Months/Fitness 2026-11 November.conflict.md")).toBe("Momentum Life/Fitness/Months/Fitness 2026-11 November.md");
    expect(conflictOriginalPath("a/N.conflict-3.md")).toBe("a/N.md");
    expect(conflictOriginalPath("a/N.md")).toBeNull();
  });
});
