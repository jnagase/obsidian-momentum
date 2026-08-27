import { App, TFile, TFolder, normalizePath } from "obsidian";
import {
  Board, Task, Note, Habit, Exercise, Workout, WorkoutExercise, Split,
  StudyCard, Meal, MealItem, MealLog, Transaction, RecurringItem, PAConfig, defaultConfig,
  ExerciseKind,
} from "./types";
import { todayLocal } from "./util";
import { monthHubTitle, monthKeyOf, monthName, financeTxTitle, mealLogTitle, workoutTitle, formatAmount, mergeBody } from "./readablenotes";
import { mapTransaction, mapMealLog, mapWorkout, computePace, deriveWorkoutKind, totalCardioDistance } from "./loaders";

/** Root folder inside the vault that holds all Personal Assistant data. */
export let DATA_ROOT = "Momentum Life";
export function setDataRoot(root: string) { DATA_ROOT = root || ""; }

type FM = Record<string, unknown>;

/** Anything a month hub can summarize: it only needs a `YYYY-MM-DD` date. */
export interface MonthItem { date: string; }

/**
 * Per-module configuration that drives the generic month-hub machinery.
 * Finance, Nutrition, and Fitness each supply one of these (tasks 4/5/6).
 * - `folder`    logical folder holding the per-item notes (e.g. "Finance/Transactions").
 * - `hubFolder` logical folder holding the month hubs (e.g. "Finance/Months").
 * - `module`    hub name prefix used by `monthHubTitle` (e.g. "Finance").
 * - `loadItems` returns ALL items of the module (each carrying a `date`).
 * - `summaryBody` builds the deterministic hub body for a month's items. It may be
 *   async so a module can load whatever it needs (e.g. Finance reads the configured
 *   currency from `loadConfig()`); `syncMonthHub` awaits it.
 * - `desiredTitle` computes the readable base filename (no extension, no collision
 *   suffix) for a note from its frontmatter. It doubles as the module's required-field
 *   validator: returning `null`/empty means the frontmatter is missing/malformed
 *   (e.g. Finance needs date+amount; Nutrition/Fitness need a date) so the migration
 *   skips that file with a warning. May be async so a module can resolve display names
 *   from config (e.g. Fitness split names). This keeps `migrateReadableNotes`
 *   module-agnostic.
 */
export interface ModuleHubConfig<T extends MonthItem = MonthItem> {
  folder: string;
  hubFolder: string;
  module: string;
  loadItems: () => T[];
  summaryBody: (monthItems: T[], monthKey: string) => string | Promise<string>;
  desiredTitle: (frontmatter: Record<string, unknown>) => string | null | Promise<string | null>;
}

/**
 * Aggregate result of a `migrateReadableNotes` run for one module.
 * - `renamed`     files renamed to the readable scheme (counted in dry-run too).
 * - `skipped`     already-correctly-named files (idempotent no-ops).
 * - `hubsWritten` month hubs created/updated during regeneration.
 * - `hubsRemoved` empty-month hubs trashed during regeneration.
 * - `warnings`    malformed frontmatter skips and per-file rename failures.
 */
export interface MigrationReport {
  renamed: number;
  skipped: number;
  hubsWritten: number;
  hubsRemoved: number;
  warnings: string[];
}

/**
 * Outcome of a single `syncMonthHub` call, so callers (notably migration) can
 * account precisely for what happened without re-probing the filesystem:
 * - `written`   the hub was created or its body updated.
 * - `removed`   an empty-month hub was trashed.
 * - `unchanged` nothing to write (idempotent no-op) or no hub to remove.
 */
export type HubSyncResult = "written" | "removed" | "unchanged";

/** Escape a string for safe use inside a `RegExp` (idempotency name matching). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Accept either an already-parsed object/array or a JSON string. */
function coerce<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return v as T;
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}
function num(v: unknown): number {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  if (typeof v === "string") { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
  return 0;
}

/** Filesystem-safe filename derived from a title (keeps accents, drops symbols). */
export function safeName(title: string): string {
  return (title || "untitled")
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim() || "untitled";
}

// Fitness cardio pure helpers (computePace, deriveWorkoutKind, totalCardioDistance) live in
// ./loaders.ts (imported above) so mapWorkout can use deriveWorkoutKind without a circular
// import — loaders.ts is the Obsidian-free module data.ts already imports from. Re-exported
// here so other modules (e.g. fitness.ts) can import them from data.ts alongside safeName.
export { computePace, deriveWorkoutKind, totalCardioDistance };

/**
 * Data layer: reads/writes the same markdown files the web app uses,
 * through the Obsidian Vault + metadata cache (no GitHub token, no fetch).
 */
export class PADataStore {
  app: App;
  constructor(app: App) { this.app = app; }

  full(path: string): string {
    return normalizePath(DATA_ROOT ? `${DATA_ROOT}/${path}` : path);
  }

  listMarkdown(folder: string): TFile[] {
    const prefix = this.full(folder).replace(/\/$/, "") + "/";
    return this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  fileAt(path: string): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(this.full(path));
    return f instanceof TFile ? f : null;
  }

  async read(path: string): Promise<string | null> {
    const f = this.fileAt(path);
    return f ? await this.app.vault.read(f) : null;
  }

  frontmatter(file: TFile): FM {
    return (this.app.metadataCache.getFileCache(file)?.frontmatter as FM) ?? {};
  }

  private async ensureFolder(fullPath: string): Promise<void> {
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    if (dir && !(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
      await this.app.vault.createFolder(dir).catch(() => {});
    }
  }

  /** Create a file (or overwrite body+frontmatter) at a logical path. */
  async writeFile(path: string, content: string): Promise<TFile> {
    const full = this.full(path);
    const existing = this.app.vault.getAbstractFileByPath(full);
    if (existing instanceof TFile) {
      await this.app.vault.process(existing, () => content);
      return existing;
    }
    await this.ensureFolder(full);
    return await this.app.vault.create(full, content);
  }

  async remove(path: string): Promise<void> {
    const f = this.fileAt(path);
    if (f) await this.app.fileManager.trashFile(f);
  }

  async removeFile(file: TFile): Promise<void> {
    await this.app.fileManager.trashFile(file);
  }

  /** Build a markdown document from a frontmatter map + body. */
  buildDoc(meta: FM, body: string): string {
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

  /** Update frontmatter of an existing file in place, preserving body. */
  async patchFrontmatter(file: TFile, mutate: (fm: FM) => void): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm: FM) => mutate(fm));
  }

  // ============================================================
  // CONFIG
  // ============================================================
  async loadConfig(): Promise<PAConfig> {
    const cfg = defaultConfig();
    const f = this.fileAt("Config/settings.md");
    if (!f) return cfg;
    const m = this.frontmatter(f);
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
    if (m.starting_balance != null) cfg.startingBalance = num(m.starting_balance);
    if (m.expense_categories) cfg.expenseCategories = coerce(m.expense_categories, cfg.expenseCategories);
    if (m.income_categories) cfg.incomeCategories = coerce(m.income_categories, cfg.incomeCategories);
    if (m.custom_pages) cfg.customPages = coerce(m.custom_pages, cfg.customPages);
    if (m.board_order) cfg.boardOrder = coerce(m.board_order, cfg.boardOrder);
    return cfg;
  }

  /** List markdown notes under a vault-relative folder (used by custom pages). */
  loadFolderNotes(folder: string): Array<{ title: string; path: string }> {
    const prefix = folder.replace(/\/+$/, "") + "/";
    return this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix))
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((f) => ({ title: f.basename, path: f.path }));
  }

  async saveConfig(cfg: PAConfig): Promise<void> {
    const meta: FM = {
      type: "config",
      calorie_target: cfg.calorieTarget,
      protein_target: cfg.proteinTarget,
      carbs_target: cfg.carbsTarget,
      water_target: cfg.waterTarget,
      task_columns: cfg.taskColumns,
      task_column_names: cfg.taskColumnNames,
      study_columns: cfg.studyColumns,
      study_column_names: cfg.studyColumnNames,
      study_topics: cfg.studyTopics,
      custom_splits: cfg.customSplits,
      split_names: cfg.splitNames,
      currency: cfg.currency,
      monthly_budget: cfg.monthlyBudget,
      starting_balance: cfg.startingBalance,
      expense_categories: cfg.expenseCategories,
      income_categories: cfg.incomeCategories,
      custom_pages: cfg.customPages,
      board_order: cfg.boardOrder || [],
      modified: new Date().toISOString(),
    };
    await this.writeFile("Config/settings.md", this.buildDoc(meta, "# Personal Assistant Config\n"));
  }

  // ============================================================
  // BOARDS (Tasks/boards.md)  +  STUDY BOARDS (Studies/boards.md)
  // ============================================================
  private boardsFrom(file: TFile | null): Board[] {
    if (!file) return [];
    const m = this.frontmatter(file);
    const list = coerce<Array<Record<string, unknown>>>(m.boards, []);
    return list.map((b) => ({ id: str(b.id), name: str(b.name), emoji: b.emoji ? str(b.emoji) : "" }))
      .filter((b) => b.id || b.name);
  }

  /**
   * Task boards ARE the folders under Tasks/ (folder = 100% source of truth): whatever
   * anyone creates there — another plugin, a device sync, or a hand-made folder — shows
   * up as a board automatically, with no boards.md config to keep in step. "General Tasks"
   * is always present and pinned first; the rest are alphabetical. Custom emoji/order are
   * intentionally not persisted in this model.
   */
  loadBoards(): Board[] {
    const root = this.app.vault.getAbstractFileByPath(this.full("Tasks"));
    const names = new Set<string>(["My Tasks"]);
    if (root instanceof TFolder) {
      for (const c of root.children) {
        if (c instanceof TFolder && c.name !== "Lists" && c.name !== "_orphaned") names.add(c.name);
      }
    }
    const sorted = [...names].sort((a, b) =>
      a === "My Tasks" ? -1 : b === "My Tasks" ? 1 : a.localeCompare(b));
    return sorted.map((name) => ({ id: safeName(name), name, emoji: "" }));
  }
  loadStudyBoards(): Board[] { return this.boardsFrom(this.fileAt("Studies/boards.md")); }

  // ── Ignored boards (tombstones) ──────────────────────────────────────────
  // Names of boards the user removed (or that were renamed away). Google-list discovery
  // skips these, so a deleted board is never resurrected from a leftover Google list.
  private ignoreFile = "Config/deleted-boards.md";
  loadIgnoredBoards(): string[] {
    const f = this.fileAt(this.ignoreFile);
    return f ? coerce<string[]>(this.frontmatter(f).boards, []) : [];
  }
  private async writeIgnoredBoards(names: string[]): Promise<void> {
    await this.writeFile(this.ignoreFile, this.buildDoc(
      { type: "deleted-boards", boards: names },
      "# Deleted boards\n\nBoards removed here are not re-created from Google Tasks lists.\n",
    ));
  }
  async addIgnoredBoard(name: string): Promise<void> {
    const set = new Set(this.loadIgnoredBoards());
    if (set.has(name)) return;
    set.add(name);
    await this.writeIgnoredBoards([...set]);
  }
  async removeIgnoredBoard(name: string): Promise<void> {
    const set = new Set(this.loadIgnoredBoards());
    if (!set.delete(name)) return;
    await this.writeIgnoredBoards([...set]);
  }

  // ── Pending Google deletions (tombstones) ─────────────────────────────────
  // A task deleted locally while still linked to Google Tasks (had a google_id) is recorded
  // here at delete time. Without this, the next sync sees the Google item still alive, finds
  // no local note referencing it, and re-pulls it as a "new" task — resurrecting a card the
  // user just deleted. The sync deletes the Google item on its next run and clears the
  // tombstone once that's confirmed (success, or the item is already gone).
  private pendingDeleteFile = "Config/pending-google-deletes.md";
  loadPendingGoogleDeletes(): Array<{ id: string; list: string }> {
    const f = this.fileAt(this.pendingDeleteFile);
    return f ? coerce<Array<{ id: string; list: string }>>(this.frontmatter(f).deletes, []) : [];
  }
  private async writePendingGoogleDeletes(items: Array<{ id: string; list: string }>): Promise<void> {
    await this.writeFile(this.pendingDeleteFile, this.buildDoc(
      { type: "pending-google-deletes", deletes: items },
      "# Pending Google deletions\n\nTasks deleted locally while linked to Google Tasks, awaiting deletion on Google's side so the next sync doesn't pull them back.\n",
    ));
  }
  async addPendingGoogleDelete(id: string, list: string): Promise<void> {
    if (!id) return;
    const items = this.loadPendingGoogleDeletes();
    if (items.some((x) => x.id === id)) return;
    items.push({ id, list });
    await this.writePendingGoogleDeletes(items);
  }
  async removePendingGoogleDelete(id: string): Promise<void> {
    const items = this.loadPendingGoogleDeletes();
    const next = items.filter((x) => x.id !== id);
    if (next.length === items.length) return;
    await this.writePendingGoogleDeletes(next);
  }

  /** Ensure a board's folder exists so an empty board still shows in the explorer/tabs. */
  async ensureBoardFolder(name: string): Promise<void> {
    const full = this.full(this.taskBoardFolder(name));
    if (!(this.app.vault.getAbstractFileByPath(full) instanceof TFolder)) {
      await this.app.vault.createFolder(full).catch(() => {});
    }
  }

  /** Create a board = create its folder. Returns false for an invalid/reserved name. */
  async createBoard(name: string): Promise<boolean> {
    const clean = safeName(name);
    if (!clean || clean === "Lists" || clean === "untitled") return false;
    await this.removeIgnoredBoard(clean); // re-creating clears any tombstone.
    await this.ensureBoardFolder(clean);
    return true;
  }

  /**
   * Rename a board = rename its folder (a plain move, no link prompt). Every note inside
   * travels with it, so all tasks re-home to the new board in one step. The kanban_name
   * hint in each note is refreshed afterwards so external readers stay consistent.
   */
  async renameBoard(oldName: string, newName: string): Promise<void> {
    const from = this.full(this.taskBoardFolder(oldName));
    const to = this.full(this.taskBoardFolder(newName));
    const folder = this.app.vault.getAbstractFileByPath(from);
    if (folder instanceof TFolder && from !== to) {
      await this.app.vault.rename(folder, to).catch(() => {});
    }
    for (const t of this.loadTasks().filter((t) => t.kanbanName === newName)) {
      const f = this.app.vault.getAbstractFileByPath(t.path);
      if (f instanceof TFile) await this.patchFrontmatter(f, (fm) => { fm.kanban_name = newName; });
    }
  }

  /**
   * Delete a board: move its notes into General Tasks (tasks are kept, as the UI promises)
   * then trash the now-empty folder. General Tasks itself can't be deleted.
   */
  async deleteBoard(name: string): Promise<void> {
    if (name === "My Tasks") return;
    await this.addIgnoredBoard(name); // tombstone so discovery won't resurrect it from Google.
    const folderPath = this.full(this.taskBoardFolder(name));
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return;
    const notes = folder.children.filter((c): c is TFile => c instanceof TFile && c.extension === "md");
    for (const f of notes) {
      await this.patchFrontmatter(f, (fm) => { fm.kanban_name = "My Tasks"; });
      await this.moveTaskToBoardFolder(f, "My Tasks");
    }
    const still = this.app.vault.getAbstractFileByPath(folderPath);
    if (still instanceof TFolder && still.children.length === 0) {
      await this.app.fileManager.trashFile(still).catch(() => {});
    }
  }

  /**
   * Remove the obsolete Tasks/boards.md — boards are now folders, so the config file is
   * dead weight. Called once from the guarded upgrade migration. No-op when absent.
   */
  async removeLegacyBoardsConfig(): Promise<void> {
    const f = this.fileAt("Tasks/boards.md");
    if (f) await this.app.fileManager.trashFile(f).catch(() => {});
  }

  /**
   * Repair malformed YAML frontmatter in one task note at the raw-text level. Notes dropped
   * by external tools (mobile widgets, old exports) often have an UNQUOTED title that opens
   * a flow collection, e.g. `title: [gbm] spec-req ...`. That is invalid YAML, so Obsidian
   * fails to parse the whole block: the task loses its status/board and — critically —
   * `processFrontMatter` (used by every update, incl. the done button) silently fails on it.
   * We can't fix it through the parser (it can't read it), so we quote the offending value
   * in the raw text. Returns true if the file was changed.
   */
  private async repairFrontmatterText(f: TFile): Promise<boolean> {
    const raw = await this.app.vault.read(f);
    if (!raw.startsWith("---")) return false;
    const fmStart = raw.indexOf("\n") + 1;
    if (fmStart <= 0) return false;
    const closeIdx = raw.indexOf("\n---", fmStart);
    if (closeIdx === -1) return false;
    const block = raw.slice(fmStart, closeIdx);
    let changed = false;
    const fixedLines = block.split("\n").map((line) => {
      const m = line.match(/^([A-Za-z0-9_-]+):[ \t]+(.*)$/);
      if (!m) return line;
      const [, key, val] = m;
      // A value that opens a flow collection ([ or {) but isn't a clean, closed [..]/{..}
      // is invalid YAML → wrap it as a quoted string so the block parses again.
      const opensFlow = val.startsWith("[") || val.startsWith("{");
      const isClosedFlow = /^\[.*\]$/.test(val.trim()) || /^\{.*\}$/.test(val.trim());
      if (opensFlow && !isClosedFlow) {
        changed = true;
        return `${key}: "${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      }
      // An UNQUOTED value containing ": " reads as a nested mapping and breaks the block
      // (e.g. `title: Script provisionador (scripts/provision.sh): roda ...`). Quote it.
      const quoted = (val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"));
      if (!quoted && (/:\s/.test(val) || val.endsWith(":"))) {
        changed = true;
        return `${key}: "${val.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      }
      return line;
    });
    // A repeated top-level key (e.g. google_id written twice) is also invalid YAML and
    // breaks the whole block the same way. Collapse duplicates: keep the LAST value (the
    // most recent write) at the position of the FIRST occurrence, so key order is stable.
    const scalarKey = (line: string): string | null => {
      const m = line.match(/^([A-Za-z0-9_-]+):[ \t]+\S.*$/);
      return m ? m[1] : null;
    };
    const lastByKey = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const line of fixedLines) {
      const key = scalarKey(line);
      if (!key) continue;
      lastByKey.set(key, line);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let hasDupes = false;
    for (const n of counts.values()) if (n > 1) { hasDupes = true; break; }
    let outLines = fixedLines;
    if (hasDupes) {
      changed = true;
      const emitted = new Set<string>();
      outLines = fixedLines.filter((line) => {
        const key = scalarKey(line);
        if (!key || (counts.get(key) ?? 0) < 2) return true;
        if (emitted.has(key)) return false;
        emitted.add(key);
        return true;
      }).map((line) => {
        const key = scalarKey(line);
        return key && (counts.get(key) ?? 0) > 1 ? (lastByKey.get(key) as string) : line;
      });
    }
    if (!changed) return false;
    await this.app.vault.modify(f, raw.slice(0, fmStart) + outLines.join("\n") + raw.slice(closeIdx));
    return true;
  }

  /** Public single-file repair (used by adoption before it writes frontmatter). */
  async repairTaskFile(f: TFile): Promise<boolean> {
    try { return await this.repairFrontmatterText(f); } catch { return false; }
  }

  /**
   * Every `google_id` that appears in the RAW TEXT of an active task note. Read straight from
   * the files instead of the metadata cache on purpose: a note whose frontmatter momentarily
   * fails to parse (malformed YAML, a half-downloaded Obsidian Sync file) disappears from
   * `loadTasks()`, and the sync would then conclude the note was deleted and remove the task
   * from Google. This set is the shield against that — if the id is still written somewhere,
   * the note exists and its Google task must NOT be deleted.
   */
  async rawGoogleIds(): Promise<Set<string>> {
    const listsPrefix = this.full("Tasks/Lists") + "/";
    const orphanPrefix = this.full("Tasks/_orphaned") + "/";
    const tasksPrefix = this.full("Tasks") + "/";
    const files = this.app.vault.getMarkdownFiles().filter((f) =>
      f.path.startsWith(tasksPrefix) &&
      !f.path.startsWith(listsPrefix) && !f.path.startsWith(orphanPrefix));
    const ids = new Set<string>();
    for (const f of files) {
      try {
        const raw = await this.app.vault.cachedRead(f);
        const m = raw.match(/^google_id:\s*"?([A-Za-z0-9_-]+)"?\s*$/m);
        if (m) ids.add(m[1]);
      } catch { /* unreadable file → skip (it can't shield an id it doesn't show) */ }
    }
    return ids;
  }

  /** Repair a task note's frontmatter by vault path (used by sync reconciliation). */
  async repairTaskFileByPath(path: string): Promise<boolean> {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? await this.repairTaskFile(f) : false;
  }

  /**
   * The FILENAME is a note's title in Obsidian, so a task whose frontmatter `title` is still
   * the "Untitled" placeholder while its file has a real name is stale — that happens because
   * Obsidian writes "Untitled.md" first and the note is adopted before the user names it. The
   * rename listener fixes the local case; this sweep also covers renames that arrive from
   * ANOTHER DEVICE through Obsidian Sync (no local rename event fires for those).
   * Idempotent; returns how many titles were realigned.
   */
  async repairTaskTitles(): Promise<number> {
    const listsPrefix = this.full("Tasks/Lists") + "/";
    const orphanPrefix = this.full("Tasks/_orphaned") + "/";
    const tasksPrefix = this.full("Tasks") + "/";
    const files = this.app.vault.getMarkdownFiles().filter((f) =>
      f.path.startsWith(tasksPrefix) &&
      !f.path.startsWith(listsPrefix) && !f.path.startsWith(orphanPrefix) &&
      f.name !== "boards.md" && f.name !== "recurring.md");
    let fixed = 0;
    for (const f of files) {
      const m = this.frontmatter(f);
      if (str(m.type) !== "task") continue;
      const current = str(m.title);
      const isPlaceholder = !current || current.toLowerCase() === "untitled";
      const nameIsReal = f.basename && f.basename.toLowerCase() !== "untitled";
      if (!isPlaceholder || !nameIsReal || current === f.basename) continue;
      try {
        await this.patchFrontmatter(f, (fm) => { fm.title = f.basename; fm.modified = new Date().toISOString(); });
        fixed++;
      } catch { /* skip a note that can't be written */ }
    }
    return fixed;
  }

  /**
   * Scan every task note and repair malformed frontmatter (see repairFrontmatterText).
   * Idempotent — files that are already valid are left untouched. Returns the count fixed.
   */
  async repairTaskFrontmatter(): Promise<number> {
    const listsPrefix = this.full("Tasks/Lists") + "/";
    const tasksPrefix = this.full("Tasks") + "/";
    const files = this.app.vault.getMarkdownFiles().filter((f) =>
      f.path.startsWith(tasksPrefix) && !f.path.startsWith(listsPrefix) && f.name !== "boards.md");
    let fixed = 0;
    for (const f of files) {
      try { if (await this.repairFrontmatterText(f)) fixed++; } catch { /* skip a bad file */ }
    }
    return fixed;
  }

  // ============================================================
  // TASKS
  // ============================================================
  loadTasks(): Task[] {
    const listsPrefix = this.full("Tasks/Lists") + "/";
    const orphanPrefix = this.full("Tasks/_orphaned") + "/";
    const tasksRoot = this.full("Tasks");
    // The board a task belongs to is its parent folder under Tasks/ (folder = 100% source
    // of truth), so anyone can file a task by hand just by dropping its note into
    // Tasks/<Board>/. `kanban_name` is only a hint, used as a fallback for notes still
    // sitting loose at the Tasks/ root (which upkeep files into General Tasks).
    return this.listMarkdown("Tasks")
      .filter((f) => f.name !== "boards.md" && !f.path.startsWith(listsPrefix) && !f.path.startsWith(orphanPrefix))
      .map((f) => {
        const m = this.frontmatter(f);
        const parent = f.parent;
        const inBoardFolder = !!parent && parent.path !== tasksRoot && parent.path.startsWith(tasksRoot + "/");
        const boardName = inBoardFolder ? parent.name : str(m.kanban_name || m["kanban-name"]);
        return {
          id: str(m.task_id) || f.basename,
          title: str(m.title) || f.basename,
          status: str(m.status) || "backlog",
          priority: str(m.priority) || "medium",
          cat: str(m.category) || "work",
          group: str(m.group),
          kanbanId: str(m["kanban-id"]),
          kanbanName: boardName,
          due: str(m.due),
          scheduled: str(m.scheduled),
          duration: num(m.duration),
          isAllDay: !!m.is_all_day,
          created: str(m.created),
          modified: str(m.modified),
          order: (m.order !== undefined && m.order !== null) ? Number(m.order) : undefined,
          eisenhower: str(m.eisenhower),
          googleId: str(m.google_id),
          googleList: str(m.google_list),
          path: f.path,
        };
      });
  }

  /** Read the body (after frontmatter) of any vault file, for previews. */
  async readBody(path: string): Promise<string> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return "";
    const raw = await this.app.vault.cachedRead(f);
    let body = raw;
    if (raw.startsWith("---")) {
      const end = raw.indexOf("\n---", 3);
      if (end !== -1) body = raw.slice(end + 4);
    }
    return body.replace(/^#.*$/m, "").trim();
  }

  /** The board a task should be filed under, defaulting unassigned tasks to My Tasks. */
  private boardOrDefault(board?: string): string {
    return board && board !== "No board" ? board : "My Tasks";
  }

  /** Vault-relative folder that holds a board's task notes: Tasks/<safe board name>. */
  taskBoardFolder(board?: string): string {
    return `Tasks/${safeName(this.boardOrDefault(board))}`;
  }

  /** Create a task note. Returns its vault path so callers can wait for the metadata cache. */
  async createTask(t: Partial<Task>): Promise<string> {
    const title = t.title || "Untitled";
    const board = this.boardOrDefault(t.kanbanName);
    const meta: FM = {
      task_id: cryptoId(),
      title,
      status: t.status || "backlog",
      priority: t.priority || "medium",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      type: "task",
      kanban_name: board,
      group: t.group || "",
    };
    if (t.due) meta.due = t.due;
    if (t.eisenhower) meta.eisenhower = t.eisenhower;
    if (t.googleId) meta.google_id = t.googleId;
    if (t.googleList) meta.google_list = t.googleList;
    const rel = this.uniquePath(this.taskBoardFolder(board), title);
    await this.writeFile(rel, this.buildDoc(meta, `# ${title}\n`));
    return this.full(rel);
  }

  /**
   * Resolve once the metadata cache has indexed a freshly written file's frontmatter (or a
   * short timeout). Prevents the "new card flashes in backlog then jumps" flicker: right
   * after create the cache is stale, so status reads as the default until it catches up.
   */
  async awaitFrontmatter(path: string, timeoutMs = 1000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.app.metadataCache.getCache(path)?.frontmatter) return;
      await new Promise((r) => window.setTimeout(r, 40));
    }
  }

  /** Persist the Google Tasks link (item id + list id) onto a task note's frontmatter. */
  async setTaskGoogleLink(task: Task, googleId: string, googleList: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(task.path);
    if (!(f instanceof TFile)) return;
    await this.patchFrontmatter(f, (fm) => {
      fm.google_id = googleId;
      fm.google_list = googleList;
      fm.modified = new Date().toISOString();
    });
  }

  /** A vault path under `folder` for `title` that does not collide with an existing file. */
  private uniquePath(folder: string, title: string): string {
    const base = safeName(title);
    let rel = `${folder}/${base}.md`;
    let n = 2;
    while (this.fileAt(rel)) { rel = `${folder}/${base} ${n}.md`; n++; }
    return rel;
  }

  async updateTask(task: Task, changes: Partial<Task>): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(task.path);
    if (!(f instanceof TFile)) return;
    await this.patchFrontmatter(f, (fm) => {
      if (changes.status !== undefined) fm.status = changes.status;
      if (changes.priority !== undefined) fm.priority = changes.priority;
      if (changes.title !== undefined) fm.title = changes.title;
      if (changes.kanbanName !== undefined) fm.kanban_name = this.boardOrDefault(changes.kanbanName);
      if (changes.group !== undefined) fm.group = changes.group;
      if (changes.due !== undefined) fm.due = changes.due;
      if (changes.order !== undefined) fm.order = changes.order;
      if (changes.eisenhower !== undefined) fm.eisenhower = changes.eisenhower;
      fm.modified = new Date().toISOString();
    });
    // Board changed → move the note into the new board's folder (folder = source of
    // truth). Uses a plain move (see moveTaskToBoardFolder) so no "update links?" prompt.
    if (changes.kanbanName !== undefined) {
      await this.moveTaskToBoardFolder(f, this.boardOrDefault(changes.kanbanName));
    }
  }

  /**
   * Move a task note into Tasks/<board>/ if it isn't already there. Uses `vault.rename`
   * (a plain move) rather than `fileManager.renameFile`, so Obsidian does NOT pop the
   * "update links?" prompt during bulk filing. Momentum resolves note links by basename,
   * which is unchanged by a folder move, so `[[links]]` keep resolving.
   */
  async moveTaskToBoardFolder(f: TFile, board: string): Promise<void> {
    const targetFolder = this.full(this.taskBoardFolder(board));
    if (f.parent && f.parent.path === targetFolder) return; // already filed correctly
    if (!(this.app.vault.getAbstractFileByPath(targetFolder) instanceof TFolder)) {
      await this.app.vault.createFolder(targetFolder).catch(() => {});
    }
    let dest = `${targetFolder}/${f.name}`;
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(dest)) { dest = `${targetFolder}/${f.basename} ${n}.md`; n++; }
    await this.app.vault.rename(f, dest);
  }

  /**
   * One-time migration to the folder-per-board layout: every task note sitting loose at
   * the Tasks/ root is moved into Tasks/<board>/ (from its kanban_name, defaulting to
   * General Tasks). Plain move (no link prompt); no note is ever deleted.
   * Idempotent — notes already inside a board folder are left untouched. Returns the count moved.
   */
  async migrateTaskFolders(): Promise<number> {
    const tasksRoot = this.full("Tasks");
    const listsPrefix = this.full("Tasks/Lists") + "/";
    const skip = new Set(["boards.md", "recurring.md"]);
    const rootFiles = this.app.vault.getMarkdownFiles().filter((f) =>
      f.parent?.path === tasksRoot &&           // directly at the Tasks/ root
      !f.path.startsWith(listsPrefix) &&
      !skip.has(f.name),
    );
    let moved = 0;
    for (const f of rootFiles) {
      const m = this.frontmatter(f);
      const type = str(m.type);
      if (type && type !== "task") continue;    // don't relocate non-task notes
      const board = this.boardOrDefault(str(m.kanban_name || m["kanban-name"]));
      await this.moveTaskToBoardFolder(f, board);
      moved++;
    }
    return moved;
  }

  /**
   * One-time migration: the default board was renamed "General Tasks" → "My Tasks" (so it
   * pairs with Google's built-in "My Tasks" list). Rename the folder, merging into an
   * existing My Tasks/ if present. No note is ever deleted.
   */
  async migrateDefaultBoardName(): Promise<void> {
    const from = this.full("Tasks/General Tasks");
    const fromF = this.app.vault.getAbstractFileByPath(from);
    if (!(fromF instanceof TFolder)) return;
    const to = this.full("Tasks/My Tasks");
    const toF = this.app.vault.getAbstractFileByPath(to);
    if (!toF) {
      await this.app.vault.rename(fromF, to).catch(() => {});
      return;
    }
    if (toF instanceof TFolder) {
      for (const c of [...fromF.children]) {
        if (!(c instanceof TFile)) continue;
        let dest = `${to}/${c.name}`;
        let n = 2;
        while (this.app.vault.getAbstractFileByPath(dest)) { dest = `${to}/${c.basename} ${n}.md`; n++; }
        await this.app.vault.rename(c, dest).catch(() => {});
      }
      const still = this.app.vault.getAbstractFileByPath(from);
      if (still instanceof TFolder && still.children.length === 0) {
        await this.app.fileManager.trashFile(still).catch(() => {});
      }
    }
    // Renamed away → tombstone so discovery never resurrects a leftover Google "General Tasks".
    await this.addIgnoredBoard("General Tasks");
  }



  /**
   * Complete a task: move it to the done column AND pin it to the TOP of that column
   * (smallest order). Marking done by any means always lands the card first; only a manual
   * drag afterwards changes its position (drag persists explicit per-card orders).
   */
  async completeTaskAtTop(task: Task, doneCol: string): Promise<void> {
    const orders = this.loadTasks()
      .filter((t) => t.status === doneCol && t.path !== task.path)
      .map((t) => t.order ?? -1);
    const newOrder = orders.length ? Math.min(...orders) - 1 : -1;
    await this.updateTask(task, { status: doneCol, order: newOrder });
  }

  /** Archive a task note whose Google item is gone into Tasks/_orphaned/ (never deletes). */
  async orphanTaskNote(task: Task): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(task.path);
    if (!(f instanceof TFile)) return;
    const folder = this.full("Tasks/_orphaned");
    if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }
    let dest = `${folder}/${f.name}`;
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(dest)) { dest = `${folder}/${f.basename} ${n}.md`; n++; }
    await this.app.vault.rename(f, dest);
  }

  /** Task notes with the same board + title (e.g. widget "name 2" copies). Groups of 2+. */
  findDuplicateTasks(): Array<{ keep: Task; remove: Task[] }> {
    const groups = new Map<string, Task[]>();
    for (const t of this.loadTasks()) {
      const key = `${(t.kanbanName || "").toLowerCase()}\u0000${t.title.trim().toLowerCase()}`;
      const arr = groups.get(key); if (arr) arr.push(t); else groups.set(key, [t]);
    }
    const out: Array<{ keep: Task; remove: Task[] }> = [];
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      // Keep the one already linked to Google (googleId), else the oldest created.
      arr.sort((a, b) => (b.googleId ? 1 : 0) - (a.googleId ? 1 : 0)
        || (a.created || "").localeCompare(b.created || ""));
      out.push({ keep: arr[0], remove: arr.slice(1) });
    }
    return out;
  }

  async deleteTask(task: Task): Promise<void> {
    // Record the tombstone BEFORE removing the file: once the note is gone there is no
    // other trace that this Google-linked task was deleted on purpose (see "Pending Google
    // deletions" above) — without it, the next sync would resurrect it from Google.
    if (task.googleId) await this.addPendingGoogleDelete(task.googleId, task.googleList || "");
    const f = this.app.vault.getAbstractFileByPath(task.path);
    if (f instanceof TFile) await this.removeFile(f);
  }

  /** Write a file only when its content actually changes (avoids churn / sync loops). */
  private async writeIfChanged(rel: string, content: string): Promise<void> {
    const existing = this.fileAt(rel);
    if (existing) {
      const cur = await this.app.vault.read(existing);
      if (cur === content) return;
      await this.app.vault.process(existing, () => content);
    } else {
      const full = this.full(rel);
      await this.ensureFolder(full);
      await this.app.vault.create(full, content);
    }
  }

  // ============================================================
  // GENERIC MONTH HUBS (shared by Finance / Nutrition / Fitness)
  // ============================================================

  /**
   * Return the body of a `buildDoc` document (everything after the frontmatter
   * fence), or the whole string when there is no frontmatter. Used to compare
   * hub bodies while ignoring the volatile `generated` timestamp.
   */
  private bodyOf(raw: string): string {
    if (!raw.startsWith("---")) return raw;
    const fenceEnd = raw.indexOf("\n---", 3);
    if (fenceEnd === -1) return raw;
    const afterFence = raw.indexOf("\n", fenceEnd + 1); // end of the closing "---" line
    return afterFence === -1 ? "" : raw.slice(afterFence + 1);
  }

  /**
   * Write a hub document only when its BODY changes, ignoring frontmatter (so the
   * volatile `generated` timestamp never triggers a rewrite). Keeps hubs churn-free
   * and safe against Obsidian Sync feedback loops.
   */
  private async writeHubIfBodyChanged(rel: string, meta: FM, body: string): Promise<boolean> {
    const content = this.buildDoc(meta, body);
    const existing = this.fileAt(rel);
    if (existing) {
      const cur = await this.app.vault.read(existing);
      if (this.bodyOf(cur) === this.bodyOf(content)) return false; // body unchanged -> true no-op
      await this.app.vault.process(existing, () => content);
    } else {
      const full = this.full(rel);
      await this.ensureFolder(full);
      await this.app.vault.create(full, content);
    }
    return true;
  }

  /**
   * Regenerate (or remove) one module's month hub based on the module's current items.
   * - Loads all items via `cfg.loadItems()` and keeps those in `monthKey`.
   * - Empty month -> trashes the hub (keeps the Graph View clean).
   * - Otherwise writes `cfg.summaryBody(...)` via `writeHubIfBodyChanged` (body-only compare).
   * Generic across modules; each module supplies its own `ModuleHubConfig`.
   */
  async syncMonthHub<T extends MonthItem>(cfg: ModuleHubConfig<T>, monthKey: string): Promise<HubSyncResult> {
    const monthItems = cfg.loadItems().filter((it) => monthKeyOf(it.date) === monthKey);
    const rel = `${cfg.hubFolder}/${monthHubTitle(cfg.module, monthKey)}.md`;

    if (!monthItems.length) {
      const existing = this.fileAt(rel);
      if (existing) {
        await this.removeFile(existing);
        return "removed";
      }
      return "unchanged";
    }

    const body = await cfg.summaryBody(monthItems, monthKey);
    const meta: FM = {
      type: `${cfg.module.toLowerCase()}-month-hub`,
      month: monthKey,
      generated: new Date().toISOString(),
    };
    const wrote = await this.writeHubIfBodyChanged(rel, meta, body);
    return wrote ? "written" : "unchanged";
  }

  /**
   * Split a raw document into its frontmatter block (including the closing `---`) and
   * its body (everything after). Used by migration to rewrite ONLY the body while
   * preserving the exact frontmatter text. Mirrors `bodyOf`'s fence detection.
   */
  private splitFrontmatter(raw: string): { fmText: string; body: string } {
    if (!raw.startsWith("---")) return { fmText: "", body: raw };
    const fenceEnd = raw.indexOf("\n---", 3);
    if (fenceEnd === -1) return { fmText: "", body: raw };
    const afterFence = raw.indexOf("\n", fenceEnd + 1); // end of the closing "---" line
    if (afterFence === -1) return { fmText: raw, body: "" };
    return { fmText: raw.slice(0, afterFence), body: raw.slice(afterFence + 1) };
  }

  /**
   * Generic, idempotent, body-preserving, backlink-safe migration for one module.
   *
   * For every markdown note under `cfg.folder`:
   *  - reads frontmatter and asks `cfg.desiredTitle` for the readable base name; a
   *    null/empty result means required fields are missing/malformed → skip + warn
   *    (Req 5.8);
   *  - ensures a stable frontmatter `id` before any rename so identity never depends
   *    on the filename (Req 5.2) — skipped in dry-run;
   *  - if the basename already equals `<desired>` or `<desired> N`, treats it as an
   *    idempotent no-op (Req 5.6); otherwise renames via `app.fileManager.renameFile`
   *    to a collision-free `uniquePath` so existing backlinks stay valid (Req 5.3);
   *  - merges the module's month-hub wikilink into the body via `mergeBody`, preserving
   *    every user-added line and adding the link at most once (Req 5.4, 5.5);
   *  - records touched months and, after processing, regenerates each touched month's
   *    hub (Req 5.13);
   *  - catches per-file rename/read errors, records a warning, and continues (Req 5.9).
   *
   * With `opts.dryRun` set, it computes and returns the report WITHOUT writing anything
   * (no id patch, no rename, no body rewrite, no hub regeneration) (Req 5.7). Module
   * agnostic (Req 11.1) — Finance/Nutrition/Fitness differ only via their `cfg`.
   */
  async migrateReadableNotes<T extends MonthItem>(
    cfg: ModuleHubConfig<T>,
    opts: { dryRun?: boolean } = {},
  ): Promise<MigrationReport> {
    const dryRun = !!opts.dryRun;
    const report: MigrationReport = { renamed: 0, skipped: 0, hubsWritten: 0, hubsRemoved: 0, warnings: [] };
    const touchedMonths = new Set<string>();
    const files = this.listMarkdown(cfg.folder);

    for (const file of files) {
      try {
        const fm = this.frontmatter(file);
        const desired = await cfg.desiredTitle(fm);
        if (!desired) {
          report.warnings.push(`Skipped (missing/malformed frontmatter): ${file.path}`);
          continue;
        }

        const date = str(fm.date).slice(0, 10);
        if (date) touchedMonths.add(monthKeyOf(date));

        // 1) Ensure a stable id so identity never depends on the filename (Req 5.2).
        if (fm.id == null && !dryRun) {
          await this.patchFrontmatter(file, (m) => { m.id = Date.now(); });
        }

        // 2) Rename to the readable scheme unless already named `<desired>`/`<desired> N`.
        const alreadyNamed = file.basename === desired
          || new RegExp(`^${escapeRegExp(desired)} \\d+$`).test(file.basename);

        let targetFile: TFile = file;
        if (alreadyNamed) {
          report.skipped++;
        } else {
          const targetRel = this.uniquePath(cfg.folder, desired);
          if (!dryRun) {
            await this.app.fileManager.renameFile(file, this.full(targetRel)); // backlink-safe
            targetFile = this.fileAt(targetRel) ?? file;
          }
          report.renamed++;
        }

        // 3) Ensure the body links the month hub, preserving user-added lines (Req 5.4/5.5).
        if (!dryRun && date) {
          const hubLink = `[[${monthHubTitle(cfg.module, monthKeyOf(date))}]]`;
          const raw = await this.app.vault.read(targetFile);
          const { fmText, body } = this.splitFrontmatter(raw);
          const merged = mergeBody(body, hubLink);
          if (merged !== body) {
            const content = fmText ? `${fmText}\n${merged}` : merged;
            await this.app.vault.process(targetFile, () => content);
          }
        }
      } catch (e) {
        // Req 5.9: record the failure, continue with the remaining files.
        report.warnings.push(`Failed to migrate ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 4) Regenerate every touched month hub (Req 5.13). Skipped entirely in dry-run
    //    so no writes occur (Req 5.7).
    if (!dryRun) {
      for (const key of touchedMonths) {
        const outcome = await this.syncMonthHub(cfg, key);
        if (outcome === "written") report.hubsWritten++;
        else if (outcome === "removed") report.hubsRemoved++;
      }
    }

    return report;
  }

  /**
   * Run `migrateReadableNotes` for every module (Finance, Nutrition, Fitness) and fold
   * the per-module reports into a single aggregate `MigrationReport`. Counts are summed
   * and warnings are concatenated, each prefixed with its module name so the origin
   * stays clear. Keeps the private per-module hub configs encapsulated so callers can
   * trigger the whole migration without knowing module internals (Req 11.4).
   */
  async migrateAllReadableNotes(opts: { dryRun?: boolean } = {}): Promise<MigrationReport> {
    const total: MigrationReport = { renamed: 0, skipped: 0, hubsWritten: 0, hubsRemoved: 0, warnings: [] };
    // Call per module: `T` in `ModuleHubConfig` is contravariant (via `summaryBody`), so the
    // concrete configs can't share one array type — inferring `T` per call keeps types sound.
    const fold = (module: string, report: MigrationReport): void => {
      total.renamed += report.renamed;
      total.skipped += report.skipped;
      total.hubsWritten += report.hubsWritten;
      total.hubsRemoved += report.hubsRemoved;
      for (const w of report.warnings) total.warnings.push(`[${module}] ${w}`);
    };
    fold("Finance", await this.migrateReadableNotes(this.financeHubConfig(), opts));
    fold("Nutrition", await this.migrateReadableNotes(this.nutritionHubConfig(), opts));
    fold("Fitness", await this.migrateReadableNotes(this.fitnessHubConfig(), opts));
    return total;
  }

  /** Board name a task belongs to for the list mirror ("No board" when unassigned). */
  private taskGroup(t: Task): string { return t.kanbanName || "No board"; }

  /**
   * Regenerate the standard-Markdown checkbox mirror of tasks, one file per board
   * under `Tasks/Lists/<board>.md`. Lets other plugins (Tasks, Home, etc.) read and
   * toggle the same tasks. Deterministic + content-guarded so it converges without loops.
   */
  async syncTaskLists(): Promise<void> {
    const cfg = await this.loadConfig();
    const cols = cfg.taskColumns;
    const names = cfg.taskColumnNames;
    const colSet = new Set(cols);
    const doneCol = cols.includes("done") ? "done" : cols[cols.length - 1];
    const tasks = this.loadTasks();
    const boards = this.loadBoards();
    const eff = (t: Task) => (colSet.has(t.status) ? t.status : cols[0]);
    const ord = (t: Task) => (t.order ?? 1e9);

    const groups = [...boards.map((b) => b.name), "No board"];
    const wanted = new Set<string>();
    for (const g of groups) {
      const gTasks = tasks.filter((t) => this.taskGroup(t) === g);
      if (g === "No board" && !gTasks.length) continue;
      const rel = `Tasks/Lists/${safeName(g)}.md`;
      wanted.add(this.full(rel));
      let body = `%% Momentum Life — task list for board "${g}". Toggle a checkbox to mark it done/undone in the board. %%\n`;
      for (const col of cols) {
        const colTasks = gTasks
          .filter((t) => eff(t) === col)
          .sort((a, b) => ord(a) - ord(b) || (a.created || "").localeCompare(b.created || "") || a.title.localeCompare(b.title));
        if (!colTasks.length) continue;
        body += `\n## ${names[col] || col}\n`;
        for (const t of colTasks) body += `- [${col === doneCol ? "x" : " "}] ${t.title}\n`;
      }
      await this.writeIfChanged(rel, body);
    }

    // Remove mirror files for boards that no longer exist.
    const listsPrefix = this.full("Tasks/Lists") + "/";
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (f.path.startsWith(listsPrefix) && !wanted.has(f.path)) await this.removeFile(f);
    }
  }

  /**
   * Reconcile external checkbox edits in the mirror files back into the board tasks.
   * Runs `applyTaskListFile` on every mirror. It ONLY toggles existing tasks; it never
   * creates tasks from mirror lines — doing so proved unsafe with whole-file sync
   * (a regenerated mirror + sync echo could loop and spawn runaway tasks). Capturing
   * brand-new items added externally is the job of the dedicated inbox instead.
   */
  async reconcileTaskLists(): Promise<void> {
    const listsPrefix = this.full("Tasks/Lists") + "/";
    // Flat mirrors live directly under Tasks/Lists as "<board>.md" (no sub-folder).
    const files = this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(listsPrefix) && !f.path.slice(listsPrefix.length).includes("/"));
    for (const f of files) {
      try { await this.applyTaskListFile(f); } catch { /* skip a bad mirror file, keep going */ }
    }
  }

  /**
   * Apply checkbox toggles from a list mirror file back to the board tasks. Only flips
   * done/undone on tasks that ALREADY exist; unknown lines are IGNORED (never created
   * here), so a regenerated mirror can never spawn tasks or feed a loop. Returns true
   * if anything changed.
   */
  async applyTaskListFile(file: TFile): Promise<boolean> {
    // Flat mirror: the file's basename is the (safe) board key.
    const content = await this.app.vault.read(file);
    return this.applyMirrorContent(file.basename, content);
  }

  /**
   * Core of the mirror reconciler: given a board key (safeName of the board) and the
   * mirror's raw content, flip done/undone on tasks that ALREADY exist. Unknown lines
   * are ignored (never created here) so a regenerated mirror can't spawn tasks or loop.
   * Shared by `applyTaskListFile` (flat mirrors) and the legacy-folder migration.
   */
  private async applyMirrorContent(boardKey: string, content: string): Promise<boolean> {
    const cfg = await this.loadConfig();
    const cols = cfg.taskColumns;
    const colSet = new Set(cols);
    const doneCol = cols.includes("done") ? "done" : cols[cols.length - 1];
    const firstCol = cols[0];
    const tasks = this.loadTasks();
    const eff = (t: Task) => (colSet.has(t.status) ? t.status : cols[0]);
    let changed = false;
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*-\s*\[( |x|X)\]\s+(.*)$/);
      if (!m) continue;
      const checked = m[1].toLowerCase() === "x";
      const title = m[2].trim();
      if (!title) continue;
      const t = tasks.find((x) => safeName(this.taskGroup(x)) === boardKey && x.title === title);
      if (!t) continue; // unknown line: ignore (never create from a mirror — avoids loops)
      const isDone = eff(t) === doneCol;
      if (checked && !isDone) { await this.updateTask(t, { status: doneCol }); changed = true; }
      else if (!checked && isDone) { await this.updateTask(t, { status: firstCol }); changed = true; }
    }
    return changed;
  }

  /**
   * One-time migration from the legacy mirror layout `Tasks/Lists/<board>/tasks.md`
   * (a folder per board holding a lone "tasks" file) to the flat, self-descriptive
   * `Tasks/Lists/<board>.md`. Safe and idempotent:
   *  1. Reconciles each legacy mirror first so any pending checkbox edit is written
   *     back into the task notes (nothing is lost).
   *  2. Trashes the legacy per-board folders — mirrors are derived data, regenerated below.
   *  3. Regenerates the flat mirrors via `syncTaskLists`.
   * Returns the number of legacy mirrors migrated.
   */
  async migrateTaskListStructure(): Promise<number> {
    const listsPrefix = this.full("Tasks/Lists") + "/";
    const legacy = this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(listsPrefix) && f.name === "tasks.md" && (f.parent?.name ?? "") !== "Lists");
    if (!legacy.length) return 0;

    // 1. Capture pending checkbox edits back into the task notes (board = parent folder name).
    for (const f of legacy) {
      try {
        const content = await this.app.vault.read(f);
        await this.applyMirrorContent(f.parent?.name ?? "", content);
      } catch { /* skip a bad legacy mirror, keep migrating the rest */ }
    }

    // 2. Trash each legacy mirror file, then its now-empty board folder.
    for (const f of legacy) {
      const folder = f.parent;
      try { await this.app.fileManager.trashFile(f); } catch { /* ignore */ }
      if (folder instanceof TFolder && folder.path !== this.full("Tasks/Lists")) {
        const still = this.app.vault.getAbstractFileByPath(folder.path);
        if (still instanceof TFolder && still.children.length === 0) {
          try { await this.app.fileManager.trashFile(still); } catch { /* ignore */ }
        }
      }
    }

    // 3. Regenerate the flat mirrors.
    await this.syncTaskLists();
    return legacy.length;
  }

  // ============================================================
  // NOTES (Notes/*.md)
  // ============================================================
  loadNotes(): Note[] {
    // Body is loaded lazily via readNoteBody() when editing, to keep load sync.
    return this.listMarkdown("Notes").map((f) => {
      const m = this.frontmatter(f);
      return {
        id: f.basename,
        title: str(m.title) || f.basename,
        content: "",
        color: str(m.color) || "yellow",
        board: str(m.board),
        date: str(m.date),
        path: f.path,
      };
    });
  }

  async readNoteBody(path: string): Promise<string> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return "";
    const raw = await this.app.vault.read(f);
    if (!raw.startsWith("---")) return raw.trim();
    const end = raw.indexOf("---", 3);
    return end === -1 ? raw.trim() : raw.substring(end + 3).trim();
  }

  async saveNote(note: Partial<Note> & { title: string }): Promise<void> {
    const meta: FM = {
      title: note.title,
      color: note.color || "yellow",
      date: note.date || todayLocal(),
      type: "note",
    };
    if (note.board) meta.board = note.board;
    await this.writeFile(`Notes/${safeName(note.title)}.md`, this.buildDoc(meta, note.content || ""));
  }

  async deleteNote(note: Note): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(note.path);
    if (f instanceof TFile) await this.removeFile(f);
  }

  // ============================================================
  // HABITS (Habits/*.md)
  // ============================================================
  loadHabits(): Habit[] {
    return this.listMarkdown("Habits").map((f) => {
      const m = this.frontmatter(f);
      return {
        id: str(m.id) || f.basename,
        name: str(m.name) || f.basename,
        emoji: str(m.emoji) || "⭐",
        habitType: str(m.habit_type) || "do",
        log: coerce<Record<string, boolean>>(m.log, {}),
        created: str(m.created),
        lastReset: str(m.lastReset),
        modified: str(m.modified),
        path: f.path,
      };
    });
  }

  async saveHabit(h: Partial<Habit> & { name: string }): Promise<void> {
    const meta: FM = {
      id: h.id || ("h" + Date.now()),
      type: "habit",
      habit_type: h.habitType || "do",
      name: h.name,
      emoji: h.emoji || "⭐",
      log: h.log || {},
      created: h.created || todayLocal(),
      lastReset: h.lastReset || todayLocal(),
      modified: new Date().toISOString(),
    };
    await this.writeFile(`Habits/${safeName(h.name)}.md`, this.buildDoc(meta, `# ${h.name}\n`));
  }

  async toggleHabit(habit: Habit, date: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(habit.path || "");
    if (!(f instanceof TFile)) return;
    await this.patchFrontmatter(f, (fm) => {
      const log = coerce<Record<string, boolean>>(fm.log, {});
      if (log[date]) delete log[date]; else log[date] = true;
      fm.log = log;
      fm.modified = new Date().toISOString();
    });
  }

  async resetHabit(habit: Habit, date: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(habit.path || "");
    if (!(f instanceof TFile)) return;
    await this.patchFrontmatter(f, (fm) => {
      const log = coerce<Record<string, boolean>>(fm.log, {});
      log[date] = true; // record the relapse so the clean history stays visible
      fm.log = log;
      fm.lastReset = date;
      fm.modified = new Date().toISOString();
    });
  }

  /** Toggle a relapse mark on a past (or today's) day for a "quit" habit, then recompute
   *  `lastReset` as the most recent logged relapse day (or the habit's creation date if
   *  none remain) so the streak — days since the last relapse — stays correct regardless
   *  of which day was retroactively edited, not just "today". */
  async toggleHabitRelapse(habit: Habit, date: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(habit.path || "");
    if (!(f instanceof TFile)) return;
    await this.patchFrontmatter(f, (fm) => {
      const log = coerce<Record<string, boolean>>(fm.log, {});
      if (log[date]) delete log[date]; else log[date] = true;
      const relapseDays = Object.keys(log).filter((d) => log[d]).sort();
      fm.log = log;
      fm.lastReset = relapseDays.length ? relapseDays[relapseDays.length - 1] : (str(fm.created) || date);
      fm.modified = new Date().toISOString();
    });
  }

  async deleteHabit(habit: Habit): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(habit.path || "");
    if (f instanceof TFile) await this.removeFile(f);
  }

  // ============================================================
  // FITNESS
  // ============================================================

  /**
   * Applied on every loadExercises() row so `kind` (and the cardio target fields) are
   * always present, defaulting legacy files (no `kind` field) to "strength" (Req 1.2, 7.1).
   */
  private applyExerciseDefaults(m: FM): { kind: ExerciseKind; targetDistance?: number; targetDuration?: number } {
    const kind: ExerciseKind = str(m.kind) === "cardio" ? "cardio" : "strength";
    return {
      kind,
      targetDistance: m.target_distance != null ? num(m.target_distance) : undefined,
      targetDuration: m.target_duration != null ? num(m.target_duration) : undefined,
    };
  }

  loadSplits(): Split[] {
    const f = this.fileAt("Fitness/splits.md");
    if (!f) return [];
    const list = coerce<Array<Record<string, unknown>>>(this.frontmatter(f).splits, []);
    return list.map((s) => ({ id: str(s.id), name: str(s.name) })).filter((s) => s.id);
  }

  loadExercises(): Exercise[] {
    return this.listMarkdown("Fitness/Exercises").map((f) => {
      const m = this.frontmatter(f);
      return {
        name: str(m.name) || f.basename,
        split: str(m.split) || "A",
        type: str(m.equipment) || "machine",
        muscle: str(m.muscle),
        sets: str(m.sets) || "3x10",
        weight: num(m.weight),
        howto: str(m.howto),
        path: f.path,
        ...this.applyExerciseDefaults(m),
      };
    });
  }

  loadWorkouts(): Workout[] {
    // Data derived solely from frontmatter; filename is presentation only (Req 10.7).
    return this.listMarkdown("Fitness/Workouts")
      .map((f) => mapWorkout(this.frontmatter(f), f.basename, f.path))
      .filter((w) => w.date);
  }

  /** Returns false if a rename would overwrite a different existing exercise. */
  async saveExercise(ex: Exercise, originalName?: string): Promise<boolean> {
    const renaming = !!originalName && originalName !== ex.name;
    const targetRel = `Fitness/Exercises/${safeName(ex.name)}.md`;
    const targetFull = this.full(targetRel);
    const targetFile = this.app.vault.getAbstractFileByPath(targetFull);
    const originalFull = originalName ? this.full(`Fitness/Exercises/${safeName(originalName)}.md`) : null;

    // Guard: never clobber a different exercise's file when renaming.
    if (renaming && targetFile && originalFull !== targetFull) return false;

    const meta: FM = {
      name: ex.name,
      split: ex.split || "A",
      muscle: ex.muscle || "",
      sets: ex.sets || "3x10",
      weight: ex.weight || 0,
      equipment: ex.type || "machine",
      howto: ex.howto || "",
      type: "exercise",
      modified: new Date().toISOString(),
      kind: ex.kind || "strength",
    };
    if ((ex.kind || "strength") === "cardio") {
      meta.target_distance = ex.targetDistance || 0;
      meta.target_duration = ex.targetDuration || 0;
    }
    await this.writeFile(targetRel, this.buildDoc(meta, `# ${ex.name}\n`));

    if (renaming && originalFull && originalFull !== targetFull) {
      const old = this.app.vault.getAbstractFileByPath(originalFull);
      if (old instanceof TFile) await this.removeFile(old);
    }
    return true;
  }

  async deleteExercise(ex: Exercise): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(ex.path || "");
    if (f instanceof TFile) await this.removeFile(f);
  }

  async saveSplits(splits: Split[]): Promise<void> {
    await this.writeFile("Fitness/splits.md", this.buildDoc({ type: "splits-config", splits }, splitsBody(splits)));
  }

  /**
   * Per-module hub config for Fitness. `syncMonthHub` uses this to (re)generate the
   * `Fitness/Months/Fitness <YYYY-MM MonthName>.md` hub from the current workouts.
   * The rich summary (workout count, total minutes, per-split breakdown) lives in
   * `fitnessHubBody`; `summaryBody` may be async so it can await `loadConfig()` for
   * split display names.
   */
  private fitnessHubConfig(): ModuleHubConfig<Workout> {
    return {
      folder: "Fitness/Workouts",
      hubFolder: "Fitness/Months",
      module: "Fitness",
      loadItems: () => this.loadWorkouts(),
      summaryBody: (items, monthKey) => this.fitnessHubBody(items, monthKey),
      // Fitness needs a date (Req 5.8); resolve the split display name for the title
      // exactly as `logWorkout` does (config split names, else the split id).
      desiredTitle: async (fm) => {
        const date = str(fm.date).slice(0, 10);
        if (!date) return null;
        const cfg = await this.loadConfig();
        const splitName = this.resolveSplitName(str(fm.split) || "A", cfg);
        return workoutTitle({ splitName, minutes: num(fm.duration), date });
      },
    };
  }

  /**
   * Fitness hub body for a month's workouts (Req 10.5): the number of workouts, the
   * total minutes, a per-split breakdown (count + minutes per split, using the resolved
   * split display name), and a date-then-basename sorted, linked list of that month's
   * sessions. Session links use each note's basename (derived from its path) so they
   * resolve regardless of the readable filename. Split display names come from
   * `resolveSplitName` + `loadConfig()`, falling back to the split id. Given a fixed set
   * of items the output is fully deterministic (stable ordering).
   */
  private async fitnessHubBody(items: Workout[], monthKey: string): Promise<string> {
    const cfg = await this.loadConfig();
    const basename = (w: Workout) => (w.path.split("/").pop() || "").replace(/\.md$/, "");
    const sorted = [...items].sort((a, b) =>
      a.date.localeCompare(b.date) || basename(a).localeCompare(basename(b)));

    const workoutCount = sorted.length;
    const totalMinutes = sorted.reduce((s, w) => s + (Number(w.duration) || 0), 0);

    // Per-split breakdown: group by split id, count sessions and sum minutes, then
    // resolve each split's display name. Sort by display name (then split id) so the
    // ordering is stable and independent of the workouts' arrival order.
    const bySplit = new Map<string, { count: number; minutes: number }>();
    for (const w of sorted) {
      const acc = bySplit.get(w.split) || { count: 0, minutes: 0 };
      acc.count += 1;
      acc.minutes += Number(w.duration) || 0;
      bySplit.set(w.split, acc);
    }
    const splitRows = [...bySplit.entries()]
      .map(([splitId, agg]) => ({ name: this.resolveSplitName(splitId, cfg), splitId, ...agg }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.splitId.localeCompare(b.splitId));

    const int = (n: number) => Math.round(n).toString();

    // Req 6.1/6.2/6.3: total distance across cardio entries, only shown when > 0.
    // Req 6.4: a failure computing it must not abort hub regeneration — log and fall back to 0.
    let totalDistance = 0;
    try {
      totalDistance = totalCardioDistance(sorted);
    } catch {
      totalDistance = 0;
    }

    const year = monthKey.slice(0, 4);
    let body = `# Fitness — ${monthName(monthKey)} ${year}\n\n`;
    body += `**Workouts:** ${workoutCount}\n`;
    body += `**Total minutes:** ${int(totalMinutes)} min\n`;
    if (totalDistance > 0) body += `**Total distance:** ${totalDistance.toFixed(2)} km\n`;
    body += `\n## By split\n\n`;
    for (const r of splitRows) {
      body += `- ${r.name}: ${r.count} workout${r.count === 1 ? "" : "s"}, ${int(r.minutes)} min\n`;
    }
    body += `\n## Sessions\n\n`;
    for (const w of sorted) body += `- [[${basename(w)}]]\n`;
    return body;
  }

  /**
   * Resolve a split's display name (Req 10.2): configured `split_names` map first,
   * then a `custom_splits` entry by id, then the `Fitness/splits.md` list, and finally
   * fall back to the split id itself so a name is always produced.
   */
  private resolveSplitName(splitId: string, cfg: PAConfig): string {
    const configured = (cfg.splitNames?.[splitId] || "").trim();
    if (configured) return configured;
    const custom = (cfg.customSplits || []).find((s) => s.id === splitId);
    if (custom && (custom.name || "").trim()) return custom.name.trim();
    const listed = this.loadSplits().find((s) => s.id === splitId);
    if (listed && (listed.name || "").trim()) return listed.name.trim();
    return splitId;
  }

  async logWorkout(splitId: string, duration: number, exercises: WorkoutExercise[], date: string = todayLocal()): Promise<void> {
    const cfg = await this.loadConfig();
    const splitName = this.resolveSplitName(splitId, cfg);
    const meta: FM = {
      id: Date.now(),
      type: "workout-log",
      date,
      split: splitId,
      duration,
      exercises,
      kind: deriveWorkoutKind(exercises),
      logged: new Date().toISOString(),
    };
    const monthKey = monthKeyOf(date);
    const hubLink = `[[${monthHubTitle("Fitness", monthKey)}]]`;
    let baseBody = `# ${splitName} - ${date}\n\n`;
    exercises.forEach((e) => {
      baseBody += `- ${e.exercise}: ${e.weight}kg x ${e.sets}${e.feel ? ` (${e.feel})` : ""}\n`;
    });
    // mergeBody adds the hub wikilink at most once (Req 10.3), preserving user lines.
    const body = mergeBody(baseBody, hubLink);
    const title = workoutTitle({ splitName, minutes: duration, date });
    const rel = this.uniquePath("Fitness/Workouts", title);
    await this.writeFile(rel, this.buildDoc(meta, body));
    await this.syncMonthHub(this.fitnessHubConfig(), monthKey);
  }

  async updateWorkoutExercises(workout: Workout, exercises: WorkoutExercise[]): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(workout.path);
    if (!(f instanceof TFile)) return;
    await this.patchFrontmatter(f, (fm) => {
      fm.exercises = exercises;
      fm.kind = deriveWorkoutKind(exercises);
      fm.modified = new Date().toISOString();
    });
  }

  async deleteWorkout(workout: Workout): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(workout.path);
    if (f instanceof TFile) await this.removeFile(f);
    // Regenerate the affected month's Fitness hub; removes it when this was the
    // last workout of the month (keeps the Graph View clean).
    await this.syncMonthHub(this.fitnessHubConfig(), monthKeyOf(workout.date));
  }

  // ============================================================
  // STUDIES
  // ============================================================
  loadStudyCards(): StudyCard[] {
    return this.listMarkdown("Studies")
      .filter((f) => f.name !== "boards.md")
      .map((f) => {
        const m = this.frontmatter(f);
        return {
          id: str(m.id) || f.basename,
          title: str(m.title) || f.basename,
          topic: str(m.topic),
          subtopic: str(m.subtopic),
          status: str(m.status) || "backlog",
          url: str(m.url),
          date: str(m.date),
          modified: str(m.modified),
          order: (m.order !== undefined && m.order !== null) ? Number(m.order) : undefined,
          path: f.path,
        };
      });
  }

  async saveStudyBoards(boards: Board[]): Promise<void> {
    await this.writeFile(
      "Studies/boards.md",
      this.buildDoc({ type: "study-boards-config", boards }, boardsBody("Study topics", boards))
    );
  }

  private studyCardDoc(c: Partial<StudyCard>, existing?: FM): string {
    const meta: FM = {
      id: c.id || existing?.id || cryptoId(),
      title: c.title,
      topic: c.topic || "",
      subtopic: c.subtopic || "",
      status: c.status || "backlog",
      url: c.url || "",
      date: c.date || existing?.date || todayLocal(),
      created: existing?.created || new Date().toISOString(),
      modified: new Date().toISOString(),
      type: "study",
    };
    if (c.order !== undefined) meta.order = c.order;
    else if (existing?.order !== undefined) meta.order = existing.order;
    return this.buildDoc(meta, `# ${c.title}\n`);
  }

  /** Patch status and/or order of a study card in place. */
  async patchStudyCardMeta(card: StudyCard, changes: { status?: string; order?: number }): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(card.path);
    if (!(f instanceof TFile)) return;
    await this.patchFrontmatter(f, (fm) => {
      if (changes.status !== undefined) fm.status = changes.status;
      if (changes.order !== undefined) fm.order = changes.order;
      fm.modified = new Date().toISOString();
    });
  }

  async createStudyCard(c: Partial<StudyCard> & { title: string; topic: string }): Promise<void> {
    await this.writeFile(this.uniquePath(`Studies/${c.topic}`, c.title), this.studyCardDoc(c));
  }

  async updateStudyCardStatus(card: StudyCard, status: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(card.path);
    if (!(f instanceof TFile)) return;
    await this.patchFrontmatter(f, (fm) => {
      fm.status = status;
      fm.modified = new Date().toISOString();
    });
  }

  /** Returns false if a rename would overwrite a different existing study card. */
  async updateStudyCard(card: StudyCard, changes: Partial<StudyCard>): Promise<boolean> {
    const merged: StudyCard = { ...card, ...changes };
    const f = this.app.vault.getAbstractFileByPath(card.path);
    const file = f instanceof TFile ? f : null;
    const renamed = merged.title !== card.title || merged.topic !== card.topic;
    if (file && !renamed) {
      await this.patchFrontmatter(file, (fm) => {
        fm.subtopic = merged.subtopic || "";
        fm.status = merged.status || "backlog";
        fm.url = merged.url || "";
        fm.modified = new Date().toISOString();
      });
      return true;
    }
    const targetFull = this.full(`Studies/${merged.topic}/${safeName(merged.title)}.md`);
    const targetExisting = this.app.vault.getAbstractFileByPath(targetFull);
    // Guard: never clobber a different card on rename/move.
    if (renamed && targetExisting && targetExisting !== file) return false;
    const existing = file ? this.frontmatter(file) : undefined;
    await this.writeFile(`Studies/${merged.topic}/${safeName(merged.title)}.md`, this.studyCardDoc(merged, existing));
    if (file && renamed) await this.removeFile(file);
    return true;
  }

  async deleteStudyCard(card: StudyCard): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(card.path);
    if (f instanceof TFile) await this.removeFile(f);
  }

  // ============================================================
  // NUTRITION
  // ============================================================
  loadMeals(): Meal[] {
    return this.listMarkdown("Nutrition/Plan").map((f) => {
      const m = this.frontmatter(f);
      return {
        id: str(m.id) || f.basename,
        name: str(m.name) || f.basename,
        emoji: str(m.emoji),
        totalCal: num(m.total_cal),
        items: coerce<MealItem[]>(m.items, []),
        path: f.path,
      };
    });
  }

  loadMealLogs(): MealLog[] {
    // Data derived solely from frontmatter; filename is presentation only (Req 9.8).
    return this.listMarkdown("Nutrition/Logs")
      .map((f) => mapMealLog(this.frontmatter(f), f.basename, f.path))
      .filter((l) => l.date);
  }

  async saveMeal(meal: Partial<Meal> & { name: string; items: MealItem[] }): Promise<void> {
    const total = meal.items.reduce((s, it) => s + (Number(it.cal) || 0), 0);
    const id = meal.id || ("m" + Date.now());
    const meta: FM = {
      type: "meal-plan",
      id,
      name: meal.name,
      emoji: meal.emoji || "",
      total_cal: total,
      items: meal.items,
    };
    let body = `# ${meal.emoji || ""} ${meal.name} (${total} cal)\n\n`;
    meal.items.forEach((it) => { body += `- ${it.name}: ${it.qty || 0}${it.unit || ""} (${it.cal || 0} cal)\n`; });
    await this.writeFile(`Nutrition/Plan/${safeName(id)}.md`, this.buildDoc(meta, body));
  }

  async deleteMeal(meal: Meal): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(meal.path);
    if (f instanceof TFile) await this.removeFile(f);
  }

  /**
   * Per-module hub config for Nutrition. `syncMonthHub` uses this to (re)generate the
   * `Nutrition/Months/Nutrition <YYYY-MM MonthName>.md` hub from the current meal logs.
   * The rich summary (total calories, avg/day, days logged, protein/carbs) lives in
   * `nutritionHubBody` (task 5.2).
   */
  private nutritionHubConfig(): ModuleHubConfig<MealLog> {
    return {
      folder: "Nutrition/Logs",
      hubFolder: "Nutrition/Months",
      module: "Nutrition",
      loadItems: () => this.loadMealLogs(),
      summaryBody: (items, monthKey) => this.nutritionHubBody(items, monthKey),
      // Nutrition needs a date (Req 5.8); resolve the meal display name for the title
      // as `logMeal` does (meal_name frontmatter, else meals lookup by id, else id).
      desiredTitle: (fm) => {
        const date = str(fm.date).slice(0, 10);
        if (!date) return null;
        return mealLogTitle({ mealName: this.resolveMealName(fm), kcal: num(fm.calories), date });
      },
    };
  }

  /**
   * Resolve a meal log's display name for the readable filename (Req 9.2 order,
   * frontmatter-only): the persisted `meal_name`, else a `Nutrition/Plan` lookup by
   * the `meal` id, else the raw `meal` id so a name is always produced.
   */
  private resolveMealName(fm: Record<string, unknown>): string {
    const persisted = str(fm.meal_name).trim();
    if (persisted) return persisted;
    const mealId = str(fm.meal);
    const meal = this.loadMeals().find((m) => m.id === mealId);
    if (meal && (meal.name || "").trim()) return meal.name.trim();
    return mealId;
  }

  /**
   * Deterministic Nutrition hub body for a month's meal logs (Req 9.6):
   *   # Nutrition — <MonthName> <Year>
   *   **Total calories / Avg per day / Days logged / Total protein / Total carbs**
   *   ## Logs — date-then-basename sorted, linked list of that month's logs.
   * Calories are rounded to integers; protein/carbs to one decimal. The average is
   * total calories divided by the number of DISTINCT days logged (never by 0). Log
   * links use each note's basename (derived from its path) so they resolve regardless
   * of the readable filename. Given a fixed set of items the output is fully
   * deterministic (stable ordering).
   */
  private nutritionHubBody(items: MealLog[], monthKey: string): string {
    const basename = (l: MealLog) => (l.path.split("/").pop() || "").replace(/\.md$/, "");
    const sorted = [...items].sort((a, b) =>
      a.date.localeCompare(b.date) || basename(a).localeCompare(basename(b)));

    const totalCal = sorted.reduce((s, l) => s + (Number(l.totalCal) || 0), 0);
    const totalProtein = sorted.reduce((s, l) => s + (Number(l.totalProtein) || 0), 0);
    const totalCarbs = sorted.reduce((s, l) => s + (Number(l.totalCarbs) || 0), 0);
    const daysLogged = new Set(sorted.map((l) => l.date)).size;
    const avgPerDay = daysLogged ? totalCal / daysLogged : 0;

    const int = (n: number) => Math.round(n).toString();
    const grams = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}g`;

    const year = monthKey.slice(0, 4);
    let body = `# Nutrition — ${monthName(monthKey)} ${year}\n\n`;
    body += `**Total calories:** ${int(totalCal)} cal\n`;
    body += `**Avg per day:** ${int(avgPerDay)} cal\n`;
    body += `**Days logged:** ${daysLogged}\n`;
    body += `**Total protein:** ${grams(totalProtein)}\n`;
    body += `**Total carbs:** ${grams(totalCarbs)}\n\n`;
    body += `## Logs\n\n`;
    for (const l of sorted) body += `- [[${basename(l)}]]\n`;
    return body;
  }

  async logMeal(meal: Meal, items: MealItem[], date: string = todayLocal()): Promise<void> {
    const totalCal = items.reduce((s, it) => s + (Number(it.cal) || 0), 0);
    const totalProtein = items.reduce((s, it) => s + (Number(it.protein) || 0), 0);
    const totalCarbs = items.reduce((s, it) => s + (Number(it.carbs) || 0), 0);
    // Resolve the meal display name (Req 9.2 order: meal_name → meals lookup → body
    // heading → meal id). At log time we hold the Meal object, so prefer its name and
    // fall back to the id. Persisting it as `meal_name` (Req 9.3) keeps future naming
    // stable even if the meal plan is renamed or deleted.
    const mealName = (meal.name || "").trim() || meal.id;
    const meta: FM = {
      id: Date.now(),
      type: "meal-log",
      date,
      meal: meal.id,
      meal_name: mealName,
      calories: totalCal,
      protein: totalProtein,
      carbs: totalCarbs,
      items,
      logged: new Date().toISOString(),
    };
    const monthKey = monthKeyOf(date);
    const hubLink = `[[${monthHubTitle("Nutrition", monthKey)}]]`;
    let baseBody = `# ${mealName} - ${date}\n\n`;
    items.forEach((it) => { baseBody += `- ${it.name}: ${it.qty}${it.unit} (${it.cal} cal)\n`; });
    baseBody += `\nTotal: ${totalCal} cal\n`;
    // mergeBody adds the hub wikilink at most once (Req 9.4), preserving user lines.
    const body = mergeBody(baseBody, hubLink);
    const title = mealLogTitle({ mealName, kcal: totalCal, date });
    const rel = this.uniquePath("Nutrition/Logs", title);
    await this.writeFile(rel, this.buildDoc(meta, body));
    await this.syncMonthHub(this.nutritionHubConfig(), monthKey);
  }

  async deleteMealLog(log: MealLog): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(log.path);
    if (f instanceof TFile) await this.removeFile(f);
    // Regenerate the affected month's Nutrition hub; removes it when this was the
    // last meal log of the month (keeps the Graph View clean).
    await this.syncMonthHub(this.nutritionHubConfig(), monthKeyOf(log.date));
  }

  // ---- Water (stored in Nutrition/water.md as a {date: liters} map) ----
  loadWaterLog(): Record<string, number> {
    const f = this.fileAt("Nutrition/water.md");
    if (!f) return {};
    return coerce<Record<string, number>>(this.frontmatter(f).log, {});
  }

  async addWater(date: string, deltaLiters: number): Promise<void> {
    const f = this.fileAt("Nutrition/water.md");
    if (f) {
      await this.patchFrontmatter(f, (fm) => {
        const log = coerce<Record<string, number>>(fm.log, {});
        log[date] = Math.max(0, Math.round(((log[date] || 0) + deltaLiters) * 100) / 100);
        fm.log = log;
        fm.modified = new Date().toISOString();
      });
      return;
    }
    const log: Record<string, number> = {};
    log[date] = Math.max(0, deltaLiters);
    await this.writeFile("Nutrition/water.md", this.buildDoc({ type: "water-log", log, modified: new Date().toISOString() }, "# Water log\n"));
  }

  // ============================================================
  // FINANCE (Finance/Transactions/*.md)
  // ============================================================
  loadTransactions(): Transaction[] {
    // Data derived solely from frontmatter; filename is presentation only (Req 6.1/6.2).
    // The pure mapper (src/loaders.ts) is the single source of truth for field extraction
    // and is what test/loadinvariance.test.ts exercises for Correctness Property 7.
    return this.listMarkdown("Finance/Transactions")
      .map((f) => mapTransaction(this.frontmatter(f), f.basename, f.path))
      .filter((t) => t.date);
  }

  /**
   * Per-module hub config for Finance. `syncMonthHub` uses this to (re)generate the
   * `Finance/Months/Finance <YYYY-MM MonthName>.md` hub from the current transactions.
   * The full Income/Expenses/Balance + linked list summary lives in `financeHubBody`
   * (task 4.2); this method just wires the pieces together.
   */
  private financeHubConfig(): ModuleHubConfig<Transaction> {
    return {
      folder: "Finance/Transactions",
      hubFolder: "Finance/Months",
      module: "Finance",
      loadItems: () => this.loadTransactions(),
      summaryBody: (items, monthKey) => this.financeHubBody(items, monthKey),
      // Finance needs a date AND an amount (Req 5.8); the readable title is built by
      // `financeTxTitle` exactly as `addTransaction` does.
      desiredTitle: (fm) => {
        const date = str(fm.date).slice(0, 10);
        if (!date || fm.amount == null) return null;
        return financeTxTitle({
          category: str(fm.category) || "Other",
          note: str(fm.note),
          amount: num(fm.amount),
          date,
        });
      },
    };
  }

  /**
   * Deterministic hub body for a month's transactions:
   *   # <MonthName> <Year>
   *   **Income / Expenses / Balance** in the configured currency
   *   ## Transactions — date-then-title sorted, linked, each with its signed amount.
   * Money is formatted with the configured `currency` (loadConfig()) using the same
   * grouping + 2-decimal style as the UI `fmt` helper. Given a fixed set of items and
   * currency the output is fully deterministic (stable ordering).
   */
  private async financeHubBody(items: Transaction[], monthKey: string): Promise<string> {
    const cur = (await this.loadConfig()).currency || "$";
    const money = (n: number) =>
      `${cur}${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const sorted = [...items].sort((a, b) =>
      a.date.localeCompare(b.date) || financeTxTitle(a).localeCompare(financeTxTitle(b)));

    const income = sorted.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expense = sorted.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);

    const year = monthKey.slice(0, 4);
    let body = `# ${monthName(monthKey)} ${year}\n\n`;
    body += `**Income:** ${money(income)}\n`;
    body += `**Expenses:** ${money(expense)}\n`;
    body += `**Balance:** ${money(income - expense)}\n\n`;
    body += `## Transactions\n\n`;
    for (const t of sorted) {
      const sign = t.type === "income" ? "+" : "-";
      body += `- [[${financeTxTitle(t)}]] — ${sign}${money(t.amount)}\n`;
    }
    return body;
  }

  async addTransaction(t: { type: string; amount: number; category: string; note?: string }, date: string = todayLocal()): Promise<void> {
    const tx_type = t.type === "income" ? "income" : "expense";
    const category = t.category || "Other";
    const meta: FM = {
      id: Date.now(),
      type: "transaction",
      tx_type,
      date,
      amount: t.amount,
      category,
      note: t.note || "",
      logged: new Date().toISOString(),
    };
    const monthKey = monthKeyOf(date);
    const sign = tx_type === "income" ? "+" : "-";
    const hubLink = `[[${monthHubTitle("Finance", monthKey)}]]`;
    const baseBody = `# ${category} ${sign}${formatAmount(t.amount)}\n\n${t.note || ""}\n`;
    const body = mergeBody(baseBody, hubLink);
    const title = financeTxTitle({ category, note: t.note, amount: t.amount, date });
    const rel = this.uniquePath("Finance/Transactions", title);
    await this.writeFile(rel, this.buildDoc(meta, body));
    await this.syncMonthHub(this.financeHubConfig(), monthKey);
  }

  async deleteTransaction(t: Transaction): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(t.path);
    if (f instanceof TFile) await this.removeFile(f);
    // Regenerate the affected month's hub; removes it when this was the last
    // transaction of the month (keeps the Graph View clean).
    await this.syncMonthHub(this.financeHubConfig(), monthKeyOf(t.date));
  }

  loadRecurring(): RecurringItem[] {
    const f = this.fileAt("Finance/recurring.md");
    if (!f) return [];
    const list = coerce<Array<Record<string, unknown>>>(this.frontmatter(f).items, []);
    return list.map((r) => ({
      id: str(r.id) || ("r" + Math.random().toString(36).slice(2, 8)),
      type: str(r.type) === "income" ? "income" : "expense",
      category: str(r.category) || "Other",
      amount: num(r.amount),
      note: str(r.note),
      freq: str(r.freq) === "weekly" ? "weekly" : "monthly",
      day: r.day != null ? num(r.day) : undefined,
      weekday: r.weekday != null ? num(r.weekday) : undefined,
    })).filter((r) => r.amount > 0);
  }

  async saveRecurring(items: RecurringItem[]): Promise<void> {
    const cur = (await this.loadConfig()).currency || "$";
    await this.writeFile("Finance/recurring.md", this.buildDoc({ type: "recurring-config", items }, recurringCostsBody(items, cur)));
  }
}

function ymdLocal(d: Date): string {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Human-readable markdown body for the recurring finance file. */
function recurringCostsBody(items: RecurringItem[], currency: string): string {
  const desc = (r: RecurringItem): string => {
    const when = r.freq === "weekly" ? `weekly (${WEEKDAY_NAMES[r.weekday ?? 1] || "Monday"})` : `monthly (day ${r.day ?? 1})`;
    const sign = r.type === "income" ? "+" : "-";
    const note = r.note ? ` — ${r.note}` : "";
    return `- **${r.category}** — ${sign}${currency}${r.amount} · ${when}${note}`;
  };
  const income = items.filter((r) => r.type === "income");
  const expense = items.filter((r) => r.type !== "income");
  let body = "# Recurring costs\n\n";
  if (expense.length) body += "## Expenses\n" + expense.map(desc).join("\n") + "\n\n";
  if (income.length) body += "## Income\n" + income.map(desc).join("\n") + "\n\n";
  if (!items.length) body += "_No recurring items yet._\n";
  return body;
}

/** Human-readable markdown body for a boards file. */
function boardsBody(title: string, boards: Board[]): string {
  const lines = boards.map((b) => `- ${b.emoji ? b.emoji + " " : ""}**${b.name}**`);
  return `# ${title}\n\n` + (lines.length ? lines.join("\n") + "\n" : "_None yet._\n");
}

/** Human-readable markdown body for the workout splits file. */
function splitsBody(splits: Split[]): string {
  const lines = splits.map((s) => `- **${s.name}**`);
  return "# Workout splits\n\n" + (lines.length ? lines.join("\n") + "\n" : "_No splits yet._\n");
}

function cryptoId(): string {
  try {
    // @ts-ignore
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* noop */ }
  return "t" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}
