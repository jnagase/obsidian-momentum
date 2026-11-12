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

import { ExerciseKind, MealItem, MealLog, Task, Transaction, UnitSystem, Workout, WorkoutExercise, WorkoutKind } from "./types";

// ============================================================
// UNITS — weights are stored canonically in kg; these convert ONLY for display/input.
// Pure (no Obsidian) so they're unit-testable and shared by the plugin + MCP (mirrored by hand).
// ============================================================
/** Exact kilograms in one pound (international avoirdupois). */
export const KG_PER_LB = 0.45359237;
/** Short unit label for the user's system. */
export function weightUnit(u: UnitSystem): string { return u === "imperial" ? "lb" : "kg"; }
/** Canonical kg → the number shown in the user's unit, rounded to 0.1. */
export function kgToDisplay(kg: number, u: UnitSystem): number {
  const v = u === "imperial" ? kg / KG_PER_LB : kg;
  return Math.round(v * 10) / 10;
}
/** A number the user typed in their unit → canonical kg for storage, rounded to 0.1 kg. */
export function displayToKg(value: number, u: UnitSystem): number {
  const kg = u === "imperial" ? value * KG_PER_LB : value;
  return Math.round(kg * 10) / 10;
}

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
  const w: Workout = {
    id: str(fm.id) || basename,
    date: str(fm.date).substring(0, 10),
    split: str(fm.split) || "A",
    duration: num(fm.duration),
    exercises,
    path,
    kind,
  };
  // Imported (Google health) extras — only set when present, so manual workouts stay identical.
  if (str(fm.source)) w.source = str(fm.source);
  if (num(fm.calories)) w.calories = num(fm.calories);
  if (num(fm.avg_hr)) w.avgHr = num(fm.avg_hr);
  if (num(fm.steps)) w.steps = num(fm.steps);
  return w;
}

// ============================================================
// MONTHLY LEDGER — pure serializers, table renderers and the consolidation planner.
// Part of the monthly-ledger-consolidation spec: each module's logged items live as
// `entries` in one note per month (frontmatter = source of truth; body = a rendered table).
// These functions are Obsidian-free so the round-trip is unit-testable in isolation.
// ============================================================

/** Month key "2026-10" from a YYYY-MM-DD date. */
function ymKey(date: string): string { return (date ?? "").slice(0, 7); }

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
/** "October 2026" from "2026-10" (empty/invalid → the raw key). */
export function monthLabel(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey || "");
  if (!m) return monthKey || "";
  const mi = parseInt(m[2], 10) - 1;
  return `${MONTH_NAMES[mi] ?? m[2]} ${m[1]}`;
}

/** Make a value safe for a one-line Markdown table cell (no pipes/newlines break the row). */
function cell(v: unknown): string {
  return str(v).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}
/** Money as "<cur>1.234,56"-style (locale grouping + 2 decimals), deterministic per currency. */
function money(n: number, currency: string): string {
  return `${currency}${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---- Domain ⇄ frontmatter entry (field list has a single source of truth: the mappers) ----
export function txToEntry(t: Transaction): Frontmatter {
  return { id: t.id, tx_type: t.type, date: t.date, amount: t.amount, category: t.category, note: t.note || "" };
}
export function entryToTransaction(e: Frontmatter, notePath: string): Transaction {
  return mapTransaction(e, str(e.id), notePath);
}
export function mealLogToEntry(l: MealLog): Frontmatter {
  return { id: l.id, date: l.date, meal: l.mealId, calories: l.totalCal, protein: l.totalProtein, carbs: l.totalCarbs, items: l.items };
}
export function entryToMealLog(e: Frontmatter, notePath: string): MealLog {
  return mapMealLog(e, str(e.id), notePath);
}
export function workoutToEntry(w: Workout): Frontmatter {
  return { id: w.id, date: w.date, split: w.split, duration: w.duration, exercises: w.exercises, kind: w.kind };
}
export function entryToWorkout(e: Frontmatter, notePath: string): Workout {
  return mapWorkout(e, str(e.id), notePath);
}

// ---- Table renderers (pure, deterministic; sorted by date then id) ----
function byDateThenId(a: { date: string; id: string }, b: { date: string; id: string }): number {
  return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}

export function renderFinanceTable(items: Transaction[], currency: string, monthKey: string): string {
  const sorted = [...items].sort(byDateThenId);
  const income = sorted.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = sorted.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  let body = `# Finance — ${monthLabel(monthKey)}\n\n`;
  body += `**Income:** ${money(income, currency)} · **Expenses:** ${money(expense, currency)} · **Balance:** ${money(income - expense, currency)}\n\n`;
  body += `| Date | Type | Category | Amount | Note |\n|------|------|----------|-------:|------|\n`;
  for (const t of sorted) {
    const sign = t.type === "income" ? "+" : "−";
    body += `| ${cell(t.date)} | ${cell(t.type)} | ${cell(t.category)} | ${sign}${money(t.amount, currency)} | ${cell(t.note)} |\n`;
  }
  return body;
}

export function renderNutritionTable(items: MealLog[], monthKey: string, mealLabel: (mealId: string) => string = (x) => x): string {
  const sorted = [...items].sort(byDateThenId);
  const totalCal = sorted.reduce((s, l) => s + l.totalCal, 0);
  const days = new Set(sorted.map((l) => l.date)).size;
  let body = `# Nutrition — ${monthLabel(monthKey)}\n\n`;
  body += `**Total:** ${totalCal} cal · **Logs:** ${sorted.length} · **Days:** ${days}\n\n`;
  body += `| Date | Meal | Cal | Protein | Carbs |\n|------|------|----:|--------:|------:|\n`;
  for (const l of sorted) {
    body += `| ${cell(l.date)} | ${cell(mealLabel(l.mealId))} | ${l.totalCal} | ${l.totalProtein} | ${l.totalCarbs} |\n`;
  }
  return body;
}

export function renderFitnessTable(items: Workout[], monthKey: string, splitLabel: (splitId: string) => string = (x) => x): string {
  const sorted = [...items].sort(byDateThenId);
  const totalMin = sorted.reduce((s, w) => s + w.duration, 0);
  const days = new Set(sorted.map((w) => w.date)).size;
  let body = `# Fitness — ${monthLabel(monthKey)}\n\n`;
  body += `**Sessions:** ${sorted.length} · **Minutes:** ${totalMin} · **Days:** ${days}\n\n`;
  body += `| Date | Split | Min | Kind | Exercises |\n|------|-------|----:|------|-----------|\n`;
  for (const w of sorted) {
    const exs = w.exercises.map((e) => e.exercise).filter(Boolean).join(", ");
    body += `| ${cell(w.date)} | ${cell(splitLabel(w.split))} | ${w.duration} | ${cell(w.kind)} | ${cell(exs)} |\n`;
  }
  return body;
}

/** Deterministic entry order (date, then id) so two devices serialise a month note identically. */
export function sortEntriesByDateId(entries: Frontmatter[]): Frontmatter[] {
  return [...entries].sort((a, b) => str(a.date).localeCompare(str(b.date)) || str(a.id).localeCompare(str(b.id)));
}

/** Merge `incoming` entries into `existing`, skipping any whose id is already present (dedup by
 *  id → idempotent consolidation). Returns the merged list and how many were newly added. */
export function mergeEntriesById(existing: Frontmatter[], incoming: Frontmatter[]): { merged: Frontmatter[]; added: number } {
  const seen = new Set(existing.map((e) => str(e.id)));
  const merged = [...existing];
  let added = 0;
  for (const e of incoming) {
    const id = str(e.id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(e);
    added++;
  }
  return { merged, added };
}

/** Group logged items by their month key ("2026-10"). Pure; drives the migration + month notes. */
export function planMonthlyConsolidation<T extends { date: string }>(items: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = ymKey(it.date);
    if (!k) continue;
    const arr = out.get(k);
    if (arr) arr.push(it); else out.set(k, [it]);
  }
  return out;
}

// ============================================================
// BOARD-NOTE TASKS (spec #2) — pure serializers + board-body renderer + consolidation planner.
// A board becomes ONE note with its tasks as `tasks` frontmatter entries. google_id per entry is
// sacred (sync key). Obsidian-free so the round-trip is unit-testable.
// ============================================================

/** Serialize a Task to a board-note `tasks` entry (frontmatter object). Lossless on sync fields. */
export function taskDomainToEntry(t: Task): Frontmatter {
  const e: Frontmatter = { task_id: t.id, title: t.title, status: t.status, priority: t.priority };
  if (t.cat) e.category = t.cat;
  if (t.group) e.group = t.group;
  if (t.due) e.due = t.due;
  if (t.scheduled) e.scheduled = t.scheduled;
  if (t.eisenhower) e.eisenhower = t.eisenhower;
  if (t.order !== undefined && t.order !== null) e.order = t.order;
  if (t.googleId) e.google_id = t.googleId;
  if (t.googleList) e.google_list = t.googleList;
  if (t.created) e.created = t.created;
  if (t.modified) e.modified = t.modified;
  if (t.kanbanId) e["kanban-id"] = t.kanbanId;
  if (t.duration) e.duration = t.duration;
  if (t.isAllDay) e.is_all_day = t.isAllDay;
  return e;
}

/** Parse a board-note `tasks` entry back into a Task. `board`/`notePath` are supplied by the caller
 *  (the entry has no path of its own — it lives inside the board note). */
export function taskEntryToDomain(e: Frontmatter, notePath: string, board: string): Task {
  return {
    id: str(e.task_id) || str(e.id),
    title: str(e.title),
    status: str(e.status) || "backlog",
    priority: str(e.priority) || "medium",
    cat: str(e.category) || "work",
    group: str(e.group),
    kanbanId: str(e["kanban-id"]),
    kanbanName: board,
    due: str(e.due),
    scheduled: str(e.scheduled),
    duration: num(e.duration),
    isAllDay: !!e.is_all_day,
    created: str(e.created),
    modified: str(e.modified),
    order: (e.order !== undefined && e.order !== null) ? Number(e.order) : undefined,
    eisenhower: str(e.eisenhower),
    googleId: str(e.google_id),
    googleList: str(e.google_list),
    path: notePath,
  };
}

/**
 * Render the read-only body of a board note: tasks grouped under their column headings, as a
 * Markdown task list (`- [ ]` / `- [x]`). This is the same `## Column` + checkbox shape the old
 * Tasks/Lists/ mirrors used and that the Kanban/Tasks community plugins read, so a board note is
 * interoperable out of the box. Done-column items are checked. The frontmatter `tasks` array stays
 * the source of truth; this body is regenerated on every write.
 */
export function renderBoardNoteBody(board: string, tasks: Task[], cols: string[], colNames: Record<string, string>): string {
  const doneCol = cols.includes("done") ? "done" : cols[cols.length - 1];
  const byCol = new Map<string, Task[]>();
  for (const t of tasks) {
    const k = t.status || cols[0] || "backlog";
    const a = byCol.get(k); if (a) a.push(t); else byCol.set(k, [t]);
  }
  const sortCol = (a: Task, b: Task) =>
    ((a.order ?? 0) - (b.order ?? 0)) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  let body = `# ${board}\n`;
  const emitted = new Set<string>();
  const emit = (col: string) => {
    const arr = (byCol.get(col) || []).slice().sort(sortCol);
    if (!arr.length) return;
    body += `\n## ${colNames[col] || col}\n`;
    const box = col === doneCol ? "x" : " ";
    for (const t of arr) body += `- [${box}] ${t.title}\n`;
    emitted.add(col);
  };
  for (const c of cols) emit(c);
  for (const c of byCol.keys()) if (!emitted.has(c)) emit(c); // leftover / unknown statuses
  return body;
}

/** Group tasks by board (for the per-task → board-note migration). Default board = "My Tasks". */
export function planBoardConsolidation(tasks: Task[]): Map<string, Task[]> {
  const out = new Map<string, Task[]>();
  for (const t of tasks) {
    const board = (t.kanbanName && t.kanbanName !== "No board") ? t.kanbanName : "My Tasks";
    const a = out.get(board); if (a) a.push(t); else out.set(board, [t]);
  }
  return out;
}

// --- Pure mutations on a board note's `tasks` entry array (identity = task_id) --------------
// The board-note store methods are thin wrappers: read the array, apply ONE of these, write it
// back. Keeping the transforms pure means create/patch/remove/move are unit-testable without a
// live vault, and the MCP (mcp/src/store.mjs) can mirror the exact same logic by hand.

/** Deterministic serialization order for a board note's `tasks` array: by `order` (missing last),
 *  then `task_id`. The array order is cosmetic (loadTasks re-reads and the UI re-sorts); this only
 *  guarantees two devices serialise byte-identically, so Drive/Sync never see a spurious change. */
export function sortTaskEntries(entries: Frontmatter[]): Frontmatter[] {
  const ord = (e: Frontmatter) => (e.order !== undefined && e.order !== null ? Number(e.order) : Number.POSITIVE_INFINITY);
  return entries.slice().sort((a, b) => (ord(a) - ord(b)) || str(a.task_id).localeCompare(str(b.task_id)));
}

/** Insert `entry` (matched by `task_id`), or merge it onto the existing one. Never mutates input. */
export function upsertTaskEntry(entries: Frontmatter[], entry: Frontmatter): Frontmatter[] {
  const id = str(entry.task_id);
  const idx = entries.findIndex((e) => str(e.task_id) === id);
  const next = entries.slice();
  if (idx >= 0) next[idx] = { ...next[idx], ...entry };
  else next.push(entry);
  return next;
}

/** Apply `patch` to the entry with `taskId`. No-op (returns the input) when it isn't present. */
export function patchTaskEntry(entries: Frontmatter[], taskId: string, patch: Frontmatter): Frontmatter[] {
  const idx = entries.findIndex((e) => str(e.task_id) === taskId);
  if (idx < 0) return entries;
  const next = entries.slice();
  next[idx] = { ...next[idx], ...patch };
  return next;
}

/** Drop the entry with `taskId` (if any). Never mutates input. */
export function removeTaskEntry(entries: Frontmatter[], taskId: string): Frontmatter[] {
  return entries.filter((e) => str(e.task_id) !== taskId);
}

/**
 * Every `google_id` written in the RAW TEXT of a board note (the single-line JSON `tasks` array).
 * This is the board-note half of the deletion shield (data.ts `rawGoogleIds`): a board note that
 * momentarily fails to parse must still shield EVERY linked task it holds, so the sync never
 * concludes a task was deleted and removes it from Google. Pure + single-sourced so it's testable.
 */
export function boardNoteGoogleIds(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(/"google_id":\s*"([A-Za-z0-9_-]+)"/g)) out.push(m[1]);
  return out;
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
