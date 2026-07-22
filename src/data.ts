import { App, TFile, TFolder, normalizePath } from "obsidian";
import {
  Board, Task, Note, Habit, Exercise, Workout, WorkoutExercise, Split,
  StudyCard, Meal, MealItem, MealLog, Transaction, RecurringItem, RecurringTask, PAConfig, defaultConfig,
} from "./types";
import { todayLocal } from "./util";

/** Root folder inside the vault that holds all Personal Assistant data. */
export let DATA_ROOT = "Momentum Life";
export function setDataRoot(root: string) { DATA_ROOT = root || ""; }

type FM = Record<string, unknown>;

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
    if (m.expense_categories) cfg.expenseCategories = coerce(m.expense_categories, cfg.expenseCategories);
    if (m.income_categories) cfg.incomeCategories = coerce(m.income_categories, cfg.incomeCategories);
    return cfg;
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
      expense_categories: cfg.expenseCategories,
      income_categories: cfg.incomeCategories,
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

  loadBoards(): Board[] { return this.boardsFrom(this.fileAt("Tasks/boards.md")); }
  loadStudyBoards(): Board[] { return this.boardsFrom(this.fileAt("Studies/boards.md")); }

  async saveBoards(boards: Board[]): Promise<void> {
    await this.writeFile("Tasks/boards.md", this.buildDoc({ type: "boards-config", boards }, boardsBody("Task boards", boards)));
  }

  // ============================================================
  // TASKS
  // ============================================================
  loadTasks(): Task[] {
    const listsPrefix = this.full("Tasks/Lists") + "/";
    return this.listMarkdown("Tasks")
      .filter((f) => f.name !== "boards.md" && !f.path.startsWith(listsPrefix))
      .map((f) => {
        const m = this.frontmatter(f);
        return {
          id: str(m.task_id) || f.basename,
          title: str(m.title) || f.basename,
          status: str(m.status) || "backlog",
          priority: str(m.priority) || "medium",
          cat: str(m.category) || "work",
          group: str(m.group),
          kanbanId: str(m["kanban-id"]),
          kanbanName: str(m.kanban_name || m["kanban-name"]),
          due: str(m.due),
          scheduled: str(m.scheduled),
          duration: num(m.duration),
          isAllDay: !!m.is_all_day,
          created: str(m.created),
          modified: str(m.modified),
          order: (m.order !== undefined && m.order !== null) ? Number(m.order) : undefined,
          eisenhower: str(m.eisenhower),
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

  async createTask(t: Partial<Task>): Promise<void> {
    const title = t.title || "Untitled";
    const meta: FM = {
      task_id: cryptoId(),
      title,
      status: t.status || "backlog",
      priority: t.priority || "medium",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      type: "task",
      kanban_name: t.kanbanName || "",
      group: t.group || "",
    };
    if (t.due) meta.due = t.due;
    if (t.eisenhower) meta.eisenhower = t.eisenhower;
    await this.writeFile(this.uniquePath("Tasks", title), this.buildDoc(meta, `# ${title}\n`));
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
      if (changes.kanbanName !== undefined) fm.kanban_name = changes.kanbanName;
      if (changes.group !== undefined) fm.group = changes.group;
      if (changes.due !== undefined) fm.due = changes.due;
      if (changes.order !== undefined) fm.order = changes.order;
      if (changes.eisenhower !== undefined) fm.eisenhower = changes.eisenhower;
      fm.modified = new Date().toISOString();
    });
  }

  async deleteTask(task: Task): Promise<void> {
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
      const rel = `Tasks/Lists/${safeName(g)}/tasks.md`;
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

  /** Apply checkbox toggles from a list mirror file back to the board tasks. Returns true if anything changed. */
  async applyTaskListFile(file: TFile): Promise<boolean> {
    const cfg = await this.loadConfig();
    const cols = cfg.taskColumns;
    const colSet = new Set(cols);
    const doneCol = cols.includes("done") ? "done" : cols[cols.length - 1];
    const firstCol = cols[0];
    const boardName = file.parent?.name ?? "";
    const content = await this.app.vault.read(file);
    const tasks = this.loadTasks();
    const eff = (t: Task) => (colSet.has(t.status) ? t.status : cols[0]);
    let changed = false;
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*-\s*\[( |x|X)\]\s+(.*)$/);
      if (!m) continue;
      const checked = m[1].toLowerCase() === "x";
      const title = m[2].trim();
      const t = tasks.find((x) => safeName(this.taskGroup(x)) === boardName && x.title === title);
      if (!t) continue;
      const isDone = eff(t) === doneCol;
      if (checked && !isDone) { await this.updateTask(t, { status: doneCol }); changed = true; }
      else if (!checked && isDone) { await this.updateTask(t, { status: firstCol }); changed = true; }
    }
    return changed;
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

  async deleteHabit(habit: Habit): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(habit.path || "");
    if (f instanceof TFile) await this.removeFile(f);
  }

  // ============================================================
  // FITNESS
  // ============================================================
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
      };
    });
  }

  loadWorkouts(): Workout[] {
    return this.listMarkdown("Fitness/Workouts").map((f) => {
      const m = this.frontmatter(f);
      return {
        id: str(m.id) || f.basename,
        date: str(m.date).substring(0, 10),
        split: str(m.split) || "A",
        duration: num(m.duration),
        exercises: coerce<WorkoutExercise[]>(m.exercises, []),
        path: f.path,
      };
    }).filter((w) => w.date);
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
    };
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

  async logWorkout(splitId: string, duration: number, exercises: WorkoutExercise[], date: string = todayLocal()): Promise<void> {
    const now = new Date();
    const time = String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0");
    const meta: FM = {
      id: Date.now(),
      type: "workout-log",
      date,
      split: splitId,
      duration,
      exercises,
      logged: new Date().toISOString(),
    };
    let body = `# Treino ${splitId} - ${date}\n\n`;
    exercises.forEach((e) => {
      body += `- ${e.exercise}: ${e.weight}kg x ${e.sets}${e.feel ? ` (${e.feel})` : ""}\n`;
    });
    await this.writeFile(`Fitness/Workouts/${date}-${splitId}-${time}-${Math.random().toString(36).slice(2, 7)}.md`, this.buildDoc(meta, body));
  }

  async updateWorkoutExercises(workout: Workout, exercises: WorkoutExercise[]): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(workout.path);
    if (!(f instanceof TFile)) return;
    await this.patchFrontmatter(f, (fm) => { fm.exercises = exercises; fm.modified = new Date().toISOString(); });
  }

  async deleteWorkout(workout: Workout): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(workout.path);
    if (f instanceof TFile) await this.removeFile(f);
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
    return this.listMarkdown("Nutrition/Logs").map((f) => {
      const m = this.frontmatter(f);
      return {
        id: str(m.id) || f.basename,
        date: str(m.date).substring(0, 10),
        mealId: str(m.meal),
        totalCal: num(m.calories),
        totalProtein: num(m.protein),
        totalCarbs: num(m.carbs),
        items: coerce<MealItem[]>(m.items, []),
        path: f.path,
      };
    }).filter((l) => l.date);
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

  async logMeal(meal: Meal, items: MealItem[], date: string = todayLocal()): Promise<void> {
    const now = new Date();
    const time = String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0");
    const totalCal = items.reduce((s, it) => s + (Number(it.cal) || 0), 0);
    const totalProtein = items.reduce((s, it) => s + (Number(it.protein) || 0), 0);
    const totalCarbs = items.reduce((s, it) => s + (Number(it.carbs) || 0), 0);
    const meta: FM = {
      id: Date.now(),
      date,
      meal: meal.id,
      calories: totalCal,
      protein: totalProtein,
      carbs: totalCarbs,
      items,
      logged: new Date().toISOString(),
    };
    let body = `# ${meal.name} - ${date}\n\n`;
    items.forEach((it) => { body += `- ${it.name}: ${it.qty}${it.unit} (${it.cal} cal)\n`; });
    body += `\nTotal: ${totalCal} cal\n`;
    await this.writeFile(`Nutrition/Logs/${date}-${meal.id}-${time}.md`, this.buildDoc(meta, body));
  }

  async deleteMealLog(log: MealLog): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(log.path);
    if (f instanceof TFile) await this.removeFile(f);
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
    return this.listMarkdown("Finance/Transactions").map((f) => {
      const m = this.frontmatter(f);
      return {
        id: str(m.id) || f.basename,
        date: str(m.date).substring(0, 10),
        type: str(m.tx_type) || "expense",
        amount: num(m.amount),
        category: str(m.category) || "Other",
        note: str(m.note),
        path: f.path,
      };
    }).filter((t) => t.date);
  }

  async addTransaction(t: { type: string; amount: number; category: string; note?: string }, date: string = todayLocal()): Promise<void> {
    const now = new Date();
    const time = String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0") + String(now.getSeconds()).padStart(2, "0");
    const meta: FM = {
      id: Date.now(),
      type: "transaction",
      tx_type: t.type === "income" ? "income" : "expense",
      date,
      amount: t.amount,
      category: t.category || "Other",
      note: t.note || "",
      logged: new Date().toISOString(),
    };
    const sign = t.type === "income" ? "+" : "-";
    const body = `# ${t.category} ${sign}${t.amount}\n\n${t.note || ""}\n`;
    const rand = Math.random().toString(36).slice(2, 7);
    await this.writeFile(`Finance/Transactions/${date}-${meta.tx_type as string}-${time}-${rand}.md`, this.buildDoc(meta, body));
  }

  async deleteTransaction(t: Transaction): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(t.path);
    if (f instanceof TFile) await this.removeFile(f);
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

  // ============================================================
  // RECURRING TASKS
  // ============================================================
  loadRecurringTasks(): RecurringTask[] {
    const f = this.fileAt("Tasks/recurring.md");
    if (!f) return [];
    const list = coerce<Array<Record<string, unknown>>>(this.frontmatter(f).items, []);
    return list.map((r) => ({
      id: str(r.id) || ("rt" + Math.random().toString(36).slice(2, 8)),
      title: str(r.title),
      board: str(r.board),
      priority: str(r.priority) || "medium",
      eisenhower: str(r.eisenhower),
      freq: ["daily", "weekly", "monthly"].includes(str(r.freq)) ? str(r.freq) : "weekly",
      weekday: r.weekday != null ? num(r.weekday) : undefined,
      interval: r.interval != null ? num(r.interval) : undefined,
      anchor: str(r.anchor),
      day: r.day != null ? num(r.day) : undefined,
      lastGenerated: str(r.lastGenerated),
    })).filter((r) => r.title.trim().length > 0);
  }

  async saveRecurringTasks(items: RecurringTask[]): Promise<void> {
    await this.writeFile("Tasks/recurring.md", this.buildDoc({ type: "recurring-tasks-config", items }, recurringTasksBody(items)));
  }

  /** The most recent occurrence date (<= today) for a rule, or null if none is due yet. */
  private lastOccurrence(rule: RecurringTask, now: Date): Date | null {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (rule.freq === "daily") return today;
    if (rule.freq === "weekly") {
      const wd = rule.weekday ?? 1;
      const back = (today.getDay() - wd + 7) % 7;
      const occ = new Date(today);
      occ.setDate(today.getDate() - back); // most recent <wd> on/before today
      const interval = Math.min(Math.max(rule.interval ?? 1, 1), 4);
      if (interval <= 1) return occ;
      // Align to the N-week phase defined by the anchor.
      const anchor = rule.anchor ? new Date(rule.anchor + "T00:00:00") : occ;
      if (isNaN(anchor.getTime())) return occ;
      const cur = new Date(occ);
      while (cur.getTime() >= anchor.getTime()) {
        const weeks = Math.round((cur.getTime() - anchor.getTime()) / (7 * 86400000));
        if (weeks % interval === 0) return cur;
        cur.setDate(cur.getDate() - 7);
      }
      return null;
    }
    // monthly
    const day = Math.min(Math.max(rule.day ?? 1, 1), 28);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), day);
    if (thisMonth.getTime() <= today.getTime()) return thisMonth;
    return new Date(today.getFullYear(), today.getMonth() - 1, day);
  }

  /**
   * Create task instances for any recurring rule whose current occurrence hasn't
   * been generated yet. Returns the titles of tasks that were created.
   */
  async generateDueRecurringTasks(): Promise<string[]> {
    const rules = this.loadRecurringTasks();
    if (!rules.length) return [];
    const now = new Date();
    const created: string[] = [];
    let changed = false;
    for (const rule of rules) {
      const occ = this.lastOccurrence(rule, now);
      if (!occ) continue;
      const occStr = ymdLocal(occ);
      if (rule.lastGenerated && rule.lastGenerated >= occStr) continue;
      await this.createTask({
        title: rule.title,
        priority: rule.priority || "medium",
        kanbanName: rule.board || "",
        due: occStr,
        eisenhower: rule.eisenhower || "",
      });
      rule.lastGenerated = occStr;
      created.push(rule.title);
      changed = true;
    }
    if (changed) await this.saveRecurringTasks(rules);
    return created;
  }
}

function ymdLocal(d: Date): string {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Human-readable markdown body for the recurring-tasks file (JSON in frontmatter stays the source of truth). */
function recurringTasksBody(items: RecurringTask[]): string {
  const desc = (r: RecurringTask): string => {
    let when: string;
    if (r.freq === "daily") when = "every day";
    else if (r.freq === "weekly") {
      const wd = WEEKDAY_NAMES[r.weekday ?? 1] || "Monday";
      const n = Math.min(Math.max(r.interval ?? 1, 1), 4);
      when = n <= 1 ? `every ${wd}` : `every ${n} weeks on ${wd}`;
    } else when = `monthly on day ${r.day ?? 1}`;
    const extras = [r.board, r.priority ? `${r.priority} priority` : ""].filter(Boolean).join(" · ");
    return `- **${r.title}** — ${when}${extras ? ` · ${extras}` : ""}`;
  };
  const lines = items.map(desc);
  return "# Recurring tasks\n\n" + (lines.length ? lines.join("\n") + "\n" : "_No recurring tasks yet._\n");
}

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
