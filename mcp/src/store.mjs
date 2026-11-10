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
  computePace, deriveWorkoutKind, totalCardioDistance,
} from "./naming.mjs";

const DEFAULT_TASK_COLUMNS = ["backlog", "in progress", "done"];
const DEFAULT_TASK_COLUMN_NAMES = { backlog: "📌 BACKLOG", "in progress": "🔄 IN PROGRESS", done: "✅ DONE" };

/** Normalize a column label for tolerant matching: lowercase, hyphens/underscores → space, collapse spaces. */
export function normCol(s) {
  return String(s || "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}
/**
 * Resolve a requested status to a REAL column name, tolerant to hyphen/underscore/case/spacing
 * variants ("in-progress" → "in progress"). Returns the canonical column, or null if unknown.
 */
export function resolveColumn(requested, cols) {
  if (!requested) return null;
  const want = normCol(requested);
  return cols.find((c) => normCol(c) === want) ?? null;
}

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

// ---- Monthly ledger: pure serializers + table renderers (MIRROR src/loaders.ts exactly) ----
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthLabel(mk) { const m = /^(\d{4})-(\d{2})$/.exec(mk || ""); if (!m) return mk || ""; return `${MONTH_NAMES[parseInt(m[2], 10) - 1] ?? m[2]} ${m[1]}`; }
function cell(v) { return str(v).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim(); }
function money(n, cur) { return `${cur}${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function sortEntriesByDateId(entries) { return [...entries].sort((a, b) => str(a.date).localeCompare(str(b.date)) || str(a.id).localeCompare(str(b.id))); }
function mergeEntriesById(existing, incoming) { const seen = new Set(existing.map((e) => str(e.id))); const merged = [...existing]; let added = 0; for (const e of incoming) { const id = str(e.id); if (seen.has(id)) continue; seen.add(id); merged.push(e); added++; } return { merged, added }; }

function txToEntry(t) { return { id: t.id, tx_type: t.type, date: t.date, amount: t.amount, category: t.category, note: t.note || "" }; }
function entryToTransaction(e, p) { return { id: str(e.id), date: str(e.date).slice(0, 10), type: str(e.tx_type) || "expense", amount: num(e.amount), category: str(e.category) || "Other", note: str(e.note), path: p }; }
function mealLogToEntry(l) { return { id: l.id, date: l.date, meal: l.mealId, meal_name: l.mealName, calories: l.totalCal, protein: l.totalProtein, carbs: l.totalCarbs, items: l.items }; }
function entryToMealLog(e, p) { return { id: str(e.id), date: str(e.date).slice(0, 10), mealId: str(e.meal), mealName: str(e.meal_name), totalCal: num(e.calories), totalProtein: num(e.protein), totalCarbs: num(e.carbs), items: coerce(e.items, []), path: p }; }
function workoutToEntry(w) { return { id: w.id, date: w.date, split: w.split, duration: w.duration, exercises: w.exercises, kind: w.kind }; }
function entryToWorkout(e, p) { const ex = coerce(e.exercises, []); const sk = str(e.kind); const kind = ["strength", "cardio", "mixed", "empty"].includes(sk) ? sk : deriveWorkoutKind(ex); return { id: str(e.id), date: str(e.date).slice(0, 10), split: str(e.split) || "A", duration: num(e.duration), exercises: ex, path: p, kind }; }

function renderFinanceTable(items, cur, mk) {
  const sorted = sortEntriesByDateId(items);
  const income = sorted.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = sorted.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  let b = `# Finance — ${monthLabel(mk)}\n\n`;
  b += `**Income:** ${money(income, cur)} · **Expenses:** ${money(expense, cur)} · **Balance:** ${money(income - expense, cur)}\n\n`;
  b += `| Date | Type | Category | Amount | Note |\n|------|------|----------|-------:|------|\n`;
  for (const t of sorted) { const sign = t.type === "income" ? "+" : "−"; b += `| ${cell(t.date)} | ${cell(t.type)} | ${cell(t.category)} | ${sign}${money(t.amount, cur)} | ${cell(t.note)} |\n`; }
  return b;
}
function renderNutritionTable(items, mk, label) {
  const sorted = sortEntriesByDateId(items);
  const totalCal = sorted.reduce((s, l) => s + l.totalCal, 0);
  const days = new Set(sorted.map((l) => l.date)).size;
  let b = `# Nutrition — ${monthLabel(mk)}\n\n`;
  b += `**Total:** ${totalCal} cal · **Logs:** ${sorted.length} · **Days:** ${days}\n\n`;
  b += `| Date | Meal | Cal | Protein | Carbs |\n|------|------|----:|--------:|------:|\n`;
  for (const l of sorted) b += `| ${cell(l.date)} | ${cell(label(l.mealId))} | ${l.totalCal} | ${l.totalProtein} | ${l.totalCarbs} |\n`;
  return b;
}
function renderFitnessTable(items, mk, label) {
  const sorted = sortEntriesByDateId(items);
  const totalMin = sorted.reduce((s, w) => s + w.duration, 0);
  const days = new Set(sorted.map((w) => w.date)).size;
  let b = `# Fitness — ${monthLabel(mk)}\n\n`;
  b += `**Sessions:** ${sorted.length} · **Minutes:** ${totalMin} · **Days:** ${days}\n\n`;
  b += `| Date | Split | Min | Kind | Exercises |\n|------|-------|----:|------|-----------|\n`;
  for (const w of sorted) { const exs = (w.exercises || []).map((e) => e.exercise).filter(Boolean).join(", "); b += `| ${cell(w.date)} | ${cell(label(w.split))} | ${w.duration} | ${cell(w.kind)} | ${cell(exs)} |\n`; }
  return b;
}
function cryptoId() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* noop */ }
  return "t" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

// --- Board-note model (hand-mirrored from src/loaders.ts — the MCP has no build step and can't
// import from src/*.ts). Keep these in lockstep with the plugin so both serialise identically. ---
function taskDomainToEntry(t) {
  const e = { task_id: t.id, title: t.title, status: t.status, priority: t.priority };
  if (t.cat) e.category = t.cat;
  if (t.group) e.group = t.group;
  if (t.due) e.due = t.due;
  if (t.scheduled) e.scheduled = t.scheduled;
  if (t.eisenhower) e.eisenhower = t.eisenhower;
  if (t.order !== undefined && t.order !== null) e.order = t.order;
  if (t.googleId) e.google_id = t.googleId;
  if (t.googleList) e.google_list = t.googleList;
  if (t.created) e.created = t.created;
  if (t.modified) e.modified = t.modified;
  if (t.kanbanId) e["kanban-id"] = t.kanbanId;
  if (t.duration) e.duration = t.duration;
  if (t.isAllDay) e.is_all_day = t.isAllDay;
  return e;
}
function taskEntryToDomain(e, notePath, board) {
  return {
    id: str(e.task_id) || str(e.id),
    title: str(e.title),
    status: str(e.status) || "backlog",
    priority: str(e.priority) || "medium",
    cat: str(e.category) || "work",
    group: str(e.group),
    kanbanId: str(e["kanban-id"]),
    kanbanName: board,
    due: str(e.due),
    scheduled: str(e.scheduled),
    duration: num(e.duration),
    isAllDay: !!e.is_all_day,
    created: str(e.created),
    modified: str(e.modified),
    order: (e.order !== undefined && e.order !== null) ? Number(e.order) : undefined,
    eisenhower: str(e.eisenhower),
    googleId: str(e.google_id),
    googleList: str(e.google_list),
    path: notePath,
  };
}
function sortTaskEntries(entries) {
  const ord = (e) => (e.order !== undefined && e.order !== null ? Number(e.order) : Number.POSITIVE_INFINITY);
  return entries.slice().sort((a, b) => (ord(a) - ord(b)) || str(a.task_id).localeCompare(str(b.task_id)));
}
function upsertTaskEntry(entries, entry) {
  const id = str(entry.task_id);
  const idx = entries.findIndex((e) => str(e.task_id) === id);
  const next = entries.slice();
  if (idx >= 0) next[idx] = { ...next[idx], ...entry }; else next.push(entry);
  return next;
}
function patchTaskEntry(entries, taskId, patch) {
  const idx = entries.findIndex((e) => str(e.task_id) === taskId);
  if (idx < 0) return entries;
  const next = entries.slice(); next[idx] = { ...next[idx], ...patch }; return next;
}
function removeTaskEntry(entries, taskId) { return entries.filter((e) => str(e.task_id) !== taskId); }
function renderBoardNoteBody(board, tasks, cols, colNames) {
  const doneCol = cols.includes("done") ? "done" : cols[cols.length - 1];
  const byCol = new Map();
  for (const t of tasks) { const k = t.status || cols[0] || "backlog"; const a = byCol.get(k); if (a) a.push(t); else byCol.set(k, [t]); }
  const sortCol = (a, b) => (((a.order ?? 0) - (b.order ?? 0)) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  let body = `# ${board}\n`;
  const emitted = new Set();
  const emit = (col) => {
    const arr = (byCol.get(col) || []).slice().sort(sortCol);
    if (!arr.length) return;
    body += `\n## ${colNames[col] || col}\n`;
    const box = col === doneCol ? "x" : " ";
    for (const t of arr) body += `- [${box}] ${t.title}\n`;
    emitted.add(col);
  };
  for (const c of cols) emit(c);
  for (const c of byCol.keys()) if (!emitted.has(c)) emit(c);
  return body;
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
      calorieTarget: 2000, proteinTarget: 120, carbsTarget: 200, waterTarget: 2.5, weightTarget: 0, unitSystem: "metric",
      taskColumns: DEFAULT_TASK_COLUMNS.slice(), taskColumnNames: { ...DEFAULT_TASK_COLUMN_NAMES },
      studyColumns: DEFAULT_TASK_COLUMNS.slice(), studyColumnNames: { ...DEFAULT_TASK_COLUMN_NAMES },
      studyTopics: [], customSplits: [], splitNames: {}, currency: "$", monthlyBudget: 0, startingBalance: 0,
      expenseCategories: DEFAULT_EXPENSE_CATEGORIES.slice(), incomeCategories: DEFAULT_INCOME_CATEGORIES.slice(),
      customPages: [], boardOrder: [],
    };
    const raw = await this.readRaw("Config/settings.md");
    if (!raw) return cfg;
    const m = this.parse(raw).fm;
    if (m.calorie_target) cfg.calorieTarget = num(m.calorie_target);
    if (m.protein_target) cfg.proteinTarget = num(m.protein_target);
    if (m.carbs_target) cfg.carbsTarget = num(m.carbs_target);
    if (m.water_target) cfg.waterTarget = num(m.water_target);
    if (m.weight_target != null) cfg.weightTarget = num(m.weight_target);
    if (m.unit_system) cfg.unitSystem = str(m.unit_system) === "imperial" ? "imperial" : "metric";
    if (m.task_columns) cfg.taskColumns = coerce(m.task_columns, cfg.taskColumns);
    if (m.task_column_names) cfg.taskColumnNames = coerce(m.task_column_names, cfg.taskColumnNames);
    if (m.study_columns) cfg.studyColumns = coerce(m.study_columns, cfg.studyColumns);
    if (m.study_column_names) cfg.studyColumnNames = coerce(m.study_column_names, cfg.studyColumnNames);
    if (m.study_topics) cfg.studyTopics = coerce(m.study_topics, cfg.studyTopics);
    if (m.custom_splits) cfg.customSplits = coerce(m.custom_splits, cfg.customSplits);
    if (m.split_names) cfg.splitNames = coerce(m.split_names, cfg.splitNames);
    if (m.currency) cfg.currency = str(m.currency);
    if (m.monthly_budget != null) cfg.monthlyBudget = num(m.monthly_budget);
    if (m.starting_balance != null) cfg.startingBalance = num(m.starting_balance);
    if (m.expense_categories) cfg.expenseCategories = coerce(m.expense_categories, cfg.expenseCategories);
    if (m.income_categories) cfg.incomeCategories = coerce(m.income_categories, cfg.incomeCategories);
    if (m.custom_pages) cfg.customPages = coerce(m.custom_pages, cfg.customPages);
    if (m.board_order) cfg.boardOrder = coerce(m.board_order, cfg.boardOrder);
    return cfg;
  }

  async saveConfig(cfg) {
    const meta = {
      type: "config",
      calorie_target: cfg.calorieTarget, protein_target: cfg.proteinTarget,
      carbs_target: cfg.carbsTarget, water_target: cfg.waterTarget, weight_target: cfg.weightTarget,
      unit_system: cfg.unitSystem,
      task_columns: cfg.taskColumns, task_column_names: cfg.taskColumnNames,
      study_columns: cfg.studyColumns, study_column_names: cfg.studyColumnNames,
      study_topics: cfg.studyTopics, custom_splits: cfg.customSplits, split_names: cfg.splitNames,
      currency: cfg.currency, monthly_budget: cfg.monthlyBudget, starting_balance: cfg.startingBalance,
      expense_categories: cfg.expenseCategories, income_categories: cfg.incomeCategories,
      custom_pages: cfg.customPages || [],
      board_order: cfg.boardOrder || [],
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
  // ---- Board-note mode (detected by PRESENCE of a Tasks/*.md tagged `task-board`, since the MCP
  // can't read the plugin's device flag in data.json). All board-note helpers mirror src/data.ts. --
  boardNoteRel(board) { return `Tasks/${safeName(this.boardOrDefault(board))}.md`; }
  // Since 0.9.2 board notes are the plugin's DEFAULT. Mode is decided from the vault itself:
  //  1. any board note (`type: task-board`) → board-note mode;
  //  2. else any per-task note still in the folder model → folder mode (an older plugin, or a
  //     vault the plugin hasn't consolidated yet — it will pick these notes up when it does);
  //  3. else (empty / brand-new vault) → board-note mode, matching the plugin default. Writing a
  //     folder-model note here would never be seen: the plugin's one-time consolidation already ran.
  async _boardNoteMode() {
    const base = this.full("Tasks");
    let entries = [];
    try { entries = await fs.readdir(base, { withFileTypes: true }); } catch { return true; }
    let legacy = false;
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".md")) {
        const m = await this.fmOf(path.join(base, e.name));
        if (str(m.type) === "task-board") return true;
        if (str(m.type) === "task") legacy = true;
      } else if (!legacy && e.isDirectory() && e.name !== "Lists" && e.name !== "_orphaned") {
        let kids = [];
        try { kids = await fs.readdir(path.join(base, e.name), { withFileTypes: true }); } catch { /* skip */ }
        if (kids.some((k) => k.isFile() && k.name.endsWith(".md"))) legacy = true;
      }
    }
    return !legacy;
  }
  async _readBoardEntries(board) {
    const raw = await this.readRaw(this.boardNoteRel(board));
    if (!raw) return [];
    return coerce(this.parse(raw).fm.tasks, []);
  }
  async _writeBoardNote(board, entries) {
    const rel = this.boardNoteRel(board);
    const sorted = sortTaskEntries(entries);
    const cfg = await this.loadConfig();
    const tasks = sorted.map((e) => taskEntryToDomain(e, this.full(rel), board));
    const body = renderBoardNoteBody(board, tasks, cfg.taskColumns, cfg.taskColumnNames);
    await this.writeRel(rel, this.buildDoc({ type: "task-board", board, tasks: sorted }, body));
  }
  async _loadBoardsBoardNote() {
    const base = this.full("Tasks");
    const names = new Set(["My Tasks"]);
    let entries = [];
    try { entries = await fs.readdir(base, { withFileTypes: true }); } catch { /* no Tasks dir yet */ }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".md")) {
        const m = await this.fmOf(path.join(base, e.name));
        if (str(m.type) === "task-board") names.add(str(m.board) || e.name.replace(/\.md$/, ""));
      }
    }
    const sorted = [...names].sort((a, b) => a === "My Tasks" ? -1 : b === "My Tasks" ? 1 : a.localeCompare(b));
    return sorted.map((name) => ({ id: safeName(name), name, emoji: "" }));
  }
  async _loadTasksBoardNote() {
    const base = this.full("Tasks");
    const out = [];
    let entries = [];
    try { entries = await fs.readdir(base, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (!(e.isFile() && e.name.endsWith(".md"))) continue;
      const abs = path.join(base, e.name);
      const m = await this.fmOf(abs);
      if (str(m.type) !== "task-board") continue;
      const board = str(m.board) || e.name.replace(/\.md$/, "");
      for (const en of coerce(m.tasks, [])) out.push(taskEntryToDomain(en, abs, board));
    }
    return out;
  }
  async _createTaskBoardNote(t) {
    const cfg = await this.loadConfig();
    const cols = cfg.taskColumns;
    const status = resolveColumn(t.status, cols) ?? cols[0];
    const board = this.boardOrDefault(t.board);
    const title = (t.title || "Untitled").trim() || "Untitled";
    const now = new Date().toISOString();
    const entry = taskDomainToEntry({
      id: cryptoId(), title, status, priority: t.priority || "medium",
      group: t.group || "", due: t.due || "", eisenhower: t.eisenhower || "",
      created: now, modified: now, kanbanName: board,
    });
    await this._writeBoardNote(board, upsertTaskEntry(await this._readBoardEntries(board), entry));
    return { path: this.full(this.boardNoteRel(board)), title, board, status };
  }
  async _updateTaskBoardNote(idOrPath, changes) {
    const target = await this._findTask(idOrPath);
    if (!target) throw new Error(`Task not found: ${idOrPath}`);
    const cfg = await this.loadConfig();
    const fromBoard = this.boardOrDefault(target.kanbanName);
    const toBoard = this.boardOrDefault(changes.board);
    const movingBoard = changes.board !== undefined && toBoard !== fromBoard;
    const patch = {};
    if (changes.status !== undefined) patch.status = resolveColumn(changes.status, cfg.taskColumns) ?? cfg.taskColumns[0];
    if (changes.priority !== undefined) patch.priority = changes.priority;
    if (changes.title !== undefined) patch.title = changes.title;
    if (changes.group !== undefined) patch.group = changes.group;
    if (changes.due !== undefined) patch.due = changes.due;
    if (changes.eisenhower !== undefined) patch.eisenhower = changes.eisenhower;
    patch.modified = new Date().toISOString();
    if (!movingBoard) {
      await this._writeBoardNote(fromBoard, patchTaskEntry(await this._readBoardEntries(fromBoard), target.id, patch));
      return { path: this.full(this.boardNoteRel(fromBoard)), ...changes };
    }
    const fromEntries = await this._readBoardEntries(fromBoard);
    const moving = fromEntries.find((e) => str(e.task_id) === target.id);
    await this._writeBoardNote(fromBoard, removeTaskEntry(fromEntries, target.id));
    const base = moving ?? taskDomainToEntry({ ...target, kanbanName: toBoard });
    await this._writeBoardNote(toBoard, upsertTaskEntry(await this._readBoardEntries(toBoard), { ...base, ...patch }));
    return { path: this.full(this.boardNoteRel(toBoard)), ...changes };
  }
  async _deleteTaskBoardNote(idOrPath) {
    const target = await this._findTask(idOrPath);
    if (!target) throw new Error(`Task not found: ${idOrPath}`);
    const board = this.boardOrDefault(target.kanbanName);
    await this._writeBoardNote(board, removeTaskEntry(await this._readBoardEntries(board), target.id));
    return { deleted: target.title };
  }
  async _createBoardBoardNote(name) {
    const clean = safeName((name || "").trim());
    if (!clean || clean === "Lists" || clean === "untitled") return false;
    if (!(await this.exists(this.boardNoteRel(clean)))) await this._writeBoardNote(clean, []);
    return true;
  }
  async _deleteBoardBoardNote(name) {
    const clean = (name || "").trim();
    if (!clean) return { ok: false, reason: "no board name" };
    if (clean === "My Tasks") return { ok: false, reason: "cannot delete My Tasks" };
    if (!(await this.exists(this.boardNoteRel(clean)))) return { ok: false, reason: "not found" };
    await this._addIgnoredBoard(clean);
    const entries = await this._readBoardEntries(clean);
    let moved = 0;
    if (entries.length) {
      let merged = await this._readBoardEntries("My Tasks");
      for (const e of entries) { merged = upsertTaskEntry(merged, e); moved++; }
      await this._writeBoardNote("My Tasks", merged);
    }
    await this.removeAbs(this.full(this.boardNoteRel(clean)));
    return { ok: true, board: clean, movedTasks: moved, tombstoned: true };
  }

  async loadBoards() {
    if (await this._boardNoteMode()) return this._loadBoardsBoardNote();
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
    if (await this._boardNoteMode()) return this._createBoardBoardNote(name);
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

  /**
   * Delete a board (mirrors the plugin's deleteBoard): move its tasks into My Tasks and
   * tombstone it in Config/deleted-boards.md so Google-list discovery won't resurrect it.
   * Does NOT touch Google — the plugin propagates the deletion (removes the Google list) on
   * its next sync. Refuses "My Tasks"; no-op when the board doesn't exist.
   */
  async deleteBoard(name) {
    if (await this._boardNoteMode()) return this._deleteBoardBoardNote(name);
    const clean = (name || "").trim();
    if (!clean) return { ok: false, reason: "no board name" };
    if (clean === "My Tasks") return { ok: false, reason: "cannot delete My Tasks" };
    const folderAbs = this.full(this.taskBoardFolder(clean));
    if (!(await this._absExists(folderAbs))) return { ok: false, reason: "not found" };
    // Tombstone first so a lingering Google list can't resurrect the board mid-operation.
    await this._addIgnoredBoard(clean);
    // Move each task note to My Tasks (folder = source of truth).
    const tasks = (await this.loadTasks()).filter((t) => t.kanbanName === clean);
    let moved = 0;
    for (const t of tasks) {
      try { await this.updateTask(t.path, { board: "My Tasks" }); moved++; } catch { /* skip */ }
    }
    // Remove the now-empty folder (rmdir fails if non-empty — safe, non-destructive).
    try { await fs.rmdir(folderAbs); } catch { /* not empty or already gone */ }
    await this.syncTaskLists();
    return { ok: true, board: clean, movedTasks: moved, tombstoned: true };
  }

  /** Append a board name to Config/deleted-boards.md (idempotent), mirroring the plugin. */
  async _addIgnoredBoard(name) {
    const rel = "Config/deleted-boards.md";
    const cur = await this.readRaw(rel);
    const set = new Set(cur ? coerce(this.parse(cur).fm.boards, []) : []);
    if (set.has(name)) return;
    set.add(name);
    await this.writeRel(rel, this.buildDoc(
      { type: "deleted-boards", boards: [...set] },
      "# Deleted boards\n\nBoards removed here are not re-created from Google Tasks lists.\n",
    ));
  }

  // ============================================================
  // TASKS
  // ============================================================
  async loadTasks() {
    if (await this._boardNoteMode()) return this._loadTasksBoardNote();
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
    if (await this._boardNoteMode()) return this._createTaskBoardNote(t);
    const cfg = await this.loadConfig();
    const cols = cfg.taskColumns;
    // Validate/resolve the requested column tolerantly, so "in-progress", "in_progress" or
    // "In Progress" all match the real "in progress" column instead of silently falling back to
    // backlog (cols[0]). Only a genuinely unknown column falls back.
    let status = resolveColumn(t.status, cols) ?? cols[0];
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
    if (await this._boardNoteMode()) return this._updateTaskBoardNote(idOrPath, changes);
    const target = await this._findTask(idOrPath);
    if (!target) throw new Error(`Task not found: ${idOrPath}`);
    const cfg = await this.loadConfig();
    const raw = await fs.readFile(target.path, "utf8");
    const { fm, body } = this.parse(raw);
    if (changes.status !== undefined) fm.status = resolveColumn(changes.status, cfg.taskColumns) ?? cfg.taskColumns[0];
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
    if (await this._boardNoteMode()) return this._deleteTaskBoardNote(idOrPath);
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
    if (await this._boardNoteMode()) return; // board notes are self-rendering; no Lists/ mirrors.
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
    // Deterministic frontmatter (no volatile `generated` timestamp) so two devices produce
    // byte-identical hubs for the same month and a whole-vault sync never conflicts them.
    const content = this.buildDoc({ type: `${cfg.module.toLowerCase()}-month-hub`, month: monthKey }, body);
    const cur = await this.readRaw(rel);
    if (cur != null && this.bodyOf(cur) === this.bodyOf(content)) return "unchanged";
    await this.writeRel(rel, content);
    return "written";
  }

  // ============================================================
  // MONTHLY LEDGER (mirror of the plugin: one consolidated note per month per module)
  // ============================================================
  _monthNoteRel(cfg, mk) { return `${cfg.hubFolder}/${monthHubTitle(cfg.module, mk)}.md`; }
  async _readMonthEntries(rel) { const raw = await this.readRaw(rel); if (!raw) return []; return coerce(this.parse(raw).fm.entries, []); }
  async _writeMonthNote(cfg, mk, entries) {
    const rel = this._monthNoteRel(cfg, mk);
    if (!entries.length) { if (await this.exists(rel)) await this.removeAbs(this.full(rel)); return; }
    const sorted = sortEntriesByDateId(entries);
    const items = sorted.map((e) => cfg.fromEntry(e, this.full(rel)));
    const body = await cfg.renderBody(items, mk);
    await this.writeRel(rel, this.buildDoc({ type: cfg.noteType, month: mk, entries: sorted }, body));
  }
  async _loadLedger(cfg) {
    const out = [];
    const seen = new Set();
    for (const abs of await this.listMarkdown(cfg.hubFolder)) {
      const m = await this.fmOf(abs);
      if (str(m.type) !== cfg.noteType) continue;
      for (const e of coerce(m.entries, [])) { const it = cfg.fromEntry(e, abs); if (it.date) { out.push(it); seen.add(it.id); } }
    }
    for (const abs of await this.listMarkdown(cfg.legacyFolder)) {
      const it = cfg.legacyMapper(await this.fmOf(abs), this.basename(abs), abs);
      if (it.date && !seen.has(it.id)) out.push(it);
    }
    return out;
  }
  async _addLedgerEntry(cfg, entry) {
    const mk = monthKeyOf(str(entry.date));
    const entries = await this._readMonthEntries(this._monthNoteRel(cfg, mk));
    entries.push(entry);
    await this._writeMonthNote(cfg, mk, entries);
    return mk;
  }
  async _deleteLedgerEntry(cfg, item) {
    const mk = monthKeyOf(item.date);
    const rel = this._monthNoteRel(cfg, mk);
    const before = await this._readMonthEntries(rel);
    const after = before.filter((e) => str(e.id) !== item.id);
    if (after.length !== before.length) await this._writeMonthNote(cfg, mk, after);
    if (item.path && item.path !== this.full(rel)) { try { await this.removeAbs(item.path); } catch { /* ignore */ } }
  }

  _financeLedgerCfg() {
    return {
      module: "Finance", hubFolder: "Finance/Months", noteType: "finance-month", legacyFolder: "Finance/Transactions",
      legacyMapper: (m, bn, p) => entryToTransaction({ ...m, id: m.id ?? bn }, p),
      toEntry: txToEntry, fromEntry: entryToTransaction,
      renderBody: async (items, mk) => renderFinanceTable(items, (await this.loadConfig()).currency || "$", mk),
    };
  }
  _nutritionLedgerCfg() {
    return {
      module: "Nutrition", hubFolder: "Nutrition/Months", noteType: "nutrition-month", legacyFolder: "Nutrition/Logs",
      legacyMapper: (m, bn, p) => entryToMealLog({ ...m, id: m.id ?? bn }, p),
      toEntry: mealLogToEntry, fromEntry: entryToMealLog,
      renderBody: async (items, mk) => {
        const byId = new Map((await this.loadMeals()).map((x) => [x.id, x.name]));
        return renderNutritionTable(items, mk, (id) => (byId.get(id) || "").trim() || id);
      },
    };
  }
  _fitnessLedgerCfg() {
    return {
      module: "Fitness", hubFolder: "Fitness/Months", noteType: "fitness-month", legacyFolder: "Fitness/Workouts",
      legacyMapper: (m, bn, p) => entryToWorkout({ ...m, id: m.id ?? bn }, p),
      toEntry: workoutToEntry, fromEntry: entryToWorkout,
      renderBody: async (items, mk) => {
        const cfg = await this.loadConfig();
        const splits = await this.loadSplits();
        const label = (id) => {
          const configured = (cfg.splitNames && cfg.splitNames[id] || "").trim(); if (configured) return configured;
          const custom = (cfg.customSplits || []).find((s) => s.id === id); if (custom && (custom.name || "").trim()) return custom.name.trim();
          const listed = splits.find((s) => s.id === id); if (listed && (listed.name || "").trim()) return listed.name.trim();
          return id;
        };
        return renderFitnessTable(items, mk, label);
      },
    };
  }

  // ============================================================
  // FINANCE
  // ============================================================
  async loadTransactions() {
    return this._loadLedger(this._financeLedgerCfg());
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
    const d = (date || todayLocal()).slice(0, 10);
    const entry = { id: crypto.randomUUID(), tx_type: type === "income" ? "income" : "expense", date: d, amount: num(amount), category: category || "Other", note: note || "" };
    const month = await this._addLedgerEntry(this._financeLedgerCfg(), entry);
    return { id: entry.id, month };
  }

  async deleteTransaction(idOrPath) {
    const t = (await this.loadTransactions()).find((x) => x.id === idOrPath || x.path === idOrPath);
    if (!t) throw new Error(`Transaction not found: ${idOrPath}`);
    await this._deleteLedgerEntry(this._financeLedgerCfg(), t);
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
  // SAVINGS BUCKETS (Finance/savings.md) — mirrors the plugin's src/data.ts.
  // Balance is always derived (sum of a bucket's log), never stored separately.
  // ============================================================
  async loadSavingsBuckets() {
    const raw = await this.readRaw("Finance/savings.md");
    const list = raw ? coerce(this.parse(raw).fm.buckets, []) : [];
    const buckets = list.map((b) => ({
      id: str(b.id) || ("s" + Math.random().toString(36).slice(2, 8)),
      name: str(b.name) || "Savings",
      kind: str(b.kind) === "reserve" ? "reserve" : "custom",
      goal: b.goal != null ? num(b.goal) : undefined,
      log: coerce(b.log, {}),
    }));
    if (!buckets.some((b) => b.id === "emergency-fund")) {
      buckets.unshift({ id: "emergency-fund", name: "Emergency fund", kind: "reserve", log: {} });
    }
    return buckets;
  }

  async _writeSavingsBuckets(buckets) {
    const cur = (await this.loadConfig()).currency || "$";
    const balanceOf = (b) => Object.values(b.log).reduce((a, v) => a + v, 0);
    let body = "# Savings\n\n";
    for (const b of buckets) {
      const bal = Math.round(balanceOf(b) * 100) / 100;
      const goal = b.goal ? ` (goal: ${cur}${b.goal})` : "";
      body += `## ${b.name}${goal}\n${cur}${bal}\n\n`;
    }
    await this.writeRel("Finance/savings.md", this.buildDoc({ type: "savings-config", buckets }, body));
  }

  async addSavingsBucket(name, goal) {
    const buckets = await this.loadSavingsBuckets();
    const id = "s" + Date.now();
    buckets.push({ id, name: (name || "Savings").trim() || "Savings", kind: "custom", goal, log: {} });
    await this._writeSavingsBuckets(buckets);
    return { id };
  }

  async updateSavingsBucket(id, { name, goal } = {}) {
    const buckets = await this.loadSavingsBuckets();
    const b = buckets.find((x) => x.id === id);
    if (!b) throw new Error(`Savings bucket not found: ${id}`);
    if (name !== undefined && b.kind !== "reserve") b.name = name.trim() || b.name;
    if (goal !== undefined) b.goal = goal;
    await this._writeSavingsBuckets(buckets);
    return { id };
  }

  async deleteSavingsBucket(id) {
    if (id === "emergency-fund") return { deleted: false };
    const buckets = (await this.loadSavingsBuckets()).filter((b) => b.id !== id);
    await this._writeSavingsBuckets(buckets);
    return { deleted: true };
  }

  async addSavingsContribution(id, amount, date) {
    const buckets = await this.loadSavingsBuckets();
    const b = buckets.find((x) => x.id === id);
    if (!b) throw new Error(`Savings bucket not found: ${id}`);
    const amt = num(amount);
    if (!amt) return { id, balance: Object.values(b.log).reduce((a, v) => a + v, 0) };
    const d = (date || todayLocal()).slice(0, 10);
    b.log[d] = Math.round(((b.log[d] || 0) + amt) * 100) / 100;
    await this._writeSavingsBuckets(buckets);
    return { id, balance: Object.values(b.log).reduce((a, v) => a + v, 0) };
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
    return this._loadLedger(this._nutritionLedgerCfg());
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
    const name = (mealName || "Meal").trim() || "Meal";
    const entry = {
      id: crypto.randomUUID(), date: d, meal: name, meal_name: name,
      calories: items.reduce((s, it) => s + (Number(it.cal) || 0), 0),
      protein: items.reduce((s, it) => s + (Number(it.protein) || 0), 0),
      carbs: items.reduce((s, it) => s + (Number(it.carbs) || 0), 0),
      items,
    };
    const month = await this._addLedgerEntry(this._nutritionLedgerCfg(), entry);
    return { id: entry.id, month, totalCal: entry.calories };
  }

  async deleteMealLog(idOrPath) {
    const l = (await this.loadMealLogs()).find((x) => x.id === idOrPath || x.path === idOrPath);
    if (!l) throw new Error(`Meal log not found: ${idOrPath}`);
    await this._deleteLedgerEntry(this._nutritionLedgerCfg(), l);
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

  // Body weight: manual {date: kg} map in Fitness/weight.md (mirrors the plugin). A weight is a
  // point-in-time value (SET, not accumulate); one value per day. kg <= 0 removes that day.
  async loadWeight() {
    const raw = await this.readRaw("Fitness/weight.md");
    if (!raw) return {};
    return coerce(this.parse(raw).fm.log, {});
  }
  async logWeight(date, kg) {
    const d = (date || todayLocal()).slice(0, 10);
    const value = Math.round(num(kg) * 10) / 10;
    const log = await this.loadWeight();
    if (value > 0) log[d] = value; else delete log[d];
    await this.writeRel("Fitness/weight.md", this.buildDoc({ type: "weight-log", log, modified: new Date().toISOString() }, "# Body weight log\n"));
    return { date: d, kg: log[d] ?? null };
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
      const kind = str(m.kind) === "cardio" ? "cardio" : "strength";
      out.push({
        name: str(m.name) || this.basename(abs), split: str(m.split) || "A", type: str(m.equipment) || "machine",
        muscle: str(m.muscle), sets: str(m.sets) || "3x10", weight: num(m.weight), howto: str(m.howto), path: abs,
        kind,
        targetDistance: m.target_distance != null ? num(m.target_distance) : undefined,
        targetDuration: m.target_duration != null ? num(m.target_duration) : undefined,
      });
    }
    return out;
  }
  async loadWorkouts() {
    return this._loadLedger(this._fitnessLedgerCfg());
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
        let totalDistance = 0;
        try {
          totalDistance = totalCardioDistance(sorted);
        } catch {
          totalDistance = 0; // Req 6.4: never abort hub regeneration on a distance-sum failure
        }
        let body = `# Fitness — ${monthName(monthKey)} ${monthKey.slice(0, 4)}\n\n`;
        body += `**Workouts:** ${sorted.length}\n**Total minutes:** ${int(totalMinutes)} min\n`;
        if (totalDistance > 0) body += `**Total distance:** ${totalDistance.toFixed(2)} km\n`;
        body += `\n## By split\n\n`;
        for (const r of rows) body += `- ${r.name}: ${r.count} workout${r.count === 1 ? "" : "s"}, ${int(r.minutes)} min\n`;
        body += `\n## Sessions\n\n`;
        for (const w of sorted) body += `- [[${basename(w)}]]\n`;
        return body;
      },
    };
  }
  async logWorkout({ split, duration, date, exercises = [] }) {
    const d = (date || todayLocal()).slice(0, 10);
    const entry = { id: crypto.randomUUID(), date: d, split: split || "A", duration: num(duration), exercises, kind: deriveWorkoutKind(exercises) };
    const month = await this._addLedgerEntry(this._fitnessLedgerCfg(), entry);
    return { id: entry.id, month };
  }
  async deleteWorkout(idOrPath) {
    const w = (await this.loadWorkouts()).find((x) => x.id === idOrPath || x.path === idOrPath);
    if (!w) throw new Error(`Workout not found: ${idOrPath}`);
    await this._deleteLedgerEntry(this._fitnessLedgerCfg(), w);
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
