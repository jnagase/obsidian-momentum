import { PAContext } from "../context";
import { Exercise, Split, Workout, WorkoutExercise, DEFAULT_SPLITS } from "../types";
import { ConfirmModal, FieldSpec, FormModal, showActionMenu, toast } from "../ui";
import { todayLocal, ymd } from "../util";
import { drawRing, drawLineChart, LineSeries } from "../charts";

const SERIES_COLORS = ["#7c3aed", "#f59e0b", "#16a34a", "#3b82f6", "#ec4899", "#0ea5e9", "#ef4444", "#10b981", "#a855f7"];

/** Renders the Fitness page: monthly rings, workout plan, stats, calendar, weight progress and an active-workout flow. */
export class FitnessModule {
  private ctx: PAContext;
  private selectedSplit: string | null = null; // open workout (edit mode)
  private workoutActive = false;                // timer running / logging session
  private selectedDate: string | null = null;  // calendar day detail
  private weightSplit = "A";                    // weight-progress chart
  private startTime: number | null = null;
  private checked = new Set<string>();
  private timerId: number | null = null;
  private timerEl: HTMLElement | null = null;
  private calMonth: number;
  private calYear: number;

  constructor(ctx: PAContext) {
    this.ctx = ctx;
    const now = new Date();
    this.calMonth = now.getMonth();
    this.calYear = now.getFullYear();
    this.selectedDate = todayLocal(); // show today's log by default
  }

  destroy(): void { this.stopTimer(); }
  private stopTimer(): void { if (this.timerId != null) { window.clearInterval(this.timerId); this.timerId = null; } }

  private getSplits(): Split[] {
    const map = new Map<string, Split>();
    DEFAULT_SPLITS.forEach((s) => map.set(s.id, { ...s }));
    this.ctx.store.loadSplits().forEach((s) => map.set(s.id, s));
    this.ctx.config.customSplits.forEach((s) => map.set(s.id, s));
    return Array.from(map.values());
  }

  render(root: HTMLElement): void {
    this.stopTimer();
    root.empty();

    const exercises = this.ctx.store.loadExercises();
    const workouts = this.ctx.store.loadWorkouts();
    const gymLog = new Set(workouts.map((w) => w.date));

    this.renderHeader(root, workouts);
    this.renderStats(root, workouts, gymLog);

    const cols = root.createDiv({ cls: "pa-two-col" });
    this.renderCalendar(cols, workouts);
    this.renderWeightProgress(cols, exercises, workouts);

    this.renderWorkoutPlan(root, exercises);
    if (this.selectedSplit) this.renderWorkoutEditor(root, exercises);

    if (this.selectedDate) this.renderDayDetail(root, workouts);
  }

  // ---- Header with 3 monthly rings ----
  private renderHeader(root: HTMLElement, workouts: Workout[]): void {
    const head = root.createDiv({ cls: "pa-ht-header" });
    const left = head.createDiv();
    left.createDiv({ text: "🏋️ Fitness", cls: "pa-h1" });
    left.createDiv({ text: "Workouts & progress", cls: "pa-muted" });

    const rings = head.createDiv({ cls: "pa-ht-rings" });
    const now = new Date();
    const monthAbbr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (let m = 2; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const y = d.getFullYear();
      const mon = d.getMonth();
      const prefix = `${y}-${String(mon + 1).padStart(2, "0")}`;
      const isCurrent = m === 0;
      const daysElapsed = isCurrent ? now.getDate() : new Date(y, mon + 1, 0).getDate();
      const workoutDays = new Set(workouts.filter((w) => w.date.startsWith(prefix)).map((w) => w.date)).size;
      const pct = daysElapsed ? Math.round((workoutDays / daysElapsed) * 100) : 0;
      const color = pct >= 70 ? "#16a34a" : pct >= 30 ? "#7c3aed" : "#d97706";
      drawRing(rings, pct, color, `${monthAbbr[mon]} ${String(y).slice(2)} · ${workoutDays}/${daysElapsed}d`, 58);
    }
  }

  // ---- Workout plan cards ----
  private renderWorkoutPlan(root: HTMLElement, exercises: Exercise[]): void {
    const splits = this.getSplits();
    const panel = root.createDiv({ cls: "pa-panel" });
    panel.createEl("h3", { text: `📋 Workout Plan — ${splits.length} slots · tap a card to edit`, cls: "pa-panel-title" });

    const grid = panel.createDiv({ cls: "pa-plan-grid" });
    splits.forEach((s) => {
      const exs = exercises.filter((e) => e.split === s.id);
      const card = grid.createDiv({ cls: "pa-plan-card pa-clickable" + (this.selectedSplit === s.id ? " on" : "") });
      card.onclick = () => {
        if (this.selectedSplit === s.id) { this.endWorkout(); }
        else { this.selectedSplit = s.id; this.weightSplit = s.id; this.workoutActive = false; this.startTime = null; this.checked.clear(); }
        this.ctx.refresh();
      };
      const ch = card.createDiv({ cls: "pa-plan-head" });
      ch.createSpan({ text: `${s.id} - ${s.name} (${exs.length} ex)`, cls: "pa-plan-title" });
      const listEl = card.createDiv({ cls: "pa-plan-list" });
      if (!exs.length) listEl.createDiv({ cls: "pa-muted", text: "No exercises" });
      else exs.forEach((ex) => listEl.createDiv({ cls: "pa-plan-ex", text: `${ex.name} — ${ex.sets}${ex.weight ? ` · ${ex.weight}kg` : ""}` }));
    });
  }

  private endWorkout(): void { this.stopTimer(); this.selectedSplit = null; this.workoutActive = false; this.startTime = null; this.checked.clear(); }

  // ---- Stats ----
  private renderStats(root: HTMLElement, workouts: Workout[], gymLog: Set<string>): void {
    const total = workouts.length;
    const last = workouts.length ? workouts[workouts.length - 1].date : "—";
    let streak = 0;
    for (let i = 0; i < 60; i++) { const d = new Date(); d.setDate(d.getDate() - i); if (gymLog.has(ymd(d))) streak++; else if (i > 0) break; }
    const durations = workouts.map((w) => w.duration).filter((d) => d > 0);
    const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

    const row = root.createDiv({ cls: "pa-stats-row" });
    const stat = (label: string, value: string) => {
      const c = row.createDiv({ cls: "pa-stat" });
      c.createDiv({ text: value, cls: "pa-stat-value" });
      c.createDiv({ text: label, cls: "pa-stat-label" });
    };
    stat("🏋️ SESSIONS", String(total));
    stat("🔥 STREAK", String(streak));
    stat("⏱ AVG MIN", String(avg));
    stat("📅 LAST", last !== "—" ? last.slice(5) : "—");
  }

  // ---- Calendar ----
  private renderCalendar(root: HTMLElement, workouts: Workout[]): void {
    const splitsByDay = new Map<string, string[]>();
    workouts.forEach((w) => {
      const arr = splitsByDay.get(w.date) || [];
      if (!arr.includes(w.split)) arr.push(w.split);
      splitsByDay.set(w.date, arr);
    });

    const card = root.createDiv({ cls: "pa-panel" });
    card.createEl("h3", { text: "📅 Workout calendar", cls: "pa-panel-title" });
    const header = card.createDiv({ cls: "pa-cal-head" });
    const prev = header.createEl("button", { text: "←", cls: "pa-icon-btn" });
    header.createSpan({ text: new Date(this.calYear, this.calMonth, 1).toLocaleString("default", { month: "long", year: "numeric" }), cls: "pa-cal-title" });
    const next = header.createEl("button", { text: "→", cls: "pa-icon-btn" });
    prev.onclick = () => { this.calMonth--; if (this.calMonth < 0) { this.calMonth = 11; this.calYear--; } this.ctx.refresh(); };
    next.onclick = () => { this.calMonth++; if (this.calMonth > 11) { this.calMonth = 0; this.calYear++; } this.ctx.refresh(); };

    const dow = card.createDiv({ cls: "pa-cal-dow-row" });
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d) => dow.createDiv({ text: d, cls: "pa-cal-dow" }));
    const days = card.createDiv({ cls: "pa-cal-grid pa-cal-days" });
    const firstDow = new Date(this.calYear, this.calMonth, 1).getDay();
    const daysInMonth = new Date(this.calYear, this.calMonth + 1, 0).getDate();
    for (let i = 0; i < firstDow; i++) days.createDiv({ cls: "pa-cal-cell empty" });
    const today = todayLocal();
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${this.calYear}-${String(this.calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const cell = days.createDiv({ cls: "pa-cal-cell" });
      cell.createDiv({ text: String(day), cls: "pa-cal-day" });
      const sp = splitsByDay.get(ds);
      if (sp && sp.length) {
        cell.addClass("worked");
        cell.createDiv({ text: sp.join(" "), cls: "pa-cal-tag" });
        cell.onclick = () => { this.selectedDate = ds; this.ctx.refresh(); };
      }
      if (ds === today) cell.addClass("today");
      if (ds === this.selectedDate) cell.addClass("selected");
    }
  }

  // ---- Weight progress ----
  private renderWeightProgress(root: HTMLElement, exercises: Exercise[], workouts: Workout[]): void {
    const card = root.createDiv({ cls: "pa-panel" });
    const head = card.createDiv({ cls: "pa-section-head" });
    head.createEl("h3", { text: "📈 Weight progress", cls: "pa-panel-title" });
    const sel = head.createEl("select", { cls: "pa-select" });
    this.getSplits().forEach((s) => { const o = sel.createEl("option", { text: `Workout ${s.id}`, value: s.id }); if (s.id === this.weightSplit) o.selected = true; });
    sel.onchange = () => { this.weightSplit = sel.value; this.ctx.refresh(); };

    const splitWorkouts = workouts.filter((w) => w.split === this.weightSplit).sort((a, b) => a.date.localeCompare(b.date));
    const labels = splitWorkouts.map((w) => w.date.slice(5));
    const exs = exercises.filter((e) => e.split === this.weightSplit);
    const series: LineSeries[] = exs.map((ex, i) => ({
      name: ex.name,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      values: splitWorkouts.map((w) => {
        const found = w.exercises.find((we) => we.exercise === ex.name);
        return found ? found.weight : null;
      }),
    })).filter((s) => s.values.some((v) => v != null));

    drawLineChart(card, labels, series, { height: 220 });
  }

  // ---- Calendar day detail ----
  private renderDayDetail(root: HTMLElement, workouts: Workout[]): void {
    const ds = this.selectedDate!;
    const dayWorkouts = workouts.filter((w) => w.date === ds);
    const panel = root.createDiv({ cls: "pa-panel pa-active" });
    const top = panel.createDiv({ cls: "pa-active-top" });
    top.createEl("h3", { text: `🏋️ ${ds} — ${dayWorkouts.length} workout${dayWorkouts.length === 1 ? "" : "s"}`, cls: "pa-panel-title" });
    const close = top.createEl("button", { text: "✕", cls: "pa-icon-btn" });
    close.onclick = () => { this.selectedDate = null; this.ctx.refresh(); };

    if (!dayWorkouts.length) { panel.createEl("p", { cls: "pa-muted", text: "No workouts logged this day." }); return; }
    dayWorkouts.forEach((w) => this.renderLoggedWorkout(panel, w));
  }

  private renderLoggedWorkout(panel: HTMLElement, w: Workout): void {
    const split = this.getSplits().find((s) => s.id === w.split);
    const card = panel.createDiv({ cls: "pa-card" });
    const head = card.createDiv({ cls: "pa-card-title-row" });
    head.createEl("strong", { text: `${w.split} - ${split?.name || ""} · ${w.duration}min` });
    const del = head.createEl("button", { text: "✕", cls: "pa-icon-btn" });
    del.onclick = () =>
      new ConfirmModal(this.ctx.app, `Delete this ${w.split} workout log?`, async () => { await this.ctx.store.deleteWorkout(w); this.ctx.refresh(); }).open();

    if (!w.exercises.length) { card.createEl("p", { cls: "pa-muted", text: "No exercises." }); return; }
    const table = card.createEl("table", { cls: "pa-fit-table" });
    const thr = table.createEl("thead").createEl("tr");
    ["Exercise", "Weight", "Sets"].forEach((h) => thr.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    w.exercises.forEach((we, idx) => {
      const tr = tbody.createEl("tr");
      tr.dataset.idx = String(idx);
      tr.createEl("td", { text: we.exercise, cls: "pa-fit-name" });
      const wIn = tr.createEl("td").createEl("input", { cls: "pa-fit-input pa-log-w" });
      wIn.type = "number"; wIn.value = String(we.weight);
      const sIn = tr.createEl("td").createEl("input", { cls: "pa-fit-input pa-log-s" });
      sIn.value = we.sets;
    });

    const save = card.createEl("button", { text: "💾 Save changes", cls: "pa-mini-btn" });
    save.onclick = async () => {
      const updated: WorkoutExercise[] = w.exercises.map((we, idx) => {
        const tr = tbody.querySelector(`tr[data-idx="${idx}"]`);
        const wv = tr?.querySelector("input.pa-log-w") as HTMLInputElement | null;
        const sv = tr?.querySelector("input.pa-log-s") as HTMLInputElement | null;
        return { ...we, weight: wv ? parseFloat(wv.value) || 0 : we.weight, sets: sv ? (sv.value.trim() || we.sets) : we.sets };
      });
      await this.ctx.store.updateWorkoutExercises(w, updated);
      this.ctx.refresh();
      toast("💾 Workout updated");
    };
  }

  // ---- Workout editor (edit mode + optional active session) ----
  private renderWorkoutEditor(root: HTMLElement, exercises: Exercise[]): void {
    const splitId = this.selectedSplit!;
    const exs = exercises.filter((e) => e.split === splitId);
    const panel = root.createDiv({ cls: "pa-panel pa-active" });

    const top = panel.createDiv({ cls: "pa-active-top" });
    const split = this.getSplits().find((s) => s.id === splitId);
    const titleWrap = top.createDiv({ cls: "pa-editor-title" });
    titleWrap.createEl("h3", { text: `${splitId} - ${split?.name || ""}`, cls: "pa-panel-title" });
    if (split) {
      const rename = titleWrap.createEl("button", { text: "✏️", cls: "pa-icon-btn" });
      rename.onclick = () => this.openSplitRename(split);
    }
    if (this.workoutActive) {
      this.timerEl = top.createSpan({ text: "⏱ 00:00", cls: "pa-timer" });
      this.startTimer();
    }

    if (!exs.length) {
      panel.createEl("p", { cls: "pa-muted", text: "No exercises in this workout. Add some with + exercise." });
    } else {
      const table = panel.createEl("table", { cls: "pa-fit-table" });
      const cols = this.workoutActive ? ["✓", "Exercise", "Weight", "Sets", "How-to", ""] : ["Exercise", "Weight", "Sets", "How-to", ""];
      const thead = table.createEl("thead").createEl("tr");
      cols.forEach((h) => thead.createEl("th", { text: h }));
      const tbody = table.createEl("tbody");
      exs.forEach((ex) => this.renderExerciseRow(tbody, ex));
    }

    const actions = panel.createDiv({ cls: "pa-active-actions" });
    if (this.workoutActive) {
      const finish = actions.createEl("button", { text: "✅ Finish workout", cls: "pa-btn" });
      finish.onclick = () => this.finishWorkout(splitId, exs, panel);
    } else {
      const start = actions.createEl("button", { text: "▶ Start workout", cls: "pa-btn" });
      start.onclick = async () => {
        await this.persistRowEdits(exs, panel); // keep edits before timing begins
        this.workoutActive = true;
        this.startTime = Date.now();
        this.checked.clear();
        this.ctx.refresh();
      };
      const addEx = actions.createEl("button", { text: "+ exercise", cls: "pa-mini-btn" });
      addEx.onclick = () => this.openExerciseModal(null);
      const save = actions.createEl("button", { text: "💾 Save changes", cls: "pa-mini-btn" });
      save.onclick = async () => { const n = await this.persistRowEdits(exs, panel); toast(n ? `💾 Saved (${n})` : "💾 Saved"); };
    }
    const close = actions.createEl("button", { text: "Close", cls: "pa-mini-btn" });
    close.onclick = () => { this.endWorkout(); this.ctx.refresh(); };
  }

  /** Persist edited weight/sets back to the exercise files. Returns number changed. */
  private async persistRowEdits(exs: Exercise[], panel: HTMLElement): Promise<number> {
    let changed = 0;
    for (const ex of exs) {
      const wInput = panel.querySelector<HTMLInputElement>(`input.pa-weight-input[data-ex="${CSS.escape(ex.name)}"]`);
      const sInput = panel.querySelector<HTMLInputElement>(`input.pa-sets-input[data-ex="${CSS.escape(ex.name)}"]`);
      const newWeight = wInput ? parseFloat(wInput.value) || 0 : ex.weight;
      const newSets = sInput ? (sInput.value.trim() || ex.sets) : ex.sets;
      if (newWeight !== ex.weight || newSets !== ex.sets) { await this.ctx.store.saveExercise({ ...ex, weight: newWeight, sets: newSets }); changed++; }
    }
    return changed;
  }

  private renderExerciseRow(tbody: HTMLElement, ex: Exercise): void {
    const tr = tbody.createEl("tr");
    if (this.workoutActive) {
      const check = tr.createEl("td").createEl("input");
      check.type = "checkbox";
      check.checked = this.checked.has(ex.name);
      check.onchange = () => { if (check.checked) this.checked.add(ex.name); else this.checked.delete(ex.name); tr.toggleClass("done", check.checked); };
      tr.toggleClass("done", check.checked);
    }

    const nameTd = tr.createEl("td", { cls: "pa-fit-name" });
    nameTd.createDiv({ text: ex.name });
    if (ex.howto) nameTd.setAttr("title", ex.howto);

    const wInput = tr.createEl("td").createEl("input", { cls: "pa-fit-input" });
    wInput.type = "number"; wInput.value = String(ex.weight); wInput.dataset.ex = ex.name; wInput.addClass("pa-weight-input");

    const setsInput = tr.createEl("td").createEl("input", { cls: "pa-fit-input" });
    setsInput.value = ex.sets; setsInput.dataset.ex = ex.name; setsInput.addClass("pa-sets-input");

    tr.createEl("td", { text: ex.howto || "—", cls: "pa-fit-howto" });

    const actionsTd = tr.createEl("td");
    const kebab = actionsTd.createEl("button", { text: "⋮", cls: "pa-icon-btn" });
    kebab.onclick = (e) => showActionMenu(e, [
      { title: "Edit", icon: "pencil", onClick: () => this.openExerciseModal(ex) },
      { title: "Delete", icon: "trash", warning: true, onClick: () => new ConfirmModal(this.ctx.app, `Delete exercise "${ex.name}"?`, async () => { await this.ctx.store.deleteExercise(ex); this.ctx.refresh(); }).open() },
    ]);
  }

  private startTimer(): void {
    this.stopTimer();
    const tick = () => {
      if (!this.startTime || !this.timerEl) return;
      const diff = Math.floor((Date.now() - this.startTime) / 1000);
      this.timerEl.setText(`⏱ ${String(Math.floor(diff / 60)).padStart(2, "0")}:${String(diff % 60).padStart(2, "0")}`);
    };
    tick();
    this.timerId = window.setInterval(tick, 1000);
  }

  private async finishWorkout(splitId: string, exs: Exercise[], panel: HTMLElement): Promise<void> {
    if (!this.startTime) return;
    const duration = Math.max(1, Math.floor((Date.now() - this.startTime) / 1000 / 60));
    const logged: WorkoutExercise[] = [];
    for (const ex of exs) {
      const wInput = panel.querySelector<HTMLInputElement>(`input.pa-weight-input[data-ex="${CSS.escape(ex.name)}"]`);
      const sInput = panel.querySelector<HTMLInputElement>(`input.pa-sets-input[data-ex="${CSS.escape(ex.name)}"]`);
      const newWeight = wInput ? parseFloat(wInput.value) || 0 : ex.weight;
      const newSets = sInput ? (sInput.value.trim() || ex.sets) : ex.sets;
      if (newWeight !== ex.weight || newSets !== ex.sets) await this.ctx.store.saveExercise({ ...ex, weight: newWeight, sets: newSets });
      if (this.checked.has(ex.name)) logged.push({ exercise: ex.name, weight: newWeight, sets: newSets, feel: "good", oldWeight: ex.weight });
    }
    if (!logged.length) { toast("Check at least one exercise to log."); return; }
    await this.ctx.store.logWorkout(splitId, duration, logged);
    this.endWorkout();
    this.selectedDate = todayLocal(); // show the just-logged workout as a log at the bottom
    this.ctx.refresh();
    toast(`💪 Workout logged (${logged.length} exercises, ${duration}min)`);
  }

  // ---- Modals ----
  private openSplitRename(s: Split): void {
    new FormModal(this.ctx.app, "Rename workout", [{ key: "name", label: "Workout name", type: "text", value: s.name }], async (v) => {
      const name = (v.name || "").trim();
      if (!name) return;
      const splits = this.getSplits().map((x) => (x.id === s.id ? { ...x, name } : x));
      await this.ctx.store.saveSplits(splits);
      this.ctx.refresh();
    }, "Save").open();
  }

  private openExerciseModal(ex: Exercise | null): void {
    const splitOptions = this.getSplits().map((s) => ({ value: s.id, label: `${s.id} — ${s.name}` }));
    const fields: FieldSpec[] = [
      { key: "name", label: "Name", type: "text", value: ex?.name || "" },
      { key: "split", label: "Workout", type: "dropdown", options: splitOptions, value: ex?.split || (this.selectedSplit || "A") },
      { key: "sets", label: "Sets x reps", type: "text", value: ex?.sets || "3x10" },
      { key: "weight", label: "Weight (kg)", type: "number", value: ex?.weight ?? 0 },
      { key: "howto", label: "How-to", type: "textarea", value: ex?.howto || "" },
    ];
    new FormModal(this.ctx.app, ex ? "Edit exercise" : "New exercise", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name) return;
      const ok = await this.ctx.store.saveExercise({
        name, split: v.split, sets: v.sets || "3x10", weight: parseFloat(v.weight) || 0, howto: v.howto || "",
        // preserve metadata not edited here
        muscle: ex?.muscle || "", type: ex?.type || "machine",
      }, ex?.name);
      if (!ok) { toast(`An exercise named "${name}" already exists.`); return; }
      this.ctx.refresh();
    }, ex ? "Save" : "Create").open();
  }
}
