// Filesystem-backed data layer for the Momentum Life vault.
// Faithful Node port of the plugin's PADataStore write/read rules, so files
// created here are indistinguishable from the ones the plugin creates:
//  - same buildDoc frontmatter format (JSON-encoded scalars/objects)
//  - readable filenames (naming.mjs)
//  - month-hub regeneration (Finance/Nutrition/Fitness)
//  - task board validation + mirror regeneration
//
// It does NOT depend on Obsidian; it reads/writes the .md files directly.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import {
  monthHubTitle, monthKeyOf, monthName, financeTxTitle, mealLogTitle,
  workoutTitle, formatAmount, mergeBody, safeName,
} from "./naming.mjs";

const DEFAULT_TASK_COLUMNS = ["backlog", "in progress", "done"];
const DEFAULT_TASK_COLUMN_NAMES = { backlog: "📌 BACKLOG", "in progress": "🔄 IN PROGRESS", done: "✅ DONE" };
const DEFAULT_EXPENSE_CATEGORIES = ["Housing", "Food", "Transport", "Health", "Leisure", "Bills", "Shopping", "Other"];
const DEFAULT_INCOME_CATEGORIES = ["Salary", "Bonus", "Investments", "Gift", "Other"];

const str = (v) => v == null ? "" : (typeof v === "string" ? v : (typeof v === "number" || typeof v === "boolean") ? String(v) : JSON.stringify(v));
const num = (v) => { if (typeof v === "number") return isNaN(v) ? 0 : v; if (typeof v === "string") { const n = parseFloat(v); return isNaN(n) ? 0 : n; } return 0; };
function coerce(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return fallback; } }
  return v;
}
function todayLocal() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function cryptoId() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* noop */ }
  return "t" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

export class MomentumStore {
  constructor(vaultPath, dataRoot = "Momentum Life") {
    this.vault = vaultPath;
    this.dataRoot = dataRoot;
  }

  // ---- paths ----
  full(rel) { return path.join(this.vault, this.dataRoot, rel); }

  async exists(rel) { try { await fs.access(this.full(rel)); return true; } catch { return false; } }

  async readRaw(rel) { try { return await fs.readFile(this.full(rel), "utf8"); } catch { return null; } }

  /** List *.md files under a folder (recursive), relative paths from dataRoot. */
  async listMarkdown(folder) {
    const base = this.full(folder);
    const out = [];
    const walk = async (dir) => {
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
      }
    };
    await walk(base);
    out.sort();
    return out; // absolute paths
  }

  basename(abs) { return path.basename(abs, ".md"); }

  // ---- frontmatter parse / build (build mirrors data.ts buildDoc exactly) ----
  parse(raw) {
    if (!raw || !raw.startsWith("---")) return { fm: {}, body: raw || "" };
    const end = raw.indexOf("\n---", 3);
    if (end === -1) return { fm: {}, body: raw };
    const fmText = raw.slice(3, end).replace(/^\n/, "");
    const afterFence = raw.indexOf("\n", end + 1);
    const body = afterFence === -1 ? "" : raw.slice(afterFence + 1);
    let fm = {};
    try { fm = YAML.parse(fmText) || {}; } catch { fm = {}; }
    return { fm, body };
  }

  buildDoc(meta, body) {
    const lines = ["---"];
    for (const k of Object.keys(meta)) {
      const v = meta[k];
      if (v == null) continue;
      if (typeof v === "object") lines.push(`${k}: ${JSON.stringify(v)}`);
      else if (typeof v === "string") lines.push(`${k}: ${JSON.stringify(v)}`);
      else if (typeof v === "number" || typeof v === "boolean") lines.push(`${k}: ${String(v)}`);
      else lines.push(`${k}: ${JSON.stringify(v)}`);
    }
    lines.push("---", "", body || "");
    return lines.join("\n");
  }

  async fmOf(abs) { return this.parse(await fs.readFile(abs, "utf8").catch(() => "")).fm; }

  async writeRel(rel, content) {
    const abs = this.full(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return abs;
  }

  async writeIfChanged(rel, content) {
    const cur = await this.readRaw(rel);
    if (cur === content) return false;
    await this.writeRel(rel, content);
    return true;
  }

  async removeAbs(abs) { try { await fs.rm(abs); } catch { /* ignore */ } }

  /** A rel path under folder for title with no collision (" 2", " 3", ...). */
  async uniqueRel(folder, title) {
    const base = safeName(title);
    let rel = `${folder}/${base}.md`;
    let n = 2;
    while (await this.exists(rel)) { rel = `${folder}/${base} ${n}.md`; n++; }
    return rel;
  }

  bodyOf(raw) {
    if (!raw || !raw.startsWith("---")) return raw || "";
    const fenceEnd = raw.indexOf("\n---", 3);
    if (fenceEnd === -1) return raw;
    const afterFence = raw.indexOf("\n", fenceEnd + 1);
    return afterFence === -1 ? "" : raw.slice(afterFence + 1);
  }

  // ============================================================
  // CONFIG
  // ============================================================
  async loadConfig() {
    const cfg = {
      calorieTarget: 2000, proteinTarget: 120, carbsTarget: 200, waterTarget: 2.5,
      taskColumns: DEFAULT_TASK_COLUMNS.slice(), taskColumnNames: { ...DEFAULT_TASK_COLUMN_NAMES },
      studyColumns: DEFAULT_TASK_COLUMNS.slice(), studyColumnNames: { ...DEFAULT_TASK_COLUMN_NAMES },
      studyTopics: [], customSplits: [], splitNames: {}, currency: "$", monthlyBudget: 0,
      expenseCategories: DEFAULT_EXPENSE_CATEGORIES.slice(), incomeCategories: DEFAULT_INCOME_CATEGORIES.slice(),
      customPages: [],
    };
    const raw = await this.readRaw("Config/settings.md");
    if (!raw) return cfg;
    const m = this.parse(raw).fm;
    if (m.calorie_target) cfg.calorieTarget = num(m.calorie_target);
    if (m.protein_target) cfg.proteinTarget = num(m.protein_target);
    if (m.carbs_target) cfg.carbsTarget = num(m.carbs_target);
    if (m.water_target) cfg.waterTarget = num(m.water_target);
    if (m.task_columns) cfg.taskColumns = coerce(m.task_columns, cfg.taskColumns);
    if (m.task_column_names) cfg.taskColumnNames = coerce(m.task_column_names, cfg.taskColumnNames);
    if (m.study_columns) cfg.studyColumns = coerce(m.study_columns, cfg.studyColumns);
    if (m.study_column_names) cfg.studyColumnNames = coerce(m.study_column_names, cfg.studyColumnNames);
    if (m.study_topics) cfg.studyTopics = coerce(m.study_topics, cfg.studyTopics);
    if (m.custom_splits) cfg.customSplits = coerce(m.custom_splits, cfg.customSplits);
    if (m.split_names) cfg.splitNames = coerce(m.split_names, cfg.splitNames);
    if (m.currency) cfg.currency = str(m.currency);
    if (m.monthly_budget != null) cfg.monthlyBudget = num(m.monthly_budget);
    if (m.expense_categories) cfg.expenseCategories = coerce(m.expense_categories, cfg.expenseCategories);
    if (m.income_categories) cfg.incomeCategories = coerce(m.income_categories, cfg.incomeCategories);
    if (m.custom_pages) cfg.customPages = coerce(m.custom_pages, cfg.customPages);
    return cfg;
  }

  async saveConfig(cfg) {
    const meta = {
      type: "config",
      calorie_target: cfg.calorieTarget, protein_target: cfg.proteinTarget,
      carbs_target: cfg.carbsTarget, water_target: cfg.waterTarget,
      task_columns: cfg.taskColumns, task_column_names: cfg.taskColumnNames,
      study_columns: cfg.studyColumns, study_column_names: cfg.studyColumnNames,
      study_topics: cfg.studyTopics, custom_splits: cfg.customSplits, split_names: cfg.splitNames,
      currency: cfg.currency, monthly_budget: cfg.monthlyBudget,
      expense_categories: cfg.expenseCategories, income_categories: cfg.incomeCategories,
      custom_pages: cfg.customPages || [],
      modified: new Date().toISOString(),
    };
    await this.writeRel("Config/settings.md", this.buildDoc(meta, "# Personal Assistant Config\n"));
  }

  // ============================================================
  // BOARDS
  // ============================================================
  /**
   * Task boards are the folders under Tasks/ (mirrors the plugin: folder = source of truth,
   * no boards.md). "My Tasks" always exists and is pinned first. Studies still uses boards.md.
   */
  async loadBoards() {
    const base = this.full("Tasks");
    const names = new Set(["My Tasks"]);
    let entries = [];
    try { entries = await fs.readdir(base, { withFileTypes: true }); } catch { /* no Tasks dir yet */ }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== "Lists" && e.name !== "_orphaned") names.add(e.name);
    }
    const sorted = [...names].sort((a, b) => a === "My Tasks" ? -1 : b === "My Tasks" ? 1 : a.localeCompare(b));
    return sorted.map((name) => ({ id: safeName(name), name, emoji: "" }));
  }
  async loadStudyBoards() { return this._boardsFrom("Studies/boards.md"); }
  async _boardsFrom(rel) {
    const raw = await this.readRaw(rel);
    if (!raw) return [];
    const list = coerce(this.parse(raw).fm.boards, []);
    return list.map((b) => ({ id: str(b.id), name: str(b.name), emoji: b.emoji ? str(b.emoji) : "" })).filter((b) => b.id || b.name);
  }

  /** The board a task is filed under, defaulting unassigned tasks to My Tasks. */
  boardOrDefault(board) { return board && board !== "No board" ? board : "My Tasks"; }
  /** Vault-relative folder that holds a board's task notes. */
  taskBoardFolder(board) { return `Tasks/${safeName(this.boardOrDefault(board))}`; }
  async ensureBoardFolder(name) { await fs.mkdir(this.full(this.taskBoardFolder(name)), { recursive: true }); }
  /** Create a board = create its folder. Returns false for an invalid/reserved name. */
  async createBoard(name) {
    const clean = safeName((name || "").trim());
    if (!clean || clean === "Lists" || clean === "untitled") return false;
    await this.ensureBoardFolder(clean);
    return true;
  }
  /** Ensure a board's folder exists; returns the resolved board name (default My Tasks). */
  async ensureBoard(name) {
    const board = this.boardOrDefault((name || "").trim());
    await this.ensureBoardFolder(board);
    return board;
  }

  // ============================================================
  // TASKS
  // ============================================================
  async loadTasks() {
    const tasksRoot = this.full("Tasks");
    const listsPrefix = this.full("Tasks/Lists") + path.sep;
    const orphanPrefix = this.full("Tasks/_orphaned") + path.sep;
    const files = (await this.listMarkdown("Tasks")).filter((abs) =>
      path.basename(abs) !== "boards.md" && path.basename(abs) !== "recurring.md" &&
      !abs.startsWith(listsPrefix) && !abs.startsWith(orphanPrefix));
    const tasks = [];
    for (const abs of files) {
      const m = await this.fmOf(abs);
      // Board = parent folder under Tasks/ (folder = source of truth); kanban_name is only
      // a fallback for a note still loose at the Tasks/ root.
      const dir = path.dirname(abs);
      const parentName = path.basename(dir);
      const inBoardFolder = dir !== tasksRoot && dir.startsWith(tasksRoot + path.sep) &&
        parentName !== "Lists" && parentName !== "_orphaned";
      const boardName = inBoardFolder ? parentName : str(m.kanban_name || m["kanban-name"]);
      tasks.push({
        id: str(m.task_id) || this.basename(abs),
        title: str(m.title) || this.basename(abs),
        status: str(m.status) || "backlog",
        priority: str(m.priority) || "medium",
        cat: str(m.category) || "work",
        group: str(m.group),
        kanbanName: boardName,
        due: str(m.due),
        created: str(m.created),
        modified: str(m.modified),
        order: (m.order !== undefined && m.order !== null) ? Number(m.order) : undefined,
        eisenhower: str(m.eisenhower),
        googleId: str(m.google_id),
        googleList: str(m.google_list),
        path: abs,
      });
    }
    return tasks;
  }

  async createTask(t) {
    const cfg = await this.loadConfig();
    const cols = cfg.taskColumns;
    // Validate the column; fall back to the first column if invalid (prevents "status: todo" messes).
    let status = t.status && cols.includes(t.status) ? t.status : cols[0];
    // Board = folder (default My Tasks); ensure the folder exists so the task is filed there.
    const board = await this.ensureBoard(t.board);
    const title = (t.title || "Untitled").trim() || "Untitled";
    const meta = {
      task_id: cryptoId(), title, status, priority: t.priority || "medium",
      created: new Date().toISOString(), modified: new Date().toISOString(),
      type: "task", kanban_name: board, group: t.group || "",
    };
    if (t.due) meta.due = t.due;
    if (t.eisenhower) meta.eisenhower = t.eisenhower;
    const rel = await this.uniqueRel(this.taskBoardFolder(board), title);
    await this.writeRel(rel, this.buildDoc(meta, `# ${title}\n`));
    await this.syncTaskLists();
    return { path: this.full(rel), title, board, status };
  }

  async updateTask(idOrPath, changes) {
    const target = await this._findTask(idOrPath);
    if (!target) throw new Error(`Task not found: ${idOrPath}`);
    const cfg = await this.loadConfig();
    const raw = await fs.readFile(target.path, "utf8");
    const { fm, body } = this.parse(raw);
    if (changes.status !== undefined) fm.status = cfg.taskColumns.includes(changes.status) ? changes.status : cfg.taskColumns[0];
    if (changes.priority !== undefined) fm.priority = changes.priority;
    if (changes.title !== undefined) fm.title = changes.title;
    if (changes.board !== undefined) fm.kanban_name = this.boardOrDefault(changes.board);
    if (changes.group !== undefined) fm.group = changes.group;
    if (changes.due !== undefined) fm.due = changes.due;
    if (changes.eisenhower !== undefined) fm.eisenhower = changes.eisenhower;
    fm.modified = new Date().toISOString();
    await fs.writeFile(target.path, this.buildDoc(fm, body), "utf8");
    // Board changed → move the note into the new board's folder (folder = source of truth).
    let finalPath = target.path;
    if (changes.board !== undefined) {
      const board = this.boardOrDefault(changes.board);
      await this.ensureBoardFolder(board);
      const targetDir = this.full(this.taskBoardFolder(board));
      if (path.dirname(target.path) !== targetDir) {
        let dest = path.join(targetDir, path.basename(target.path));
        let n = 2;
        while (await this._absExists(dest)) { dest = path.join(targetDir, `${this.basename(target.path)} ${n}.md`); n++; }
        await fs.rename(target.path, dest);
        finalPath = dest;
      }
    }
    await this.syncTaskLists();
    return { path: finalPath, ...changes };
  }

  async _absExists(abs) { try { await fs.access(abs); return true; } catch { return false; } }

  async completeTask(idOrPath) {
    const cfg = await this.loadConfig();
    const doneCol = cfg.taskColumns.includes("done") ? "done" : cfg.taskColumns[cfg.taskColumns.length - 1];
    return this.updateTask(idOrPath, { status: doneCol });
  }

  async deleteTask(idOrPath) {
    const target = await this._findTask(idOrPath);
    if (!target) throw new Error(`Task not found: ${idOrPath}`);
    await this.removeAbs(target.path);
    await this.syncTaskLists();
    return { deleted: target.title };
  }

  async _findTask(idOrPath) {
    const tasks = await this.loadTasks();
    return tasks.find((t) => t.id === idOrPath || t.path === idOrPath || t.title === idOrPath) || null;
  }

  /** Regenerate the flat Tasks/Lists/<board>.md mirrors (mirrors data.ts syncTaskLists). */
  async syncTaskLists() {
    const cfg = await this.loadConfig();
    const cols = cfg.taskColumns;
    const names = cfg.taskColumnNames;
    const colSet = new Set(cols);
    const doneCol = cols.includes("done") ? "done" : cols[cols.length - 1];
    const tasks = await this.loadTasks();
    const boards = await this.loadBoards();
    const eff = (t) => (colSet.has(t.status) ? t.status : cols[0]);
    const ord = (t) => (t.order ?? 1e9);
    const groupOf = (t) => t.kanbanName || "No board";

    const groups = [...boards.map((b) => b.name), "No board"];
    const wanted = new Set();
    for (const g of groups) {
      const gTasks = tasks.filter((t) => groupOf(t) === g);
      if (g === "No board" && !gTasks.length) continue;
      const rel = `Tasks/Lists/${safeName(g)}.md`;
      wanted.add(this.full(rel));
      let body = `%% Momentum Life — task list for board "${g}". Toggle a checkbox to mark it done/undone in the board. %%\n`;
      for (const col of cols) {
        const colTasks = gTasks.filter((t) => eff(t) === col)
          .sort((a, b) => ord(a) - ord(b) || (a.created || "").localeCompare(b.created || "") || a.title.localeCompare(b.title));
        if (!colTasks.length) continue;
        body += `\n## ${names[col] || col}\n`;
        for (const t of colTasks) body += `- [${col === doneCol ? "x" : " "}] ${t.title}\n`;
      }
      await this.writeIfChanged(rel, body);
    }
    // Remove mirror files for boards that no longer exist.
    const listFiles = await this.listMarkdown("Tasks/Lists");
    for (const abs of listFiles) { if (!wanted.has(abs)) await this.removeAbs(abs); }
  }

  // ============================================================
  // GENERIC MONTH HUB
  // ============================================================
  async syncMonthHub(cfg, monthKey) {
    const items = (await cfg.loadItems()).filter((it) => monthKeyOf(it.date) === monthKey);
    const rel = `${cfg.hubFolder}/${monthHubTitle(cfg.module, monthKey)}.md`;
    if (!items.length) { if (await this.exists(rel)) await this.removeAbs(this.full(rel)); return "removed"; }
    const body = await cfg.summaryBody(items, monthKey);
    const content = this.buildDoc({ type: `${cfg.module.toLowerCase()}-month-hub`, month: monthKey, generated: new Date().toISOString() }, body);
    const cur = await this.readRaw(rel);
    if (cur != null && this.bodyOf(cur) === this.bodyOf(content)) return "unchanged";
    await this.writeRel(rel, content);
    return "written";
  }

  // ============================================================
  // FINANCE
  // ============================================================
  async loadTransactions() {
    const files = await this.listMarkdown("Finance/Transactions");
    const out = [];
    for (const abs of files) {
      const m = await this.fmOf(abs);
      const t = {
        id: str(m.id) || this.basename(abs),
        date: str(m.date).slice(0, 10),
        type: str(m.tx_type) || "expense",
        amount: num(m.amount),
        category: str(m.category) || "Other",
        note: str(m.note),
        path: abs,
      };
      if (t.date) out.push(t);
    }
    return out;
  }

  _financeCfg() {
    return {
      folder: "Finance/Transactions", hubFolder: "Finance/Months", module: "Finance",
      loadItems: () => this.loadTransactions(),
      summaryBody: async (items, monthKey) => {
        const cur = (await this.loadConfig()).currency || "$";
        const money = (n) => `${cur}${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || financeTxTitle(a).localeCompare(financeTxTitle(b)));
        const income = sorted.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
        const expense = sorted.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
        const year = monthKey.slice(0, 4);
        let body = `# ${monthName(monthKey)} ${year}\n\n`;
        body += `**Income:** ${money(income)}\n**Expenses:** ${money(expense)}\n**Balance:** ${money(income - expense)}\n\n## Transactions\n\n`;
        for (const t of sorted) body += `- [[${financeTxTitle(t)}]] — ${t.type === "income" ? "+" : "-"}${money(t.amount)}\n`;
        return body;
      },
    };
  }

  async addTransaction({ type, amount, category, note, date }) {
    const tx_type = type === "income" ? "income" : "expense";
    const cat = category || "Other";
    const d = (date || todayLocal()).slice(0, 10);
    const meta = {
      id: Date.now(), type: "transaction", tx_type, date: d,
      amount: num(amount), category: cat, note: note || "", logged: new Date().toISOString(),
    };
    const monthKey = monthKeyOf(d);
    const sign = tx_type === "income" ? "+" : "-";
    const baseBody = `# ${cat} ${sign}${formatAmount(num(amount))}\n\n${note || ""}\n`;
    const body = mergeBody(baseBody, `[[${monthHubTitle("Finance", monthKey)}]]`);
    const rel = await this.uniqueRel("Finance/Transactions", financeTxTitle({ category: cat, note, amount: num(amount), date: d }));
    await this.writeRel(rel, this.buildDoc(meta, body));
    await this.syncMonthHub(this._financeCfg(), monthKey);
    return { path: this.full(rel), month: monthKey };
  }

  async deleteTransaction(idOrPath) {
    const list = await this.loadTransactions();
    const t = list.find((x) => x.id === idOrPath || x.path === idOrPath);
    if (!t) throw new Error(`Transaction not found: ${idOrPath}`);
    await this.removeAbs(t.path);
    await this.syncMonthHub(this._financeCfg(), monthKeyOf(t.date));
    return { deleted: t.id };
  }

  async monthSummary(monthKey) {
    const txs = (await this.loadTransactions()).filter((t) => t.date.startsWith(monthKey));
    const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { month: monthKey, income, expenses: expense, balance: income - expense, count: txs.length };
  }

  async loadRecurring() {
    const raw = await this.readRaw("Finance/recurring.md");
    if (!raw) return [];
    const list = coerce(this.parse(raw).fm.items, []);
    return list.map((r) => ({
      id: str(r.id) || ("r" + Math.random().toString(36).slice(2, 8)),
      type: str(r.type) === "income" ? "income" : "expense",
      category: str(r.category) || "Other", amount: num(r.amount), note: str(r.note),
      freq: str(r.freq) === "weekly" ? "weekly" : "monthly",
      day: r.day != null ? num(r.day) : undefined, weekday: r.weekday != null ? num(r.weekday) : undefined,
    })).filter((r) => r.amount > 0);
  }

  async saveRecurring(items) {
    const cur = (await this.loadConfig()).currency || "$";
    const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const desc = (r) => {
      const when = r.freq === "weekly" ? `weekly (${WEEKDAYS[r.weekday ?? 1] || "Monday"})` : `monthly (day ${r.day ?? 1})`;
      const sign = r.type === "income" ? "+" : "-";
      const note = r.note ? ` — ${r.note}` : "";
      return `- **${r.category}** — ${sign}${cur}${r.amount} · ${when}${note}`;
    };
    const income = items.filter((r) => r.type === "income");
    const expense = items.filter((r) => r.type !== "income");
    let body = "# Recurring costs\n\n";
    if (expense.length) body += "## Expenses\n" + expense.map(desc).join("\n") + "\n\n";
    if (income.length) body += "## Income\n" + income.map(desc).join("\n") + "\n\n";
    if (!items.length) body += "_No recurring items yet._\n";
    await this.writeRel("Finance/recurring.md", this.buildDoc({ type: "recurring-config", items }, body));
  }

  async addRecurring(item) {
    const items = await this.loadRecurring();
    items.push({ id: "r" + Date.now(), type: item.type === "income" ? "income" : "expense", category: item.category || "Other", amount: num(item.amount), note: item.note || "", freq: item.freq === "weekly" ? "weekly" : "monthly", day: item.day, weekday: item.weekday });
    await this.saveRecurring(items);
    return { count: items.length };
  }

  // ============================================================
  // NUTRITION
  // ============================================================
  async loadMeals() {
    const files = await this.listMarkdown("Nutrition/Plan");
    const out = [];
    for (const abs of files) {
      const m = await this.fmOf(abs);
      out.push({ id: str(m.id) || this.basename(abs), name: str(m.name) || this.basename(abs), emoji: str(m.emoji), totalCal: num(m.total_cal), items: coerce(m.items, []), path: abs });
    }
    return out;
  }

  async loadMealLogs() {
    const files = await this.listMarkdown("Nutrition/Logs");
    const out = [];
    for (const abs of files) {
      const m = await this.fmOf(abs);
      const l = { id: str(m.id) || this.basename(abs), date: str(m.date).slice(0, 10), mealId: str(m.meal), mealName: str(m.meal_name), totalCal: num(m.calories), totalProtein: num(m.protein), totalCarbs: num(m.carbs), items: coerce(m.items, []), path: abs };
      if (l.date) out.push(l);
    }
    return out;
  }

  _nutritionCfg() {
    return {
      folder: "Nutrition/Logs", hubFolder: "Nutrition/Months", module: "Nutrition",
      loadItems: () => this.loadMealLogs(),
      summaryBody: async (items, monthKey) => {
        const basename = (l) => path.basename(l.path, ".md");
        const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || basename(a).localeCompare(basename(b)));
        const totalCal = sorted.reduce((s, l) => s + (Number(l.totalCal) || 0), 0);
        const totalProtein = sorted.reduce((s, l) => s + (Number(l.totalProtein) || 0), 0);
        const totalCarbs = sorted.reduce((s, l) => s + (Number(l.totalCarbs) || 0), 0);
        const daysLogged = new Set(sorted.map((l) => l.date)).size;
        const avg = daysLogged ? totalCal / daysLogged : 0;
        const int = (n) => Math.round(n).toString();
        const grams = (n) => `${(Math.round(n * 10) / 10).toFixed(1)}g`;
        let body = `# Nutrition — ${monthName(monthKey)} ${monthKey.slice(0, 4)}\n\n`;
        body += `**Total calories:** ${int(totalCal)} cal\n**Avg per day:** ${int(avg)} cal\n**Days logged:** ${daysLogged}\n**Total protein:** ${grams(totalProtein)}\n**Total carbs:** ${grams(totalCarbs)}\n\n## Logs\n\n`;
        for (const l of sorted) body += `- [[${basename(l)}]]\n`;
        return body;
      },
    };
  }

  async logMeal({ mealName, items = [], date }) {
    const d = (date || todayLocal()).slice(0, 10);
    const totalCal = items.reduce((s, it) => s + (Number(it.cal) || 0), 0);
    const totalProtein = items.reduce((s, it) => s + (Number(it.protein) || 0), 0);
    const totalCarbs = items.reduce((s, it) => s + (Number(it.carbs) || 0), 0);
    const name = (mealName || "Meal").trim() || "Meal";
    const meta = { id: Date.now(), type: "meal-log", date: d, meal: name, meal_name: name, calories: totalCal, protein: totalProtein, carbs: totalCarbs, items, logged: new Date().toISOString() };
    const monthKey = monthKeyOf(d);
    let baseBody = `# ${name} - ${d}\n\n`;
    items.forEach((it) => { baseBody += `- ${it.name}: ${it.qty ?? ""}${it.unit ?? ""} (${it.cal ?? 0} cal)\n`; });
    baseBody += `\nTotal: ${totalCal} cal\n`;
    const body = mergeBody(baseBody, `[[${monthHubTitle("Nutrition", monthKey)}]]`);
    const rel = await this.uniqueRel("Nutrition/Logs", mealLogTitle({ mealName: name, kcal: totalCal, date: d }));
    await this.writeRel(rel, this.buildDoc(meta, body));
    await this.syncMonthHub(this._nutritionCfg(), monthKey);
    return { path: this.full(rel), month: monthKey, totalCal };
  }

  async deleteMealLog(idOrPath) {
    const list = await this.loadMealLogs();
    const l = list.find((x) => x.id === idOrPath || x.path === idOrPath);
    if (!l) throw new Error(`Meal log not found: ${idOrPath}`);
    await this.removeAbs(l.path);
    await this.syncMonthHub(this._nutritionCfg(), monthKeyOf(l.date));
    return { deleted: l.id };
  }

  async loadWater() {
    const raw = await this.readRaw("Nutrition/water.md");
    if (!raw) return {};
    return coerce(this.parse(raw).fm.log, {});
  }
  async addWater(date, deltaLiters) {
    const d = (date || todayLocal()).slice(0, 10);
    const log = await this.loadWater();
    log[d] = Math.max(0, Math.round(((log[d] || 0) + num(deltaLiters)) * 100) / 100);
    await this.writeRel("Nutrition/water.md", this.buildDoc({ type: "water-log", log, modified: new Date().toISOString() }, "# Water log\n"));
    return { date: d, liters: log[d] };
  }

  // ============================================================
  // FITNESS
  // ============================================================
  async loadSplits() {
    const raw = await this.readRaw("Fitness/splits.md");
    if (!raw) return [];
    const list = coerce(this.parse(raw).fm.splits, []);
    return list.map((s) => ({ id: str(s.id), name: str(s.name) })).filter((s) => s.id);
  }
  async loadExercises() {
    const files = await this.listMarkdown("Fitness/Exercises");
    const out = [];
    for (const abs of files) {
      const m = await this.fmOf(abs);
      out.push({ name: str(m.name) || this.basename(abs), split: str(m.split) || "A", type: str(m.equipment) || "machine", muscle: str(m.muscle), sets: str(m.sets) || "3x10", weight: num(m.weight), howto: str(m.howto), path: abs });
    }
    return out;
  }
  async loadWorkouts() {
    const files = await this.listMarkdown("Fitness/Workouts");
    const out = [];
    for (const abs of files) {
      const m = await this.fmOf(abs);
      const w = { id: str(m.id) || this.basename(abs), date: str(m.date).slice(0, 10), split: str(m.split) || "A", duration: num(m.duration), exercises: coerce(m.exercises, []), path: abs };
      if (w.date) out.push(w);
    }
    return out;
  }
  async resolveSplitName(splitId, cfg) {
    cfg = cfg || await this.loadConfig();
    const configured = (cfg.splitNames && cfg.splitNames[splitId] || "").trim();
    if (configured) return configured;
    const custom = (cfg.customSplits || []).find((s) => s.id === splitId);
    if (custom && (custom.name || "").trim()) return custom.name.trim();
    const listed = (await this.loadSplits()).find((s) => s.id === splitId);
    if (listed && (listed.name || "").trim()) return listed.name.trim();
    return splitId;
  }
  _fitnessCfg() {
    return {
      folder: "Fitness/Workouts", hubFolder: "Fitness/Months", module: "Fitness",
      loadItems: () => this.loadWorkouts(),
      summaryBody: async (items, monthKey) => {
        const cfg = await this.loadConfig();
        const basename = (w) => path.basename(w.path, ".md");
        const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || basename(a).localeCompare(basename(b)));
        const totalMinutes = sorted.reduce((s, w) => s + (Number(w.duration) || 0), 0);
        const bySplit = new Map();
        for (const w of sorted) { const acc = bySplit.get(w.split) || { count: 0, minutes: 0 }; acc.count += 1; acc.minutes += Number(w.duration) || 0; bySplit.set(w.split, acc); }
        const rows = [];
        for (const [splitId, agg] of bySplit) rows.push({ name: await this.resolveSplitName(splitId, cfg), splitId, ...agg });
        rows.sort((a, b) => a.name.localeCompare(b.name) || a.splitId.localeCompare(b.splitId));
        const int = (n) => Math.round(n).toString();
        let body = `# Fitness — ${monthName(monthKey)} ${monthKey.slice(0, 4)}\n\n`;
        body += `**Workouts:** ${sorted.length}\n**Total minutes:** ${int(totalMinutes)} min\n\n## By split\n\n`;
        for (const r of rows) body += `- ${r.name}: ${r.count} workout${r.count === 1 ? "" : "s"}, ${int(r.minutes)} min\n`;
        body += `\n## Sessions\n\n`;
        for (const w of sorted) body += `- [[${basename(w)}]]\n`;
        return body;
      },
    };
  }
  async logWorkout({ split, duration, date, exercises = [] }) {
    const cfg = await this.loadConfig();
    const splitId = split || "A";
    const splitName = await this.resolveSplitName(splitId, cfg);
    const d = (date || todayLocal()).slice(0, 10);
    const meta = { id: Date.now(), type: "workout-log", date: d, split: splitId, duration: num(duration), exercises, logged: new Date().toISOString() };
    const monthKey = monthKeyOf(d);
    let baseBody = `# ${splitName} - ${d}\n\n`;
    exercises.forEach((e) => { baseBody += `- ${e.exercise}: ${e.weight ?? ""}kg x ${e.sets ?? ""}${e.feel ? ` (${e.feel})` : ""}\n`; });
    const body = mergeBody(baseBody, `[[${monthHubTitle("Fitness", monthKey)}]]`);
    const rel = await this.uniqueRel("Fitness/Workouts", workoutTitle({ splitName, minutes: num(duration), date: d }));
    await this.writeRel(rel, this.buildDoc(meta, body));
    await this.syncMonthHub(this._fitnessCfg(), monthKey);
    return { path: this.full(rel), month: monthKey };
  }
  async deleteWorkout(idOrPath) {
    const list = await this.loadWorkouts();
    const w = list.find((x) => x.id === idOrPath || x.path === idOrPath);
    if (!w) throw new Error(`Workout not found: ${idOrPath}`);
    await this.removeAbs(w.path);
    await this.syncMonthHub(this._fitnessCfg(), monthKeyOf(w.date));
    return { deleted: w.id };
  }

  // ============================================================
  // HABITS
  // ============================================================
  async loadHabits() {
    const files = await this.listMarkdown("Habits");
    const out = [];
    for (const abs of files) {
      const m = await this.fmOf(abs);
      out.push({ id: str(m.id) || this.basename(abs), name: str(m.name) || this.basename(abs), emoji: str(m.emoji) || "⭐", habitType: str(m.habit_type) || "do", log: coerce(m.log, {}), created: str(m.created), lastReset: str(m.lastReset), path: abs });
    }
    return out;
  }
  async saveHabit({ name, emoji, habitType }) {
    const n = (name || "").trim();
    if (!n) throw new Error("Habit name required");
    const meta = { id: "h" + Date.now(), type: "habit", habit_type: habitType || "do", name: n, emoji: emoji || "⭐", log: {}, created: todayLocal(), lastReset: todayLocal(), modified: new Date().toISOString() };
    await this.writeRel(`Habits/${safeName(n)}.md`, this.buildDoc(meta, `# ${n}\n`));
    return { name: n };
  }
  async toggleHabit(idOrName, date) {
    const d = (date || todayLocal()).slice(0, 10);
    const list = await this.loadHabits();
    const h = list.find((x) => x.id === idOrName || x.name === idOrName || x.path === idOrName);
    if (!h) throw new Error(`Habit not found: ${idOrName}`);
    const raw = await fs.readFile(h.path, "utf8");
    const { fm, body } = this.parse(raw);
    const log = coerce(fm.log, {});
    if (log[d]) delete log[d]; else log[d] = true;
    fm.log = log; fm.modified = new Date().toISOString();
    await fs.writeFile(h.path, this.buildDoc(fm, body), "utf8");
    return { habit: h.name, date: d, done: !!log[d] };
  }

  // ============================================================
  // STUDIES
  // ============================================================
  async loadStudyCards() {
    const files = (await this.listMarkdown("Studies")).filter((abs) => path.basename(abs) !== "boards.md");
    const out = [];
    for (const abs of files) {
      const m = await this.fmOf(abs);
      out.push({ id: str(m.id) || this.basename(abs), title: str(m.title) || this.basename(abs), topic: str(m.topic), subtopic: str(m.subtopic), status: str(m.status) || "backlog", url: str(m.url), date: str(m.date), path: abs });
    }
    return out;
  }
  async createStudyCard({ title, topic, subtopic, status, url }) {
    const t = (title || "").trim();
    const tp = (topic || "").trim();
    if (!t || !tp) throw new Error("Study card requires title and topic");
    const cfg = await this.loadConfig();
    const st = status && cfg.studyColumns.includes(status) ? status : cfg.studyColumns[0];
    const meta = { id: cryptoId(), title: t, topic: tp, subtopic: subtopic || "", status: st, url: url || "", date: todayLocal(), created: new Date().toISOString(), modified: new Date().toISOString(), type: "study" };
    const rel = await this.uniqueRel(`Studies/${tp}`, t);
    await this.writeRel(rel, this.buildDoc(meta, `# ${t}\n`));
    return { path: this.full(rel), topic: tp };
  }

  // ============================================================
  // NOTES
  // ============================================================
  async loadNotes() {
    const files = await this.listMarkdown("Notes");
    const out = [];
    for (const abs of files) {
      const m = await this.fmOf(abs);
      out.push({ id: this.basename(abs), title: str(m.title) || this.basename(abs), color: str(m.color) || "yellow", board: str(m.board), date: str(m.date), path: abs });
    }
    return out;
  }
  async saveNote({ title, content, color, board }) {
    const t = (title || "").trim();
    if (!t) throw new Error("Note title required");
    const meta = { title: t, color: color || "yellow", date: todayLocal(), type: "note" };
    if (board) meta.board = board;
    await this.writeRel(`Notes/${safeName(t)}.md`, this.buildDoc(meta, content || ""));
    return { title: t };
  }

  // ============================================================
  // RECURRING TASKS (read-only listing for now)
  // ============================================================
  async loadRecurringTasks() {
    const raw = await this.readRaw("Tasks/recurring.md");
    if (!raw) return [];
    const list = coerce(this.parse(raw).fm.items, []);
    return list.map((r) => ({ id: str(r.id), title: str(r.title), board: str(r.board), priority: str(r.priority) || "medium", freq: str(r.freq) || "weekly", weekday: r.weekday, interval: r.interval, day: r.day })).filter((r) => r.title);
  }
}
