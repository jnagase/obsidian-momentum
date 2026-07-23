/**
 * Shared readable-notes core.
 *
 * Pure, deterministic helpers that turn transactions / meal logs / workouts into
 * readable, filesystem-safe titles, and that name the module-prefixed monthly hubs.
 *
 * These functions are the single source of truth for naming across the Finance,
 * Nutrition, and Fitness modules. They MUST stay side-effect free and MUST NOT
 * import from "obsidian" so they remain trivially testable and portable across
 * both the community and personal builds.
 */

/** Characters that are illegal in Obsidian/OS filenames (mirrors safeName's set). */
export const INVALID_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

/** English month names, index 0 = January. Fixed so naming is locale-independent. */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Sanitize one path segment (category, note, meal name, split name) for use in a filename.
 * - Replaces invalid filename characters with a space (so they become separators).
 * - Collapses whitespace runs and converts them to single hyphens.
 * - Collapses repeated hyphens and trims leading/trailing hyphens.
 * - Preserves Unicode letters (including accents like á, ã, ç) and digits — readable.
 * Deterministic and side-effect free.
 */
export function sanitizeSegment(raw: string): string {
  return (raw ?? "")
    .replace(INVALID_FILENAME_CHARS, " ") // *, /, :, etc. become separators
    .replace(/\s+/g, "-")                 // whitespace runs -> single hyphen
    .replace(/-+/g, "-")                  // collapse repeated hyphens
    .replace(/^-+|-+$/g, "")              // trim leading/trailing hyphens
    .trim();
}

/** Format money for a filename: point decimal separator, exactly 2 decimals, no grouping. */
export function formatAmount(n: number): string {
  const safe = Number.isFinite(n) ? Math.abs(n) : 0; // no sign in filename; guard NaN/Infinity
  return safe.toFixed(2); // toFixed always uses "." and 2 decimals, no grouping
}

/** "2026-06" from a YYYY-MM-DD date. */
export function monthKeyOf(date: string): string {
  return (date ?? "").slice(0, 7);
}

/** English month name for a "YYYY-MM" key: "2026-06" -> "June". */
export function monthName(monthKey: string): string {
  const m = Number((monthKey ?? "").slice(5, 7));
  return MONTH_NAMES[m - 1] ?? "";
}

/**
 * Module-prefixed hub basename: "<Module> <YYYY-MM MonthName>".
 * e.g. monthHubTitle("Finance", "2026-06") -> "Finance 2026-06 June".
 * The module prefix keeps hub basenames unique across modules so wikilinks resolve.
 */
export function monthHubTitle(module: string, monthKey: string): string {
  return `${module} ${monthKey} ${monthName(monthKey)}`;
}

/**
 * Build the readable transaction title (no extension, no collision suffix):
 *   <category>-<note>-<amount>-<YYYY-MM-DD>
 * The note segment is omitted when empty/blank or when it sanitizes to empty.
 * Never includes an income/expense marker (the category conveys it).
 */
export function financeTxTitle(tx: {
  category: string; note?: string; amount: number; date: string;
}): string {
  const category = sanitizeSegment(tx.category) || "Other";
  const note = sanitizeSegment(tx.note ?? "");
  const amount = formatAmount(tx.amount);
  const date = (tx.date ?? "").slice(0, 10);
  const segments = note ? [category, note, amount, date] : [category, amount, date];
  return segments.join("-");
}

/**
 * Build the readable meal-log title:
 *   <Meal>-<kcal>cal-<YYYY-MM-DD>   (e.g. "Lunch-620cal-2026-06-30")
 * Meal name is sanitized per the shared rules; calories are rounded to an integer.
 */
export function mealLogTitle(log: {
  mealName: string; kcal: number; date: string;
}): string {
  const meal = sanitizeSegment(log.mealName) || "Meal";
  const kcal = Number.isFinite(log.kcal) ? Math.max(0, Math.round(log.kcal)) : 0;
  const date = (log.date ?? "").slice(0, 10);
  return `${meal}-${kcal}cal-${date}`;
}

/**
 * Build the readable workout title:
 *   <Split>-<duration>min-<YYYY-MM-DD>   (e.g. "PushDay-45min-2026-06-30")
 * Split name is sanitized per the shared rules; minutes are rounded to an integer.
 */
export function workoutTitle(w: {
  splitName: string; minutes: number; date: string;
}): string {
  const split = sanitizeSegment(w.splitName) || "Workout";
  const minutes = Number.isFinite(w.minutes) ? Math.max(0, Math.round(w.minutes)) : 0;
  const date = (w.date ?? "").slice(0, 10);
  return `${split}-${minutes}min-${date}`;
}

/**
 * Ensure a note body links its month hub while PRESERVING every user-added line.
 *
 * - Keeps ALL existing lines exactly as they are (never removes unknown lines such
 *   as a manual `Hub: [[Hub - Personal]]`).
 * - Adds `hubLink` at most once: if any line already equals the link, the body is
 *   returned unchanged.
 * - Idempotent fixpoint: `mergeBody(mergeBody(b, h), h) === mergeBody(b, h)`.
 *
 * Pure and deterministic; no Obsidian imports.
 */
export function mergeBody(body: string, hubLink: string): string {
  const link = (hubLink ?? "").trim();
  const src = body ?? "";
  if (!link) return src;
  const lines = src.split("\n");
  if (lines.some((l) => l.trim() === link)) return src; // already present -> no-op
  const kept = [...lines];
  // Separate the link from prior content with a single blank line.
  if (kept.length && kept[kept.length - 1].trim() !== "") kept.push("");
  kept.push(link);
  return kept.join("\n");
}
