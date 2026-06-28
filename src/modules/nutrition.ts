import { PAContext } from "../context";
import { Meal, MealItem, MealLog } from "../types";
import { toast } from "../ui";
import { todayLocal, ymd } from "../util";
import { drawRing, drawLineChart } from "../charts";
import { searchFoods, FoodResult } from "../foodapi";

/** Fixed meal slots — names are not editable, only their plans. */
const SLOTS = [
  { id: "breakfast", name: "Breakfast", emoji: "☕" },
  { id: "lunch", name: "Lunch", emoji: "🍽️" },
  { id: "dinner", name: "Dinner", emoji: "🌙" },
  { id: "snacks", name: "Snacks", emoji: "🍎" },
];

/** Renders the Nutrition page, mirroring the Fitness UX (fixed plans + inline editor). */
export class NutritionModule {
  private ctx: PAContext;
  private selectedMeal: string | null = null;
  private selectedDate: string | null = null;
  private calMonth: number;
  private calYear: number;
  private addForm = { name: "", qty: "100", cal: "", meal: "lunch", kcal100: 0, protein100: 0, carbs100: 0 };

  constructor(ctx: PAContext) {
    const now = new Date();
    this.ctx = ctx;
    this.calMonth = now.getMonth();
    this.calYear = now.getFullYear();
    this.selectedDate = todayLocal(); // show today's log by default
  }

  /** The 4 fixed slots, hydrated with any saved plan file. */
  private getMeals(): Meal[] {
    const saved = this.ctx.store.loadMeals();
    return SLOTS.map((s) => {
      const m = saved.find((x) => x.id === s.id);
      return m ? { ...m, name: s.name, emoji: s.emoji } : ({ id: s.id, name: s.name, emoji: s.emoji, totalCal: 0, items: [], path: "" } as Meal);
    });
  }

  render(root: HTMLElement): void {
    root.empty();
    const meals = this.getMeals();
    const logs = this.ctx.store.loadMealLogs();
    const water = this.ctx.store.loadWaterLog();
    const today = todayLocal();
    const calByDay = new Map<string, number>();
    logs.forEach((l) => calByDay.set(l.date, (calByDay.get(l.date) || 0) + l.totalCal));

    this.renderHeader(root, calByDay, today);
    this.renderStats(root, calByDay, water, today);

    const cols = root.createDiv({ cls: "pa-two-col" });
    this.renderCalendar(cols, calByDay);
    this.renderTrend(cols, calByDay, today);

    this.renderMealPlans(root, meals);
    this.renderAddFood(root, meals);
    if (this.selectedMeal) this.renderMealEditor(root, meals);

    if (this.selectedDate) this.renderDayDetail(root, meals, logs);
  }

  // ---- Header rings (last 3 days calorie %) ----
  private renderHeader(root: HTMLElement, calByDay: Map<string, number>, today: string): void {
    const head = root.createDiv({ cls: "pa-ht-header" });
    const left = head.createDiv();
    left.createDiv({ text: "🥗 Nutrition", cls: "pa-h1" });
    left.createDiv({ text: "Daily food tracking", cls: "pa-muted" });

    const target = this.ctx.config.calorieTarget || 2000;
    const rings = head.createDiv({ cls: "pa-ht-rings" });
    const dayN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const base = new Date(today + "T00:00:00");
    for (let i = 2; i >= 0; i--) {
      const dt = new Date(base);
      dt.setDate(dt.getDate() - i);
      const ds = ymd(dt);
      const cal = calByDay.get(ds) || 0;
      const pct = target ? Math.round((cal / target) * 100) : 0;
      const color = pct >= 80 && pct <= 110 ? "#16a34a" : pct > 110 ? "#ef4444" : "#d97706";
      const label = i === 0 ? `Today · ${cal} cal` : `${dayN[dt.getDay()]} ${dt.getDate()} · ${cal} cal`;
      drawRing(rings, pct, color, label, 58);
    }
  }

  // ---- Add a food (fixed bar) — to a plan (recurring) or just today's meal ----
  private renderAddFood(root: HTMLElement, meals: Meal[]): void {
    const panel = root.createDiv({ cls: "pa-panel pa-addfood" });
    const head = panel.createDiv({ cls: "pa-section-head" });
    head.createEl("h4", { text: "🔎 Add a food — pick the meal, then add to the plan or just to today", cls: "pa-panel-title" });
    const water = head.createEl("button", { text: "💧 +250ml", cls: "pa-mini-btn" });
    water.onclick = async () => { await this.ctx.store.addWater(todayLocal(), 0.25); this.ctx.refresh(); toast("💧 +250ml"); };

    const row = panel.createDiv({ cls: "pa-addfood-row" });
    const nameInput = row.createEl("input", { cls: "pa-addfood-name", placeholder: "Food name…" });
    nameInput.value = this.addForm.name;
    nameInput.oninput = () => { this.addForm.name = nameInput.value; this.clearFoodBasis(); };

    const qty = row.createEl("input", { cls: "pa-fit-input" });
    qty.type = "number"; qty.value = this.addForm.qty; qty.title = "Qty (g)";

    const cal = row.createEl("input", { cls: "pa-fit-input" });
    cal.type = "number"; cal.placeholder = "Cal"; cal.value = this.addForm.cal;
    cal.oninput = () => (this.addForm.cal = cal.value);

    // Recompute calories from the per-100g basis when a product was picked.
    qty.oninput = () => {
      this.addForm.qty = qty.value;
      if (this.addForm.kcal100 > 0) {
        const q = parseFloat(qty.value) || 0;
        this.addForm.cal = String(Math.round((this.addForm.kcal100 * q) / 100));
        cal.value = this.addForm.cal;
      }
    };

    const mealSel = row.createEl("select", { cls: "pa-select" });
    SLOTS.forEach((s) => { const o = mealSel.createEl("option", { text: s.name, value: s.id }); if (s.id === this.addForm.meal) o.selected = true; });
    mealSel.onchange = () => (this.addForm.meal = mealSel.value);

    // Open Food Facts search button + results panel.
    const searchBtn = row.createEl("button", { text: "🔎 Search", cls: "pa-mini-btn" });
    const results = panel.createDiv({ cls: "pa-food-results" });
    results.hide();

    const doSearch = async () => {
      const q = this.addForm.name.trim();
      if (!q) { toast("Type a food name to search."); return; }
      results.empty(); results.show();
      results.createDiv({ cls: "pa-muted", text: `Searching “${q}” on Open Food Facts…` });
      searchBtn.disabled = true;
      try {
        const found = await searchFoods(q, 20);
        results.empty();
        if (!found.length) { results.createDiv({ cls: "pa-muted", text: "No results found." }); return; }
        found.forEach((f) => this.renderFoodResult(results, f, nameInput, qty, cal));
      } catch (e) {
        results.empty();
        results.createDiv({ cls: "pa-muted", text: "Search failed (check your connection). You can still enter the food manually." });
        console.error("Open Food Facts search error", e);
      } finally {
        searchBtn.disabled = false;
      }
    };
    searchBtn.onclick = doSearch;
    nameInput.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } };

    const buildItem = (): MealItem | null => {
      const name = this.addForm.name.trim();
      if (!name) { toast("Enter a food name."); return null; }
      const q = parseFloat(this.addForm.qty) || 0;
      const item: MealItem = { name, qty: q, unit: "g", cal: parseInt(this.addForm.cal) || 0 };
      if (this.addForm.protein100 > 0) item.protein = Math.round((this.addForm.protein100 * q) / 100 * 10) / 10;
      if (this.addForm.carbs100 > 0) item.carbs = Math.round((this.addForm.carbs100 * q) / 100 * 10) / 10;
      return item;
    };
    const targetMeal = () => meals.find((m) => m.id === this.addForm.meal)!;

    const toToday = row.createEl("button", { text: "+ Add to Today", cls: "pa-btn" });
    toToday.onclick = async () => {
      const item = buildItem();
      if (!item) return;
      await this.ctx.store.logMeal(targetMeal(), [item]);
      this.resetAddForm();
      this.selectedDate = todayLocal();
      this.ctx.refresh();
      toast(`Logged ${item.name} to ${targetMeal().name}`);
    };
    const toPlan = row.createEl("button", { text: "+ Add to Plan", cls: "pa-mini-btn" });
    toPlan.onclick = async () => {
      const item = buildItem();
      if (!item) return;
      const meal = targetMeal();
      await this.ctx.store.saveMeal({ id: meal.id, name: meal.name, emoji: meal.emoji, items: [...meal.items, item] });
      this.resetAddForm();
      this.ctx.refresh();
      toast(`Added ${item.name} to ${meal.name} plan`);
    };
  }

  /** Render a single Open Food Facts result row; clicking fills the form. */
  private renderFoodResult(parent: HTMLElement, f: FoodResult, nameInput: HTMLInputElement, qty: HTMLInputElement, cal: HTMLInputElement): void {
    const item = parent.createDiv({ cls: "pa-food-result pa-clickable" });
    const main = item.createDiv({ cls: "pa-food-result-main" });
    main.createSpan({ cls: "pa-food-result-name", text: f.brand ? `${f.name} · ${f.brand}` : f.name });
    const macros = [`${f.kcal100} kcal/100g`];
    if (f.protein100) macros.push(`P ${f.protein100}g`);
    if (f.carbs100) macros.push(`C ${f.carbs100}g`);
    if (f.fat100) macros.push(`G ${f.fat100}g`);
    item.createDiv({ cls: "pa-food-result-macros pa-muted", text: macros.join(" · ") });
    item.onclick = () => {
      this.addForm.name = f.name;
      this.addForm.kcal100 = f.kcal100;
      this.addForm.protein100 = f.protein100 || 0;
      this.addForm.carbs100 = f.carbs100 || 0;
      const q = parseFloat(this.addForm.qty) || 100;
      this.addForm.cal = String(Math.round((f.kcal100 * q) / 100));
      nameInput.value = f.name;
      cal.value = this.addForm.cal;
      qty.value = this.addForm.qty;
      parent.empty(); parent.hide();
      toast(`Selected ${f.name} — ${this.addForm.cal} cal for ${q}g`);
    };
  }

  /** Drop any picked per-100g basis (user is typing a custom name). */
  private clearFoodBasis(): void {
    this.addForm.kcal100 = 0;
    this.addForm.protein100 = 0;
    this.addForm.carbs100 = 0;
  }

  private resetAddForm(): void {
    this.addForm.name = "";
    this.addForm.cal = "";
    this.clearFoodBasis();
  }

  // ---- Meal plan cards (fixed 4, whole card clickable) ----
  private renderMealPlans(root: HTMLElement, meals: Meal[]): void {
    const panel = root.createDiv({ cls: "pa-panel" });
    const head = panel.createDiv({ cls: "pa-section-head" });
    head.createEl("h3", { text: "🍽️ Meal Plan — 4 fixed slots · tap a card to edit", cls: "pa-panel-title" });
    const water = head.createEl("button", { text: "💧 +250ml", cls: "pa-mini-btn" });
    water.onclick = async () => { await this.ctx.store.addWater(todayLocal(), 0.25); this.ctx.refresh(); toast("💧 +250ml"); };

    const grid = panel.createDiv({ cls: "pa-plan-grid" });
    meals.forEach((m) => {
      const card = grid.createDiv({ cls: "pa-plan-card pa-clickable" + (this.selectedMeal === m.id ? " on" : "") });
      card.onclick = () => { this.selectedMeal = this.selectedMeal === m.id ? null : m.id; this.ctx.refresh(); };
      card.createDiv({ text: `${m.emoji || ""} ${m.name} (${m.totalCal} cal)`.trim(), cls: "pa-plan-title" });
      const listEl = card.createDiv({ cls: "pa-plan-list" });
      if (!m.items.length) listEl.createDiv({ cls: "pa-muted", text: "No items" });
      else m.items.forEach((it) => listEl.createDiv({ cls: "pa-plan-ex", text: `${it.name} — ${it.qty} ${it.unit}` }));
    });
  }

  // ---- Meal editor (below plans) ----
  private renderMealEditor(root: HTMLElement, meals: Meal[]): void {
    const meal = meals.find((m) => m.id === this.selectedMeal);
    if (!meal) return;
    const panel = root.createDiv({ cls: "pa-panel pa-active" });
    const top = panel.createDiv({ cls: "pa-active-top" });
    top.createEl("h3", { text: `${meal.emoji || ""} ${meal.name}`.trim(), cls: "pa-panel-title" });
    const totalEl = top.createSpan({ cls: "pa-muted" });

    const table = panel.createEl("table", { cls: "pa-fit-table" });
    const thr = table.createEl("thead").createEl("tr");
    ["✓", "Food", "Qty", "Unit", "Calories", ""].forEach((h) => thr.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");

    const recalc = () => {
      let sum = 0;
      tbody.querySelectorAll("tr").forEach((tr) => {
        const chk = tr.querySelector("input.pa-it-check") as HTMLInputElement;
        const calIn = tr.querySelector("input.pa-it-cal") as HTMLInputElement;
        if (chk?.checked) sum += parseInt(calIn.value) || 0;
      });
      totalEl.setText(`Estimated total: ${sum} cal`);
    };

    if (!meal.items.length) {
      panel.createEl("p", { cls: "pa-muted", text: "No items in this plan yet. Add a food below." });
    } else {
      meal.items.forEach((it, idx) => {
        const tr = tbody.createEl("tr");
        tr.dataset.idx = String(idx);
        const chk = tr.createEl("td").createEl("input", { cls: "pa-it-check" });
        chk.type = "checkbox"; chk.checked = true; chk.onchange = recalc;
        tr.createEl("td", { text: it.name, cls: "pa-fit-name" });
        const qtyIn = tr.createEl("td").createEl("input", { cls: "pa-fit-input pa-it-qty" });
        qtyIn.type = "number"; qtyIn.value = String(it.qty);
        tr.createEl("td", { text: it.unit, cls: "pa-muted" });
        const calIn = tr.createEl("td").createEl("input", { cls: "pa-fit-input pa-it-cal" });
        calIn.type = "number"; calIn.value = String(it.cal); calIn.oninput = recalc;
        const del = tr.createEl("td").createEl("button", { text: "🗑", cls: "pa-icon-btn" });
        del.onclick = () => { tr.remove(); recalc(); };
      });
    }
    recalc();

    const actions = panel.createDiv({ cls: "pa-active-actions" });
    const confirm = actions.createEl("button", { text: "✓ Confirm Meal", cls: "pa-btn" });
    confirm.onclick = async () => {
      const eaten = this.readRows(tbody, meal, true);
      if (!eaten.length) { toast("Check at least one item."); return; }
      await this.ctx.store.logMeal(meal, eaten);
      this.selectedMeal = null;
      this.selectedDate = todayLocal(); // show the log at the bottom
      this.ctx.refresh();
      toast(`✓ ${meal.name} confirmed`);
    };
    const save = actions.createEl("button", { text: "💾 Save Plan", cls: "pa-mini-btn" });
    save.onclick = async () => { await this.ctx.store.saveMeal({ id: meal.id, name: meal.name, emoji: meal.emoji, items: this.readRows(tbody, meal, false) }); this.ctx.refresh(); toast("💾 Plan saved"); };
    const close = actions.createEl("button", { text: "Close", cls: "pa-mini-btn" });
    close.onclick = () => { this.selectedMeal = null; this.ctx.refresh(); };
  }

  private readRows(tbody: HTMLElement, meal: Meal, onlyChecked: boolean): MealItem[] {
    const items: MealItem[] = [];
    tbody.querySelectorAll("tr").forEach((tr) => {
      const chk = tr.querySelector("input.pa-it-check") as HTMLInputElement;
      if (onlyChecked && !chk.checked) return;
      const idx = parseInt((tr as HTMLElement).dataset.idx || "0");
      const base = meal.items[idx] || { name: "Item", unit: "g" };
      items.push({
        name: base.name,
        unit: base.unit,
        qty: parseFloat((tr.querySelector("input.pa-it-qty") as HTMLInputElement).value) || 0,
        cal: parseInt((tr.querySelector("input.pa-it-cal") as HTMLInputElement).value) || 0,
        protein: base.protein, carbs: base.carbs,
      });
    });
    return items;
  }

  // ---- Stats ----
  private renderStats(root: HTMLElement, calByDay: Map<string, number>, water: Record<string, number>, today: string): void {
    const cfg = this.ctx.config;
    const consumed = calByDay.get(today) || 0;
    const remaining = cfg.calorieTarget - consumed;
    const waterToday = water[today] || 0;

    const row = root.createDiv({ cls: "pa-stats-row" });
    const stat = (label: string, value: string, color?: string) => {
      const c = row.createDiv({ cls: "pa-stat" });
      const v = c.createDiv({ text: value, cls: "pa-stat-value" });
      if (color) v.style.color = color;
      c.createDiv({ text: label, cls: "pa-stat-label" });
    };
    stat("🥗 CALORIES TODAY", String(consumed));
    stat("🎯 DAILY GOAL", String(cfg.calorieTarget), "var(--text-accent)");
    stat("➖ REMAINING", String(remaining), remaining >= 0 ? "#16a34a" : "#ef4444");
    stat(`💧 WATER /${cfg.waterTarget}L`, `${waterToday.toFixed(1)}L`, "#3b82f6");
  }

  // ---- Calendar ----
  private renderCalendar(root: HTMLElement, calByDay: Map<string, number>): void {
    const target = this.ctx.config.calorieTarget || 2000;
    const card = root.createDiv({ cls: "pa-panel" });
    card.createEl("h3", { text: "📅 Meal Calendar", cls: "pa-panel-title" });
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
      const cal = calByDay.get(ds);
      if (cal != null) {
        const pct = target ? (cal / target) * 100 : 0;
        const color = pct >= 80 && pct <= 110 ? "#16a34a" : pct > 110 ? "#ef4444" : "#f59e0b";
        cell.style.background = color;
        cell.style.color = "#fff";
        cell.createDiv({ text: String(cal), cls: "pa-cal-tag" });
        cell.onclick = () => { this.selectedDate = ds; this.ctx.refresh(); };
      }
      if (ds === today) cell.addClass("today");
    }
    const legend = card.createDiv({ cls: "pa-cal-legend" });
    [["#f59e0b", "<80%"], ["#16a34a", "80-110%"], ["#ef4444", ">110%"]].forEach(([c, l]) => {
      const item = legend.createDiv({ cls: "pa-legend-item" });
      const dot = item.createSpan({ cls: "pa-legend-dot" }); dot.style.background = c;
      item.createSpan({ text: l });
    });
  }

  // ---- Calories last 7 days ----
  private renderTrend(root: HTMLElement, calByDay: Map<string, number>, today: string): void {
    const card = root.createDiv({ cls: "pa-panel" });
    card.createEl("h3", { text: "📈 Calories Last 7 Days", cls: "pa-panel-title" });
    const labels: string[] = [];
    const values: number[] = [];
    const base = new Date(today + "T00:00:00");
    for (let i = 6; i >= 0; i--) {
      const d = new Date(base); d.setDate(d.getDate() - i);
      const ds = ymd(d);
      labels.push(ds.slice(5));
      values.push(calByDay.get(ds) || 0);
    }
    drawLineChart(card, labels, [{ name: "Calories", color: "#f59e0b", values }], { goal: this.ctx.config.calorieTarget, height: 220 });
  }

  // ---- Selected day detail (log) ----
  private renderDayDetail(root: HTMLElement, meals: Meal[], logs: MealLog[]): void {
    const ds = this.selectedDate!;
    const dayLogs = logs.filter((l) => l.date === ds);
    const total = dayLogs.reduce((s, l) => s + l.totalCal, 0);
    const panel = root.createDiv({ cls: "pa-panel pa-active" });
    const top = panel.createDiv({ cls: "pa-active-top" });
    top.createEl("h3", { text: `🍴 ${ds} — ${total} cal`, cls: "pa-panel-title" });
    const close = top.createEl("button", { text: "✕", cls: "pa-icon-btn" });
    close.onclick = () => { this.selectedDate = null; this.ctx.refresh(); };

    if (!dayLogs.length) { panel.createEl("p", { cls: "pa-muted", text: "No meals logged this day." }); return; }
    dayLogs.forEach((l) => {
      const meal = meals.find((m) => m.id === l.mealId);
      const card = panel.createDiv({ cls: "pa-card" });
      const tr = card.createDiv({ cls: "pa-card-title-row" });
      tr.createEl("strong", { text: meal ? `${meal.emoji || ""} ${meal.name}` : l.mealId || "Meal" });
      const del = tr.createEl("button", { text: "✕", cls: "pa-icon-btn" });
      del.onclick = async () => { await this.ctx.store.deleteMealLog(l); this.ctx.refresh(); };
      l.items.forEach((it) => card.createDiv({ cls: "pa-muted", text: `${it.name} — ${it.qty}${it.unit} (${it.cal} cal)` }));
      card.createDiv({ cls: "pa-macro-total", text: `Total: ${l.totalCal} cal` });
    });
  }
}
