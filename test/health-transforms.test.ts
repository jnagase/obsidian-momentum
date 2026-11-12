import { describe, it, expect } from "vitest";
import {
  civilYmd, addDays, chunkRange, durationSeconds, rollupSum, rollupsToDays, restingHrToDays,
  sleepToDays, weightsToDays, mergeDays, exerciseToWorkoutEntry, nutritionToMealEntries,
  upsertByExternalId,
} from "../src/healthTransforms";

const civil = (y: number, m: number, d: number, h = 0) => ({ date: { year: y, month: m, day: d }, time: { hours: h } });

describe("dates", () => {
  it("reads Google civil dates and does calendar arithmetic", () => {
    expect(civilYmd(civil(2026, 11, 2))).toBe("2026-11-02");
    expect(civilYmd({ year: 2026, month: 1, day: 9 })).toBe("2026-01-09");
    expect(civilYmd({})).toBe("");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("chunks a range by the API limit", () => {
    expect(chunkRange("2026-11-01", "2026-11-31", 14)).toEqual([
      ["2026-11-01", "2026-11-15"], ["2026-11-15", "2026-11-29"], ["2026-11-29", "2026-11-31"],
    ]);
    expect(chunkRange("2026-11-01", "2026-11-01", 14)).toEqual([]);
  });

  it("parses protobuf durations", () => {
    expect(durationSeconds("1800s")).toBe(1800);
    expect(durationSeconds("3.5s")).toBe(3.5);
  });
});

describe("daily rollups (Fitbit + phone already reconciled by Google)", () => {
  it("takes the *Sum field whatever its name", () => {
    expect(rollupSum({ countSum: "8123" })).toEqual({ key: "countSum", value: 8123 });
    expect(rollupSum({ foo: 1 })).toBeNull();
  });

  it("maps steps, distance (mm → km) and water (ml → L) per local day", () => {
    const steps = rollupsToDays([{ civilStartTime: civil(2026, 11, 12), steps: { countSum: "10450" } }], "steps", "steps");
    expect(steps).toEqual({ "2026-11-12": { steps: 10450 } });
    const dist = rollupsToDays([{ civilStartTime: civil(2026, 11, 12), distance: { millimetersSum: "7345000" } }], "distance", "distanceKm");
    expect(dist["2026-11-12"].distanceKm).toBe(7.35);
    const water = rollupsToDays([{ civilStartTime: civil(2026, 11, 12), hydrationLog: { amountConsumedMillilitersSum: 1750 } }], "hydrationLog", "waterL");
    expect(water["2026-11-12"].waterL).toBe(1.75);
  });

  it("skips days without a value (watch not worn)", () => {
    expect(rollupsToDays([{ civilStartTime: civil(2026, 11, 12) }], "steps", "steps")).toEqual({});
  });
});

describe("daily metrics", () => {
  it("resting heart rate, sleep (by wake-up day, naps added) and latest weight per day", () => {
    expect(restingHrToDays([{ dailyRestingHeartRate: { date: { year: 2026, month: 11, day: 12 }, beatsPerMinute: "58" } }]))
      .toEqual({ "2026-11-12": { restingHr: 58 } });
    expect(sleepToDays([
      { sleep: { interval: { civilEndTime: civil(2026, 11, 12, 7) }, summary: { minutesAsleep: "412" } } },
      { sleep: { interval: { civilEndTime: civil(2026, 11, 12, 15) }, summary: { minutesAsleep: "30" } } },
    ])).toEqual({ "2026-11-12": { sleepMin: 442 } });
    expect(weightsToDays([
      { weight: { weightGrams: 80140, sampleTime: { physicalTime: "2026-11-12T10:00:00Z", civilTime: civil(2026, 11, 12, 7) } } },
      { weight: { weightGrams: 79800, sampleTime: { physicalTime: "2026-11-12T22:00:00Z", civilTime: civil(2026, 11, 12, 19) } } },
    ])).toEqual({ "2026-11-12": 79.8 });
  });

  it("maps sleep from a list point with no civil times or summary (stages or span)", () => {
    const night = { sleep: {
      interval: { startTime: "2026-11-12T02:00:00Z", endTime: "2026-11-12T09:30:00Z", endUtcOffset: "-10800s" },
      stages: [
        { type: "LIGHT", startTime: "2026-11-12T02:00:00Z", endTime: "2026-11-12T06:00:00Z" },
        { type: "AWAKE", startTime: "2026-11-12T06:00:00Z", endTime: "2026-11-12T06:30:00Z" },
        { type: "DEEP", startTime: "2026-11-12T06:30:00Z", endTime: "2026-11-12T09:30:00Z" },
      ],
    } };
    expect(sleepToDays([night])).toEqual({ "2026-11-12": { sleepMin: 420 } });
    const bare = { sleep: { interval: { startTime: "2026-11-12T02:00:00Z", endTime: "2026-11-12T09:00:00Z", endUtcOffset: "-10800s" } } };
    expect(sleepToDays([bare])).toEqual({ "2026-11-12": { sleepMin: 420 } });
  });

  it("merges metric maps per day", () => {
    expect(mergeDays({ "2026-11-12": { steps: 1 } }, { "2026-11-12": { sleepMin: 2 } }, { "2026-11-13": { steps: 3 } }))
      .toEqual({ "2026-11-12": { steps: 1, sleepMin: 2 }, "2026-11-13": { steps: 3 } });
  });
});

describe("workouts → Fitness calendar", () => {
  const point = {
    name: "users/123/dataTypes/exercise/dataPoints/3054085373369111216",
    exercise: {
      interval: { startTime: "2026-11-12T11:00:00Z", endTime: "2026-11-12T11:40:00Z", civilStartTime: civil(2026, 11, 12, 8) },
      exerciseType: "WALKING", displayName: "Walk", activeDuration: "2100s",
      metricsSummary: { caloriesKcal: 180.4, distanceMillimeters: 3210000, steps: "4100", averageHeartRateBeatsPerMinute: "104" },
    },
  };

  it("becomes one cardio workout on its local day, with the watch summary", () => {
    expect(exerciseToWorkoutEntry(point)).toEqual({
      id: "gh-ex-3054085373369111216",
      date: "2026-11-12",
      split: "Walk",
      duration: 35,
      exercises: [{ exercise: "Walk", weight: 0, sets: "", kind: "cardio", duration: 35, distance: 3.21 }],
      kind: "cardio",
      source: "google-health",
      external_id: point.name,
      calories: 180,
      avg_hr: 104,
      steps: 4100,
    });
  });

  it("falls back to the interval length when there is no active duration", () => {
    const p = { ...point, exercise: { ...point.exercise, activeDuration: undefined } };
    expect(exerciseToWorkoutEntry(p)?.duration).toBe(40);
  });

  it("maps a list point with no civil times and no name (local day from UTC + offset)", () => {
    // Pilates 08:00–09:50 in São Paulo (UTC-3), as the list may return it.
    const p = { exercise: {
      interval: { startTime: "2026-11-12T11:00:00Z", startUtcOffset: "-10800s", endTime: "2026-11-12T12:50:00Z" },
      exerciseType: "PILATES", displayName: "Pilates", metricsSummary: {},
    } };
    const e = exerciseToWorkoutEntry(p);
    expect(e).toMatchObject({ date: "2026-11-12", split: "Pilates", duration: 110, kind: "cardio", source: "google-health" });
    expect(e?.external_id).toBe("exercise-2026-11-12T11:00:00Z-PILATES");
    // A late-evening session in UTC-3 still belongs to the local day.
    const late = { exercise: { ...p.exercise, interval: { ...p.exercise.interval, startTime: "2026-11-13T01:30:00Z", endTime: "2026-11-13T02:00:00Z" } } };
    expect(exerciseToWorkoutEntry(late)?.date).toBe("2026-11-12");
  });
});

describe("nutrition → Nutrition meal logs", () => {
  it("groups foods by day and meal, with totals", () => {
    const log = (food: string, kcal: number, meal: string, protein = 0, carbs = 0) => ({
      nutritionLog: {
        interval: { civilStartTime: civil(2026, 11, 12, 12) }, foodDisplayName: food, mealType: meal,
        energy: { kcal }, totalCarbohydrate: { grams: carbs }, serving: { amount: 1 },
        nutrients: [{ nutrient: "PROTEIN", quantity: { grams: protein } }],
      },
    });
    const out = nutritionToMealEntries([log("Rice", 200, "LUNCH", 4, 44), log("Chicken", 165, "LUNCH", 31, 0), log("Apple", 95, "SNACK", 0.5, 25)]);
    expect(out).toHaveLength(2);
    const lunch = out.find((m) => m.id === "gh-meal-2026-11-12-lunch")!;
    expect(lunch).toMatchObject({ date: "2026-11-12", meal_name: "Lunch (Google)", calories: 365, protein: 35, carbs: 44, source: "google-health" });
    expect((lunch.items as unknown[]).length).toBe(2);
  });
});

describe("upsert by external_id (idempotent, manual entries untouched)", () => {
  const manual = { id: "m1", date: "2026-11-12", split: "A" };
  const imported = { id: "gh-ex-1", date: "2026-11-12", external_id: "x1", source: "google-health", duration: 30 };

  it("adds new, replaces changed, keeps manual", () => {
    const r1 = upsertByExternalId([manual], [imported]);
    expect(r1).toEqual({ entries: [manual, imported], changed: true });
    const r2 = upsertByExternalId(r1.entries, [imported]);
    expect(r2.changed).toBe(false);
    const r3 = upsertByExternalId(r1.entries, [{ ...imported, duration: 31 }]);
    expect(r3.changed).toBe(true);
    expect(r3.entries[1]).toMatchObject({ duration: 31 });
    expect(r3.entries[0]).toBe(manual);
  });

  it("drops an imported item that vanished from Google, only inside the re-read window", () => {
    expect(upsertByExternalId([manual, imported], [], new Set(["2026-11-12"]))).toEqual({ entries: [manual], changed: true });
    expect(upsertByExternalId([manual, imported], [], new Set(["2026-11-11"])).changed).toBe(false);
  });
});
