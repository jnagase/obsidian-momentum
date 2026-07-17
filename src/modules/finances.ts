import { PAContext } from "../context";
import { RecurringItem, Transaction } from "../types";
import { ConfirmModal, FieldSpec, FormModal, toast } from "../ui";
import { todayLocal } from "../util";
import { drawRing, drawDonut, drawLineChart } from "../charts";

const CAT_COLORS = ["#7c3aed", "#f59e0b", "#16a34a", "#3b82f6", "#ec4899", "#0ea5e9", "#ef4444", "#10b981", "#a855f7", "#eab308"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Starter templates with typical recurring items — users just edit the amounts. */
const STARTER_MONTHLY: Array<Omit<RecurringItem, "id">> = [
  { type: "income", category: "Salary", amount: 3000, note: "Monthly salary", freq: "monthly", day: 5 },
  { type: "expense", category: "Housing", amount: 1200, note: "Rent / mortgage", freq: "monthly", day: 5 },
  { type: "expense", category: "Bills", amount: 120, note: "Electricity", freq: "monthly", day: 10 },
  { type: "expense", category: "Bills", amount: 60, note: "Water", freq: "monthly", day: 10 },
  { type: "expense", category: "Bills", amount: 80, note: "Internet", freq: "monthly", day: 15 },
  { type: "expense", category: "Bills", amount: 50, note: "Mobile phone", freq: "monthly", day: 15 },
  { type: "expense", category: "Health", amount: 200, note: "Health insurance", freq: "monthly", day: 8 },
  { type: "expense", category: "Health", amount: 60, note: "Gym", freq: "monthly", day: 5 },
  { type: "expense", category: "Leisure", amount: 40, note: "Streaming subscriptions", freq: "monthly", day: 20 },
];
const STARTER_WEEKLY: Array<Omit<RecurringItem, "id">> = [
  { type: "expense", category: "Food", amount: 150, note: "Groceries", freq: "weekly", weekday: 6 },
  { type: "expense", category: "Transport", amount: 40, note: "Commute / fuel", freq: "weekly", weekday: 1 },
  { type: "expense", category: "Leisure", amount: 60, note: "Dining out", freq: "weekly", weekday: 5 },
];

/** Personal finances: income/expense ledger with monthly summaries, category breakdown and trend. */
export class FinancesModule {
  private ctx: PAContext;
  private calMonth: number;
  private calYear: number;
  private addForm = { type: "expense", category: "", amount: "", note: "", date: todayLocal() };
  private expandedWeeks = new Set<number>();

  constructor(ctx: PAContext) {
    this.ctx = ctx;
    const now = new Date();
    this.calMonth = now.getMonth();
    this.calYear = now.getFullYear();
  }

  private cur(): string { return this.ctx.config.currency || "$"; }
  private fmt(n: number): string {
    return `${this.cur()}${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  private monthPrefix(): string { return `${this.calYear}-${String(this.calMonth + 1).padStart(2, "0")}`; }
  private monthLabel(): string { return new Date(this.calYear, this.calMonth, 1).toLocaleString("default", { month: "long" }); }
  private fmtShort(n: number): string {
    const cur = this.cur();
    const abs = Math.abs(n);
    if (abs >= 1000000) return `${cur}${(n / 1000000).toFixed(1)}M`;
    if (abs >= 1000) return `${cur}${(n / 1000).toFixed(1)}k`;
    return `${cur}${Math.round(n)}`;
  }
  private sumByType(txs: Transaction[], type: string): number {
    return txs.filter((t) => t.type === type).reduce((a, t) => a + t.amount, 0);
  }

  render(root: HTMLElement): void {
    root.empty();
    const txs = this.ctx.store.loadTransactions();
    this.renderHeader(root, txs);
    this.renderStats(root, txs);
    const cols = root.createDiv({ cls: "pa-two-col" });
    this.renderBreakdown(cols, txs);
    this.renderTrend(cols, txs);
    this.renderRecurring(root);
    this.renderAddBar(root);
    this.renderLedger(root, txs);
  }

  // ---- Recurring costs: the month composed of weeks; apply a week or the whole month ----
  private renderRecurring(root: HTMLElement): void {
    const items = this.ctx.store.loadRecurring();
    const panel = root.createDiv({ cls: "pa-panel" });
    const head = panel.createDiv({ cls: "pa-section-head" });
    head.createEl("h3", { text: "🔁 Recurring costs — by week; apply a week or the whole month", cls: "pa-panel-title" });
    const apply = head.createEl("button", { text: `📥 Apply to ${this.monthLabel()}`, cls: "pa-btn" });
    apply.setAttr("title", `Creates ${this.monthLabel()}'s transactions from all recurring items (skips any already there).`);
    apply.onclick = () => this.applyRecurring(items);
    const addBtn = head.createEl("button", { text: "+ add", cls: "pa-mini-btn" });
    addBtn.onclick = () => this.openRecurringModal(null, items);

    if (!items.length) {
      panel.createEl("p", { cls: "pa-muted", text: "No recurring costs yet. Load a starter template or add your own." });
      const empty = panel.createDiv({ cls: "pa-active-actions" });
      const sm = empty.createEl("button", { text: "📋 Load monthly starter", cls: "pa-mini-btn" });
      sm.onclick = () => this.loadStarter(items, STARTER_MONTHLY, "monthly");
      const sw = empty.createEl("button", { text: "📋 Load weekly starter", cls: "pa-mini-btn" });
      sw.onclick = () => this.loadStarter(items, STARTER_WEEKLY, "weekly");
      return;
    }

    const inc = items.filter((i) => i.type === "income").reduce((a, i) => a + this.monthlyEquivalent(i), 0);
    const exp = items.filter((i) => i.type === "expense").reduce((a, i) => a + this.monthlyEquivalent(i), 0);
    panel.createDiv({ cls: "pa-muted", text: `This month: +${this.fmt(inc)} · -${this.fmt(exp)} · net ${this.fmt(inc - exp)}` });

    for (let w = 1; w <= 4; w++) {
      const [lo, hi] = this.weekBounds(w);
      const rows: Array<{ it: RecurringItem; date: string }> = [];
      for (const it of items) {
        for (const date of this.datesForItem(it)) {
          const day = Number(date.slice(8, 10));
          if (day >= lo && day <= hi) rows.push({ it, date });
        }
      }
      rows.sort((a, b) => a.date.localeCompare(b.date));

      const inc = rows.filter((r) => r.it.type === "income").reduce((a, r) => a + r.it.amount, 0);
      const exp = rows.filter((r) => r.it.type === "expense").reduce((a, r) => a + r.it.amount, 0);
      const open = this.expandedWeeks.has(w);

      const wk = panel.createDiv({ cls: "pa-rec-week" });
      const wkHead = wk.createDiv({ cls: "pa-section-head pa-rec-week-head pa-clickable" });
      wkHead.onclick = () => { if (open) this.expandedWeeks.delete(w); else this.expandedWeeks.add(w); this.ctx.refresh(); };
      const wkLeft = wkHead.createDiv({ cls: "pa-rec-week-left" });
      wkLeft.createEl("h4", { text: `${open ? "▾" : "▸"} Week ${w} · days ${lo}–${hi}`, cls: "pa-panel-title" });
      const sum = wkLeft.createSpan({ cls: "pa-rec-week-sum" });
      if (rows.length) {
        sum.createSpan({ text: `+${this.fmt(inc)}`, cls: "pa-pos" });
        sum.createSpan({ text: ` -${this.fmt(exp)}`, cls: "pa-neg" });
        const n = sum.createSpan({ text: ` · net ${this.fmt(inc - exp)}`, cls: "pa-rec-net" });
        n.style.color = inc - exp >= 0 ? "#16a34a" : "#ef4444";
      } else {
        sum.createSpan({ cls: "pa-muted", text: "No items" });
      }
      if (rows.length) {
        const applyW = wkHead.createEl("button", { text: `📥 Apply week ${w}`, cls: "pa-mini-btn" });
        applyW.onclick = (e) => { e.stopPropagation(); void this.applyWeek(items, w); };
      }

      if (!open) continue;
      if (!rows.length) { wk.createEl("p", { cls: "pa-muted", text: "No items this week." }); continue; }

      const list = wk.createDiv({ cls: "pa-fin-list" });
      rows.forEach(({ it, date }) => {
        const day = Number(date.slice(8, 10));
        const rowEl = list.createDiv({ cls: "pa-fin-row" });
        const info = rowEl.createDiv({ cls: "pa-fin-info" });
        const when = it.freq === "weekly" ? `${WEEKDAYS[it.weekday ?? 1]} ${String(day).padStart(2, "0")}` : `day ${day}`;
        info.createSpan({ text: when, cls: "pa-fin-date" });
        info.createSpan({ text: it.category, cls: "pa-fin-cat" });
        if (it.note) info.createSpan({ text: it.note, cls: "pa-muted pa-fin-note" });
        const amt = rowEl.createSpan({ text: `${it.type === "income" ? "+" : "-"}${this.fmt(it.amount)}`, cls: "pa-fin-amt" });
        amt.style.color = it.type === "income" ? "#16a34a" : "#ef4444";
        const edit = rowEl.createEl("button", { text: "✏️", cls: "pa-icon-btn" });
        edit.setAttr("aria-label", "Edit recurring item");
        edit.onclick = () => this.openRecurringModal(it, items);
        const del = rowEl.createEl("button", { text: "🗑", cls: "pa-icon-btn" });
        del.setAttr("aria-label", "Delete recurring item");
        del.onclick = () => new ConfirmModal(this.ctx.app, `Delete recurring "${it.category}"?`, async () => {
          await this.ctx.store.saveRecurring(items.filter((x) => x.id !== it.id));
          this.ctx.refresh();
        }).open();
      });
    }
  }

  /** Day range [lo, hi] for week w of the selected month (week 4 absorbs the tail). */
  private weekBounds(w: number): [number, number] {
    const daysInMonth = new Date(this.calYear, this.calMonth + 1, 0).getDate();
    return [(w - 1) * 7 + 1, w === 4 ? daysInMonth : w * 7];
  }

  /** Post only the recurring occurrences that fall within week w of the selected month. */
  private async applyWeek(items: RecurringItem[], w: number): Promise<void> {
    const [lo, hi] = this.weekBounds(w);
    const prefix = this.monthPrefix();
    const existing = this.ctx.store.loadTransactions().filter((t) => t.date.startsWith(prefix));
    let created = 0;
    let skipped = 0;
    for (const it of items) {
      for (const date of this.datesForItem(it)) {
        const day = Number(date.slice(8, 10));
        if (day < lo || day > hi) continue;
        const dup = existing.some((t) =>
          t.type === it.type && t.category === it.category && (t.note || "") === (it.note || "") &&
          Math.abs(t.amount - it.amount) < 0.005 && t.date === date);
        if (dup) { skipped++; continue; }
        await this.ctx.store.addTransaction({ type: it.type, amount: it.amount, category: it.category, note: it.note }, date);
        created++;
      }
    }
    this.ctx.refresh();
    toast(`Applied week ${w} to ${this.monthLabel()}: ${created} added${skipped ? `, ${skipped} already there` : ""}`);
  }

  /** Append a starter template of typical recurring items for the user to edit.
   * Skips items already present (same category + note) so clicking it on an
   * existing list can't silently create duplicates. */
  private async seedStarter(items: RecurringItem[], set: Array<Omit<RecurringItem, "id">>, label: string): Promise<void> {
    const key = (c?: string, n?: string) => `${(c || "").toLowerCase()}|${(n || "").toLowerCase()}`;
    const have = new Set(items.map((i) => key(i.category, i.note)));
    const fresh = set.filter((s) => !have.has(key(s.category, s.note)));
    if (!fresh.length) { toast(`Those ${label} starter items are already in your list — nothing added`); return; }
    const seeded = fresh.map((s, i) => ({ id: `r${Date.now() + i}`, ...s }));
    await this.ctx.store.saveRecurring([...items, ...seeded]);
    this.ctx.refresh();
    toast(`Added ${seeded.length} ${label} starter items — edit the amounts to match your life`);
  }

  private loadStarter(items: RecurringItem[], set: Array<Omit<RecurringItem, "id">>, label: string): void {
    if (!items.length) { void this.seedStarter(items, set, label); return; }
    new ConfirmModal(this.ctx.app,
      `Add generic ${label} EXAMPLE items here for you to edit? This does NOT post anything to the month — to launch expenses use “Post recurring to the month” at the top. Duplicates are skipped.`,
      () => this.seedStarter(items, set, label)).open();
  }

  /** Dates in the selected month that fall on the given weekday (0=Sun..6=Sat). */
  private monthDatesForWeekday(weekday: number): string[] {
    const daysInMonth = new Date(this.calYear, this.calMonth + 1, 0).getDate();
    const out: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(this.calYear, this.calMonth, d).getDay() === weekday) {
        out.push(`${this.monthPrefix()}-${String(d).padStart(2, "0")}`);
      }
    }
    return out;
  }

  /** How much this recurring item totals in the selected month (weekly items repeat). */
  private monthlyEquivalent(it: RecurringItem): number {
    if (it.freq === "weekly") return it.amount * this.monthDatesForWeekday(it.weekday ?? 1).length;
    return it.amount;
  }

  /** Dates a recurring item generates in the selected month. */
  private datesForItem(it: RecurringItem): string[] {
    if (it.freq === "weekly") return this.monthDatesForWeekday(it.weekday ?? 1);
    const day = Math.min(Math.max(it.day || 1, 1), 28);
    return [`${this.monthPrefix()}-${String(day).padStart(2, "0")}`];
  }

  /** Create transactions for the selected month from the recurring template, skipping exact duplicates. */
  private async applyRecurring(items: RecurringItem[], group?: string): Promise<void> {
    const list = group ? items.filter((i) => i.freq === group) : items;
    if (!list.length) { toast("No recurring costs to apply. Add some first."); return; }
    const prefix = this.monthPrefix();
    const existing = this.ctx.store.loadTransactions().filter((t) => t.date.startsWith(prefix));
    let created = 0;
    let skipped = 0;
    for (const it of list) {
      for (const date of this.datesForItem(it)) {
        const dup = existing.some((t) =>
          t.type === it.type && t.category === it.category && (t.note || "") === (it.note || "") &&
          Math.abs(t.amount - it.amount) < 0.005 && t.date === date);
        if (dup) { skipped++; continue; }
        await this.ctx.store.addTransaction({ type: it.type, amount: it.amount, category: it.category, note: it.note }, date);
        created++;
      }
    }
    this.ctx.refresh();
    toast(`Applied to ${this.monthLabel()}: ${created} added${skipped ? `, ${skipped} already there` : ""}`);
  }

  private openRecurringModal(item: RecurringItem | null, items: RecurringItem[], defaultFreq = "monthly"): void {
    const cfg = this.ctx.config;
    const cats = Array.from(new Set([...cfg.expenseCategories, ...cfg.incomeCategories]));
    const fields: FieldSpec[] = [
      { key: "type", label: "Type", type: "dropdown", options: [{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }], value: item?.type || "expense" },
      { key: "category", label: "Category", type: "dropdown", options: cats.map((c) => ({ value: c, label: c })), value: item?.category || cats[0] || "Other" },
      { key: "amount", label: "Amount", type: "number", value: item?.amount ?? 0 },
      { key: "freq", label: "Frequency", type: "dropdown", options: [{ value: "monthly", label: "Monthly" }, { value: "weekly", label: "Weekly" }], value: item?.freq || defaultFreq },
      { key: "day", label: "Day of month (1-28, for monthly)", type: "number", value: item?.day ?? "" },
      { key: "weekday", label: "Weekday (for weekly)", type: "dropdown", options: WEEKDAYS.map((w, i) => ({ value: String(i), label: w })), value: item?.weekday != null ? String(item.weekday) : "1" },
      { key: "note", label: "Note (optional)", type: "text", value: item?.note || "" },
    ];
    new FormModal(this.ctx.app, item ? "Edit recurring cost" : "New recurring cost", fields, async (v) => {
      const amount = parseFloat(v.amount) || 0;
      if (amount <= 0) { toast("Enter an amount greater than zero."); return; }
      const freq = v.freq === "weekly" ? "weekly" : "monthly";
      const day = v.day ? Math.min(Math.max(parseInt(v.day) || 1, 1), 28) : undefined;
      const weekday = v.weekday !== "" && v.weekday != null ? (parseInt(v.weekday) || 0) : undefined;
      const fieldsOut = { type: v.type, category: v.category, amount, note: v.note, freq, day, weekday };
      const next = item
        ? items.map((x) => (x.id === item.id ? { ...x, ...fieldsOut } : x))
        : [...items, { id: "r" + Date.now(), ...fieldsOut }];
      await this.ctx.store.saveRecurring(next);
      this.ctx.refresh();
      toast(item ? "Recurring updated" : "Recurring added");
    }, item ? "Save" : "Create").open();
  }

  // ---- Header with 3 monthly savings-rate rings ----
  private renderHeader(root: HTMLElement, txs: Transaction[]): void {
    const head = root.createDiv({ cls: "pa-ht-header" });
    const left = head.createDiv();
    left.createDiv({ text: "💰 Finances", cls: "pa-h1" });
    left.createDiv({ text: "Income, expenses and budget", cls: "pa-muted" });

    const rings = head.createDiv({ cls: "pa-ht-rings" });
    const now = new Date();
    for (let m = 2; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const month = txs.filter((t) => t.date.startsWith(prefix));
      const inc = this.sumByType(month, "income");
      const exp = this.sumByType(month, "expense");
      const rate = inc > 0 ? Math.round(((inc - exp) / inc) * 100) : 0;
      const color = rate >= 20 ? "#16a34a" : rate >= 0 ? "#7c3aed" : "#ef4444";
      drawRing(rings, Math.max(0, rate), color, `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)} · saved`, 58);
    }
  }

  // ---- Stats for the selected month ----
  private renderStats(root: HTMLElement, txs: Transaction[]): void {
    const month = txs.filter((t) => t.date.startsWith(this.monthPrefix()));
    const income = this.sumByType(month, "income");
    const expense = this.sumByType(month, "expense");
    const balance = income - expense;
    const budget = this.ctx.config.monthlyBudget || 0;

    const row = root.createDiv({ cls: "pa-stats-row" });
    const stat = (label: string, value: string, color?: string) => {
      const c = row.createDiv({ cls: "pa-stat" });
      const v = c.createDiv({ text: value, cls: "pa-stat-value" });
      if (color) v.style.color = color;
      c.createDiv({ text: label, cls: "pa-stat-label" });
    };
    stat("💵 INCOME", this.fmt(income), "#16a34a");
    stat("💸 EXPENSES", this.fmt(expense), "#ef4444");
    stat("⚖️ BALANCE", this.fmt(balance), balance >= 0 ? "#16a34a" : "#ef4444");
    if (budget > 0) {
      const left = budget - expense;
      stat("🎯 BUDGET LEFT", this.fmt(left), left >= 0 ? "#16a34a" : "#ef4444");
    } else {
      stat("🎯 BUDGET", "—", "var(--text-accent)");
    }
  }

  // ---- Expenses by category (donut) for the selected month ----
  private renderBreakdown(root: HTMLElement, txs: Transaction[]): void {
    const card = root.createDiv({ cls: "pa-panel" });
    card.createEl("h3", { text: "📊 Expenses by category", cls: "pa-panel-title" });
    const byCat = new Map<string, number>();
    txs.filter((t) => t.type === "expense" && t.date.startsWith(this.monthPrefix()))
      .forEach((t) => byCat.set(t.category, (byCat.get(t.category) || 0) + t.amount));
    const segs = Array.from(byCat.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], i) => ({ label, value: Math.round(value), color: CAT_COLORS[i % CAT_COLORS.length] }));
    if (!segs.length) { card.createEl("p", { cls: "pa-muted", text: "No expenses this month yet." }); return; }
    drawDonut(card, segs, 150, (n) => this.fmt(n), (n) => this.fmtShort(n));
  }

  // ---- Income vs expenses over the last 6 months ----
  private renderTrend(root: HTMLElement, txs: Transaction[]): void {
    const card = root.createDiv({ cls: "pa-panel" });
    card.createEl("h3", { text: "📈 Income vs expenses (6 months)", cls: "pa-panel-title" });
    const labels: string[] = [];
    const inc: Array<number | null> = [];
    const exp: Array<number | null> = [];
    const base = new Date(this.calYear, this.calMonth, 1);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const mt = txs.filter((t) => t.date.startsWith(p));
      labels.push(MONTHS[d.getMonth()]);
      inc.push(Math.round(this.sumByType(mt, "income")));
      exp.push(Math.round(this.sumByType(mt, "expense")));
    }
    drawLineChart(card, labels, [
      { name: "Income", color: "#16a34a", values: inc },
      { name: "Expenses", color: "#ef4444", values: exp },
    ], { height: 220 });
  }

  // ---- Add a transaction (supports past dates via the date field) ----
  private renderAddBar(root: HTMLElement): void {
    const panel = root.createDiv({ cls: "pa-panel pa-addfood" });
    panel.createEl("h4", { text: "💸 Add a transaction — pick type and category, set the date, then add", cls: "pa-panel-title" });
    const row = panel.createDiv({ cls: "pa-addfood-row" });

    const typeSel = row.createEl("select", { cls: "pa-select" });
    [["expense", "Expense"], ["income", "Income"]].forEach(([v, l]) => {
      const o = typeSel.createEl("option", { text: l, value: v });
      if (v === this.addForm.type) o.selected = true;
    });

    const catSel = row.createEl("select", { cls: "pa-select" });
    const fillCats = () => {
      catSel.empty();
      const cats = this.addForm.type === "income" ? this.ctx.config.incomeCategories : this.ctx.config.expenseCategories;
      cats.forEach((c) => { const o = catSel.createEl("option", { text: c, value: c }); if (c === this.addForm.category) o.selected = true; });
      this.addForm.category = catSel.value;
    };
    fillCats();
    typeSel.onchange = () => { this.addForm.type = typeSel.value; fillCats(); };
    catSel.onchange = () => (this.addForm.category = catSel.value);

    const amount = row.createEl("input", { cls: "pa-fit-input" });
    amount.type = "number"; amount.placeholder = "Amount"; amount.value = this.addForm.amount;
    amount.oninput = () => (this.addForm.amount = amount.value);

    const note = row.createEl("input", { cls: "pa-addfood-name" });
    note.placeholder = "Note (optional)"; note.value = this.addForm.note;
    note.oninput = () => (this.addForm.note = note.value);

    const dateInput = row.createEl("input", { cls: "pa-fit-input" });
    dateInput.type = "date"; dateInput.value = this.addForm.date || todayLocal();
    dateInput.onchange = () => (this.addForm.date = dateInput.value);

    const add = row.createEl("button", { text: "+ add", cls: "pa-btn" });
    add.onclick = async () => {
      const amt = parseFloat(this.addForm.amount) || 0;
      if (amt <= 0) { toast("Enter an amount greater than zero."); return; }
      const date = this.addForm.date || todayLocal();
      await this.ctx.store.addTransaction({ type: this.addForm.type, amount: amt, category: this.addForm.category, note: this.addForm.note.trim() }, date);
      this.addForm.amount = "";
      this.addForm.note = "";
      this.calYear = Number(date.slice(0, 4));
      this.calMonth = Number(date.slice(5, 7)) - 1;
      this.ctx.refresh();
      toast("Transaction added");
    };
  }

  // ---- Month navigation + transactions ledger ----
  private renderLedger(root: HTMLElement, txs: Transaction[]): void {
    const card = root.createDiv({ cls: "pa-panel" });
    const head = card.createDiv({ cls: "pa-cal-head" });
    const prev = head.createEl("button", { text: "←", cls: "pa-icon-btn" });
    head.createSpan({ text: `${MONTHS[this.calMonth]} ${this.calYear}`, cls: "pa-cal-title" });
    const next = head.createEl("button", { text: "→", cls: "pa-icon-btn" });
    prev.onclick = () => { this.calMonth--; if (this.calMonth < 0) { this.calMonth = 11; this.calYear--; } this.ctx.refresh(); };
    next.onclick = () => { this.calMonth++; if (this.calMonth > 11) { this.calMonth = 0; this.calYear++; } this.ctx.refresh(); };
    const gear = head.createEl("button", { text: "⚙️", cls: "pa-icon-btn" });
    gear.setAttr("aria-label", "Finance settings");
    gear.onclick = () => this.openSettings();

    const month = txs.filter((t) => t.date.startsWith(this.monthPrefix()))
      .sort((a, b) => b.date.localeCompare(a.date) || b.path.localeCompare(a.path));
    if (!month.length) { card.createEl("p", { cls: "pa-muted", text: "No transactions this month. Add one above." }); return; }

    const list = card.createDiv({ cls: "pa-fin-list" });
    month.forEach((t) => {
      const rowEl = list.createDiv({ cls: "pa-fin-row" });
      const info = rowEl.createDiv({ cls: "pa-fin-info" });
      info.createSpan({ text: t.date.slice(5), cls: "pa-fin-date" });
      info.createSpan({ text: t.category, cls: "pa-fin-cat" });
      if (t.note) info.createSpan({ text: t.note, cls: "pa-muted pa-fin-note" });
      const amt = rowEl.createSpan({ text: `${t.type === "income" ? "+" : "-"}${this.fmt(t.amount)}`, cls: "pa-fin-amt" });
      amt.style.color = t.type === "income" ? "#16a34a" : "#ef4444";
      const del = rowEl.createEl("button", { text: "🗑", cls: "pa-icon-btn" });
      del.setAttr("aria-label", "Delete transaction");
      del.onclick = () => new ConfirmModal(this.ctx.app, `Delete this ${t.type} of ${this.fmt(t.amount)}?`, async () => {
        await this.ctx.store.deleteTransaction(t);
        this.ctx.refresh();
      }).open();
    });
  }

  private splitCsv(v: string, fallback: string[]): string[] {
    const arr = (v || "").split(",").map((s) => s.trim()).filter(Boolean);
    return arr.length ? arr : fallback;
  }

  private openSettings(): void {
    const cfg = this.ctx.config;
    const fields: FieldSpec[] = [
      { key: "currency", label: "Currency symbol", type: "text", value: cfg.currency },
      { key: "budget", label: "Monthly budget (0 to hide)", type: "number", value: cfg.monthlyBudget },
      { key: "expenseCats", label: "Expense categories (comma-separated)", type: "text", value: cfg.expenseCategories.join(", ") },
      { key: "incomeCats", label: "Income categories (comma-separated)", type: "text", value: cfg.incomeCategories.join(", ") },
    ];
    new FormModal(this.ctx.app, "Finance settings", fields, async (v) => {
      cfg.currency = (v.currency || "$").trim() || "$";
      cfg.monthlyBudget = parseFloat(v.budget) || 0;
      cfg.expenseCategories = this.splitCsv(v.expenseCats, cfg.expenseCategories);
      cfg.incomeCategories = this.splitCsv(v.incomeCats, cfg.incomeCategories);
      await this.ctx.store.saveConfig(cfg);
      this.ctx.refresh();
      toast("Finance settings saved");
    }, "Save").open();
  }
}

