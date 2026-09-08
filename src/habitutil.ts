import { Habit } from "./types";
import { daysBetween, ymd } from "./util";

/** Whether a habit counts as "done" on a given day. For "do" habits, done = logged that
 *  day. For "quit" habits, done = a CLEAN day (no relapse recorded) within the habit's
 *  active range (from creation through today) — matches the bar/line/streak/dot-color
 *  logic in the Habit Tracker, so every view (Habit Tracker, Cockpit) agrees on what
 *  counts as a win for the same habit. Shared here so that agreement can't drift. */
export function habitDoneOn(h: Habit, ds: string, today: string): boolean {
  if (h.habitType === "quit") {
    const created = h.created || today;
    return ds >= created && ds <= today && !(h.log && h.log[ds]);
  }
  return !!h.log[ds];
}

/** Current streak (consecutive days ending today) for an arbitrary boolean "done"
 *  function. Counts backward from today; today not yet done doesn't break the streak —
 *  only a genuine gap on a PAST day does. Capped at 365 days back. */
export function streakFromDoneFn(doneFn: (ds: string) => boolean, today: string): number {
  let streak = 0;
  const base = new Date(today + "T00:00:00");
  for (let i = 0; i < 365; i++) {
    const x = new Date(base);
    x.setDate(x.getDate() - i);
    const ds = ymd(x);
    if (doneFn(ds)) streak++;
    else if (i === 0) continue;
    else break;
  }
  return streak;
}

/** Current streak for a habit. "Do": consecutive logged days ending today. "Quit": days
 *  since the last recorded relapse (or since creation if it was never relapsed). */
export function habitStreak(h: Habit, today: string): number {
  if (h.habitType === "quit") return daysBetween(h.lastReset || h.created || today, today);
  return streakFromDoneFn((ds) => !!h.log[ds], today);
}
