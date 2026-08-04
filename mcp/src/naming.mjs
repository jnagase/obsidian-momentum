// Pure naming helpers — a faithful JS port of src/readablenotes.ts.
// Keep in sync with the plugin so the MCP and the plugin agree on filenames/hubs.

export const INVALID_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Sanitize one segment (category/note/meal/split) for a filename. */
export function sanitizeSegment(raw) {
  return (raw ?? "")
    .replace(INVALID_FILENAME_CHARS, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

/** Money for a filename: abs value, 2 decimals, "." separator, no grouping. */
export function formatAmount(n) {
  const safe = Number.isFinite(n) ? Math.abs(n) : 0;
  return safe.toFixed(2);
}

/** "2026-06" from a YYYY-MM-DD date. */
export function monthKeyOf(date) {
  return (date ?? "").slice(0, 7);
}

/** English month name for a "YYYY-MM" key. */
export function monthName(monthKey) {
  const m = Number((monthKey ?? "").slice(5, 7));
  return MONTH_NAMES[m - 1] ?? "";
}

/** Module-prefixed hub basename: "<Module> <YYYY-MM MonthName>". */
export function monthHubTitle(module, monthKey) {
  return `${module} ${monthKey} ${monthName(monthKey)}`;
}

/** Readable transaction title: <category>-<note>-<amount>-<YYYY-MM-DD> (note omitted if empty). */
export function financeTxTitle(tx) {
  const category = sanitizeSegment(tx.category) || "Other";
  const note = sanitizeSegment(tx.note ?? "");
  const amount = formatAmount(tx.amount);
  const date = (tx.date ?? "").slice(0, 10);
  const segments = note ? [category, note, amount, date] : [category, amount, date];
  return segments.join("-");
}

/** Readable meal-log title: <Meal>-<kcal>cal-<YYYY-MM-DD>. */
export function mealLogTitle(log) {
  const meal = sanitizeSegment(log.mealName) || "Meal";
  const kcal = Number.isFinite(log.kcal) ? Math.max(0, Math.round(log.kcal)) : 0;
  const date = (log.date ?? "").slice(0, 10);
  return `${meal}-${kcal}cal-${date}`;
}

/** Readable workout title: <Split>-<duration>min-<YYYY-MM-DD>. */
export function workoutTitle(w) {
  const split = sanitizeSegment(w.splitName) || "Workout";
  const minutes = Number.isFinite(w.minutes) ? Math.max(0, Math.round(w.minutes)) : 0;
  const date = (w.date ?? "").slice(0, 10);
  return `${split}-${minutes}min-${date}`;
}

/** Ensure the body links its month hub, preserving user lines, adding the link at most once. */
export function mergeBody(body, hubLink) {
  const link = (hubLink ?? "").trim();
  const src = body ?? "";
  if (!link) return src;
  const lines = src.split("\n");
  if (lines.some((l) => l.trim() === link)) return src;
  const kept = [...lines];
  if (kept.length && kept[kept.length - 1].trim() !== "") kept.push("");
  kept.push(link);
  return kept.join("\n");
}

/** Filesystem-safe filename (mirrors data.ts safeName). */
export function safeName(title) {
  return ((title || "untitled")
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()) || "untitled";
}
