import { App, ItemView, TFile, WorkspaceLeaf, debounce } from "obsidian";
import { PAContext } from "./context";
import { PADataStore, DATA_ROOT } from "./data";
import { todayLocal } from "./util";
import { drawRing, drawDonut, drawBars } from "./charts";
import { StudyCard, Task, Exercise } from "./types";
import { FormModal, FieldSpec, toast } from "./ui";

/** Shared palette for the panel's donuts/bars. */
const CHART_COLORS = ["#7c3aed", "#3b82f6", "#16a34a", "#f59e0b", "#ef4444", "#10b981", "#e11d48", "#0ea5e9"];

export const VIEW_TYPE_PA_SIDE = "momentum-side";

/** Frontmatter `type` values the context panel knows how to summarize. */
const KNOWN_TYPES = new Set([
  "task", "note", "habit", "workout-log", "study", "meal-log", "meal-plan", "transaction",
]);

/** The Momentum note type for `file`, or null when it's not a known Momentum note. */
export function momentumNoteType(app: App, file: TFile): string | null {
  if (!file.path.startsWith(DATA_ROOT + "/")) return null;
  const t: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.type;
  const type = typeof t === "string" ? t.toLowerCase() : "";
  return KNOWN_TYPES.has(type) ? type : null;
}

/**
 * Right-sidebar context panel. It follows the note you open: when that note is a
 * Momentum note (task, transaction, meal, workout, …) it shows only what matters
 * for that item plus quick actions. With no Momentum note in focus it falls back
 * to the Tasks summary (status rings + task list). Scroll is preserved across the
 * auto re-renders that editing triggers.
 */
export class PASideView extends ItemView {
  private ctx: PAContext;
  private mainEl: HTMLElement | null = null;
  /** Path of the note the panel is currently mirroring. */
  private targetPath: string | null = null;
  /** What drives the panel: a focused note ("note") or the active Momentum page ("page"). */
  private mode: "note" | "page" = "page";
  /** The Momentum page whose summary to show in "page" mode. */
  private currentPage = "tasks";
  /** Tasks panel: selected board filter ("all" or a board name). */
  private taskBoard = "all";
  /** Studies panel: selected topic filter ("all" or a topic name). */
  private studyTopic = "all";
  /** Which columns are expanded, keyed "task:<col>" / "study:<col>" (kept across re-renders). */
  private openCols = new Set<string>();
  /** Whether the default column expand-state was applied yet (per domain). */
  private colsInit = new Set<string>();

  constructor(leaf: WorkspaceLeaf, store: PADataStore) {
    super(leaf);
    this.ctx = new PAContext(this.app, store);
    this.ctx.refresh = () => this.render();
  }

  getViewType(): string { return VIEW_TYPE_PA_SIDE; }
  getDisplayText(): string { return "Momentum context"; }
  getIcon(): string { return "target"; }

  async onOpen(): Promise<void> {
    await this.ctx.reloadConfig();
    const root = this.contentEl;
    root.empty();
    root.addClass("pa-root", "pa-side-root");
    this.mainEl = root.createDiv({ cls: "pa-page" });

    // Start on whatever note is already active, if it's a Momentum note.
    const active = this.app.workspace.getActiveFile();
    if (active && this.isMomentumNote(active)) { this.mode = "note"; this.targetPath = active.path; }
    this.render();

    // Re-render when the plugin's data changes (config, tasks, boards, notes).
    const refresh = debounce(() => { void this.reloadAndRender(); }, 400, true);
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file.path.startsWith(DATA_ROOT + "/")) refresh();
      })
    );
  }

  async onClose(): Promise<void> {}

  /** Point the panel at a note. Ignores non-Momentum notes so the last context stays. */
  showFile(file: TFile | null): void {
    if (file && this.isMomentumNote(file)) {
      this.mode = "note";
      this.targetPath = file.path;
      this.render();
    }
  }

  /** Point the panel at a Momentum page (called when the nav switches tabs). */
  showPage(pageId: string): void {
    this.mode = "page";
    this.currentPage = pageId;
    this.render();
  }

  private isMomentumNote(file: TFile): boolean {
    return momentumNoteType(this.app, file) != null;
  }

  private typeOf(file: TFile): string {
    return momentumNoteType(this.app, file) ?? "";
  }

  private async reloadAndRender(): Promise<void> {
    await this.ctx.reloadConfig();
    this.render();
  }

  private render(): void {
    if (!this.mainEl) return;
    // Keep scroll position across the auto re-renders that editing triggers.
    const scrollTop = this.mainEl.scrollTop;
    this.mainEl.empty();

    if (this.mode === "note") {
      const file = this.targetPath ? this.app.vault.getAbstractFileByPath(this.targetPath) : null;
      if (file instanceof TFile && this.isMomentumNote(file)) {
        this.renderContext(this.mainEl, file, this.typeOf(file));
        this.mainEl.scrollTop = scrollTop;
        return;
      }
    }
    // Page mode (or note fell through): show the active module's summary.
    this.renderPageSummary(this.mainEl, this.currentPage);
    this.mainEl.scrollTop = scrollTop;
  }

  /** Compact summary for a Momentum page (shown when the nav switches tabs). */
  private renderPageSummary(root: HTMLElement, page: string): void {
    switch (page) {
      case "finances": this.renderFinanceSummary(root); break;
      case "nutrition": this.renderNutritionSummary(root); break;
      case "fitness": this.renderFitnessSummary(root); break;
      case "studies": this.renderStudiesSummary(root); break;
      case "habit-tracker": this.renderHabitSummary(root); break;
      case "tasks":
      default: this.renderTasksSummary(root);
    }
  }

  private summaryHeader(root: HTMLElement, title: string, subtitle: string): void {
    const head = root.createDiv({ cls: "pa-ctx-header" });
    head.createDiv({ text: title, cls: "pa-ctx-name" });
    if (subtitle) head.createDiv({ text: subtitle, cls: "pa-muted" });
  }

  /** A row of colored stat chips (value + label). */
  private statChips(root: HTMLElement, stats: Array<{ label: string; value: string; color?: string }>): void {
    const row = root.createDiv({ cls: "pa-ctx-stats" });
    for (const s of stats) {
      const chip = row.createDiv({ cls: "pa-ctx-stat" });
      const v = chip.createDiv({ text: s.value, cls: "pa-ctx-stat-value" });
      if (s.color) v.style.color = s.color;
      chip.createDiv({ text: s.label, cls: "pa-ctx-stat-label" });
    }
  }

  /** Last `n` dates ending today, as YYYY-MM-DD, oldest first. */
  private lastNDates(n: number): string[] {
    const out: string[] = [];
    const d = new Date(); d.setHours(0, 0, 0, 0);
    for (let i = n - 1; i >= 0; i--) {
      const x = new Date(d); x.setDate(d.getDate() - i);
      out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`);
    }
    return out;
  }

  /**
   * Render a collapsible column (Backlog/In progress/Done style) with optional reorder + add.
   * Uses an explicit open flag + re-render (not native <details>) so the panel's frequent
   * auto re-renders never fight the user's expand/collapse.
   */
  private renderColumn(root: HTMLElement, opts: {
    title: string; count: number; open: boolean;
    onToggle: (open: boolean) => void;
    renderBody: (body: HTMLElement) => void;
    onAdd?: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
  }): void {
    const wrap = root.createDiv({ cls: "pa-ctx-col" + (opts.open ? " open" : "") });
    const head = wrap.createDiv({ cls: "pa-ctx-col-sum" });
    head.createSpan({ text: opts.title, cls: "pa-ctx-col-title" });
    const tools = head.createSpan({ cls: "pa-ctx-col-tools" });
    const moveBtn = (glyph: string, label: string, handler?: () => void) => {
      if (!handler) return;
      const b = tools.createEl("button", { cls: "pa-ctx-col-move", text: glyph });
      b.setAttr("aria-label", label);
      b.onclick = (e) => { e.stopPropagation(); handler(); };
    };
    moveBtn("▲", "Move column up", opts.onMoveUp);
    moveBtn("▼", "Move column down", opts.onMoveDown);
    tools.createSpan({ text: String(opts.count), cls: "pa-ctx-col-count" });
    head.onclick = () => { opts.onToggle(!opts.open); this.render(); };

    if (opts.open) {
      const body = wrap.createDiv({ cls: "pa-ctx-col-body" });
      opts.renderBody(body);
      if (opts.onAdd) {
        const add = body.createEl("button", { cls: "pa-ctx-add", text: "+ add" });
        add.onclick = (e) => { e.stopPropagation(); opts.onAdd!(); };
      }
    }
  }

  /** Reorder a column in the config (shared with the full board) and re-render. */
  private async moveColumn(domain: "task" | "study", col: string, dir: -1 | 1): Promise<void> {
    const cfg = this.ctx.config;
    const arr = domain === "task" ? cfg.taskColumns : cfg.studyColumns;
    const i = arr.indexOf(col);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    await this.ctx.store.saveConfig(cfg);
    await this.ctx.reloadConfig();
    this.render();
  }

  /** Default: non-done columns expanded, Done collapsed — applied once per domain. */
  private ensureColDefaults(domain: string, cols: string[], doneCol: string): void {
    if (this.colsInit.has(domain)) return;
    cols.filter((c) => c !== doneCol).forEach((c) => this.openCols.add(`${domain}:${c}`));
    this.colsInit.add(domain);
  }

  /** Quick "new task" dialog seeded with a column and the current board. */
  private taskQuickAdd(status: string): void {
    const fields: FieldSpec[] = [
      { key: "title", label: "Title", type: "text", value: "", placeholder: "New task" },
      { key: "due", label: "Due date", type: "text", value: "", placeholder: "YYYY-MM-DD" },
    ];
    new FormModal(this.app, "New task", fields, async (v) => {
      const title = (v.title || "").trim();
      if (!title) return;
      await this.ctx.store.createTask({
        title, status,
        kanbanName: this.taskBoard === "all" ? "" : this.taskBoard,
        due: (v.due || "").trim() || undefined,
      });
      this.render();
    }, "Create").open();
  }

  /** Quick "new study card" dialog seeded with a column and topic. */
  private studyQuickAdd(status: string): void {
    const topics = this.ctx.store.loadStudyBoards();
    const topicOpts = topics.map((b) => ({ value: b.name, label: `${b.emoji || ""} ${b.name}`.trim() }));
    const preset = this.studyTopic !== "all" ? this.studyTopic : (topicOpts[0]?.value || "");
    const fields: FieldSpec[] = [
      { key: "title", label: "Title", type: "text", value: "", placeholder: "New card" },
      { key: "topic", label: "Topic", type: "dropdown", value: preset, options: topicOpts.length ? topicOpts : [{ value: "", label: "— none —" }] },
    ];
    new FormModal(this.app, "New study card", fields, async (v) => {
      const title = (v.title || "").trim();
      const topic = (v.topic || "").trim();
      if (!title || !topic) return;
      await this.ctx.store.createStudyCard({ title, topic, status });
      this.render();
    }, "Create").open();
  }

  /** Log a workout from a split's defined exercises, asking only for the duration. */
  private quickLogWorkout(splitId: string, exercises: Exercise[]): void {
    const list = exercises.filter((e) => e.split === splitId).map((e) => ({ exercise: e.name, weight: e.weight, sets: e.sets }));
    new FormModal(this.app, "Log workout", [{ key: "duration", label: "Duration (min)", type: "number", value: "45" }], async (v) => {
      const dur = parseInt(v.duration, 10) || 45;
      await this.ctx.store.logWorkout(splitId, dur, list);
      toast("Workout logged");
      this.render();
    }, "Log").open();
  }

  /** Quick income/expense dialog (amount + category + note). */
  private quickTransaction(type: "income" | "expense"): void {
    const cats = type === "income" ? this.ctx.config.incomeCategories : this.ctx.config.expenseCategories;
    const fields: FieldSpec[] = [
      { key: "amount", label: "Amount", type: "number", value: "" },
      { key: "category", label: "Category", type: "dropdown", value: cats[0] || "Other", options: cats.map((c) => ({ value: c, label: c })) },
      { key: "note", label: "Note", type: "text", value: "" },
    ];
    new FormModal(this.app, type === "income" ? "New income" : "New expense", fields, async (v) => {
      const amount = parseFloat(v.amount) || 0;
      if (!amount) return;
      await this.ctx.store.addTransaction({ type, amount, category: v.category, note: (v.note || "").trim() || undefined });
      toast(`${type === "income" ? "Income" : "Expense"} added`);
      this.render();
    }, "Add").open();
  }

  // --- Tasks briefing (distinct from the full board) -------------------------

  private renderTasksSummary(root: HTMLElement): void {
    const cols = this.ctx.config.taskColumns;
    const names = this.ctx.config.taskColumnNames;
    const colSet = new Set(cols);
    const eff = (t: Task) => (colSet.has(t.status) ? t.status : cols[0]);
    const doneCol = cols.includes("done") ? "done" : cols[cols.length - 1];
    const firstCol = cols[0];
    const boards = this.ctx.store.loadBoards();
    const allTasks = this.ctx.store.loadTasks();
    const tasks = allTasks.filter((t) => this.taskBoard === "all" || t.kanbanName === this.taskBoard);
    const total = tasks.length || 1;
    const open = tasks.filter((t) => eff(t) !== doneCol);
    const today = todayLocal();

    this.ensureColDefaults("task", cols, doneCol);

    this.summaryHeader(root, "✅ Tasks", `${tasks.length} task${tasks.length === 1 ? "" : "s"}`);

    // Board selector.
    const boardBar = root.createDiv({ cls: "pa-ctx-board" });
    const sel = boardBar.createEl("select", { cls: "pa-ctx-board-select dropdown" });
    sel.createEl("option", { text: "📋 All boards", value: "all" });
    boards.forEach((b) => sel.createEl("option", { text: `${b.emoji || ""} ${b.name}`.trim(), value: b.name }));
    sel.value = this.taskBoard;
    sel.onchange = () => { this.taskBoard = sel.value; this.render(); };

    const rings = root.createDiv({ cls: "pa-ht-rings" });
    const ringColors = ["#d97706", "#7c3aed", "#16a34a"];
    cols.slice(0, 3).forEach((col, i) => {
      const cnt = tasks.filter((t) => eff(t) === col).length;
      const label = (names[col] || col).replace(/^[^\p{L}\p{N}]+/u, "").trim();
      drawRing(rings, Math.round((cnt / total) * 100), ringColors[i] || "#7c3aed", label, 52);
    });

    const overdue = open.filter((t) => t.due && t.due < today).sort((a, b) => (a.due || "").localeCompare(b.due || ""));
    const in7 = new Date(); in7.setHours(0, 0, 0, 0); in7.setDate(in7.getDate() + 7);
    const in7Str = `${in7.getFullYear()}-${String(in7.getMonth() + 1).padStart(2, "0")}-${String(in7.getDate()).padStart(2, "0")}`;
    const dueSoon = open.filter((t) => t.due && t.due >= today && t.due <= in7Str).sort((a, b) => (a.due || "").localeCompare(b.due || ""));

    this.statChips(root, [
      { label: "Open", value: String(open.length), color: "#3b82f6" },
      { label: "Overdue", value: String(overdue.length), color: "#ef4444" },
      { label: "Due ≤7d", value: String(dueSoon.length), color: "#f59e0b" },
    ]);

    // Donut: open by board (All view) or open by column (single board).
    if (this.taskBoard === "all") {
      const byBoard = new Map<string, number>();
      for (const t of open) { const k = t.kanbanName || "No board"; byBoard.set(k, (byBoard.get(k) || 0) + 1); }
      if (byBoard.size) {
        const sec = this.section(root, "Open by board");
        const segments = [...byBoard.entries()].map(([label, value], i) => ({ label, value, color: CHART_COLORS[i % CHART_COLORS.length] }));
        drawDonut(sec, segments, 150);
      }
    }

    // Collapsible columns with per-task complete/reopen toggles, reorder + quick add.
    const ord = (t: Task) => (t.order ?? 1e9);
    cols.forEach((col, idx) => {
      const colTasks = tasks.filter((t) => eff(t) === col).sort((a, b) => ord(a) - ord(b) || a.title.localeCompare(b.title));
      this.renderColumn(root, {
        title: names[col] || col,
        count: colTasks.length,
        open: this.openCols.has(`task:${col}`),
        onToggle: (o) => { if (o) this.openCols.add(`task:${col}`); else this.openCols.delete(`task:${col}`); },
        renderBody: (body) => {
          if (!colTasks.length) body.createDiv({ cls: "pa-muted", text: "Empty." });
          for (const t of colTasks) this.renderTaskRow(body, t, col === doneCol, doneCol, firstCol);
        },
        onAdd: () => this.taskQuickAdd(col),
        onMoveUp: idx > 0 ? () => void this.moveColumn("task", col, -1) : undefined,
        onMoveDown: idx < cols.length - 1 ? () => void this.moveColumn("task", col, 1) : undefined,
      });
    });
  }

  /** A task row with a toggle circle (close/reopen) and a clickable title. */
  private renderTaskRow(parent: HTMLElement, t: Task, isDone: boolean, doneCol: string, firstCol: string): void {
    const row = parent.createDiv({ cls: "pa-ctx-taskrow" + (isDone ? " done" : "") });
    const circle = row.createSpan({ cls: "pa-list-circle" + (isDone ? " on" : ""), text: isDone ? "●" : "○" });
    circle.setAttr("aria-label", isDone ? "Reopen task" : "Mark done");
    circle.onclick = () => void (async () => {
      await this.ctx.store.updateTask(t, { status: isDone ? firstCol : doneCol });
      this.render();
    })();
    const main = row.createDiv({ cls: "pa-ctx-taskrow-main" });
    const title = main.createDiv({ text: t.title, cls: "pa-ctx-item-title" });
    title.onclick = () => {
      const f = this.app.vault.getAbstractFileByPath(t.path);
      if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
    };
    if (t.due) main.createDiv({ text: `📅 ${t.due.slice(5)}`, cls: "pa-muted pa-ctx-taskrow-sub" });
  }

  private renderFinanceSummary(root: HTMLElement): void {
    const cur = this.ctx.config.currency || "$";
    const month = todayLocal().slice(0, 7);
    const txs = this.ctx.store.loadTransactions().filter((t) => t.date.slice(0, 7) === month);
    const income = txs.filter((t) => t.type === "income").reduce((a, t) => a + t.amount, 0);
    const expense = txs.filter((t) => t.type === "expense").reduce((a, t) => a + t.amount, 0);

    this.summaryHeader(root, "💰 Finances", month);
    this.statChips(root, [
      { label: "Income", value: `${cur}${income.toFixed(0)}`, color: "#16a34a" },
      { label: "Expense", value: `${cur}${expense.toFixed(0)}`, color: "#ef4444" },
      { label: "Balance", value: `${cur}${(income - expense).toFixed(0)}`, color: income - expense >= 0 ? "#16a34a" : "#ef4444" },
    ]);

    // Quick add: one-click from your recurring templates, plus a manual expense/income.
    const recurring = this.ctx.store.loadRecurring();
    const quick = this.section(root, "Quick add");
    const qwrap = quick.createDiv({ cls: "pa-ctx-quick" });
    for (const r of recurring) {
      const b = qwrap.createEl("button", { cls: "pa-ctx-quickbtn", text: `${r.type === "income" ? "➕" : "➖"} ${r.category} ${cur}${r.amount.toFixed(0)}` });
      b.onclick = () => void (async () => {
        await this.ctx.store.addTransaction({ type: r.type, amount: r.amount, category: r.category, note: r.note });
        toast(`Added ${r.category}`);
        this.render();
      })();
    }
    const be = qwrap.createEl("button", { cls: "pa-ctx-quickbtn", text: "➖ Expense" });
    be.onclick = () => this.quickTransaction("expense");
    const bi = qwrap.createEl("button", { cls: "pa-ctx-quickbtn", text: "➕ Income" });
    bi.onclick = () => this.quickTransaction("income");

    // Expenses by category — donut, so the biggest drains pop out.
    const byCat = new Map<string, number>();
    for (const t of txs.filter((x) => x.type === "expense")) byCat.set(t.category, (byCat.get(t.category) || 0) + t.amount);
    if (byCat.size) {
      const sec = this.section(root, "Expenses by category");
      const segments = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: CHART_COLORS[i % CHART_COLORS.length] }));
      drawDonut(sec, segments, 150, (n) => `${cur}${n.toFixed(0)}`);
    }

    const recent = txs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    const sec = this.section(root, `Recent (${txs.length})`);
    if (!recent.length) { sec.createDiv({ cls: "pa-muted", text: "No transactions this month." }); return; }
    const list = sec.createEl("ul", { cls: "pa-ctx-items" });
    for (const t of recent) {
      const sign = t.type === "income" ? "+" : "-";
      list.createEl("li", { text: `${t.date.slice(5)}  ${sign}${cur}${t.amount.toFixed(0)} · ${t.category}` });
    }
  }

  private renderNutritionSummary(root: HTMLElement): void {
    const today = todayLocal();
    const logs = this.ctx.store.loadMealLogs().filter((l) => l.date === today);
    const cal = logs.reduce((a, l) => a + l.totalCal, 0);
    const protein = logs.reduce((a, l) => a + l.totalProtein, 0);
    const carbs = logs.reduce((a, l) => a + l.totalCarbs, 0);
    const calTarget = this.ctx.config.calorieTarget || 2000;
    const proTarget = this.ctx.config.proteinTarget || 120;
    const carbTarget = this.ctx.config.carbsTarget || 200;
    const water = this.ctx.store.loadWaterLog()[today] ?? 0;

    this.summaryHeader(root, "🥗 Nutrition", "Today");
    const rings = root.createDiv({ cls: "pa-ht-rings" });
    drawRing(rings, Math.round((cal / (calTarget || 1)) * 100), "#16a34a", "Calories", 52);
    drawRing(rings, Math.round((protein / (proTarget || 1)) * 100), "#3b82f6", "Protein", 52);
    drawRing(rings, Math.round((carbs / (carbTarget || 1)) * 100), "#f59e0b", "Carbs", 52);

    // Quick-log a defined meal plan with one click.
    const meals = this.ctx.store.loadMeals();
    if (meals.length) {
      const sec = this.section(root, "Quick log a meal");
      const wrap = sec.createDiv({ cls: "pa-ctx-quick" });
      for (const m of meals) {
        const b = wrap.createEl("button", { cls: "pa-ctx-quickbtn", text: `＋ ${m.emoji || "🍽️"} ${m.name}` });
        b.onclick = () => void (async () => {
          await this.ctx.store.logMeal(m, m.items);
          toast(`Logged ${m.name}`);
          this.render();
        })();
      }
    }
    // Quick water: +250ml / +500ml.
    const waterBar = this.section(root, "Quick water");
    const wwrap = waterBar.createDiv({ cls: "pa-ctx-quick" });
    for (const l of [0.25, 0.5]) {
      const b = wwrap.createEl("button", { cls: "pa-ctx-quickbtn", text: `💧 +${l * 1000}ml` });
      b.onclick = () => void (async () => { await this.ctx.store.addWater(todayLocal(), l); this.render(); })();
    }

    const info = this.section(root, "Totals");
    this.field(info, "Calories", `${Math.round(cal)} / ${calTarget}`);
    this.field(info, "Protein", `${Math.round(protein)} / ${proTarget} g`);
    this.field(info, "Carbs", `${Math.round(carbs)} / ${carbTarget} g`);
    this.field(info, "Water", `${water.toFixed(1)} L`);

    const sec = this.section(root, `Meals today (${logs.length})`);
    if (!logs.length) { sec.createDiv({ cls: "pa-muted", text: "Nothing logged today." }); return; }
    const list = sec.createEl("ul", { cls: "pa-ctx-items" });
    for (const l of logs) list.createEl("li", { text: `${Math.round(l.totalCal)} kcal · ${Math.round(l.totalProtein)}g protein` });
  }

  private renderFitnessSummary(root: HTMLElement): void {
    const workouts = this.ctx.store.loadWorkouts().slice().sort((a, b) => b.date.localeCompare(a.date));
    const month = todayLocal().slice(0, 7);
    const thisMonth = workouts.filter((w) => w.date.slice(0, 7) === month);
    const totalMin = thisMonth.reduce((a, w) => a + w.duration, 0);

    this.summaryHeader(root, "🏋️ Fitness", `${workouts.length} workouts`);
    this.statChips(root, [
      { label: "This month", value: String(thisMonth.length), color: "#7c3aed" },
      { label: "Minutes", value: String(totalMin), color: "#3b82f6" },
    ]);

    // Quick-log a workout from a defined split (asks only for the duration).
    const splits = this.ctx.store.loadSplits();
    const exercises = this.ctx.store.loadExercises();
    if (splits.length) {
      const sec = this.section(root, "Quick log a workout");
      const wrap = sec.createDiv({ cls: "pa-ctx-quick" });
      for (const s of splits) {
        const name = this.ctx.config.splitNames[s.id] || s.name;
        const b = wrap.createEl("button", { cls: "pa-ctx-quickbtn", text: `＋ ${s.id} · ${name}` });
        b.onclick = () => this.quickLogWorkout(s.id, exercises);
      }
    }

    // Duration of the last sessions as bars.
    const recent = workouts.slice(0, 8).reverse();
    if (recent.length) {
      const sec = this.section(root, "Recent durations (min)");
      const data = recent.map((w) => ({ label: w.date.slice(5), value: w.duration }));
      drawBars(sec, data, Math.max(...data.map((d) => d.value), 1), "#7c3aed");
    }

    const sec = this.section(root, "Recent workouts");
    if (!workouts.length) { sec.createDiv({ cls: "pa-muted", text: "No workouts yet." }); return; }
    const list = sec.createEl("ul", { cls: "pa-ctx-items" });
    for (const w of workouts.slice(0, 8)) {
      const name = this.ctx.config.splitNames[w.split] || w.split;
      list.createEl("li", { text: `${w.date} · ${name} · ${w.duration}min` });
    }
  }

  private renderStudiesSummary(root: HTMLElement): void {
    const cols = this.ctx.config.studyColumns;
    const names = this.ctx.config.studyColumnNames;
    const colSet = new Set(cols);
    const eff = (c: StudyCard) => (colSet.has(c.status) ? c.status : cols[0]);
    const doneCol = cols.includes("done") ? "done" : cols[cols.length - 1];
    const firstCol = cols[0];
    const topics = this.ctx.store.loadStudyBoards();
    const allCards = this.ctx.store.loadStudyCards();
    const cards = allCards.filter((c) => this.studyTopic === "all" || c.topic === this.studyTopic);
    const total = cards.length || 1;

    this.ensureColDefaults("study", cols, doneCol);
    this.summaryHeader(root, "📚 Studies", `${cards.length} card${cards.length === 1 ? "" : "s"}`);

    // Topic selector.
    const bar = root.createDiv({ cls: "pa-ctx-board" });
    const sel = bar.createEl("select", { cls: "pa-ctx-board-select dropdown" });
    sel.createEl("option", { text: "📚 All topics", value: "all" });
    topics.forEach((b) => sel.createEl("option", { text: `${b.emoji || ""} ${b.name}`.trim(), value: b.name }));
    sel.value = this.studyTopic;
    sel.onchange = () => { this.studyTopic = sel.value; this.render(); };

    const rings = root.createDiv({ cls: "pa-ht-rings" });
    const ringColors = ["#d97706", "#7c3aed", "#16a34a"];
    cols.slice(0, 3).forEach((col, i) => {
      const cnt = cards.filter((c) => eff(c) === col).length;
      const label = (names[col] || col).replace(/^[^\p{L}\p{N}]+/u, "").trim();
      drawRing(rings, Math.round((cnt / total) * 100), ringColors[i] || "#7c3aed", label, 52);
    });

    // Cards by topic — donut (only meaningful across all topics).
    if (this.studyTopic === "all") {
      const byTopic = new Map<string, number>();
      for (const c of cards) { const k = c.topic || "—"; byTopic.set(k, (byTopic.get(k) || 0) + 1); }
      if (byTopic.size) {
        const sec = this.section(root, "By topic");
        const segments = [...byTopic.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label, value, color: CHART_COLORS[i % CHART_COLORS.length] }));
        drawDonut(sec, segments, 150);
      }
    }

    // Collapsible columns with complete/reopen toggles, reorder + quick add.
    const ord = (c: StudyCard) => (c.order ?? 1e9);
    cols.forEach((col, idx) => {
      const colCards = cards.filter((c) => eff(c) === col).sort((a, b) => ord(a) - ord(b) || a.title.localeCompare(b.title));
      this.renderColumn(root, {
        title: names[col] || col,
        count: colCards.length,
        open: this.openCols.has(`study:${col}`),
        onToggle: (o) => { if (o) this.openCols.add(`study:${col}`); else this.openCols.delete(`study:${col}`); },
        renderBody: (body) => {
          if (!colCards.length) body.createDiv({ cls: "pa-muted", text: "Empty." });
          for (const c of colCards) this.renderStudyRow(body, c, col === doneCol, doneCol, firstCol);
        },
        onAdd: () => this.studyQuickAdd(col),
        onMoveUp: idx > 0 ? () => void this.moveColumn("study", col, -1) : undefined,
        onMoveDown: idx < cols.length - 1 ? () => void this.moveColumn("study", col, 1) : undefined,
      });
    });
  }

  /** A study-card row with a toggle circle (complete/reopen) and a clickable title. */
  private renderStudyRow(parent: HTMLElement, c: StudyCard, isDone: boolean, doneCol: string, firstCol: string): void {
    const row = parent.createDiv({ cls: "pa-ctx-taskrow" + (isDone ? " done" : "") });
    const circle = row.createSpan({ cls: "pa-list-circle" + (isDone ? " on" : ""), text: isDone ? "●" : "○" });
    circle.setAttr("aria-label", isDone ? "Reopen card" : "Mark done");
    circle.onclick = () => void (async () => {
      await this.ctx.store.updateStudyCardStatus(c, isDone ? firstCol : doneCol);
      this.render();
    })();
    const main = row.createDiv({ cls: "pa-ctx-taskrow-main" });
    const title = main.createDiv({ text: c.title, cls: "pa-ctx-item-title" });
    title.onclick = () => {
      const f = this.app.vault.getAbstractFileByPath(c.path);
      if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
    };
    if (c.topic) main.createDiv({ text: c.topic, cls: "pa-muted pa-ctx-taskrow-sub" });
  }

  private renderHabitSummary(root: HTMLElement): void {
    const habits = this.ctx.store.loadHabits();
    const today = todayLocal();
    const done = habits.filter((h) => !!(h.log && h.log[today])).length;
    const total = habits.length || 1;

    this.summaryHeader(root, "🎯 Habit Tracker", "Today");
    const rings = root.createDiv({ cls: "pa-ht-rings" });
    drawRing(rings, Math.round((done / total) * 100), "#7c3aed", "Done today", 52);

    // Completions over the last 7 days as bars.
    const days = this.lastNDates(7);
    const data = days.map((d) => ({ label: d.slice(5), value: habits.filter((h) => h.log && h.log[d]).length }));
    if (habits.length) {
      const chart = this.section(root, "Last 7 days");
      drawBars(chart, data, Math.max(habits.length, 1), "#7c3aed");
    }

    const sec = this.section(root, `Habits (${habits.length})`);
    if (!habits.length) { sec.createDiv({ cls: "pa-muted", text: "No habits yet." }); return; }
    const list = sec.createEl("ul", { cls: "pa-ctx-items" });
    for (const h of habits) {
      const mark = h.log && h.log[today] ? "●" : "○";
      list.createEl("li", { text: `${mark} ${h.emoji || ""} ${h.name}`.trim() });
    }
  }

  // --- Context renderers -----------------------------------------------------

  private renderContext(root: HTMLElement, file: TFile, type: string): void {
    switch (type) {
      case "task": this.renderTaskContext(root, file); break;
      case "transaction": this.renderTransactionContext(root, file); break;
      case "meal-log": this.renderMealLogContext(root, file); break;
      case "workout-log": this.renderWorkoutContext(root, file); break;
      case "note": this.renderNoteContext(root, file); break;
      case "study": this.renderStudyContext(root, file); break;
      case "meal-plan": this.renderMealPlanContext(root, file); break;
      case "habit": this.renderHabitContext(root, file); break;
      default: this.renderTasksSummary(root);
    }
  }

  /** A titled section container. */
  private section(root: HTMLElement, title: string): HTMLElement {
    const sec = root.createDiv({ cls: "pa-ctx-section" });
    sec.createEl("h4", { text: title });
    return sec;
  }

  /** Header: emoji + title, a type subtitle, and an "open note" link. */
  private header(root: HTMLElement, emoji: string, title: string, subtitle: string, file: TFile): void {
    const head = root.createDiv({ cls: "pa-ctx-header" });
    head.createDiv({ text: `${emoji} ${title}`.trim(), cls: "pa-ctx-name" });
    if (subtitle) head.createDiv({ text: subtitle, cls: "pa-muted" });
    const open = head.createEl("a", { text: "Open note →", cls: "pa-ctx-link" });
    open.onclick = (e) => { e.preventDefault(); void this.app.workspace.getLeaf(false).openFile(file); };
  }

  /** A label/value row inside a section. */
  private field(sec: HTMLElement, label: string, value: string): void {
    if (!value) return;
    const row = sec.createDiv({ cls: "pa-ctx-field" });
    row.createSpan({ text: label, cls: "pa-ctx-field-label pa-muted" });
    row.createSpan({ text: value, cls: "pa-ctx-field-value" });
  }

  // --- Task ------------------------------------------------------------------

  private renderTaskContext(root: HTMLElement, file: TFile): void {
    const task = this.ctx.store.loadTasks().find((t) => t.path === file.path);
    if (!task) { root.createDiv({ cls: "pa-muted", text: "This task isn't loaded yet." }); return; }

    const cols = this.ctx.config.taskColumns;
    const names = this.ctx.config.taskColumnNames;
    const doneCol = cols.includes("done") ? "done" : cols[cols.length - 1];
    const firstCol = cols[0];
    const status = cols.includes(task.status) ? task.status : firstCol;
    const isDone = status === doneCol;

    this.header(root, "✅", task.title, "Task", file);

    const chips = root.createDiv({ cls: "pa-card-chips pa-ctx-chips" });
    const prio = task.priority || "medium";
    chips.createSpan({ cls: `pa-chip pa-chip-prio prio-${prio}`, text: prio.charAt(0).toUpperCase() + prio.slice(1) });
    if (task.due) {
      const chip = chips.createSpan({ cls: "pa-chip pa-chip-date" });
      chip.createSpan({ cls: "pa-chip-ico", text: "📅" });
      chip.createSpan({ text: task.due });
    }

    const info = this.section(root, "Details");
    this.field(info, "Board", task.kanbanName || "No board");
    this.field(info, "Column", names[status] || status);
    if (task.group) this.field(info, "Group", task.group);

    const actions = root.createDiv({ cls: "pa-ctx-actions" });
    const toggle = actions.createEl("button", { cls: "pa-mini-btn", text: isDone ? "↩ reopen" : "✓ mark done" });
    toggle.onclick = () => void (async () => {
      await this.ctx.store.updateTask(task, { status: isDone ? firstCol : doneCol });
      this.render();
    })();
  }

  // --- Transaction -----------------------------------------------------------

  private renderTransactionContext(root: HTMLElement, file: TFile): void {
    const tx = this.ctx.store.loadTransactions().find((t) => t.path === file.path);
    if (!tx) { root.createDiv({ cls: "pa-muted", text: "This transaction isn't loaded yet." }); return; }

    const cur = this.ctx.config.currency || "$";
    const income = tx.type === "income";
    this.header(root, income ? "💰" : "🧾", `${cur} ${tx.amount.toFixed(2)}`, income ? "Income" : "Expense", file);

    const info = this.section(root, "Details");
    this.field(info, "Category", tx.category);
    this.field(info, "Date", tx.date);
    if (tx.note) this.field(info, "Note", tx.note);
  }

  // --- Meal log --------------------------------------------------------------

  private renderMealLogContext(root: HTMLElement, file: TFile): void {
    const log = this.ctx.store.loadMealLogs().find((m) => m.path === file.path);
    if (!log) { root.createDiv({ cls: "pa-muted", text: "This meal isn't loaded yet." }); return; }

    this.header(root, "🥗", `${Math.round(log.totalCal)} kcal`, "Meal log", file);

    const info = this.section(root, "Details");
    this.field(info, "Date", log.date);
    this.field(info, "Protein", `${Math.round(log.totalProtein)} g`);
    this.field(info, "Carbs", `${Math.round(log.totalCarbs)} g`);

    if (log.items.length) {
      const sec = this.section(root, `Items (${log.items.length})`);
      const list = sec.createEl("ul", { cls: "pa-ctx-items" });
      for (const it of log.items) list.createEl("li", { text: `${it.name} — ${Math.round(it.cal)} kcal` });
    }
  }

  // --- Workout ---------------------------------------------------------------

  private renderWorkoutContext(root: HTMLElement, file: TFile): void {
    const w = this.ctx.store.loadWorkouts().find((x) => x.path === file.path);
    if (!w) { root.createDiv({ cls: "pa-muted", text: "This workout isn't loaded yet." }); return; }

    const splitName = this.ctx.config.splitNames[w.split] || w.split;
    this.header(root, "🏋️", splitName || "Workout", "Workout", file);

    const info = this.section(root, "Details");
    this.field(info, "Date", w.date);
    this.field(info, "Duration", `${w.duration} min`);

    if (w.exercises.length) {
      const sec = this.section(root, `Exercises (${w.exercises.length})`);
      const list = sec.createEl("ul", { cls: "pa-ctx-items" });
      for (const ex of w.exercises) {
        const parts = [ex.exercise, ex.sets, ex.weight ? `${ex.weight} kg` : ""].filter(Boolean);
        list.createEl("li", { text: parts.join(" · ") });
      }
    }
  }

  // --- Note ------------------------------------------------------------------

  private renderNoteContext(root: HTMLElement, file: TFile): void {
    const note = this.ctx.store.loadNotes().find((n) => n.path === file.path);
    if (!note) { root.createDiv({ cls: "pa-muted", text: "This note isn't loaded yet." }); return; }

    this.header(root, "📝", note.title, "Note", file);
    const info = this.section(root, "Details");
    if (note.board) this.field(info, "Board", note.board);
    if (note.date) this.field(info, "Date", note.date);

    // Body preview (loaded async so we don't block the render).
    const sec = this.section(root, "Preview");
    const p = sec.createDiv({ cls: "pa-muted", text: "…" });
    void this.ctx.store.readNoteBody(note.path).then((body) => {
      p.setText(body ? body.slice(0, 400) : "Empty note.");
    });
  }

  // --- Study card ------------------------------------------------------------

  private renderStudyContext(root: HTMLElement, file: TFile): void {
    const card = this.ctx.store.loadStudyCards().find((c) => c.path === file.path);
    if (!card) { root.createDiv({ cls: "pa-muted", text: "This study card isn't loaded yet." }); return; }

    this.header(root, "📚", card.title, "Study", file);
    const info = this.section(root, "Details");
    this.field(info, "Topic", card.topic);
    if (card.subtopic) this.field(info, "Subtopic", card.subtopic);
    this.field(info, "Status", this.ctx.config.studyColumnNames[card.status] || card.status);
    if (card.url) {
      const sec = this.section(root, "Link");
      const a = sec.createEl("a", { text: card.url, cls: "pa-ctx-link", href: card.url });
      a.onclick = (e) => { e.preventDefault(); window.open(card.url, "_blank", "noopener,noreferrer"); };
    }
  }

  // --- Meal plan -------------------------------------------------------------

  private renderMealPlanContext(root: HTMLElement, file: TFile): void {
    const meal = this.ctx.store.loadMeals().find((m) => m.path === file.path);
    if (!meal) { root.createDiv({ cls: "pa-muted", text: "This meal plan isn't loaded yet." }); return; }

    this.header(root, meal.emoji || "🍽️", meal.name, "Meal plan", file);
    this.field(this.section(root, "Details"), "Total", `${Math.round(meal.totalCal)} kcal`);

    if (meal.items.length) {
      const sec = this.section(root, `Items (${meal.items.length})`);
      const list = sec.createEl("ul", { cls: "pa-ctx-items" });
      for (const it of meal.items) list.createEl("li", { text: `${it.name} — ${Math.round(it.cal)} kcal` });
    }
  }

  // --- Habit -----------------------------------------------------------------

  private renderHabitContext(root: HTMLElement, file: TFile): void {
    const habit = this.ctx.store.loadHabits().find((h) => h.path === file.path);
    if (!habit) { root.createDiv({ cls: "pa-muted", text: "This habit isn't loaded yet." }); return; }

    this.header(root, habit.emoji || "🎯", habit.name, habit.habitType === "quit" ? "Habit (quit)" : "Habit", file);
    const done = Object.values(habit.log || {}).filter(Boolean).length;
    this.field(this.section(root, "Details"), "Days completed", String(done));
  }
}
