import { listDataPoints, reconcileDataPoints, dailyRollUp, HealthApiError } from "./googlehealth";
import {
  HealthDay, rollupsToDays, restingHrToDays, sleepToDays, weightsToDays, mergeDays,
  exerciseToWorkoutEntry, nutritionToMealEntries, civilYmd,
} from "./healthTransforms";

// Google Health → vault, read-only (Google is never written). Each data type is fetched on its own:
// a type that fails (missing scope, odd filter, outage) is logged and skipped, the rest still land.

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

/** What the sync needs from the data store (kept narrow so the sync is testable with a fake). */
export interface HealthSink {
  upsertGoogleWorkouts(entries: Obj[], dates: Set<string>): Promise<number>;
  upsertGoogleMealLogs(entries: Obj[], dates: Set<string>): Promise<number>;
  mergeHealthDays(days: Record<string, HealthDay>): Promise<number>;
  applyGoogleWeights(weights: Record<string, number>): Promise<number>;
  applyGoogleWater(liters: Record<string, number>): Promise<number>;
}

export interface HealthSyncResult {
  days: number;
  workouts: number;
  meals: number;
  weights: number;
  water: number;
  errors: string[];
  notes: string[];
}

const SCOPE = (s: string) => `https://www.googleapis.com/auth/googlehealth.${s}.readonly`;

/**
 * List with a filter, retrying once with the camelCase field name if Google rejects the
 * snake_case one (the docs show both styles across data types).
 */
async function listWithFilter(token: string, dataType: string, field: string, camelField: string, start: string, end: string): Promise<unknown[]> {
  const f = (name: string) => `${name} >= "${start}" AND ${name} < "${end}"`;
  try {
    return await listDataPoints(token, dataType, f(field));
  } catch (e) {
    if (e instanceof HealthApiError && e.status === 400 && camelField !== field) {
      return listDataPoints(token, dataType, f(camelField));
    }
    throw e;
  }
}

/**
 * Import [startYmd, endYmd) (local calendar days). `granted` = scopes the user actually allowed;
 * types whose scope is missing are skipped with a note, not an error.
 */
export async function runHealthSync(opts: {
  token: string;
  sink: HealthSink;
  granted: string[];
  startYmd: string;
  endYmd: string;
  log?: (msg: string) => void;
}): Promise<HealthSyncResult> {
  const { token, sink, startYmd: s, endYmd: e } = opts;
  const has = (scope: string) => opts.granted.includes(SCOPE(scope));
  const res: HealthSyncResult = { days: 0, workouts: 0, meals: 0, weights: 0, water: 0, errors: [], notes: [] };
  const log = (m: string) => opts.log?.(m);
  const step = async (label: string, scope: string, fn: () => Promise<void>) => {
    if (!has(scope)) { res.notes.push(`${label}: skipped (permission not granted)`); return; }
    try { await fn(); log(`${label}: ok`); }
    catch (err) { const msg = `${label}: ${err instanceof Error ? err.message : String(err)}`; res.errors.push(msg); log(msg); }
  };

  const dayMaps: Record<string, HealthDay>[] = [];

  // Daily totals — the rollup reconciles Fitbit + phone, so nothing is double-counted.
  const rollups: [string, string, keyof HealthDay, string][] = [
    ["steps", "steps", "steps", "activity_and_fitness"],
    ["distance", "distance", "distanceKm", "activity_and_fitness"],
    ["total-calories", "totalCalories", "caloriesKcal", "activity_and_fitness"],
    ["active-minutes", "activeMinutes", "activeMinutes", "activity_and_fitness"],
    ["hydration-log", "hydrationLog", "waterL", "nutrition"],
  ];
  for (const [type, field, metric, scope] of rollups) {
    await step(type, scope, async () => { dayMaps.push(rollupsToDays(await dailyRollUp(token, type, s, e), field, metric)); });
  }

  await step("daily-resting-heart-rate", "health_metrics_and_measurements", async () => {
    dayMaps.push(restingHrToDays(await listWithFilter(token, "daily-resting-heart-rate",
      "daily_resting_heart_rate.date", "dailyRestingHeartRate.date", s, e)));
  });
  await step("sleep", "sleep", async () => {
    let pts = await listWithFilter(token, "sleep", "sleep.interval.civil_end_time", "sleep.interval.civil_end_time", s, e);
    if (!pts.length) {
      // Fallback: the physical end-time filter (RFC-3339), in case the civil one matches nothing.
      const f = `sleep.interval.end_time >= "${s}T00:00:00Z" AND sleep.interval.end_time < "${e}T00:00:00Z"`;
      try { pts = await listDataPoints(token, "sleep", f); log(`sleep: physical-time filter returned ${pts.length}`); }
      catch (err) { log(`sleep: physical-time filter failed — ${err instanceof Error ? err.message : String(err)}`); }
    }
    const nights = sleepToDays(pts);
    log(`sleep: list returned ${pts.length}, mapped ${Object.keys(nights).length} day(s)`);
    if (pts.length && !Object.keys(nights).length) {
      const s0 = obj(obj(pts[0]).sleep);
      log(`sleep: shape — sleep: [${Object.keys(s0).join(",")}] interval: [${Object.keys(obj(s0.interval)).join(",")}] summary: [${Object.keys(obj(s0.summary)).join(",")}]`);
    }
    dayMaps.push(nights);
  });

  let weights: Record<string, number> = {};
  await step("weight", "health_metrics_and_measurements", async () => {
    weights = weightsToDays(await listWithFilter(token, "weight", "weight.sample_time.civil_time", "weight.sample_time.civil_time", s, e));
    dayMaps.push(Object.fromEntries(Object.entries(weights).map(([d, kg]) => [d, { weightKg: kg }])));
  });

  const days = mergeDays(...dayMaps);
  try { res.days = await sink.mergeHealthDays(days); } catch (err) { res.errors.push(`health note: ${String(err)}`); }
  try { res.weights = await sink.applyGoogleWeights(weights); } catch (err) { res.errors.push(`weight log: ${String(err)}`); }
  const water = Object.fromEntries(Object.entries(days).filter(([, d]) => (d.waterL ?? 0) > 0).map(([d, v]) => [d, v.waterL as number]));
  try { res.water = await sink.applyGoogleWater(water); } catch (err) { res.errors.push(`water log: ${String(err)}`); }

  // Every date of the window is "re-read": an imported item that vanished in Google is dropped.
  const window = new Set<string>();
  for (let d = s; d < e; d = nextDay(d)) window.add(d);

  await step("exercise", "activity_and_fitness", async () => {
    const field = "exercise.interval.civil_start_time";
    let pts = await listWithFilter(token, "exercise", field, field, s, e);
    log(`exercise: list returned ${pts.length}`);
    if (!pts.length) {
      // The workouts guide reads sessions through :reconcile; use it when the plain list is empty.
      try {
        pts = await reconcileDataPoints(token, "exercise", `${field} >= "${s}" AND ${field} < "${e}"`);
        log(`exercise: reconcile returned ${pts.length}`);
      } catch (err) { log(`exercise: reconcile failed — ${err instanceof Error ? err.message : String(err)}`); }
    }
    if (!pts.length) {
      // Diagnostic only: does the account have ANY exercise at all (no filter)? Counts only.
      try {
        const any = await listDataPoints(token, "exercise", "", 5, 1);
        const dates = any.map((p) => civilYmd(obj(obj(obj(p).exercise).interval).civilStartTime)).join(", ");
        log(`exercise: unfiltered sample ${any.length} (latest dates: ${dates || "none"})`);
      } catch (err) { log(`exercise: unfiltered check failed — ${err instanceof Error ? err.message : String(err)}`); }
    }
    const entries = pts.map(exerciseToWorkoutEntry).filter((x): x is Obj => !!x);
    if (pts.length && !entries.length) {
      // Keys only (no values) of the first point, so the log shows the real shape.
      const p0 = obj(pts[0]);
      const ex0 = obj(p0.exercise);
      log(`exercise: points found but none could be mapped — keys: [${Object.keys(p0).join(",")}] exercise: [${Object.keys(ex0).join(",")}] interval: [${Object.keys(obj(ex0.interval)).join(",")}]`);
    }
    res.workouts = await sink.upsertGoogleWorkouts(entries, window);
  });
  await step("nutrition-log", "nutrition", async () => {
    const pts = await listWithFilter(token, "nutrition-log", "nutrition_log.interval.civil_start_time", "nutritionLog.interval.civil_start_time", s, e);
    res.meals = await sink.upsertGoogleMealLogs(nutritionToMealEntries(pts), window);
  });

  return res;
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
