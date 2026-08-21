/**
 * Pure frontmatter → domain mappers for the readable-notes item types.
 *
 * These functions are the single place that turns a note's parsed frontmatter into a
 * domain object (`Transaction` / `MealLog` / `Workout`). They are intentionally free of
 * any Obsidian imports so the load-invariance property (design.md Correctness Property 7,
 * Requirements 6.1/6.2/11.1/11.3) can be exercised without a live vault.
 *
 * LOAD-INVARIANCE CONTRACT (verified by test/loadinvariance.test.ts):
 *   Every domain field is derived from `fm` (frontmatter) EXCEPT:
 *     - `id`, which falls back to the file `basename` ONLY when `fm.id` is absent, and
 *     - `path`, which is presentation/location metadata, never parsed for data.
 *   Therefore, given identical frontmatter that INCLUDES an `id`, two files with different
 *   basenames/paths map to domain objects that are equal on every field except `path`.
 *   The migration (`migrateReadableNotes`) ensures a stable frontmatter `id` BEFORE renaming
 *   any file, which neutralizes the basename fallback and guarantees the invariant holds
 *   across renames for real data.
 */

import { ExerciseKind, MealItem, MealLog, Transaction, Workout, WorkoutExercise, WorkoutKind } from "./types";

/** Frontmatter is an untyped bag of parsed YAML values. */
export type Frontmatter = Record<string, unknown>;

// The following three helpers mirror the private helpers in `src/data.ts` exactly. They
// are duplicated here (rather than imported) so this module stays Obsidian-free and can be
// unit-tested in isolation. Because the loaders delegate to the mappers below, the mapping
// of item fields has a single source of truth and cannot drift.

/** Accept either an already-parsed object/array or a JSON string. */
export function coerce<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v as T;
}

export function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export function num(v: unknown): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  if (typeof v === "string") { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  return 0;
}

/**
 * Map a Finance transaction note's frontmatter to a `Transaction`.
 * Data fields (`id`, `date`, `type`, `amount`, `category`, `note`) come from frontmatter;
 * `basename` is only the `id` fallback and `path` is location metadata.
 */
export function mapTransaction(fm: Frontmatter, basename: string, path: string): Transaction {
  return {
    id: str(fm.id) || basename,
    date: str(fm.date).substring(0, 10),
    type: str(fm.tx_type) || "expense",
    amount: num(fm.amount),
    category: str(fm.category) || "Other",
    note: str(fm.note),
    path,
  };
}

/**
 * Map a Nutrition meal-log note's frontmatter to a `MealLog`.
 * Data fields (`id`, `date`, `mealId`, `totalCal`, `totalProtein`, `totalCarbs`, `items`)
 * come from frontmatter; `basename` is only the `id` fallback and `path` is metadata.
 */
export function mapMealLog(fm: Frontmatter, basename: string, path: string): MealLog {
  return {
    id: str(fm.id) || basename,
    date: str(fm.date).substring(0, 10),
    mealId: str(fm.meal),
    totalCal: num(fm.calories),
    totalProtein: num(fm.protein),
    totalCarbs: num(fm.carbs),
    items: coerce<MealItem[]>(fm.items, []),
    path,
  };
}

/**
 * Map a Fitness workout note's frontmatter to a `Workout`.
 * Data fields (`id`, `date`, `split`, `duration`, `exercises`) come from frontmatter;
 * `basename` is only the `id` fallback and `path` is metadata. `kind` is read verbatim
 * when it is a valid WorkoutKind value, else derived from the exercises (legacy files
 * have neither the top-level nor the per-entry `kind` field, so this resolves to
 * "strength" when non-empty and "empty" when not — see deriveWorkoutKind).
 */
export function mapWorkout(fm: Frontmatter, basename: string, path: string): Workout {
  const exercises = coerce<WorkoutExercise[]>(fm.exercises, []);
  const storedKind = str(fm.kind);
  const kind: WorkoutKind = storedKind === "strength" || storedKind === "cardio" || storedKind === "mixed" || storedKind === "empty"
    ? storedKind
    : deriveWorkoutKind(exercises);
  return {
    id: str(fm.id) || basename,
    date: str(fm.date).substring(0, 10),
    split: str(fm.split) || "A",
    duration: num(fm.duration),
    exercises,
    path,
    kind,
  };
}

// ============================================================
// FITNESS — pure cardio helpers (no Obsidian imports; mirrored by hand in
// mcp/src/store.mjs since the MCP has no build step and cannot import from src/*.ts).
// ============================================================

/** Pace in minutes/km, rounded to 1 decimal; null when distance or duration is not > 0. */
export function computePace(distanceKm: number, durationMin: number): number | null {
  if (!(distanceKm > 0) || !(durationMin > 0)) return null;
  return Math.round((durationMin / distanceKm) * 10) / 10;
}

/** Derives a Workout's kind from its logged entries. Empty array -> "empty". */
export function deriveWorkoutKind(entries: Array<{ kind?: ExerciseKind }>): WorkoutKind {
  if (entries.length === 0) return "empty";
  const kinds = new Set(entries.map((e) => e.kind ?? "strength"));
  if (kinds.size > 1) return "mixed";
  return kinds.has("cardio") ? "cardio" : "strength";
}

/** Sum of distance across all cardio entries in the given workouts. */
export function totalCardioDistance(workouts: Array<{ exercises: Array<{ kind?: ExerciseKind; distance?: number }> }>): number {
  let total = 0;
  for (const w of workouts) {
    for (const e of w.exercises) {
      if ((e.kind ?? "strength") === "cardio") total += Number(e.distance) || 0;
    }
  }
  return total;
}
