import { PAContext } from "../context";
import { Board, Habit, StudyCard, Task, Workout, MealLog, Transaction } from "../types";
import { FieldSpec, FormModal, toast, appendSidebarBtn } from "../ui";
import { todayLocal, ymd } from "../util";
import { drawBars, drawDonut } from "../charts";
import { habitDoneOn, habitStreak } from "../habitutil";

const DONUT_PALETTE = ["#7c3aed", "#16a34a", "#f59e0b", "#3b82f6", "#ef4444", "#10b981"];

/** Days back to show on the small "evolution" bar charts. */
const BARS_DAYS = 7;
/** Months back to show on the finance bar chart. */
const BARS_MONTHS = 6;
/** How many open tasks the "Open tasks" card shows before "load more" — same pattern
 *  (and page size) as the Kanban columns on the Tasks page. */
const TASKS_PAGE_SIZE = 14;

/**
 * Cockpit Life — the landing page: three columns for a quick-capture-and-glance
 * workflow instead of a stack of full-width panels.
 *  - Left: fast task capture (inline "+ add", no modal) for today/overdue, then habits.
 *  - Middle: task evolution charts + short bar-chart trends per module, each with its
 *    own one-tap quick action.
 *  - Right: every task, grouped by board (with a board filter that also scopes the
 *    evolution charts in the middle column), growing to fill the page — no internal
 *    scroll/cap, the page itself scrolls.
 * Every action here calls the same store methods the owning module's own page uses
 * (completeTaskAtTop, createTask, addWater, addTransaction, toggleHabit, …) — this page
 * never writes its own data format, so nothing can drift between the two views.
 */
export class CockpitModule {
  private ctx: PAContext;
  /** Board filter shared by the "All tasks" list and the "Tasks evolution" chart —
   *  picking a board in the list's dropdown also re-scopes the chart on the right. */
  private selectedBoard = "all";
  /** How many open tasks are currently shown in the "Open tasks" card; grows by
   *  TASKS_PAGE_SIZE per "load more" click, resets whenever the module is recreated
   *  (e.g. navigating away and back). */
  private taskListLimit = TASKS_PAGE_SIZE;

  constructor(ctx: PAContext) { this.ctx = ctx; }

  render(root: HTMLElement): void {
    root.empty();
    const today = todayLocal();
    const cfg = this.ctx.config;

    const tasks = this.ctx.store.loadTasks();
    const habits = this.ctx.store.loadHabits();
    const workouts = this.ctx.store.loadWorkouts();
    const mealLogs = this.ctx.store.loadMealLogs();
    const txs = this.ctx.store.loadTransactions();
    const waterLog = this.ctx.store.loadWaterLog();
    const boards = this.ctx.store.loadBoards();
    const studyBoards = this.ctx.store.loadStudyBoards();
    const studyCards = this.ctx.store.loadStudyCards();

    this.renderHeader(root, tasks, cfg, today);
    this.renderDonuts(root, { workouts, studyCards, tasks, habits, today });

    const cols = root.createDiv({ cls: "pa-cockpit-cols" });
    this.renderCaptureColumn(cols.createDiv({ cls: "pa-cockpit-col" }), tasks, habits, studyBoards, studyCards, cfg, today);
    this.renderTrendsColumn(cols.createDiv({ cls: "pa-cockpit-col" }), tasks, workouts, mealLogs, waterLog, txs, cfg, today);
    this.renderAllTasksCard(cols.createDiv({ cls: "pa-cockpit-col" }), tasks, cfg, boards);
  }

  // ---- Shared task-column helpers (same "effective status" pattern used across the
  // plugin — a task's raw status may not match the currently configured columns). ----
  private taskCols(cfg: PAContext["config"]) {
    const cols = cfg.taskColumns;
    const colSet = new Set(cols);
    const doneCol = cols.includes("done") ? "done" : cols[cols.length - 1];
    const eff = (t: Task) => (colSet.has(t.status) ? t.status : cols[0]);
    return { cols, doneCol, firstCol: cols[0], eff };
  }

  // ---- Header: title + greeting (moved here from Habit Tracker) + open task count ----
  private renderHeader(root: HTMLElement, tasks: Task[], cfg: PAContext["config"], today: string): void {
    const { doneCol, eff } = this.taskCols(cfg);
    const open = tasks.filter((t) => eff(t) !== doneCol).length;
    const head = root.createDiv({ cls: "pa-cockpit-topbar" });
    const left = head.createDiv();
    left.createDiv({ text: "🎯 Cockpit life", cls: "pa-h1" });
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const dateStr = new Date(today + "T00:00:00").toLocaleDateString("default", { weekday: "long", day: "numeric", month: "short" });
    left.createDiv({ text: `${greeting}, Jaime · ${dateStr} · ${open} open task${open === 1 ? "" : "s"}`, cls: "pa-muted" });
    appendSidebarBtn(left, this.ctx.openSidePanel);
  }

  // ---- 4 donut charts (workouts/studies/tasks by status moved here from Habit Tracker,
  // plus habits today so all 4 tracked modules get the same at-a-glance status view) ----
  private renderDonuts(root: HTMLElement, d: { workouts: Workout[]; studyCards: StudyCard[]; tasks: Task[]; habits: Habit[]; today: string }): void {
    const row = root.createDiv({ cls: "pa-donuts-row" });

    // Workouts by type (month)
    const ym = d.today.substring(0, 7);
    const bySplit = new Map<string, number>();
    d.workouts.forEach((w) => { if (w.date.substring(0, 7) === ym) bySplit.set(w.split, (bySplit.get(w.split) || 0) + 1); });
    this.donutPanel(row, "🏋️ Workouts by type (month)",
      Array.from(bySplit.entries()).map(([k, v], i) => ({ label: "Workout " + k, value: v, color: DONUT_PALETTE[i % DONUT_PALETTE.length] })));

    // Studies by status
    const byStatus = new Map<string, number>();
    d.studyCards.forEach((c) => { const s = c.status || "backlog"; byStatus.set(s, (byStatus.get(s) || 0) + 1); });
    this.donutPanel(row, "📚 Studies by status",
      Array.from(byStatus.entries()).map(([k, v], i) => ({ label: k, value: v, color: DONUT_PALETTE[i % DONUT_PALETTE.length] })));

    // Tasks by status
    const byTask = new Map<string, number>();
    d.tasks.forEach((t) => { const s = t.status || "backlog"; byTask.set(s, (byTask.get(s) || 0) + 1); });
    this.donutPanel(row, "✅ Tasks by status",
      Array.from(byTask.entries()).map(([k, v], i) => ({ label: k, value: v, color: DONUT_PALETTE[i % DONUT_PALETTE.length] })));

    // Habits today — done vs. pending, using the same habitDoneOn() truth used by the
    // Habit Tracker so a "done" habit here always matches a filled dot there.
    if (d.habits.length) {
      const done = d.habits.filter((h) => habitDoneOn(h, d.today, d.today)).length;
      const pending = d.habits.length - done;
      this.donutPanel(row, "🎯 Habits today",
        [{ label: "Done", value: done, color: "#16a34a" }, { label: "Pending", value: pending, color: "#e5e7eb" }]);
    }
  }

  private donutPanel(row: HTMLElement, title: string, segments: Array<{ label: string; value: number; color: string }>): void {
    const panel = row.createDiv({ cls: "pa-panel pa-donut-panel" });
    panel.createEl("h3", { text: title, cls: "pa-panel-title" });
    drawDonut(panel, segments);
  }

  /** An inline "+ add" row (text input + button), committed on Enter or click — no
   *  modal, so capturing several tasks in a row never leaves this page. */
  private renderInlineAdd(container: HTMLElement, placeholder: string, onSubmit: (title: string) => void): void {
    const row = container.createDiv({ cls: "pa-cockpit-inline-add" });
    const input = row.createEl("input", { cls: "pa-cockpit-inline-input" });
    input.type = "text";
    input.placeholder = placeholder;
    const commit = () => {
      const v = input.value.trim();
      if (!v) return;
      onSubmit(v);
      input.value = "";
      input.focus();
    };
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } };
    const btn = row.createEl("button", { cls: "pa-icon-btn pa-cockpit-inline-btn", text: "+" });
    btn.setAttr("aria-label", "Add");
    btn.onclick = commit;
  }

  private renderTaskCheckRow(list: HTMLElement, t: Task, isDone: boolean, doneCol: string, firstCol: string, showBoard: boolean): void {
    const row = list.createDiv({ cls: "pa-ctx-taskrow" + (isDone ? " done" : "") });
    const circle = row.createSpan({ cls: "pa-list-circle" + (isDone ? " on" : ""), text: isDone ? "●" : "○" });
    circle.setAttr("aria-label", isDone ? "Reopen task" : "Mark done");
    circle.onclick = () => void (async () => {
      if (isDone) await this.ctx.store.updateTask(t, { status: firstCol });
      else await this.ctx.store.completeTaskAtTop(t, doneCol);
      this.ctx.refresh();
    })();
    const main = row.createDiv({ cls: "pa-ctx-taskrow-main" });
    const title = main.createDiv({ text: t.title, cls: "pa-ctx-item-title" });
    title.onclick = () => {
      const f = this.ctx.app.vault.getAbstractFileByPath(t.path);
      if (f && "extension" in f) void this.ctx.app.workspace.getLeaf(false).openFile(f as never);
    };
    if (t.due || (showBoard && t.kanbanName)) {
      const today = todayLocal();
      const overdue = !!t.due && t.due < today && !isDone;
      const sub = main.createDiv({ cls: "pa-muted pa-ctx-taskrow-sub" });
      const parts: string[] = [];
      if (t.due) parts.push(overdue ? `⚠️ ${t.due.slice(5)}` : `📅 ${t.due.slice(5)}`);
      if (showBoard && t.kanbanName) parts.push(t.kanbanName);
      sub.setText(parts.join(" · "));
      if (overdue) row.addClass("pa-cockpit-overdue");
    }
  }

  // ---- LEFT: quick capture — today/overdue, habits, then study progress ----
  private renderCaptureColumn(
    root: HTMLElement, tasks: Task[], habits: Habit[], studyBoards: Board[], studyCards: StudyCard[],
    cfg: PAContext["config"], today: string
  ): void {
    const { doneCol, firstCol, eff } = this.taskCols(cfg);
    const open = tasks.filter((t) => eff(t) !== doneCol);
    const due = open.filter((t) => t.due && t.due <= today).sort((a, b) => (a.due || "").localeCompare(b.due || ""));

    const card1 = root.createDiv({ cls: "pa-panel pa-cockpit-card" });
    card1.createEl("h3", { text: `📌 Today & overdue — ${due.length}`, cls: "pa-panel-title" });
    const list1 = card1.createDiv({ cls: "pa-cockpit-tasklist" });
    if (!due.length) list1.createDiv({ cls: "pa-muted", text: "Nothing due. 🎉" });
    else due.forEach((t) => this.renderTaskCheckRow(list1, t, false, doneCol, firstCol, true));
    this.renderInlineAdd(card1, "+ add a task for today…", (title) => {
      void (async () => {
        const path = await this.ctx.store.createTask({ title, status: firstCol, due: today });
        await this.ctx.store.awaitFrontmatter(path);
        this.ctx.refresh();
      })();
    });

    const card2 = root.createDiv({ cls: "pa-panel pa-cockpit-card" });
    card2.createEl("h3", { text: "🎯 Habits today", cls: "pa-panel-title" });
    if (!habits.length) card2.createEl("p", { cls: "pa-muted", text: "No habits yet." });
    else {
      const list2 = card2.createDiv({ cls: "pa-cockpit-habitlist" });
      habits.forEach((h) => {
        const isQuit = h.habitType === "quit";
        const done = habitDoneOn(h, today, today);
        const row = list2.createDiv({ cls: "pa-ctx-taskrow" });
        const circle = row.createSpan({ cls: "pa-list-circle" + (done ? " on" : ""), text: done ? "●" : "○" });
        circle.onclick = () => void (async () => {
          if (isQuit) await this.ctx.store.toggleHabitRelapse(h, today);
          else await this.ctx.store.toggleHabit(h, today);
          this.ctx.refresh();
        })();
        const main = row.createDiv({ cls: "pa-ctx-taskrow-main" });
        main.createDiv({ text: `${h.emoji || ""} ${h.name}`.trim(), cls: "pa-ctx-item-title" });
        const streak = habitStreak(h, today);
        if (streak > 0) main.createDiv({ cls: "pa-muted pa-ctx-taskrow-sub", text: isQuit ? `🚭 ${streak}d clean` : `🔥 ${streak} day streak` });
      });

      // Weekly consistency — % of habits done per day over the last 7 days, same
      // horizontal-bar language as the other progress rows on this page.
      const rows = card2.createDiv({ cls: "pa-cockpit-hbars pa-cockpit-habit-week" });
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() - i);
        const ds = ymd(d);
        const done = habits.filter((h) => habitDoneOn(h, ds, today)).length;
        const pct = habits.length ? Math.round((done / habits.length) * 100) : 0;
        const row = rows.createDiv({ cls: "pa-cockpit-hbar-row" });
        const labelRow = row.createDiv({ cls: "pa-progress-label" });
        labelRow.createSpan({ text: i === 0 ? "Today" : ds.slice(5) });
        labelRow.createSpan({ text: `${done}/${habits.length}`, cls: "pa-muted" });
        const track = row.createDiv({ cls: "pa-progress-track" });
        const fill = track.createDiv({ cls: "pa-progress-fill pa-cockpit-hbar-fill" });
        fill.style.width = `${pct}%`;
      }
    }

    if (studyBoards.length) {
      const card3 = root.createDiv({ cls: "pa-panel pa-cockpit-card" });
      card3.createEl("h3", { text: "📚 Study progress", cls: "pa-panel-title" });
      const rows = card3.createDiv({ cls: "pa-cockpit-hbars" });
      studyBoards.forEach((b) => {
        const topicCards = studyCards.filter((c) => c.topic === b.name);
        const done = topicCards.filter((c) => c.status === "done").length;
        const total = topicCards.length;
        const pct = total ? Math.round((done / total) * 100) : 0;
        const row = rows.createDiv({ cls: "pa-cockpit-hbar-row" });
        const labelRow = row.createDiv({ cls: "pa-progress-label" });
        labelRow.createSpan({ text: `${b.emoji || ""} ${b.name}`.trim() });
        labelRow.createSpan({ text: `${pct}% (${done}/${total})`, cls: "pa-muted" });
        const track = row.createDiv({ cls: "pa-progress-track" });
        const fill = track.createDiv({ cls: "pa-progress-fill pa-cockpit-hbar-fill" });
        fill.style.width = `${pct}%`;
      });
    }
  }

  /** All OPEN tasks (done tasks are hidden here — they already live in their board's own
   *  Kanban), scoped to the board picked in this dropdown (or every board) — the same
   *  selection also drives the task evolution charts in the middle column. Capped at
   *  TASKS_PAGE_SIZE with a "load more" button, same pattern as the Kanban columns on the
   *  Tasks page, so a vault with hundreds of tasks doesn't render them all at once. */
  private renderAllTasksCard(root: HTMLElement, tasks: Task[], cfg: PAContext["config"], boards: Board[]): void {
    const { doneCol, firstCol, eff } = this.taskCols(cfg);
    const scoped = (this.selectedBoard === "all" ? tasks : tasks.filter((t) => t.kanbanName === this.selectedBoard))
      .filter((t) => eff(t) !== doneCol);

    const card = root.createDiv({ cls: "pa-panel pa-cockpit-card pa-cockpit-alltasks-card" });
    const head = card.createDiv({ cls: "pa-section-head" });
    head.createEl("h3", { text: `🗂 Open tasks — ${scoped.length}`, cls: "pa-panel-title" });
    const sel = head.createEl("select", { cls: "pa-cockpit-board-select dropdown" });
    sel.createEl("option", { text: "📋 All boards", value: "all" });
    boards.forEach((b) => sel.createEl("option", { text: `${b.emoji || ""} ${b.name}`.trim(), value: b.name }));
    sel.value = this.selectedBoard;
    sel.onchange = () => { this.selectedBoard = sel.value; this.ctx.refresh(); };

    const list = card.createDiv({ cls: "pa-cockpit-alltasks" });
    if (!scoped.length) { list.createDiv({ cls: "pa-muted", text: "No open tasks here. 🎉" }); return; }

    const byBoard = new Map<string, Task[]>();
    scoped.forEach((t) => {
      const k = t.kanbanName || "No board";
      const arr = byBoard.get(k) || [];
      arr.push(t);
      byBoard.set(k, arr);
    });
    const ord = (t: Task) => (t.order ?? -1);
    // Flatten to a single ordered list (board group headers stay inline as markers)
    // before applying the shared page limit, so "load more" reveals a consistent
    // number of tasks per click regardless of how they're distributed across boards.
    type Row = { board?: string; task?: Task };
    const rows: Row[] = [];
    Array.from(byBoard.keys()).sort().forEach((board) => {
      if (this.selectedBoard === "all") rows.push({ board });
      const boardTasks = (byBoard.get(board) || []).sort((a, b) => ord(a) - ord(b));
      boardTasks.forEach((t) => rows.push({ task: t }));
    });

    const limit = this.taskListLimit;
    let shown = 0;
    for (const row of rows) {
      if (row.board) { list.createDiv({ text: row.board, cls: "pa-cockpit-alltasks-group" }); continue; }
      if (shown >= limit) break;
      this.renderTaskCheckRow(list, row.task!, false, doneCol, firstCol, this.selectedBoard === "all");
      shown++;
    }
    if (scoped.length > limit) {
      const remaining = scoped.length - limit;
      const next = Math.min(TASKS_PAGE_SIZE, remaining);
      const more = list.createEl("button", { cls: "pa-load-more", text: `▾ Load ${next} more (${remaining} left)` });
      more.onclick = () => { this.taskListLimit = limit + TASKS_PAGE_SIZE; this.ctx.refresh(); };
    }
  }

  /** Last N calendar day keys ("YYYY-MM-DD"), oldest first. */
  private lastDays(n: number): string[] {
    const out: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    return out;
  }

  private barCard(root: HTMLElement, title: string): HTMLElement {
    const card = root.createDiv({ cls: "pa-panel pa-cockpit-card pa-cockpit-barcard" });
    card.createEl("h3", { text: title, cls: "pa-panel-title" });
    return card;
  }

  // ---- MIDDLE: short trend bars per module, each with its own quick action ----
  private renderTrendsColumn(
    root: HTMLElement, tasks: Task[], workouts: Workout[], mealLogs: MealLog[], waterLog: Record<string, number>,
    txs: Transaction[], cfg: PAContext["config"], today: string
  ): void {
    this.renderTaskCharts(root, tasks, cfg);
    const days = this.lastDays(BARS_DAYS);
    const dayLabel = (ds: string) => ds.slice(8, 10);

    // Fitness — minutes per day.
    const fitCard = this.barCard(root, "🏋️ Workout minutes (7d)");
    const minsByDay = new Map<string, number>();
    workouts.forEach((w) => minsByDay.set(w.date, (minsByDay.get(w.date) || 0) + w.duration));
    const fitData = days.map((d) => ({ label: dayLabel(d), value: minsByDay.get(d) || 0 }));
    drawBars(fitCard, fitData, Math.max(1, ...fitData.map((d) => d.value)), "#16a34a", 110);

    // Nutrition — calories per day + water quick actions.
    const nutCard = this.barCard(root, "🥗 Calories (7d)");
    const calByDay = new Map<string, number>();
    mealLogs.forEach((m) => calByDay.set(m.date, (calByDay.get(m.date) || 0) + m.totalCal));
    const calData = days.map((d) => ({ label: dayLabel(d), value: Math.round(calByDay.get(d) || 0) }));
    drawBars(nutCard, calData, Math.max(cfg.calorieTarget || 2000, ...calData.map((d) => d.value)), "#f59e0b", 110);
    const waterToday = waterLog[today] || 0;
    const waterTarget = cfg.waterTarget || 2.5;
    nutCard.createDiv({ cls: "pa-muted", text: `💧 ${waterToday.toFixed(1)}/${waterTarget}L today` });
    const waterRow = nutCard.createDiv({ cls: "pa-cockpit-quickrow" });
    [0.25, 0.5].forEach((amt) => {
      const b = waterRow.createEl("button", { text: `+${amt * 1000}ml`, cls: "pa-mini-btn" });
      b.onclick = () => void (async () => { await this.ctx.store.addWater(today, amt); this.ctx.refresh(); })();
    });

    // Finance — net per month + income/expense quick actions.
    const finCard = this.barCard(root, `💰 Balance (${BARS_MONTHS}mo)`);
    const cur = cfg.currency || "$";
    const monthKeys: string[] = [];
    for (let i = BARS_MONTHS - 1; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const finData = monthKeys.map((k) => {
      const monthTx = txs.filter((t) => t.date.startsWith(k));
      const net = monthTx.filter((t) => t.type === "income").reduce((a, t) => a + t.amount, 0)
        - monthTx.filter((t) => t.type === "expense").reduce((a, t) => a + t.amount, 0);
      return { label: k.slice(5), value: Math.round(net) };
    });
    // Keep the minus sign in front of the currency symbol ("-R$6003", not "R$-6003").
    const money = (n: number) => (n < 0 ? `-${cur}${Math.abs(n)}` : `${cur}${n}`);
    drawBars(finCard, finData, Math.max(1, ...finData.map((d) => Math.abs(d.value))), "#3b82f6", 110, money);
    const balanceNow = finData[finData.length - 1]?.value ?? 0;
    finCard.createDiv({ cls: "pa-muted", text: `This month: ${money(balanceNow)}` });
    const finRow = finCard.createDiv({ cls: "pa-cockpit-quickrow" });
    const inc = finRow.createEl("button", { text: "+ income", cls: "pa-mini-btn" });
    inc.onclick = () => this.quickTransaction("income", cfg);
    const exp = finRow.createEl("button", { text: "+ expense", cls: "pa-mini-btn" });
    exp.onclick = () => this.quickTransaction("expense", cfg);
  }

  // ---- Task evolution charts, scoped to the board picked in the right column's
  // dropdown — kept in the middle column alongside the other module trend bars. ----
  private renderTaskCharts(root: HTMLElement, tasks: Task[], cfg: PAContext["config"]): void {
    const { doneCol, eff } = this.taskCols(cfg);
    const scoped = this.selectedBoard === "all" ? tasks : tasks.filter((t) => t.kanbanName === this.selectedBoard);
    const boardLabel = this.selectedBoard === "all" ? "all boards" : this.selectedBoard;

    const doneCard = this.barCard(root, `✅ Tasks completed (7d) — ${boardLabel}`);
    const days = this.lastDays(BARS_DAYS);
    const doneByDay = new Map<string, number>();
    scoped.forEach((t) => {
      if (eff(t) !== doneCol || !t.modified) return;
      const ds = t.modified.slice(0, 10);
      doneByDay.set(ds, (doneByDay.get(ds) || 0) + 1);
    });
    const doneData = days.map((d) => ({ label: d.slice(8, 10), value: doneByDay.get(d) || 0 }));
    drawBars(doneCard, doneData, Math.max(1, ...doneData.map((d) => d.value)), "#7c3aed", 110);

    // Completion % per board (every board, not just the one selected above) — a quick
    // "which board is furthest along" glance, independent of the dropdown filter.
    // Horizontal bars (one row per board) read better here than vertical ones once
    // there are more than a couple of boards — board names stay legible instead of
    // being squeezed under narrow vertical bars.
    const compCard = this.barCard(root, "📊 Completion by board");
    const byBoard = new Map<string, { total: number; done: number }>();
    tasks.forEach((t) => {
      const k = t.kanbanName || "No board";
      const acc = byBoard.get(k) || { total: 0, done: 0 };
      acc.total++;
      if (eff(t) === doneCol) acc.done++;
      byBoard.set(k, acc);
    });
    const rows = compCard.createDiv({ cls: "pa-cockpit-hbars" });
    Array.from(byBoard.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, acc]) => {
      const pct = acc.total ? Math.round((acc.done / acc.total) * 100) : 0;
      const row = rows.createDiv({ cls: "pa-cockpit-hbar-row" });
      const labelRow = row.createDiv({ cls: "pa-progress-label" });
      labelRow.createSpan({ text: name });
      labelRow.createSpan({ text: `${pct}% (${acc.done}/${acc.total})`, cls: "pa-muted" });
      const track = row.createDiv({ cls: "pa-progress-track" });
      const fill = track.createDiv({ cls: "pa-progress-fill pa-cockpit-hbar-fill" });
      fill.style.width = `${pct}%`;
    });
  }

  private quickTransaction(type: "income" | "expense", cfg: PAContext["config"]): void {
    const cats = type === "income" ? cfg.incomeCategories : cfg.expenseCategories;
    const fields: FieldSpec[] = [
      { key: "amount", label: "Amount", type: "number", value: "" },
      { key: "category", label: "Category", type: "dropdown", value: cats[0] || "Other", options: cats.map((c) => ({ value: c, label: c })) },
      { key: "note", label: "Note", type: "text", value: "" },
    ];
    new FormModal(this.ctx.app, type === "income" ? "New income" : "New expense", fields, async (v) => {
      const amount = parseFloat(v.amount) || 0;
      if (!amount) return;
      await this.ctx.store.addTransaction({ type, amount, category: v.category, note: (v.note || "").trim() || undefined });
      toast(`${type === "income" ? "Income" : "Expense"} added`);
      this.ctx.refresh();
    }, "Add").open();
  }

}
