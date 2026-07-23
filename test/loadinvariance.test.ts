import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  mapTransaction,
  mapMealLog,
  mapWorkout,
  Frontmatter,
} from "../src/loaders";

// =====================================================================================
// Correctness Property 7 — Loaded data is invariant across rename
//
//   ∀ item note f with frontmatter data d: renaming f to any valid new name and reloading
//   yields a domain object equal to the original on every data field (i.e. everything
//   EXCEPT `path`).
//
// Validates: Requirements 6.1, 6.2, 11.1, 11.3
//
// AUDIT (design.md "Verification: loading does not depend on filenames"):
//   `loadTransactions` / `loadMealLogs` / `loadWorkouts` delegate their field extraction to
//   the pure mappers in `src/loaders.ts`. Every domain field is derived from frontmatter;
//   the ONLY filename dependency is the `id` fallback `str(fm.id) || basename`, and `path`
//   is location metadata that is never parsed for data. Therefore, given identical
//   frontmatter that INCLUDES an `id`, two files with DIFFERENT basenames/paths map to
//   domain objects equal on all fields except `path`. The migration (`migrateReadableNotes`)
//   ensures a stable frontmatter `id` BEFORE renaming, neutralizing the fallback so the
//   invariant holds across real renames. These tests exercise the actual mapping code used
//   by the loaders (not a copy).
// =====================================================================================

/** Everything except `path` — the fields the invariant must preserve. */
const dataOf = <T extends { path: string }>(obj: T): Omit<T, "path"> => {
  const { path: _ignored, ...rest } = obj;
  return rest;
};

/** A valid, distinct basename/path pair used to simulate a rename. */
const nameArb = fc.record({
  basename: fc.string({ minLength: 1, maxLength: 40 }),
  folder: fc.constantFrom("Finance/Transactions", "Nutrition/Logs", "Fitness/Workouts", "Legacy"),
});

/** Two DIFFERENT name pairs (the "before" and "after" of a rename). */
const twoNamesArb = fc
  .tuple(nameArb, nameArb)
  .filter(([a, b]) => a.basename !== b.basename || a.folder !== b.folder)
  .map(([a, b]) => ({
    before: { basename: a.basename, path: `${a.folder}/${a.basename}.md` },
    after: { basename: b.basename, path: `${b.folder}/${b.basename}.md` },
  }));

/** Arbitrary JSON-ish frontmatter value (numbers, strings, booleans, arrays, objects). */
const fmValueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string(), { maxLength: 4 }),
);

/**
 * Frontmatter that ALWAYS carries a stable `id` (a number, as `addTransaction`/migration set).
 * This is the state guaranteed by the migration before any rename occurs.
 */
const fmWithIdArb: fc.Arbitrary<Frontmatter> = fc
  .dictionary(fc.string(), fmValueArb, { maxKeys: 8 })
  .chain((bag) =>
    fc.integer({ min: 1, max: 2_000_000_000_000 }).map((id) => ({ ...bag, id })),
  );

describe("Property 7: load-invariance across rename (Finance)", () => {
  it("maps frontmatter-with-id to equal Transactions under different basenames/paths", () => {
    fc.assert(
      fc.property(fmWithIdArb, twoNamesArb, (fm, names) => {
        const before = mapTransaction(fm, names.before.basename, names.before.path);
        const after = mapTransaction(fm, names.after.basename, names.after.path);
        // All data fields (id, date, type, amount, category, note) are identical.
        expect(dataOf(after)).toStrictEqual(dataOf(before));
        // Only presentation (`path`) tracks the current location.
        expect(after.path).toBe(names.after.path);
      }),
      { numRuns: 500 },
    );
  });
});

describe("Property 7: load-invariance across rename (Nutrition)", () => {
  it("maps frontmatter-with-id to equal MealLogs under different basenames/paths", () => {
    fc.assert(
      fc.property(fmWithIdArb, twoNamesArb, (fm, names) => {
        const before = mapMealLog(fm, names.before.basename, names.before.path);
        const after = mapMealLog(fm, names.after.basename, names.after.path);
        expect(dataOf(after)).toStrictEqual(dataOf(before));
        expect(after.path).toBe(names.after.path);
      }),
      { numRuns: 500 },
    );
  });
});

describe("Property 7: load-invariance across rename (Fitness)", () => {
  it("maps frontmatter-with-id to equal Workouts under different basenames/paths", () => {
    fc.assert(
      fc.property(fmWithIdArb, twoNamesArb, (fm, names) => {
        const before = mapWorkout(fm, names.before.basename, names.before.path);
        const after = mapWorkout(fm, names.after.basename, names.after.path);
        expect(dataOf(after)).toStrictEqual(dataOf(before));
        expect(after.path).toBe(names.after.path);
      }),
      { numRuns: 500 },
    );
  });
});

// -------------------------------------------------------------------------------------
// The `id` fallback caveat: WHY migration must ensure `id` before renaming.
// Without a frontmatter `id`, identity falls back to the basename, so a rename would
// change the loaded `id`. Ensuring `id` first (migration step 1) neutralizes this.
// -------------------------------------------------------------------------------------
describe("Property 7 caveat: the basename fallback is why migration ensures id first", () => {
  it("without a frontmatter id, a rename changes the loaded id (fallback fires)", () => {
    const fm: Frontmatter = { date: "2026-06-30", tx_type: "expense", amount: 42.9, category: "Leisure", note: "spotify" };
    const before = mapTransaction(fm, "old-name", "Finance/Transactions/old-name.md");
    const after = mapTransaction(fm, "Leisure-spotify-42.90-2026-06-30", "Finance/Transactions/Leisure-spotify-42.90-2026-06-30.md");
    // The fallback means id tracks the basename → NOT invariant without an id.
    expect(before.id).toBe("old-name");
    expect(after.id).toBe("Leisure-spotify-42.90-2026-06-30");
    expect(after.id).not.toBe(before.id);
    // Every other data field is still invariant (derived from frontmatter).
    expect(after.date).toBe(before.date);
    expect(after.type).toBe(before.type);
    expect(after.amount).toBe(before.amount);
    expect(after.category).toBe(before.category);
    expect(after.note).toBe(before.note);
  });

  it("with a frontmatter id, the same rename preserves the id (fallback neutralized)", () => {
    const fm: Frontmatter = { id: 1719772530000, date: "2026-06-30", tx_type: "expense", amount: 42.9, category: "Leisure", note: "spotify" };
    const before = mapTransaction(fm, "old-name", "Finance/Transactions/old-name.md");
    const after = mapTransaction(fm, "Leisure-spotify-42.90-2026-06-30", "Finance/Transactions/Leisure-spotify-42.90-2026-06-30.md");
    expect(after.id).toBe(before.id);
    expect(after.id).toBe("1719772530000");
    expect(dataOf(after)).toStrictEqual(dataOf(before));
  });
});
