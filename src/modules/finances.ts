import { PAContext } from "../context";
import { RecurringItem, Transaction, SavingsBucket } from "../types";
import { ConfirmModal, FieldSpec, FormModal, toast, appendSidebarBtn } from "../ui";
import { todayLocal } from "../util";
import { drawRing, drawDonut, drawLineChart } from "../charts";

const CAT_COLORS = ["#7c3aed", "#f59e0b", "#16a34a", "#3b82f6", "#ec4899", "#0ea5e9", "#ef4444", "#10b981", "#a855f7", "#eab308"];
// Market-standard convention: the Emergency fund reads as "safety" (blue); custom
// buckets (e.g. Investments) cycle through a separate palette starting with "growth"
// green, so a bucket named "Investments" never accidentally lands on the reserve's blue.
const RESERVE_COLOR = "#3b82f6";
const BUCKET_COLORS = ["#16a34a", "#f59e0b", "#8b5cf6", "#ec4899", "#0ea5e9", "#eab308"];
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
    this.renderNetWorth(root, txs);
    this.renderSavings(root, txs);
    this.renderBreakdown(root, txs);
    this.renderRecurring(root);
    this.renderAddBar(root);
    this.renderLedger(root, txs);
  }

  /** All distinct "YYYY-MM" month keys with at least one transaction, oldest first. */
  private monthKeysWithTx(txs: Transaction[]): string[] {
    const keys = new Set(txs.map((t) => t.date.slice(0, 7)).filter((k) => k.length === 7));
    return Array.from(keys).sort();
  }

  /** "YYYY-MM" key for the calendar month `n` months before `key` (n=0 returns `key`). */
  private monthKeyBack(key: string, n: number): string {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(y, m - 1 - n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  /** A fixed-length window of consecutive month keys ending at `endKey` (inclusive),
   *  regardless of which months actually have transactions. Keeps the net-worth chart's
   *  x-axis stable as history grows or gets backfilled, instead of only ever showing
   *  the months that happen to have data — and it slides forward automatically as real
   *  time passes, since `endKey` is always the current month. */
  private fixedMonthWindow(endKey: string, count: number): string[] {
    const out: string[] = [];
    for (let i = count - 1; i >= 0; i--) out.push(this.monthKeyBack(endKey, i));
    return out;
  }

  /** Running balance up to and including the given month, starting from the configured
   *  starting balance. Cheap to compute from scratch: transactions are already in memory
   *  and this runs once per render, same cost class as the existing 6-month trend. */
  private cumulativeThrough(txs: Transaction[], monthKeyInclusive: string): number {
    const start = this.ctx.config.startingBalance || 0;
    const upTo = txs.filter((t) => t.date.slice(0, 7) <= monthKeyInclusive);
    return start + this.sumByType(upTo, "income") - this.sumByType(upTo, "expense");
  }

  /** Fixed width of the net-worth chart's x-axis: always the current month plus the
   *  12 before it (13 points total). Unlike only plotting months that have data, this
   *  keeps the axis stable as history is backfilled or has gaps — and it slides forward
   *  on its own every calendar month, since the window always ends at "now". The
   *  headline total is unaffected — it's always computed from the full, uncapped history. */
  private static readonly NET_WORTH_CHART_MONTHS = 13;

  // ---- Net worth: running balance since the starting balance, all-time ----
  private renderNetWorth(root: HTMLElement, txs: Transaction[]): void {
    const monthKeys = this.monthKeysWithTx(txs);
    const nowKey = `${this.calYear}-${String(this.calMonth + 1).padStart(2, "0")}`;
    // Always include the current month so the headline number reflects "as of today"
    // even before any transaction has been logged this month.
    const allKeys = Array.from(new Set([...monthKeys, nowKey])).sort();
    const total = this.cumulativeThrough(txs, allKeys[allKeys.length - 1]);
    // Fixed 13-month window ending at the current month — see NET_WORTH_CHART_MONTHS.
    const chartKeys = this.fixedMonthWindow(nowKey, FinancesModule.NET_WORTH_CHART_MONTHS);

    const card = root.createDiv({ cls: "pa-panel" });
    const head = card.createDiv({ cls: "pa-section-head" });
    head.createEl("h3", { text: "🏦 Net worth — accumulated since you started tracking", cls: "pa-panel-title" });
    const gear = head.createEl("button", { text: "⚙️", cls: "pa-icon-btn" });
    gear.setAttr("aria-label", "Set starting balance");
    gear.onclick = () => this.openStartingBalanceModal();

    // Top row: the SAVED SO FAR stat next to the two small donuts (current year so far,
    // Savings breakdown) — all together at the top of the card, above the full-width
    // trend chart below.
    const topRow = card.createDiv({ cls: "pa-networth-top" });
    const row = topRow.createDiv({ cls: "pa-stats-row pa-networth-stat" });
    const c = row.createDiv({ cls: "pa-stat" });
    const v = c.createDiv({ text: this.fmt(total), cls: "pa-stat-value" });
    v.style.color = total >= 0 ? "#16a34a" : "#ef4444";
    c.createDiv({ text: total >= 0 ? "💰 SAVED SO FAR" : "📉 IN THE RED", cls: "pa-stat-label" });
    if (this.ctx.config.startingBalance) {
      row.createDiv({ cls: "pa-muted", text: `Includes a starting balance of ${this.fmt(this.ctx.config.startingBalance)}.` });
    }
    this.renderYearlyMini(topRow.createDiv({ cls: "pa-networth-yearly" }), txs);

    // chartKeys is now a fixed-length window (see NET_WORTH_CHART_MONTHS), so its length
    // alone no longer signals "not enough data yet" — check for any real transaction
    // history instead.
    if (!monthKeys.length) {
      card.createEl("p", { cls: "pa-muted", text: "Log transactions across a couple of months to see the trend." });
      return;
    }

    // Trend chart, full width, below the top row. Combines the accumulated Balance with
    // each month's Income/Expenses on the same chart — this used to be two separate line
    // charts (this one, plus "Income vs expenses" further down) which was one too many;
    // consolidating here shows both "how the month went" and "the overall trend" at once.
    const chartCol = card.createDiv({ cls: "pa-networth-chart" });
    const labels = chartKeys.map((k) => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`);
    const balanceValues = chartKeys.map((k) => Math.round(this.cumulativeThrough(txs, k)));
    const incomeValues = chartKeys.map((k) => Math.round(this.sumByType(txs.filter((t) => t.date.startsWith(k)), "income")));
    const expenseValues = chartKeys.map((k) => Math.round(this.sumByType(txs.filter((t) => t.date.startsWith(k)), "expense")));
    drawLineChart(chartCol, labels, [
      { name: "Balance", color: total >= 0 ? "#16a34a" : "#ef4444", values: balanceValues },
      { name: "Income", color: "#3b82f6", values: incomeValues },
      { name: "Expenses", color: "#f59e0b", values: expenseValues },
    ], { height: 220, format: (n) => this.fmt(n) });
    if (allKeys.some((k) => k < chartKeys[0])) {
      chartCol.createDiv({ cls: "pa-muted", text: `Showing the last ${FinancesModule.NET_WORTH_CHART_MONTHS} months. Older history is included in the total above.` });
    }
  }

  // ---- Small donut cards next to the SAVED SO FAR stat: current year so far, and the
  // Savings breakdown. ----
  private renderYearlyMini(root: HTMLElement, txs: Transaction[]): void {
    const currentYear = this.calYear;
    const byYear = new Map<string, { income: number; expense: number }>();
    txs.forEach((t) => {
      const y = t.date.slice(0, 4);
      if (y.length !== 4) return;
      const acc = byYear.get(y) || { income: 0, expense: 0 };
      if (t.type === "income") acc.income += t.amount; else acc.expense += t.amount;
      byYear.set(y, acc);
    });

    const DONUT_SIZE = 100;

    // Current year so far — Income vs Expenses, center shows this year's net.
    const curCard = root.createDiv({ cls: "pa-networth-mini" });
    curCard.createEl("h4", { text: `📆 ${currentYear} so far`, cls: "pa-panel-title" });
    const cur = byYear.get(String(currentYear)) || { income: 0, expense: 0 };
    if (!cur.income && !cur.expense) {
      curCard.createDiv({ cls: "pa-muted", text: "No transactions yet." });
    } else {
      const net = cur.income - cur.expense;
      const segs = [
        { label: "Income", value: Math.round(cur.income), color: "#16a34a" },
        { label: "Expenses", value: Math.round(cur.expense), color: "#ef4444" },
      ];
      // Center text shows the year's NET (income - expenses), not the segment total
      // (income + expenses) that drawDonut would pass in — hence the closure over `net`
      // instead of using the callback's argument. Uses fmtShort: the full formatted
      // amount doesn't fit inside a 100px circle and was overflowing past the edge.
      drawDonut(curCard, segs, DONUT_SIZE, (n) => this.fmt(n), () => this.fmtShort(net));
    }

    // Savings breakdown — same segments/colors as the Savings panel below. Only shown
    // once there's actually something logged; an empty card here just added clutter
    // next to the always-present "so far" card.
    const buckets = this.ctx.store.loadSavingsBuckets();
    const savTotal = buckets.reduce((a, b) => a + this.bucketBalance(b), 0);
    if (savTotal > 0) {
      const savCard = root.createDiv({ cls: "pa-networth-mini" });
      savCard.createEl("h4", { text: "🐷 Savings", cls: "pa-panel-title" });
      const segs = this.savingsSegments(buckets);
      drawDonut(savCard, segs, DONUT_SIZE, (n) => this.fmt(n), (n) => this.fmtShort(n));
    }
  }

  private openStartingBalanceModal(): void {
    const cfg = this.ctx.config;
    const fields: FieldSpec[] = [
      {
        key: "startingBalance",
        label: `Balance before your first tracked transaction (${this.cur()})`,
        type: "number",
        value: cfg.startingBalance || 0,
      },
    ];
    new FormModal(this.ctx.app, "Starting balance", fields, async (v) => {
      cfg.startingBalance = parseFloat(v.startingBalance) || 0;
      await this.ctx.store.saveConfig(cfg);
      this.ctx.refresh();
      toast("Starting balance saved");
    }, "Save").open();
  }

  // ---- Savings buckets: piggy banks (fixed Emergency fund + user-created ones) ----
  private bucketBalance(b: SavingsBucket): number {
    return Math.round(Object.values(b.log).reduce((a, v) => a + v, 0) * 100) / 100;
  }

  /** Average monthly income over the last 3 months that have any transaction, falling
   *  back to 0 when there's no income history yet (then the suggested goal is also 0,
   *  same as leaving it unset). Mirrors the 3-month window already used by the header's
   *  savings-rate rings, so this stays consistent with the rest of the module. */
  private avgMonthlyIncome(txs: Transaction[]): number {
    const now = new Date();
    let total = 0;
    let months = 0;
    for (let m = 0; m < 3; m++) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const inc = this.sumByType(txs.filter((t) => t.date.startsWith(prefix)), "income");
      if (inc > 0) { total += inc; months++; }
    }
    return months ? total / months : 0;
  }

  /** Market-standard default: 6 months of income as the Emergency fund target. Only
   *  used when the user hasn't set an explicit goal on the bucket. */
  private suggestedReserveGoal(txs: Transaction[]): number {
    return Math.round(this.avgMonthlyIncome(txs) * 6);
  }

  /** Donut segments for the savings breakdown — shared between the small card next to
   *  the net-worth chart and (were it ever needed again) the Savings panel itself. */
  private savingsSegments(buckets: SavingsBucket[]): Array<{ label: string; value: number; color: string }> {
    return buckets.map((b, i) => ({
      label: b.name,
      value: Math.max(0, this.bucketBalance(b)),
      color: b.kind === "reserve" ? RESERVE_COLOR : BUCKET_COLORS[i % BUCKET_COLORS.length],
    }));
  }

  private renderSavings(root: HTMLElement, txs: Transaction[]): void {
    const buckets = this.ctx.store.loadSavingsBuckets();
    const card = root.createDiv({ cls: "pa-panel" });
    const head = card.createDiv({ cls: "pa-section-head" });
    head.createEl("h3", { text: "🐷 Savings — money set aside, by goal", cls: "pa-panel-title" });
    const addBtn = head.createEl("button", { text: "+ new bucket", cls: "pa-mini-btn" });
    addBtn.onclick = () => this.openBucketModal();

    const list = card.createDiv({ cls: "pa-savings-list" });
    buckets.forEach((b, i) => {
      const bal = this.bucketBalance(b);
      const color = b.kind === "reserve" ? RESERVE_COLOR : BUCKET_COLORS[i % BUCKET_COLORS.length];
      const goal = b.goal ?? (b.kind === "reserve" ? this.suggestedReserveGoal(txs) : 0);
      const isSuggested = b.kind === "reserve" && b.goal == null && goal > 0;

      const row = list.createDiv({ cls: "pa-savings-item" });
      const top = row.createDiv({ cls: "pa-savings-item-top" });
      const dot = top.createSpan({ cls: "pa-legend-dot" });
      dot.style.background = color;
      top.createSpan({ text: b.name, cls: "pa-savings-item-name" });
      top.createSpan({ text: this.fmt(bal), cls: "pa-savings-item-bal" });

      if (goal > 0) {
        const pct = Math.min(100, Math.round((bal / goal) * 100));
        const labelRow = row.createDiv({ cls: "pa-progress-label" });
        labelRow.createSpan({ text: `Goal: ${this.fmt(goal)}${isSuggested ? " (suggested — 6mo income)" : ""}` });
        labelRow.createSpan({ text: `${pct}%`, cls: "pa-muted" });
        const bar = row.createDiv({ cls: "pa-progress-track" });
        const fill = bar.createDiv({ cls: "pa-progress-fill" });
        fill.style.width = pct + "%";
        fill.style.background = color;
      }

      const actions = row.createDiv({ cls: "pa-savings-item-actions" });
      const add = actions.createEl("button", { text: "+ contribution", cls: "pa-mini-btn" });
      add.onclick = () => this.openContributionModal(b);
      const edit = actions.createEl("button", { text: "✏️ edit", cls: "pa-mini-btn" });
      edit.setAttr("aria-label", "Edit this bucket's name, balance and/or goal");
      edit.onclick = () => this.openEditBucketModal(b, bal, txs);
      if (b.kind !== "reserve") {
        const del = actions.createEl("button", { text: "🗑", cls: "pa-icon-btn" });
        del.setAttr("aria-label", "Delete bucket");
        del.onclick = () => new ConfirmModal(this.ctx.app,
          `Delete "${b.name}"? Its ${this.fmt(bal)} balance and contribution history will be lost — this only removes the bucket, it never touches your transactions.`,
          async () => { await this.ctx.store.deleteSavingsBucket(b.id); this.ctx.refresh(); }).open();
      }
    });
  }

  /** "+ new bucket" only — renaming an existing one is now folded into
   *  openEditBucketModal alongside its balance. */
  private openBucketModal(): void {
    const fields: FieldSpec[] = [
      { key: "name", label: "Bucket name", type: "text", value: "", placeholder: "e.g. Investments, Travel, New car" },
    ];
    new FormModal(this.ctx.app, "New savings bucket", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name) { toast("Enter a name for the bucket."); return; }
      await this.ctx.store.addSavingsBucket(name);
      this.ctx.refresh();
      toast("Bucket created");
    }, "Create").open();
  }

  /** One combined modal for everything you'd want to fix on an existing bucket: its name
   *  (skipped for the fixed Emergency fund), its total balance, and its goal — replaces
   *  what used to be three separate buttons/modals (rename, "set balance", and goal).
   *  Renaming and the goal write straight through; correcting the balance records the
   *  difference as one contribution dated today (the balance is always the sum of the
   *  log, so this is the only way to change it without losing the rest of the
   *  contribution history). */
  private openEditBucketModal(bucket: SavingsBucket, currentBalance: number, txs: Transaction[]): void {
    const suggested = bucket.kind === "reserve" ? this.suggestedReserveGoal(txs) : 0;
    const fields: FieldSpec[] = [];
    if (bucket.kind !== "reserve") {
      fields.push({ key: "name", label: "Bucket name", type: "text", value: bucket.name });
    }
    fields.push({ key: "balance", label: `Correct total balance (${this.cur()})`, type: "number", value: currentBalance });
    fields.push({
      key: "goal",
      label: bucket.kind === "reserve"
        ? `Goal (${this.cur()}) — leave as suggested (6mo income = ${this.fmt(suggested)}) or set your own, 0 to clear`
        : `Goal (${this.cur()}) — 0 to leave unset`,
      type: "number",
      value: bucket.goal ?? suggested,
    });
    new FormModal(this.ctx.app, `Edit "${bucket.name}"`, fields, async (v) => {
      const name = (v.name || "").trim();
      const goal = parseFloat(v.goal) || 0;
      const patch: { name?: string; goal?: number | undefined } = { goal: goal > 0 ? goal : undefined };
      if (bucket.kind !== "reserve" && name && name !== bucket.name) patch.name = name;
      await this.ctx.store.updateSavingsBucket(bucket.id, patch);
      const target = parseFloat(v.balance) || 0;
      const diff = Math.round((target - currentBalance) * 100) / 100;
      if (diff) await this.ctx.store.addSavingsContribution(bucket.id, diff, todayLocal());
      this.ctx.refresh();
      toast("Bucket updated");
    }, "Save").open();
  }

  private openContributionModal(bucket: SavingsBucket): void {
    const fields: FieldSpec[] = [
      { key: "amount", label: `Amount (${this.cur()}) — negative to withdraw`, type: "number", value: "" },
      { key: "date", label: "Date", type: "text", value: todayLocal() },
    ];
    new FormModal(this.ctx.app, `Add to "${bucket.name}"`, fields, async (v) => {
      const amount = parseFloat(v.amount) || 0;
      if (!amount) { toast("Enter a non-zero amount."); return; }
      const date = /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : todayLocal();
      await this.ctx.store.addSavingsContribution(bucket.id, amount, date);
      this.ctx.refresh();
      toast(amount > 0 ? "Contribution added" : "Withdrawal recorded");
    }, "Save").open();
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
    appendSidebarBtn(left, this.ctx.openSidePanel);

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

