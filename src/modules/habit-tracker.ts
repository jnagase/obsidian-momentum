import { PAContext } from "../context";
import { Habit } from "../types";
import { ConfirmModal, FieldSpec, FormModal, toast, appendSidebarBtn } from "../ui";
import { todayLocal, ymd } from "../util";
import { habitDoneOn, habitStreak, streakFromDoneFn } from "../habitutil";
import { drawRing, drawLineChart } from "../charts";

interface SystemHabit {
  label: string;
  color: string;
  done: (ds: string) => boolean;
}

/** Trailing window (days) used for the rolling completion-rate line under each habit. */
const ROLLING_WINDOW = 7;

/** The first tab: an overview dashboard fused with monthly habit trackers (bullet-journal
 *  style: a dot row for daily completion, a weekly bar chart, and a rolling-rate line —
 *  all three chart styles per habit, for the selected month). */
export class HabitTrackerModule {
  private ctx: PAContext;
  private calMonth: number;
  private calYear: number;

  constructor(ctx: PAContext) {
    this.ctx = ctx;
    const now = new Date();
    this.calMonth = now.getMonth();
    this.calYear = now.getFullYear();
  }

  render(root: HTMLElement): void {
    root.empty();
    const today = todayLocal();
    const cfg = this.ctx.config;

    const tasks = this.ctx.store.loadTasks();
    const habits = this.ctx.store.loadHabits();
    const workouts = this.ctx.store.loadWorkouts();
    const studyCards = this.ctx.store.loadStudyCards();
    const mealLogs = this.ctx.store.loadMealLogs();

    // Day-indexed lookups. Built from the FULL history (not scoped to the displayed
    // month), so navigating months never needs to reload anything — done(ds)/streak
    // math works for any date.
    const gym = new Set(workouts.map((w) => w.date));
    const mealDays = new Set(mealLogs.map((m) => m.date));
    const mealCal = new Map<string, number>();
    mealLogs.forEach((m) => mealCal.set(m.date, (mealCal.get(m.date) || 0) + m.totalCal));
    const taskDone = new Set<string>();
    tasks.forEach((t) => { if (t.status === "done" && t.modified) taskDone.add(t.modified.substring(0, 10)); });
    const studyDays = new Set<string>();
    studyCards.forEach((c) => { if (c.modified) studyDays.add(c.modified.substring(0, 10)); });
    const waterLog = this.ctx.store.loadWaterLog();
    const wt = cfg.waterTarget || 2.5;
    const calTarget = cfg.calorieTarget || 2000;

    const systemHabits: SystemHabit[] = [
      { label: "🏋️ Workout", color: "#16a34a", done: (ds) => gym.has(ds) },
      { label: "🥗 Logged meal", color: "#f59e0b", done: (ds) => mealDays.has(ds) },
      { label: "💧 Water goal", color: "#3b82f6", done: (ds) => (waterLog[ds] || 0) >= wt },
      { label: "🎯 Calorie goal", color: "#10b981", done: (ds) => { const c = mealCal.get(ds) || 0; return c > 0 && c <= calTarget; } },
      { label: "✅ Completed task", color: "#7c3aed", done: (ds) => taskDone.has(ds) },
      { label: "📚 Studied", color: "#ec4899", done: (ds) => studyDays.has(ds) },
    ];

    const scoreForDay = (ds: string): { done: number; total: number } => {
      const checks = systemHabits.map((h) => h.done(ds));
      habits.forEach((h) => {
        if (h.habitType === "quit") checks.push((h.created || ds) <= ds && !(h.log && h.log[ds]));
        else checks.push(!!h.log[ds]);
      });
      return { done: checks.filter(Boolean).length, total: checks.length };
    };

    this.renderHeader(root, today, scoreForDay);
    this.renderHabitConsistency(root, systemHabits, habits, today);
  }

  // ---- Header: title + 3 consistency rings (the greeting moved to Cockpit Life) ----
  private renderHeader(root: HTMLElement, today: string, scoreForDay: (ds: string) => { done: number; total: number }): void {
    const head = root.createDiv({ cls: "pa-ht-header" });
    const left = head.createDiv();
    left.createDiv({ text: "🚀 Habit Tracker", cls: "pa-h1" });
    appendSidebarBtn(left, this.ctx.openSidePanel);

    const rings = head.createDiv({ cls: "pa-ht-rings" });
    const dayN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const base = new Date(today + "T00:00:00");
    for (let i = 2; i >= 0; i--) {
      const dt = new Date(base);
      dt.setDate(dt.getDate() - i);
      const ds = ymd(dt);
      const s = scoreForDay(ds);
      const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
      const color = pct >= 70 ? "#16a34a" : pct >= 30 ? "#d97706" : "#7c3aed";
      const label = i === 0 ? "Today" : `${dayN[dt.getDay()]} ${dt.getDate()}`;
      drawRing(rings, pct, color, label, 58);
    }
  }

  /** "YYYY-MM-DD" for every day of the currently selected month, day 1 first. */
  private monthDates(): string[] {
    const daysInMonth = new Date(this.calYear, this.calMonth + 1, 0).getDate();
    const out: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      out.push(`${this.calYear}-${String(this.calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    return out;
  }

  // ---- Habit consistency: month navigator + one tracker per habit ----
  private renderHabitConsistency(root: HTMLElement, systemHabits: SystemHabit[], habits: Habit[], today: string): void {
    const panel = root.createDiv({ cls: "pa-panel" });
    const head = panel.createDiv({ cls: "pa-section-head" });
    head.createEl("h3", { text: "📊 Habit consistency", cls: "pa-panel-title" });
    const add = head.createEl("button", { text: "+ new habit", cls: "pa-btn" });
    add.onclick = () => this.openHabitModal();

    const nav = panel.createDiv({ cls: "pa-cal-head" });
    const prev = nav.createEl("button", { text: "←", cls: "pa-icon-btn" });
    nav.createSpan({ text: new Date(this.calYear, this.calMonth, 1).toLocaleString("default", { month: "long", year: "numeric" }), cls: "pa-cal-title" });
    const next = nav.createEl("button", { text: "→", cls: "pa-icon-btn" });
    prev.onclick = () => { this.calMonth--; if (this.calMonth < 0) { this.calMonth = 11; this.calYear--; } this.ctx.refresh(); };
    next.onclick = () => { this.calMonth++; if (this.calMonth > 11) { this.calMonth = 0; this.calYear++; } this.ctx.refresh(); };

    const dates = this.monthDates();
    const grid = panel.createDiv({ cls: "pa-habits-grid" });
    systemHabits.forEach((h) => this.renderSystemHabit(grid, h, dates, today));
    habits.forEach((h) => this.renderCustomHabit(grid, h, dates, today));
  }

  /** Single-row dot tracker for the given dates (bullet-journal "habit grid" style):
   *  one circle per day, filled when `cellColor` returns a color. `onClickDay`, when
   *  given, makes every past/today cell clickable so a day can be edited retroactively. */
  private dotsRow(card: HTMLElement, dates: string[], cellColor: (ds: string) => string | null, today: string, onClickDay?: (ds: string) => void | Promise<void>): void {
    const hm = card.createDiv({ cls: "pa-month-dots" });
    dates.forEach((ds) => {
      const cell = hm.createDiv({ cls: "pa-hm-cell" });
      cell.setAttr("title", ds);
      const c = cellColor(ds);
      if (c) cell.style.background = c;
      if (onClickDay && ds <= today) {
        cell.addClass("pa-clickable");
        cell.onclick = () => { void onClickDay(ds); };
      }
    });
  }

  /** Weekly consistency (bullet-journal "mood bars" style, adapted): one HORIZONTAL
   *  progress bar per week of the selected month, filled by the fraction of days done
   *  that week. A vertical bar chart (drawBars) looks stretched/sparse with only 4-5
   *  categories spread across a full card width — a compact horizontal-bar list (same
   *  visual language as the Cockpit's "Completion by board") reads much better at this
   *  small a category count. */
  private weeklyBars(card: HTMLElement, dates: string[], doneFn: (ds: string) => boolean, color: string): void {
    const rows = card.createDiv({ cls: "pa-cockpit-hbars pa-habit-weekbars" });
    for (let i = 0; i < dates.length; i += 7) {
      const chunk = dates.slice(i, i + 7);
      const count = chunk.filter((ds) => doneFn(ds)).length;
      const first = Number(chunk[0].slice(8, 10));
      const last = Number(chunk[chunk.length - 1].slice(8, 10));
      const label = first === last ? `${first}` : `${first}-${last}`;
      const pct = Math.round((count / chunk.length) * 100);

      const row = rows.createDiv({ cls: "pa-cockpit-hbar-row" });
      const labelRow = row.createDiv({ cls: "pa-progress-label" });
      labelRow.createSpan({ text: label });
      labelRow.createSpan({ text: `${count}/${chunk.length}`, cls: "pa-muted" });
      const track = row.createDiv({ cls: "pa-progress-track" });
      const fill = track.createDiv({ cls: "pa-progress-fill" });
      fill.style.width = `${pct}%`;
      fill.style.background = color;
    }
  }

  /** Rolling completion-rate line (bullet-journal "sleep line" style): for each day of
   *  the month, the % of the trailing ROLLING_WINDOW days that were done — reads back
   *  before the 1st when needed, since `doneFn` works for any date, not just this month. */
  private rollingLine(card: HTMLElement, dates: string[], doneFn: (ds: string) => boolean, color: string): void {
    const values = dates.map((ds) => {
      const end = new Date(ds + "T00:00:00");
      let done = 0;
      for (let i = 0; i < ROLLING_WINDOW; i++) {
        const d = new Date(end);
        d.setDate(d.getDate() - i);
        if (doneFn(ymd(d))) done++;
      }
      return Math.round((done / ROLLING_WINDOW) * 100);
    });
    // Only label every 5th day (and the last) — 31 labels on one line chart would overlap.
    const labels = dates.map((ds, i) => {
      const day = Number(ds.slice(8, 10));
      return day === 1 || day % 5 === 0 || i === dates.length - 1 ? String(day) : "";
    });
    drawLineChart(card, labels, [{ name: "", color, values }], { height: 70, format: (n) => `${n}%` });
  }

  private renderSystemHabit(grid: HTMLElement, h: SystemHabit, dates: string[], today: string): void {
    const streak = streakFromDoneFn(h.done, today);
    const card = grid.createDiv({ cls: "pa-habit-card" });
    const top = card.createDiv({ cls: "pa-habit-top" });
    top.createSpan({ text: h.label, cls: "pa-habit-name" });
    top.createSpan({ text: `🔥 ${streak}`, cls: "pa-muted pa-streak" });
    this.dotsRow(card, dates, (ds) => (h.done(ds) ? h.color : null), today);
    this.weeklyBars(card, dates, h.done, h.color);
    this.rollingLine(card, dates, h.done, h.color);
  }

  private renderCustomHabit(grid: HTMLElement, h: Habit, dates: string[], today: string): void {
    const isQuit = h.habitType === "quit";
    const color = isQuit ? "#ef4444" : "#0ea5e9";
    const cleanColor = "#16a34a";
    const created = h.created || today;
    // Quit: a "done" day is a CLEAN day (no relapse recorded) within the habit's active
    // range — so the bar/line/streak math (and the dot color below) all agree on what
    // counts as a win, same distinction the old heatmap made. Shared with Cockpit via
    // habitDoneOn() so both views agree on the same habit.
    const doneFn = (ds: string) => habitDoneOn(h, ds, today);
    // Quit: clean days are green, relapse days (recorded on Reset) are red,
    // so a streak with an interruption stays visible. Do: filled on logged days.
    const cellColor: (ds: string) => string | null = isQuit
      ? (ds) => {
          if (h.log && h.log[ds]) return color;
          if (ds >= created && ds <= today) return cleanColor;
          return null;
        }
      : (ds) => (h.log[ds] ? color : null);

    const streak = habitStreak(h, today);

    const card = grid.createDiv({ cls: "pa-habit-card" });
    const top = card.createDiv({ cls: "pa-habit-top" });
    top.createSpan({ text: `${h.emoji || "⭐"} ${h.name}`, cls: "pa-habit-name" });
    const right = top.createDiv({ cls: "pa-habit-actions" });
    right.createSpan({ text: isQuit ? `🚭 ${streak}d` : `🔥 ${streak}`, cls: "pa-muted pa-streak" });

    if (isQuit) {
      const reset = right.createEl("button", { text: "↺ reset", cls: "pa-mini-btn" });
      reset.onclick = async () => { await this.ctx.store.resetHabit(h, today); this.ctx.refresh(); };
    } else {
      const marked = !!h.log[today];
      const mark = right.createEl("button", { text: marked ? "✓ Today" : "Mark today", cls: "pa-mini-btn" + (marked ? " on" : "") });
      if (marked) mark.setCssStyles({ backgroundColor: color, color: "#fff" });
      mark.onclick = async () => { await this.ctx.store.toggleHabit(h, today); this.ctx.refresh(); };
    }
    const del = right.createEl("button", { text: "🗑", cls: "pa-icon-btn" });
    del.onclick = () =>
      new ConfirmModal(this.ctx.app, `Remove habit "${h.name}"?`, async () => {
        await this.ctx.store.deleteHabit(h);
        this.ctx.refresh();
      }).open();

    card.createDiv({ cls: "pa-muted pa-habit-hint", text: isQuit ? "Tap a day to toggle a relapse." : "Tap a day to mark/unmark it." });
    this.dotsRow(card, dates, cellColor, today, async (ds) => {
      if (isQuit) {
        // Toggling a relapse day recomputes lastReset from the remaining relapse days,
        // so the streak stays correct even when editing a day other than today.
        await this.ctx.store.toggleHabitRelapse(h, ds);
      } else {
        await this.ctx.store.toggleHabit(h, ds);
      }
      this.ctx.refresh();
    });
    this.weeklyBars(card, dates, doneFn, color);
    this.rollingLine(card, dates, doneFn, color);
  }

  // ---- New habit modal ----
  private openHabitModal(): void {
    const fields: FieldSpec[] = [
      { key: "name", label: "Name", type: "text", placeholder: "Walk the dog / Quit smoking" },
      { key: "emoji", label: "Emoji", type: "emoji", value: "⭐" },
      {
        key: "type", label: "Type", type: "dropdown", value: "do",
        options: [
          { value: "do", label: "✅ Do — mark when done" },
          { value: "quit", label: "🚭 Quit — counts days, reset to restart" },
        ],
      },
    ];
    new FormModal(this.ctx.app, "New habit", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name) return;
      await this.ctx.store.saveHabit({ name, emoji: (v.emoji || "⭐").trim(), habitType: v.type === "quit" ? "quit" : "do", log: {} });
      this.ctx.refresh();
      toast("Habit created");
    }, "Create").open();
  }
}
