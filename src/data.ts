import { App, TFile, TFolder, normalizePath } from "obsidian";
import {
  Board, Task, Note, Habit, Exercise, Workout, WorkoutExercise, Split,
  StudyCard, Meal, MealItem, MealLog, PAConfig, defaultConfig,
} from "./types";
import { todayLocal } from "./util";

/** Root folder inside the vault that holds all Personal Assistant data. */
export let DATA_ROOT = "Personal Assistant";
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
    await this.writeFile("Tasks/boards.md", this.buildDoc({ type: "boards-config", boards }, "# Boards\n"));
  }

  // ============================================================
  // TASKS
  // ============================================================
  loadTasks(): Task[] {
    return this.listMarkdown("Tasks")
      .filter((f) => f.name !== "boards.md")
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
      fm.modified = new Date().toISOString();
    });
  }

  async deleteTask(task: Task): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(task.path);
    if (f instanceof TFile) await this.removeFile(f);
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
    await this.writeFile("Fitness/splits.md", this.buildDoc({ type: "splits-config", splits }, "# Workout Splits\n"));
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
    await this.writeFile(`Fitness/Workouts/${date}-${splitId}-${time}.md`, this.buildDoc(meta, body));
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
      this.buildDoc({ type: "study-boards-config", boards }, "# Study Boards\n")
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
}

function cryptoId(): string {
  try {
    // @ts-ignore
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* noop */ }
  return "t" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}
