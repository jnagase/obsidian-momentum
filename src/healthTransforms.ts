// Pure Google Health → Momentum transforms. No I/O, no Obsidian API: unit-tested in
// test/health-transforms.test.ts. The sync (healthSync.ts) fetches, these shape, the store writes.

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const numOf = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const pad = (n: number) => String(n).padStart(2, "0");
/** A string field, or "" for anything else (never "[object Object]"). */
const s = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** One day of Google Health metrics, as stored in the health month note. Absent = no data. */
export interface HealthDay {
  steps?: number;
  distanceKm?: number;
  caloriesKcal?: number;
  activeMinutes?: number;
  restingHr?: number;
  sleepMin?: number;
  waterL?: number;
  weightKg?: number;
}

/** "YYYY-MM-DD" from a Google CivilDateTime ({ date: {year, month, day}, time? }) or a Date. */
export function civilYmd(v: unknown): string {
  const o = obj(v);
  const d = o.date ? obj(o.date) : o;
  const y = numOf(d.year), m = numOf(d.month), day = numOf(d.day);
  if (!y || !m || !day) return "";
  return `${y}-${pad(m)}-${pad(day)}`;
}

/** Google Date object for a "YYYY-MM-DD" (CivilDateTime with only the date part). */
export function ymdToCivil(ymd: string): { date: { year: number; month: number; day: number } } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { date: { year: y, month: m, day: d } };
}

/** Add `days` to a "YYYY-MM-DD" (calendar arithmetic, timezone-free). */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Split [start, end) into consecutive chunks of at most `maxDays` days (API range limits). */
export function chunkRange(start: string, end: string, maxDays: number): [string, string][] {
  const out: [string, string][] = [];
  let s = start;
  while (s < end) {
    const e = addDays(s, maxDays) < end ? addDays(s, maxDays) : end;
    out.push([s, e]);
    s = e;
  }
  return out;
}

/** Seconds from a protobuf Duration string ("1800s", "3.5s"). */
export function durationSeconds(v: unknown): number {
  if (typeof v !== "string") return numOf(v);
  return numOf(v.replace(/s$/, ""));
}

/**
 * The single aggregated number of a daily rollup value, whatever its exact field name
 * (`countSum`, `millimetersSum`, `kcalSum`, …): the first numeric field ending in "Sum".
 * Kept generic on purpose — Google names each RollupValue's fields per type.
 */
export function rollupSum(value: unknown): { key: string; value: number } | null {
  for (const [k, v] of Object.entries(obj(value))) {
    if (/sum$/i.test(k)) return { key: k, value: numOf(v) };
  }
  return null;
}

/**
 * Daily rollup points → per-day metric. Google's daily rollup already RECONCILES all sources
 * (Fitbit + phone/Health Connect) and drops not-worn intervals, so nothing is counted twice (D4).
 * `field` is the rollup union field (steps, distance, totalCalories, activeMinutes, hydrationLog).
 */
export function rollupsToDays(points: unknown[], field: string, metric: keyof HealthDay): Record<string, HealthDay> {
  const out: Record<string, HealthDay> = {};
  for (const p of points) {
    const po = obj(p);
    const ymd = civilYmd(po.civilStartTime);
    const sum = rollupSum(po[field]);
    if (!ymd || !sum) continue;
    let v = sum.value;
    const key = sum.key.toLowerCase();
    if (metric === "distanceKm") v = key.includes("millimeter") ? v / 1_000_000 : key.includes("meter") ? v / 1000 : v;
    if (metric === "waterL") v = key.includes("milliliter") ? v / 1000 : v;
    if (metric === "activeMinutes" && key.includes("second")) v = v / 60;
    out[ymd] = { [metric]: round(v, metric === "distanceKm" || metric === "waterL" ? 2 : 0) };
  }
  return out;
}

/** Daily resting heart rate points → { ymd: { restingHr } }. */
export function restingHrToDays(points: unknown[]): Record<string, HealthDay> {
  const out: Record<string, HealthDay> = {};
  for (const p of points) {
    const r = obj(obj(p).dailyRestingHeartRate);
    const ymd = civilYmd(r.date);
    const bpm = numOf(r.beatsPerMinute);
    if (ymd && bpm) out[ymd] = { restingHr: Math.round(bpm) };
  }
  return out;
}

/** Sleep sessions → minutes asleep per wake-up day (local end date). Naps add to the same day. */
export function sleepToDays(points: unknown[]): Record<string, HealthDay> {
  const out: Record<string, HealthDay> = {};
  for (const p of points) {
    const sl = obj(obj(p).sleep);
    const iv = obj(sl.interval);
    // Like exercise, the list may omit civil times: fall back to UTC end + offset.
    const ymd = civilYmd(iv.civilEndTime) || localYmd(iv.endTime, iv.endUtcOffset);
    const min = sleepMinutes(sl);
    if (!ymd || !min) continue;
    out[ymd] = { sleepMin: (out[ymd]?.sleepMin ?? 0) + Math.round(min) };
  }
  return out;
}

/** Minutes asleep of one session: the summary when present, else the non-awake stages, else the span. */
function sleepMinutes(sl: Obj): number {
  const fromSummary = numOf(obj(sl.summary).minutesAsleep);
  if (fromSummary) return fromSummary;
  const stages = Array.isArray(sl.stages) ? sl.stages.map(obj) : [];
  const asleep = stages
    .filter((st) => !/AWAKE|OUT_OF_BED|UNKNOWN/i.test(s(st.type)))
    .reduce((a, st) => a + Math.max(0, (Date.parse(s(st.endTime)) - Date.parse(s(st.startTime))) / 60000 || 0), 0);
  if (asleep) return asleep;
  const iv = obj(sl.interval);
  const span = (Date.parse(s(iv.endTime)) - Date.parse(s(iv.startTime))) / 60000;
  return Number.isFinite(span) && span > 0 ? span : 0;
}

/** Weight samples → latest kg per day (0.1 kg precision). */
export function weightsToDays(points: unknown[]): Record<string, number> {
  const latest: Record<string, { t: string; kg: number }> = {};
  for (const p of points) {
    const w = obj(obj(p).weight);
    const st = obj(w.sampleTime);
    const ymd = civilYmd(st.civilTime);
    const kg = numOf(w.weightGrams) / 1000;
    if (!ymd || kg <= 0) continue;
    const t = s(st.physicalTime);
    if (!latest[ymd] || t > latest[ymd].t) latest[ymd] = { t, kg: round(kg, 1) };
  }
  return Object.fromEntries(Object.entries(latest).map(([d, v]) => [d, v.kg]));
}

/** Merge per-metric day maps into one { ymd: HealthDay }. */
export function mergeDays(...maps: Record<string, HealthDay>[]): Record<string, HealthDay> {
  const out: Record<string, HealthDay> = {};
  for (const m of maps) for (const [d, v] of Object.entries(m)) out[d] = { ...(out[d] ?? {}), ...v };
  return out;
}

/** Stable, filename-safe id from a Google resource name ("users/…/dataPoints/123" → "gh-…-123"). */
export function externalId(prefix: string, name: string): string {
  const tail = name.split("/").pop() || name;
  return `gh-${prefix}-${tail.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 60)}`;
}

/** Local "YYYY-MM-DD" of an RFC-3339 instant shifted by a protobuf offset ("-10800s"). */
export function localYmd(instant: unknown, offset: unknown): string {
  const t = Date.parse(s(instant));
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + durationSeconds(offset) * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Exercise session → a Fitness month-note workout entry (D2: it goes on the calendar). Cardio,
 * one line with the watch's summary. `external_id` makes re-syncs idempotent; manual workouts are
 * never touched because they have no external_id.
 */
export function exerciseToWorkoutEntry(point: unknown): Obj | null {
  const po = obj(point);
  const e = obj(po.exercise);
  const iv = obj(e.interval);
  // The list may omit civil times and the resource name: fall back to UTC + offset, and to a
  // stable id built from the start instant + type (one workout can't start twice at once).
  const date = civilYmd(iv.civilStartTime) || localYmd(iv.startTime, iv.startUtcOffset);
  const name = s(po.name) || (s(iv.startTime) ? `exercise-${s(iv.startTime)}-${s(e.exerciseType)}` : "");
  if (!date || !name) return null;
  const ms = obj(e.metricsSummary);
  const activeSec = durationSeconds(e.activeDuration);
  const spanSec = (Date.parse(s(iv.endTime)) - Date.parse(s(iv.startTime))) / 1000;
  const minutes = Math.max(0, Math.round((activeSec || (Number.isFinite(spanSec) ? spanSec : 0)) / 60));
  const km = round(numOf(ms.distanceMillimeters) / 1_000_000, 2);
  const label = s(e.displayName) || s(e.exerciseType) || "Workout";
  const ex: Obj = { exercise: label, weight: 0, sets: "", kind: "cardio", duration: minutes };
  if (km > 0) ex.distance = km;
  const entry: Obj = {
    id: externalId("ex", name),
    date,
    split: label,
    duration: minutes,
    exercises: [ex],
    kind: "cardio",
    source: "google-health",
    external_id: name,
  };
  const kcal = Math.round(numOf(ms.caloriesKcal));
  const hr = Math.round(numOf(ms.averageHeartRateBeatsPerMinute));
  const steps = Math.round(numOf(ms.steps));
  if (kcal) entry.calories = kcal;
  if (hr) entry.avg_hr = hr;
  if (steps) entry.steps = steps;
  return entry;
}

const MEAL_LABEL: Record<string, string> = { BREAKFAST: "Breakfast", LUNCH: "Lunch", DINNER: "Dinner", SNACK: "Snack" };

/**
 * Nutrition logs → Nutrition month-note meal entries (D5). One entry per day + meal type, its
 * foods as items, so a re-sync replaces the whole group (idempotent; a food removed in Google
 * disappears from that group). Manual meal logs have no external_id and are never touched.
 */
export function nutritionToMealEntries(points: unknown[]): Obj[] {
  const groups = new Map<string, { date: string; meal: string; items: Obj[] }>();
  for (const p of points) {
    const n = obj(obj(p).nutritionLog);
    const date = civilYmd(obj(n.interval).civilStartTime);
    if (!date) continue;
    const meal = (s(n.mealType) || "SNACK").toUpperCase();
    const protein = (Array.isArray(n.nutrients) ? n.nutrients : [])
      .map(obj).find((q) => q.nutrient === "PROTEIN");
    const item: Obj = {
      name: s(n.foodDisplayName) || "Food",
      qty: numOf(obj(n.serving).amount) || 1,
      unit: "serving",
      cal: Math.round(numOf(obj(n.energy).kcal)),
      protein: round(numOf(obj(obj(protein).quantity).grams), 1),
      carbs: round(numOf(obj(n.totalCarbohydrate).grams), 1),
    };
    const key = `${date}|${meal}`;
    const g = groups.get(key) ?? { date, meal, items: [] };
    g.items.push(item);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const sum = (k: string) => round(g.items.reduce((s, it) => s + numOf(it[k]), 0), 1);
    return {
      id: `gh-meal-${g.date}-${g.meal.toLowerCase()}`,
      date: g.date,
      meal: "google-health",
      meal_name: `${MEAL_LABEL[g.meal] ?? "Meal"} (Google)`,
      calories: Math.round(sum("cal")),
      protein: sum("protein"),
      carbs: sum("carbs"),
      items: g.items,
      source: "google-health",
      external_id: `gh-meal-${g.date}-${g.meal.toLowerCase()}`,
    };
  });
}

/**
 * Upsert imported entries into a month's raw entries by `external_id`. Entries without an
 * external_id (manual) are kept as-is. Pure. `replaceDates` (optional): for those dates, imported
 * entries that are no longer in `incoming` are dropped (e.g. a meal group that vanished in Google).
 */
export function upsertByExternalId(existing: Obj[], incoming: Obj[], replaceDates?: Set<string>): { entries: Obj[]; changed: boolean } {
  const byExt = new Map(incoming.map((e) => [s(e.external_id), e]));
  let changed = false;
  const out: Obj[] = [];
  for (const e of existing) {
    const ext = s(e.external_id);
    if (!ext) { out.push(e); continue; }
    const next = byExt.get(ext);
    if (next) {
      if (JSON.stringify(next) !== JSON.stringify(e)) changed = true;
      out.push(next);
      byExt.delete(ext);
    } else if (replaceDates?.has(s(e.date)) && e.source === "google-health") {
      changed = true; // gone in Google for a date we just re-read → drop it
    } else {
      out.push(e);
    }
  }
  for (const e of byExt.values()) { out.push(e); changed = true; }
  return { entries: out, changed };
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
