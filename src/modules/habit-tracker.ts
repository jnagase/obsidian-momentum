import { PAContext } from "../context";
import { Board, Habit, MealLog, StudyCard, Task, Workout } from "../types";
import { ConfirmModal, FieldSpec, FormModal, toast } from "../ui";
import { daysBetween, todayLocal, ymd } from "../util";
import { drawDonut, drawRing } from "../charts";

const HEATMAP_WEEKS = 18;
const HEATMAP_DAYS = HEATMAP_WEEKS * 7;

interface SystemHabit {
  label: string;
  color: string;
  done: (ds: string) => boolean;
}

/** The first tab: an overview dashboard fused with the habit heatmaps. */
export class HabitTrackerModule {
  private ctx: PAContext;
  constructor(ctx: PAContext) { this.ctx = ctx; }

  render(root: HTMLElement): void {
    root.empty();
    const today = todayLocal();
    const cfg = this.ctx.config;

    const tasks = this.ctx.store.loadTasks();
    const habits = this.ctx.store.loadHabits();
    const workouts = this.ctx.store.loadWorkouts();
    const studyCards = this.ctx.store.loadStudyCards();
    const mealLogs = this.ctx.store.loadMealLogs();
    const studyBoards = this.ctx.store.loadStudyBoards();

    // Day-indexed lookups
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
    this.renderKpis(root, { tasks, workouts, studyCards, mealCal, gym, today, waterToday: waterLog[today] || 0 });
    this.renderDonuts(root, { workouts, studyCards, tasks, today });
    this.renderHabitConsistency(root, systemHabits, habits, today);
    this.renderStudyProgress(root, studyBoards, studyCards);
  }

  // ---- Header: title + greeting + 3 consistency rings ----
  private renderHeader(root: HTMLElement, today: string, scoreForDay: (ds: string) => { done: number; total: number }): void {
    const head = root.createDiv({ cls: "pa-ht-header" });
    const left = head.createDiv();
    left.createDiv({ text: "🎯 Habit Tracker", cls: "pa-h1" });
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const dateStr = new Date().toLocaleDateString("default", { weekday: "long", day: "numeric", month: "short" });
    left.createDiv({ text: `${greeting}, Jaime · ${dateStr}`, cls: "pa-muted" });

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

  // ---- KPI row ----
  private renderKpis(
    root: HTMLElement,
    d: { tasks: Task[]; workouts: Workout[]; studyCards: StudyCard[]; mealCal: Map<string, number>; gym: Set<string>; today: string; waterToday: number }
  ): void {
    const ym = d.today.substring(0, 7);
    const workoutsMonth = d.workouts.filter((w) => w.date.substring(0, 7) === ym).length;
    const studyDone = d.studyCards.filter((c) => c.status === "done").length;
    const tasksDone = d.tasks.filter((t) => t.status === "done").length;
    const todayCal = d.mealCal.get(d.today) || 0;

    const activeDay = (ds: string) => d.gym.has(ds) || d.mealCal.has(ds);
    let streak = 0;
    const base = new Date(d.today + "T00:00:00");
    for (let i = 0; i < 365; i++) {
      const x = new Date(base);
      x.setDate(x.getDate() - i);
      if (activeDay(ymd(x))) streak++;
      else if (i === 0) continue;
      else break;
    }

    const row = root.createDiv({ cls: "pa-stats-row pa-kpis" });
    const kpi = (label: string, value: string) => {
      const c = row.createDiv({ cls: "pa-stat" });
      c.createDiv({ text: value, cls: "pa-stat-value" });
      c.createDiv({ text: label, cls: "pa-stat-label" });
    };
    kpi("🔥 Active streak", streak + "d");
    kpi("🏋️ Workouts (month)", String(workoutsMonth));
    kpi("🥗 Calories today", String(todayCal));
    kpi("💧 Water today", `${d.waterToday.toFixed(1)}L`);
    kpi("📚 Studies done", `${studyDone}/${d.studyCards.length}`);
    kpi("✅ Tasks done", `${tasksDone}/${d.tasks.length}`);
  }

  // ---- 3 donut charts ----
  private renderDonuts(
    root: HTMLElement,
    d: { workouts: Workout[]; studyCards: StudyCard[]; tasks: Task[]; today: string }
  ): void {
    const palette = ["#7c3aed", "#16a34a", "#f59e0b", "#3b82f6", "#ef4444", "#10b981"];
    const row = root.createDiv({ cls: "pa-donuts-row" });

    // Workouts by type (month)
    const ym = d.today.substring(0, 7);
    const bySplit = new Map<string, number>();
    d.workouts.forEach((w) => { if (w.date.substring(0, 7) === ym) bySplit.set(w.split, (bySplit.get(w.split) || 0) + 1); });
    this.donutPanel(row, "🏋️ Workouts by type (month)",
      Array.from(bySplit.entries()).map(([k, v], i) => ({ label: "Workout " + k, value: v, color: palette[i % palette.length] })));

    // Studies by status
    const byStatus = new Map<string, number>();
    d.studyCards.forEach((c) => { const s = c.status || "backlog"; byStatus.set(s, (byStatus.get(s) || 0) + 1); });
    this.donutPanel(row, "📚 Studies by status",
      Array.from(byStatus.entries()).map(([k, v], i) => ({ label: k, value: v, color: palette[i % palette.length] })));

    // Tasks by status
    const byTask = new Map<string, number>();
    d.tasks.forEach((t) => { const s = t.status || "backlog"; byTask.set(s, (byTask.get(s) || 0) + 1); });
    this.donutPanel(row, "✅ Tasks by status",
      Array.from(byTask.entries()).map(([k, v], i) => ({ label: k, value: v, color: palette[i % palette.length] })));
  }

  private donutPanel(row: HTMLElement, title: string, segments: Array<{ label: string; value: number; color: string }>): void {
    const panel = row.createDiv({ cls: "pa-panel pa-donut-panel" });
    panel.createEl("h3", { text: title, cls: "pa-panel-title" });
    drawDonut(panel, segments);
  }

  // ---- Habit consistency ----
  private renderHabitConsistency(root: HTMLElement, systemHabits: SystemHabit[], habits: Habit[], today: string): void {
    const panel = root.createDiv({ cls: "pa-panel" });
    const head = panel.createDiv({ cls: "pa-section-head" });
    head.createEl("h3", { text: "📊 Habit Consistency", cls: "pa-panel-title" });
    const add = head.createEl("button", { text: "+ New Habit", cls: "pa-btn" });
    add.onclick = () => this.openHabitModal();

    const grid = panel.createDiv({ cls: "pa-habits-grid" });
    systemHabits.forEach((h) => this.renderSystemHabit(grid, h, today));
    habits.forEach((h) => this.renderCustomHabit(grid, h, today));
  }

  private heatmap(card: HTMLElement, cellColor: (ds: string) => string | null, today: string): void {
    const hm = card.createDiv({ cls: "pa-heatmap" });
    const base = new Date(today + "T00:00:00");
    for (let j = HEATMAP_DAYS - 1; j >= 0; j--) {
      const x = new Date(base);
      x.setDate(x.getDate() - j);
      const ds = ymd(x);
      const cell = hm.createDiv({ cls: "pa-hm-cell" });
      cell.setAttr("title", ds);
      const c = cellColor(ds);
      if (c) cell.style.background = c;
    }
  }

  private renderSystemHabit(grid: HTMLElement, h: SystemHabit, today: string): void {
    let streak = 0;
    const base = new Date(today + "T00:00:00");
    for (let i = 0; i < 365; i++) {
      const x = new Date(base);
      x.setDate(x.getDate() - i);
      if (h.done(ymd(x))) streak++;
      else if (i === 0) continue;
      else break;
    }
    const card = grid.createDiv({ cls: "pa-habit-card" });
    const top = card.createDiv({ cls: "pa-habit-top" });
    top.createSpan({ text: h.label, cls: "pa-habit-name" });
    top.createSpan({ text: `🔥 ${streak}`, cls: "pa-muted pa-streak" });
    this.heatmap(card, (ds) => (h.done(ds) ? h.color : null), today);
  }

  private renderCustomHabit(grid: HTMLElement, h: Habit, today: string): void {
    const isQuit = h.habitType === "quit";
    const color = isQuit ? "#ef4444" : "#0ea5e9";
    const cleanColor = "#16a34a";
    const created = h.created || today;
    // Quit: clean days are green, relapse days (recorded on Reset) are red,
    // so a streak with an interruption stays visible. Do: filled on logged days.
    const cellColor: (ds: string) => string | null = isQuit
      ? (ds) => {
          if (h.log && h.log[ds]) return color;
          if (ds >= created && ds <= today) return cleanColor;
          return null;
        }
      : (ds) => (h.log[ds] ? color : null);

    let streak: number;
    if (isQuit) {
      streak = daysBetween(h.lastReset || h.created || today, today);
    } else {
      streak = 0;
      const base = new Date(today + "T00:00:00");
      for (let i = 0; i < 365; i++) {
        const x = new Date(base);
        x.setDate(x.getDate() - i);
        if (h.log[ymd(x)]) streak++;
        else if (i === 0) continue;
        else break;
      }
    }

    const card = grid.createDiv({ cls: "pa-habit-card" });
    const top = card.createDiv({ cls: "pa-habit-top" });
    top.createSpan({ text: `${h.emoji || "⭐"} ${h.name}`, cls: "pa-habit-name" });
    const right = top.createDiv({ cls: "pa-habit-actions" });
    right.createSpan({ text: isQuit ? `🚭 ${streak}d` : `🔥 ${streak}`, cls: "pa-muted pa-streak" });

    if (isQuit) {
      const reset = right.createEl("button", { text: "↺ Reset", cls: "pa-mini-btn" });
      reset.onclick = async () => { await this.ctx.store.resetHabit(h, today); this.ctx.refresh(); };
    } else {
      const marked = !!h.log[today];
      const mark = right.createEl("button", { text: marked ? "✓ Today" : "Mark today", cls: "pa-mini-btn" + (marked ? " on" : "") });
      if (marked) { mark.style.background = color; mark.style.color = "#fff"; }
      mark.onclick = async () => { await this.ctx.store.toggleHabit(h, today); this.ctx.refresh(); };
    }
    const del = right.createEl("button", { text: "🗑", cls: "pa-icon-btn" });
    del.onclick = () =>
      new ConfirmModal(this.ctx.app, `Remove habit "${h.name}"?`, async () => {
        await this.ctx.store.deleteHabit(h);
        this.ctx.refresh();
      }).open();

    this.heatmap(card, cellColor, today);
  }

  // ---- Study progress ----
  private renderStudyProgress(root: HTMLElement, boards: Board[], cards: StudyCard[]): void {
    if (!boards.length) return;
    const panel = root.createDiv({ cls: "pa-panel" });
    panel.createEl("h3", { text: "📚 Study Progress", cls: "pa-panel-title" });
    boards.forEach((b) => {
      const topicCards = cards.filter((c) => c.topic === b.name);
      const done = topicCards.filter((c) => c.status === "done").length;
      const total = topicCards.length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const color = pct >= 70 ? "#16a34a" : pct >= 30 ? "#d97706" : "var(--interactive-accent)";

      const labelRow = panel.createDiv({ cls: "pa-progress-label" });
      labelRow.createSpan({ text: `${b.emoji || ""} ${b.name}`.trim() });
      labelRow.createSpan({ text: `${pct}% (${done}/${total})`, cls: "pa-muted" });
      const bar = panel.createDiv({ cls: "pa-progress-track" });
      const fill = bar.createDiv({ cls: "pa-progress-fill" });
      fill.style.width = pct + "%";
      fill.style.background = color;
    });
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
