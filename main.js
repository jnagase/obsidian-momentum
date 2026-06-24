var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PersonalAssistantPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian5 = require("obsidian");

// src/data.ts
var import_obsidian = require("obsidian");

// src/types.ts
var DEFAULT_TASK_COLUMNS = ["todo", "in progress", "done"];
var DEFAULT_TASK_COLUMN_NAMES = {
  todo: "\u{1F4CC} BACKLOG",
  "in progress": "\u{1F504} IN PROGRESS",
  done: "\u2705 DONE",
  "on-hold": "On-hold"
};
var DEFAULT_STUDY_COLUMNS = ["backlog", "in progress", "done"];
var DEFAULT_STUDY_COLUMN_NAMES = {
  backlog: "\u{1F4CC} BACKLOG",
  "in progress": "\u{1F504} IN PROGRESS",
  done: "\u2705 DONE"
};
var DEFAULT_SPLITS = [
  { id: "A", name: "Peito/Ombro/Tr\xEDceps" },
  { id: "B", name: "Costas/B\xEDceps" },
  { id: "C", name: "Pernas" },
  { id: "D", name: "Core/Lombar" }
];
function defaultConfig() {
  return {
    calorieTarget: 2e3,
    proteinTarget: 120,
    carbsTarget: 200,
    waterTarget: 2.5,
    taskColumns: DEFAULT_TASK_COLUMNS.slice(),
    taskColumnNames: { ...DEFAULT_TASK_COLUMN_NAMES },
    studyColumns: DEFAULT_STUDY_COLUMNS.slice(),
    studyColumnNames: { ...DEFAULT_STUDY_COLUMN_NAMES },
    studyTopics: [],
    customSplits: [],
    splitNames: {}
  };
}

// src/util.ts
function ymd(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function todayLocal() {
  return ymd(/* @__PURE__ */ new Date());
}
function daysBetween(aStr, bStr) {
  const a = /* @__PURE__ */ new Date(aStr + "T00:00:00");
  const b = /* @__PURE__ */ new Date(bStr + "T00:00:00");
  const diff = Math.round((b.getTime() - a.getTime()) / 864e5);
  return diff >= 0 ? diff : 0;
}

// src/data.ts
var DATA_ROOT = "Personal Assistant";
function setDataRoot(root) {
  DATA_ROOT = root || "";
}
function coerce(v, fallback) {
  if (v == null)
    return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }
  return v;
}
function str(v) {
  return v == null ? "" : String(v);
}
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
function safeName(title) {
  return (title || "untitled").replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim() || "untitled";
}
var PADataStore = class {
  constructor(app) {
    this.app = app;
  }
  full(path) {
    return (0, import_obsidian.normalizePath)(DATA_ROOT ? `${DATA_ROOT}/${path}` : path);
  }
  listMarkdown(folder) {
    const prefix = this.full(folder).replace(/\/$/, "") + "/";
    return this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix)).sort((a, b) => a.path.localeCompare(b.path));
  }
  fileAt(path) {
    const f = this.app.vault.getAbstractFileByPath(this.full(path));
    return f instanceof import_obsidian.TFile ? f : null;
  }
  async read(path) {
    const f = this.fileAt(path);
    return f ? await this.app.vault.read(f) : null;
  }
  frontmatter(file) {
    var _a, _b;
    return (_b = (_a = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter) != null ? _b : {};
  }
  async ensureFolder(fullPath) {
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    if (dir && !(this.app.vault.getAbstractFileByPath(dir) instanceof import_obsidian.TFolder)) {
      await this.app.vault.createFolder(dir).catch(() => {
      });
    }
  }
  /** Create a file (or overwrite body+frontmatter) at a logical path. */
  async writeFile(path, content) {
    const full = this.full(path);
    const existing = this.app.vault.getAbstractFileByPath(full);
    if (existing instanceof import_obsidian.TFile) {
      await this.app.vault.modify(existing, content);
      return existing;
    }
    await this.ensureFolder(full);
    return await this.app.vault.create(full, content);
  }
  async remove(path) {
    const f = this.fileAt(path);
    if (f)
      await this.app.fileManager.trashFile(f);
  }
  async removeFile(file) {
    await this.app.fileManager.trashFile(file);
  }
  /** Build a markdown document from a frontmatter map + body. */
  buildDoc(meta, body) {
    const lines = ["---"];
    for (const k of Object.keys(meta)) {
      const v = meta[k];
      if (v == null)
        continue;
      if (typeof v === "object")
        lines.push(`${k}: ${JSON.stringify(v)}`);
      else
        lines.push(`${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`);
    }
    lines.push("---", "", body || "");
    return lines.join("\n");
  }
  /** Update frontmatter of an existing file in place, preserving body. */
  async patchFrontmatter(file, mutate) {
    await this.app.fileManager.processFrontMatter(file, (fm) => mutate(fm));
  }
  // ============================================================
  // CONFIG
  // ============================================================
  async loadConfig() {
    const cfg = defaultConfig();
    const f = this.fileAt("Config/settings.md");
    if (!f)
      return cfg;
    const m = this.frontmatter(f);
    if (m.calorie_target)
      cfg.calorieTarget = num(m.calorie_target);
    if (m.protein_target)
      cfg.proteinTarget = num(m.protein_target);
    if (m.carbs_target)
      cfg.carbsTarget = num(m.carbs_target);
    if (m.water_target)
      cfg.waterTarget = num(m.water_target);
    if (m.task_columns)
      cfg.taskColumns = coerce(m.task_columns, cfg.taskColumns);
    if (m.task_column_names)
      cfg.taskColumnNames = coerce(m.task_column_names, cfg.taskColumnNames);
    if (m.study_columns)
      cfg.studyColumns = coerce(m.study_columns, cfg.studyColumns);
    if (m.study_column_names)
      cfg.studyColumnNames = coerce(m.study_column_names, cfg.studyColumnNames);
    if (m.study_topics)
      cfg.studyTopics = coerce(m.study_topics, cfg.studyTopics);
    if (m.custom_splits)
      cfg.customSplits = coerce(m.custom_splits, cfg.customSplits);
    if (m.split_names)
      cfg.splitNames = coerce(m.split_names, cfg.splitNames);
    return cfg;
  }
  async saveConfig(cfg) {
    const meta = {
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
      modified: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.writeFile("Config/settings.md", this.buildDoc(meta, "# Personal Assistant Config\n"));
  }
  // ============================================================
  // BOARDS (Tasks/boards.md)  +  STUDY BOARDS (Studies/boards.md)
  // ============================================================
  boardsFrom(file) {
    if (!file)
      return [];
    const m = this.frontmatter(file);
    const list = coerce(m.boards, []);
    return list.map((b) => ({ id: str(b.id), name: str(b.name), emoji: b.emoji ? str(b.emoji) : "" })).filter((b) => b.id || b.name);
  }
  loadBoards() {
    return this.boardsFrom(this.fileAt("Tasks/boards.md"));
  }
  loadStudyBoards() {
    return this.boardsFrom(this.fileAt("Studies/boards.md"));
  }
  async saveBoards(boards) {
    await this.writeFile("Tasks/boards.md", this.buildDoc({ type: "boards-config", boards }, "# Boards\n"));
  }
  // ============================================================
  // TASKS
  // ============================================================
  loadTasks() {
    return this.listMarkdown("Tasks").filter((f) => f.name !== "boards.md").map((f) => {
      const m = this.frontmatter(f);
      return {
        id: str(m.task_id) || f.basename,
        title: str(m.title) || f.basename,
        status: str(m.status) || "todo",
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
        path: f.path
      };
    });
  }
  async createTask(t) {
    const title = t.title || "Untitled";
    const meta = {
      task_id: cryptoId(),
      title,
      status: t.status || "todo",
      priority: t.priority || "medium",
      created: (/* @__PURE__ */ new Date()).toISOString(),
      modified: (/* @__PURE__ */ new Date()).toISOString(),
      type: "task",
      kanban_name: t.kanbanName || "",
      group: t.group || ""
    };
    if (t.due)
      meta.due = t.due;
    await this.writeFile(this.uniquePath("Tasks", title), this.buildDoc(meta, `# ${title}
`));
  }
  /** A vault path under `folder` for `title` that does not collide with an existing file. */
  uniquePath(folder, title) {
    const base = safeName(title);
    let rel = `${folder}/${base}.md`;
    let n = 2;
    while (this.fileAt(rel)) {
      rel = `${folder}/${base} ${n}.md`;
      n++;
    }
    return rel;
  }
  async updateTask(task, changes) {
    const f = this.app.vault.getAbstractFileByPath(task.path);
    if (!(f instanceof import_obsidian.TFile))
      return;
    await this.patchFrontmatter(f, (fm) => {
      if (changes.status !== void 0)
        fm.status = changes.status;
      if (changes.priority !== void 0)
        fm.priority = changes.priority;
      if (changes.title !== void 0)
        fm.title = changes.title;
      if (changes.kanbanName !== void 0)
        fm.kanban_name = changes.kanbanName;
      if (changes.group !== void 0)
        fm.group = changes.group;
      if (changes.due !== void 0)
        fm.due = changes.due;
      fm.modified = (/* @__PURE__ */ new Date()).toISOString();
    });
  }
  async deleteTask(task) {
    const f = this.app.vault.getAbstractFileByPath(task.path);
    if (f instanceof import_obsidian.TFile)
      await this.removeFile(f);
  }
  // ============================================================
  // NOTES (Notes/*.md)
  // ============================================================
  loadNotes() {
    return this.listMarkdown("Notes").map((f) => {
      const m = this.frontmatter(f);
      return {
        id: f.basename,
        title: str(m.title) || f.basename,
        content: "",
        color: str(m.color) || "yellow",
        board: str(m.board),
        date: str(m.date),
        path: f.path
      };
    });
  }
  async readNoteBody(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof import_obsidian.TFile))
      return "";
    const raw = await this.app.vault.read(f);
    if (!raw.startsWith("---"))
      return raw.trim();
    const end = raw.indexOf("---", 3);
    return end === -1 ? raw.trim() : raw.substring(end + 3).trim();
  }
  async saveNote(note) {
    const meta = {
      title: note.title,
      color: note.color || "yellow",
      date: note.date || todayLocal(),
      type: "note"
    };
    if (note.board)
      meta.board = note.board;
    await this.writeFile(`Notes/${safeName(note.title)}.md`, this.buildDoc(meta, note.content || ""));
  }
  async deleteNote(note) {
    const f = this.app.vault.getAbstractFileByPath(note.path);
    if (f instanceof import_obsidian.TFile)
      await this.removeFile(f);
  }
  // ============================================================
  // HABITS (Habits/*.md)
  // ============================================================
  loadHabits() {
    return this.listMarkdown("Habits").map((f) => {
      const m = this.frontmatter(f);
      return {
        id: str(m.id) || f.basename,
        name: str(m.name) || f.basename,
        emoji: str(m.emoji) || "\u2B50",
        habitType: str(m.habit_type) || "do",
        log: coerce(m.log, {}),
        created: str(m.created),
        lastReset: str(m.lastReset),
        modified: str(m.modified),
        path: f.path
      };
    });
  }
  async saveHabit(h) {
    const meta = {
      id: h.id || "h" + Date.now(),
      type: "habit",
      habit_type: h.habitType || "do",
      name: h.name,
      emoji: h.emoji || "\u2B50",
      log: h.log || {},
      created: h.created || todayLocal(),
      lastReset: h.lastReset || todayLocal(),
      modified: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.writeFile(`Habits/${safeName(h.name)}.md`, this.buildDoc(meta, `# ${h.name}
`));
  }
  async toggleHabit(habit, date) {
    const f = this.app.vault.getAbstractFileByPath(habit.path || "");
    if (!(f instanceof import_obsidian.TFile))
      return;
    await this.patchFrontmatter(f, (fm) => {
      const log = coerce(fm.log, {});
      if (log[date])
        delete log[date];
      else
        log[date] = true;
      fm.log = log;
      fm.modified = (/* @__PURE__ */ new Date()).toISOString();
    });
  }
  async resetHabit(habit, date) {
    const f = this.app.vault.getAbstractFileByPath(habit.path || "");
    if (!(f instanceof import_obsidian.TFile))
      return;
    await this.patchFrontmatter(f, (fm) => {
      fm.lastReset = date;
      fm.modified = (/* @__PURE__ */ new Date()).toISOString();
    });
  }
  async deleteHabit(habit) {
    const f = this.app.vault.getAbstractFileByPath(habit.path || "");
    if (f instanceof import_obsidian.TFile)
      await this.removeFile(f);
  }
  // ============================================================
  // FITNESS
  // ============================================================
  loadSplits() {
    const f = this.fileAt("Fitness/splits.md");
    if (!f)
      return [];
    const list = coerce(this.frontmatter(f).splits, []);
    return list.map((s) => ({ id: str(s.id), name: str(s.name) })).filter((s) => s.id);
  }
  loadExercises() {
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
        path: f.path
      };
    });
  }
  loadWorkouts() {
    return this.listMarkdown("Fitness/Workouts").map((f) => {
      const m = this.frontmatter(f);
      return {
        id: str(m.id) || f.basename,
        date: str(m.date).substring(0, 10),
        split: str(m.split) || "A",
        duration: num(m.duration),
        exercises: coerce(m.exercises, []),
        path: f.path
      };
    }).filter((w) => w.date);
  }
  /** Returns false if a rename would overwrite a different existing exercise. */
  async saveExercise(ex, originalName) {
    const renaming = !!originalName && originalName !== ex.name;
    const targetRel = `Fitness/Exercises/${safeName(ex.name)}.md`;
    const targetFull = this.full(targetRel);
    const targetFile = this.app.vault.getAbstractFileByPath(targetFull);
    const originalFull = originalName ? this.full(`Fitness/Exercises/${safeName(originalName)}.md`) : null;
    if (renaming && targetFile && originalFull !== targetFull)
      return false;
    const meta = {
      name: ex.name,
      split: ex.split || "A",
      muscle: ex.muscle || "",
      sets: ex.sets || "3x10",
      weight: ex.weight || 0,
      equipment: ex.type || "machine",
      howto: ex.howto || "",
      type: "exercise",
      modified: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.writeFile(targetRel, this.buildDoc(meta, `# ${ex.name}
`));
    if (renaming && originalFull && originalFull !== targetFull) {
      const old = this.app.vault.getAbstractFileByPath(originalFull);
      if (old instanceof import_obsidian.TFile)
        await this.removeFile(old);
    }
    return true;
  }
  async deleteExercise(ex) {
    const f = this.app.vault.getAbstractFileByPath(ex.path || "");
    if (f instanceof import_obsidian.TFile)
      await this.removeFile(f);
  }
  async saveSplits(splits) {
    await this.writeFile("Fitness/splits.md", this.buildDoc({ type: "splits-config", splits }, "# Workout Splits\n"));
  }
  async logWorkout(splitId, duration, exercises) {
    const date = todayLocal();
    const now = /* @__PURE__ */ new Date();
    const time = String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0");
    const meta = {
      id: Date.now(),
      type: "workout-log",
      date,
      split: splitId,
      duration,
      exercises,
      logged: (/* @__PURE__ */ new Date()).toISOString()
    };
    let body = `# Treino ${splitId} - ${date}

`;
    exercises.forEach((e) => {
      body += `- ${e.exercise}: ${e.weight}kg x ${e.sets}${e.feel ? ` (${e.feel})` : ""}
`;
    });
    await this.writeFile(`Fitness/Workouts/${date}-${splitId}-${time}.md`, this.buildDoc(meta, body));
  }
  // ============================================================
  // STUDIES
  // ============================================================
  loadStudyCards() {
    return this.listMarkdown("Studies").filter((f) => f.name !== "boards.md").map((f) => {
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
        path: f.path
      };
    });
  }
  async saveStudyBoards(boards) {
    await this.writeFile(
      "Studies/boards.md",
      this.buildDoc({ type: "study-boards-config", boards }, "# Study Boards\n")
    );
  }
  studyCardDoc(c, existing) {
    const meta = {
      id: c.id || (existing == null ? void 0 : existing.id) || cryptoId(),
      title: c.title,
      topic: c.topic || "",
      subtopic: c.subtopic || "",
      status: c.status || "backlog",
      url: c.url || "",
      date: c.date || (existing == null ? void 0 : existing.date) || todayLocal(),
      created: (existing == null ? void 0 : existing.created) || (/* @__PURE__ */ new Date()).toISOString(),
      modified: (/* @__PURE__ */ new Date()).toISOString(),
      type: "study"
    };
    return this.buildDoc(meta, `# ${c.title}
`);
  }
  async createStudyCard(c) {
    await this.writeFile(this.uniquePath(`Studies/${c.topic}`, c.title), this.studyCardDoc(c));
  }
  async updateStudyCardStatus(card, status) {
    const f = this.app.vault.getAbstractFileByPath(card.path);
    if (!(f instanceof import_obsidian.TFile))
      return;
    await this.patchFrontmatter(f, (fm) => {
      fm.status = status;
      fm.modified = (/* @__PURE__ */ new Date()).toISOString();
    });
  }
  /** Returns false if a rename would overwrite a different existing study card. */
  async updateStudyCard(card, changes) {
    const merged = { ...card, ...changes };
    const f = this.app.vault.getAbstractFileByPath(card.path);
    const file = f instanceof import_obsidian.TFile ? f : null;
    const renamed = merged.title !== card.title || merged.topic !== card.topic;
    if (file && !renamed) {
      await this.patchFrontmatter(file, (fm) => {
        fm.subtopic = merged.subtopic || "";
        fm.status = merged.status || "backlog";
        fm.url = merged.url || "";
        fm.modified = (/* @__PURE__ */ new Date()).toISOString();
      });
      return true;
    }
    const targetFull = this.full(`Studies/${merged.topic}/${safeName(merged.title)}.md`);
    const targetExisting = this.app.vault.getAbstractFileByPath(targetFull);
    if (renamed && targetExisting && targetExisting !== file)
      return false;
    const existing = file ? this.frontmatter(file) : void 0;
    await this.writeFile(`Studies/${merged.topic}/${safeName(merged.title)}.md`, this.studyCardDoc(merged, existing));
    if (file && renamed)
      await this.removeFile(file);
    return true;
  }
  async deleteStudyCard(card) {
    const f = this.app.vault.getAbstractFileByPath(card.path);
    if (f instanceof import_obsidian.TFile)
      await this.removeFile(f);
  }
  // ============================================================
  // NUTRITION
  // ============================================================
  loadMeals() {
    return this.listMarkdown("Nutrition/Plan").map((f) => {
      const m = this.frontmatter(f);
      return {
        id: str(m.id) || f.basename,
        name: str(m.name) || f.basename,
        emoji: str(m.emoji),
        totalCal: num(m.total_cal),
        items: coerce(m.items, []),
        path: f.path
      };
    });
  }
  loadMealLogs() {
    return this.listMarkdown("Nutrition/Logs").map((f) => {
      const m = this.frontmatter(f);
      return {
        id: str(m.id) || f.basename,
        date: str(m.date).substring(0, 10),
        mealId: str(m.meal),
        totalCal: num(m.calories),
        totalProtein: num(m.protein),
        totalCarbs: num(m.carbs),
        items: coerce(m.items, []),
        path: f.path
      };
    }).filter((l) => l.date);
  }
  async saveMeal(meal) {
    const total = meal.items.reduce((s, it) => s + (Number(it.cal) || 0), 0);
    const id = meal.id || "m" + Date.now();
    const meta = {
      type: "meal-plan",
      id,
      name: meal.name,
      emoji: meal.emoji || "",
      total_cal: total,
      items: meal.items
    };
    let body = `# ${meal.emoji || ""} ${meal.name} (${total} cal)

`;
    meal.items.forEach((it) => {
      body += `- ${it.name}: ${it.qty || 0}${it.unit || ""} (${it.cal || 0} cal)
`;
    });
    await this.writeFile(`Nutrition/Plan/${safeName(id)}.md`, this.buildDoc(meta, body));
  }
  async deleteMeal(meal) {
    const f = this.app.vault.getAbstractFileByPath(meal.path);
    if (f instanceof import_obsidian.TFile)
      await this.removeFile(f);
  }
  async logMeal(meal, items) {
    const date = todayLocal();
    const now = /* @__PURE__ */ new Date();
    const time = String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0");
    const totalCal = items.reduce((s, it) => s + (Number(it.cal) || 0), 0);
    const totalProtein = items.reduce((s, it) => s + (Number(it.protein) || 0), 0);
    const totalCarbs = items.reduce((s, it) => s + (Number(it.carbs) || 0), 0);
    const meta = {
      id: Date.now(),
      date,
      meal: meal.id,
      calories: totalCal,
      protein: totalProtein,
      carbs: totalCarbs,
      items,
      logged: (/* @__PURE__ */ new Date()).toISOString()
    };
    let body = `# ${meal.name} - ${date}

`;
    items.forEach((it) => {
      body += `- ${it.name}: ${it.qty}${it.unit} (${it.cal} cal)
`;
    });
    body += `
Total: ${totalCal} cal
`;
    await this.writeFile(`Nutrition/Logs/${date}-${meal.id}-${time}.md`, this.buildDoc(meta, body));
  }
  async deleteMealLog(log) {
    const f = this.app.vault.getAbstractFileByPath(log.path);
    if (f instanceof import_obsidian.TFile)
      await this.removeFile(f);
  }
  // ---- Water (stored in Nutrition/water.md as a {date: liters} map) ----
  loadWaterLog() {
    const f = this.fileAt("Nutrition/water.md");
    if (!f)
      return {};
    return coerce(this.frontmatter(f).log, {});
  }
  async addWater(date, deltaLiters) {
    const f = this.fileAt("Nutrition/water.md");
    if (f) {
      await this.patchFrontmatter(f, (fm) => {
        const log2 = coerce(fm.log, {});
        log2[date] = Math.max(0, Math.round(((log2[date] || 0) + deltaLiters) * 100) / 100);
        fm.log = log2;
        fm.modified = (/* @__PURE__ */ new Date()).toISOString();
      });
      return;
    }
    const log = {};
    log[date] = Math.max(0, deltaLiters);
    await this.writeFile("Nutrition/water.md", this.buildDoc({ type: "water-log", log, modified: (/* @__PURE__ */ new Date()).toISOString() }, "# Water log\n"));
  }
};
function cryptoId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID)
      return crypto.randomUUID();
  } catch (e) {
  }
  return "t" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

// src/view.ts
var import_obsidian3 = require("obsidian");

// src/context.ts
var PAContext = class {
  constructor(app, store) {
    this.config = defaultConfig();
    /** Re-render the currently active page. Set by the view. */
    this.refresh = () => {
    };
    this.app = app;
    this.store = store;
  }
  async reloadConfig() {
    this.config = await this.store.loadConfig();
  }
};

// src/ui.ts
var import_obsidian2 = require("obsidian");
function toast(msg) {
  new import_obsidian2.Notice(msg);
}
function openExternal(url) {
  const u = (url || "").trim();
  if (/^https?:\/\//i.test(u)) {
    window.open(u, "_blank", "noopener,noreferrer");
  } else {
    new import_obsidian2.Notice("Only http(s) links can be opened.");
  }
}
var FormModal = class extends import_obsidian2.Modal {
  constructor(app, title, fields, onSubmit, submitLabel = "Save") {
    super(app);
    this.values = {};
    this.title = title;
    this.fields = fields;
    this.onSubmit = onSubmit;
    this.submitLabel = submitLabel;
    fields.forEach((f) => {
      this.values[f.key] = f.value == null ? "" : String(f.value);
    });
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.title });
    this.fields.forEach((f) => {
      const setting = new import_obsidian2.Setting(contentEl).setName(f.label);
      switch (f.type) {
        case "textarea":
          setting.addTextArea((t) => {
            t.setValue(this.values[f.key]).onChange((v) => this.values[f.key] = v);
            if (f.placeholder)
              t.setPlaceholder(f.placeholder);
            t.inputEl.rows = 4;
            t.inputEl.style.width = "100%";
          });
          break;
        case "number":
          setting.addText((t) => {
            t.inputEl.type = "number";
            t.setValue(this.values[f.key]).onChange((v) => this.values[f.key] = v);
          });
          break;
        case "dropdown":
          setting.addDropdown((d) => {
            var _a, _b, _c;
            (f.options || []).forEach((o) => d.addOption(o.value, o.label));
            d.setValue(this.values[f.key] || ((_c = (_b = (_a = f.options) == null ? void 0 : _a[0]) == null ? void 0 : _b.value) != null ? _c : "")).onChange((v) => this.values[f.key] = v);
          });
          break;
        case "toggle":
          setting.addToggle((tg) => {
            tg.setValue(this.values[f.key] === "true").onChange((v) => this.values[f.key] = String(v));
          });
          break;
        default:
          setting.addText((t) => {
            t.setValue(this.values[f.key]).onChange((v) => this.values[f.key] = v);
            if (f.placeholder)
              t.setPlaceholder(f.placeholder);
          });
      }
    });
    new import_obsidian2.Setting(contentEl).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close())).addButton(
      (b) => b.setButtonText(this.submitLabel).setCta().onClick(() => {
        this.onSubmit(this.values);
        this.close();
      })
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ConfirmModal = class extends import_obsidian2.Modal {
  constructor(app, message, onConfirm) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: this.message });
    new import_obsidian2.Setting(contentEl).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close())).addButton(
      (b) => b.setButtonText("Confirm").setWarning().onClick(() => {
        this.onConfirm();
        this.close();
      })
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/charts.ts
var SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs))
    el.setAttribute(k, String(attrs[k]));
  return el;
}
function drawRing(parent, percent, color, label, size = 66) {
  const wrap = parent.createDiv({ cls: "pa-ring" });
  const r = (size - 10) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent));
  const offset = circ * (1 - pct / 100);
  const svg = svgEl("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  svg.appendChild(svgEl("circle", {
    cx,
    cy: cx,
    r,
    fill: "none",
    stroke: "var(--background-modifier-border)",
    "stroke-width": 7
  }));
  const arc = svgEl("circle", {
    cx,
    cy: cx,
    r,
    fill: "none",
    stroke: color,
    "stroke-width": 7,
    "stroke-linecap": "round",
    "stroke-dasharray": circ,
    "stroke-dashoffset": offset,
    transform: `rotate(-90 ${cx} ${cx})`
  });
  svg.appendChild(arc);
  const text = svgEl("text", {
    x: cx,
    y: cx,
    "text-anchor": "middle",
    "dominant-baseline": "central",
    "font-size": 14,
    "font-weight": 700,
    fill: "var(--text-normal)"
  });
  text.textContent = pct + "%";
  svg.appendChild(text);
  wrap.appendChild(svg);
  if (label)
    wrap.createDiv({ text: label, cls: "pa-ring-label" });
}
function drawDonut(parent, segments, size = 150) {
  const wrap = parent.createDiv({ cls: "pa-donut-wrap" });
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = (size - 22) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  const svg = svgEl("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
  if (!total) {
    svg.appendChild(svgEl("circle", { cx, cy: cx, r, fill: "none", stroke: "var(--background-modifier-border)", "stroke-width": 16 }));
  } else {
    let cumulative = 0;
    segments.forEach((s) => {
      if (s.value <= 0)
        return;
      const segLen = s.value / total * circ;
      const arc = svgEl("circle", {
        cx,
        cy: cx,
        r,
        fill: "none",
        stroke: s.color,
        "stroke-width": 16,
        "stroke-dasharray": `${segLen} ${circ - segLen}`,
        "stroke-dashoffset": -cumulative,
        transform: `rotate(-90 ${cx} ${cx})`
      });
      svg.appendChild(arc);
      cumulative += segLen;
    });
  }
  const totalText = svgEl("text", { x: cx, y: cx - 4, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 22, "font-weight": 700, fill: "var(--text-normal)" });
  totalText.textContent = String(total);
  svg.appendChild(totalText);
  const labelText = svgEl("text", { x: cx, y: cx + 14, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 10, fill: "var(--text-muted)" });
  labelText.textContent = "Total";
  svg.appendChild(labelText);
  wrap.appendChild(svg);
  const legend = wrap.createDiv({ cls: "pa-donut-legend" });
  segments.filter((s) => s.value > 0).forEach((s) => {
    const item = legend.createDiv({ cls: "pa-legend-item" });
    const dot = item.createSpan({ cls: "pa-legend-dot" });
    dot.style.background = s.color;
    item.createSpan({ text: `${s.label} (${s.value})` });
  });
}
function drawLineChart(parent, labels, series, opts = {}) {
  var _a, _b, _c;
  const wrap = parent.createDiv({ cls: "pa-linechart" });
  const height = (_a = opts.height) != null ? _a : 220;
  if (!labels.length || !series.length) {
    wrap.createDiv({ cls: "pa-muted", text: "Not enough data yet." });
    return;
  }
  const w = 520;
  const padL = 34;
  const padR = 10;
  const padT = 10;
  const padB = 26;
  let max = (_b = opts.goal) != null ? _b : 0;
  let min = Infinity;
  series.forEach((s) => s.values.forEach((v) => {
    if (v != null) {
      if (v > max)
        max = v;
      if (v < min)
        min = v;
    }
  }));
  if (!isFinite(min))
    min = 0;
  min = Math.min(min, 0);
  if (max <= min)
    max = min + 1;
  const plotW = w - padL - padR;
  const plotH = height - padT - padB;
  const xAt = (i) => padL + (labels.length === 1 ? plotW / 2 : i / (labels.length - 1) * plotW);
  const yAt = (v) => padT + plotH * (1 - (v - min) / (max - min));
  const svg = svgEl("svg", { width: "100%", height, viewBox: `0 0 ${w} ${height}` });
  for (let g = 0; g <= 4; g++) {
    const val = min + (max - min) * g / 4;
    const y = yAt(val);
    svg.appendChild(svgEl("line", { x1: padL, y1: y, x2: w - padR, y2: y, stroke: "var(--background-modifier-border)", "stroke-width": 1 }));
    const lab = svgEl("text", { x: padL - 4, y, "text-anchor": "end", "dominant-baseline": "central", "font-size": 9, fill: "var(--text-muted)" });
    lab.textContent = String(Math.round(val));
    svg.appendChild(lab);
  }
  if (opts.goal != null) {
    const y = yAt(opts.goal);
    svg.appendChild(svgEl("line", { x1: padL, y1: y, x2: w - padR, y2: y, stroke: opts.goalColor || "#dc2626", "stroke-width": 1.5, "stroke-dasharray": "5 4" }));
  }
  labels.forEach((lab, i) => {
    const t = svgEl("text", { x: xAt(i), y: height - 8, "text-anchor": "middle", "font-size": 9, fill: "var(--text-muted)" });
    t.textContent = lab;
    svg.appendChild(t);
  });
  series.forEach((s) => {
    const pts = [];
    s.values.forEach((v, i) => {
      if (v != null)
        pts.push(`${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
    });
    if (pts.length) {
      svg.appendChild(svgEl("polyline", { fill: "none", stroke: s.color, "stroke-width": 2, points: pts.join(" ") }));
      s.values.forEach((v, i) => {
        if (v != null)
          svg.appendChild(svgEl("circle", { cx: xAt(i), cy: yAt(v), r: 2.5, fill: s.color }));
      });
    }
  });
  wrap.appendChild(svg);
  if (series.length > 1 || ((_c = series[0]) == null ? void 0 : _c.name)) {
    const legend = wrap.createDiv({ cls: "pa-donut-legend" });
    series.forEach((s) => {
      const item = legend.createDiv({ cls: "pa-legend-item" });
      const dot = item.createSpan({ cls: "pa-legend-dot" });
      dot.style.background = s.color;
      item.createSpan({ text: s.name });
    });
  }
}

// src/modules/habit-tracker.ts
var HEATMAP_WEEKS = 18;
var HEATMAP_DAYS = HEATMAP_WEEKS * 7;
var HabitTrackerModule = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  render(root) {
    root.empty();
    const today = todayLocal();
    const cfg = this.ctx.config;
    const tasks = this.ctx.store.loadTasks();
    const habits = this.ctx.store.loadHabits();
    const workouts = this.ctx.store.loadWorkouts();
    const studyCards = this.ctx.store.loadStudyCards();
    const mealLogs = this.ctx.store.loadMealLogs();
    const studyBoards = this.ctx.store.loadStudyBoards();
    const gym = new Set(workouts.map((w) => w.date));
    const mealDays = new Set(mealLogs.map((m) => m.date));
    const mealCal = /* @__PURE__ */ new Map();
    mealLogs.forEach((m) => mealCal.set(m.date, (mealCal.get(m.date) || 0) + m.totalCal));
    const taskDone = /* @__PURE__ */ new Set();
    tasks.forEach((t) => {
      if (t.status === "done" && t.modified)
        taskDone.add(t.modified.substring(0, 10));
    });
    const studyDays = /* @__PURE__ */ new Set();
    studyCards.forEach((c) => {
      if (c.modified)
        studyDays.add(c.modified.substring(0, 10));
    });
    const waterLog = this.ctx.store.loadWaterLog();
    const wt = cfg.waterTarget || 2.5;
    const calTarget = cfg.calorieTarget || 2e3;
    const systemHabits = [
      { label: "\u{1F3CB}\uFE0F Workout", color: "#16a34a", done: (ds) => gym.has(ds) },
      { label: "\u{1F957} Logged meal", color: "#f59e0b", done: (ds) => mealDays.has(ds) },
      { label: "\u{1F4A7} Water goal", color: "#3b82f6", done: (ds) => (waterLog[ds] || 0) >= wt },
      { label: "\u{1F3AF} Calorie goal", color: "#10b981", done: (ds) => {
        const c = mealCal.get(ds) || 0;
        return c > 0 && c <= calTarget;
      } },
      { label: "\u2705 Completed task", color: "#7c3aed", done: (ds) => taskDone.has(ds) },
      { label: "\u{1F4DA} Studied", color: "#ec4899", done: (ds) => studyDays.has(ds) }
    ];
    const scoreForDay = (ds) => {
      const checks = systemHabits.map((h) => h.done(ds));
      habits.forEach((h) => {
        if (h.habitType === "quit")
          checks.push((h.lastReset || h.created || ds) <= ds);
        else
          checks.push(!!h.log[ds]);
      });
      return { done: checks.filter(Boolean).length, total: checks.length };
    };
    this.renderHeader(root, today, scoreForDay);
    this.renderKpis(root, { tasks, workouts, studyCards, mealCal, gym, today, waterToday: waterLog[today] || 0 });
    this.renderDonuts(root, { workouts, studyCards, tasks, today });
    this.renderHabitConsistency(root, systemHabits, habits, today);
    this.renderStudyProgress(root, studyBoards, studyCards);
  }
  // ---- Header: title + greeting + 3 consistency rings ----
  renderHeader(root, today, scoreForDay) {
    const head = root.createDiv({ cls: "pa-ht-header" });
    const left = head.createDiv();
    left.createDiv({ text: "\u{1F3AF} Habit Tracker", cls: "pa-h1" });
    const hour = (/* @__PURE__ */ new Date()).getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const dateStr = (/* @__PURE__ */ new Date()).toLocaleDateString("default", { weekday: "long", day: "numeric", month: "short" });
    left.createDiv({ text: `${greeting}, Jaime \xB7 ${dateStr}`, cls: "pa-muted" });
    const rings = head.createDiv({ cls: "pa-ht-rings" });
    const dayN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const base = /* @__PURE__ */ new Date(today + "T00:00:00");
    for (let i = 2; i >= 0; i--) {
      const dt = new Date(base);
      dt.setDate(dt.getDate() - i);
      const ds = ymd(dt);
      const s = scoreForDay(ds);
      const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
      const color = pct >= 70 ? "#16a34a" : pct >= 30 ? "#d97706" : "#7c3aed";
      const label = i === 0 ? "Today" : `${dayN[dt.getDay()]} ${dt.getDate()}`;
      drawRing(rings, pct, color, label, 58);
    }
  }
  // ---- KPI row ----
  renderKpis(root, d) {
    const ym = d.today.substring(0, 7);
    const workoutsMonth = d.workouts.filter((w) => w.date.substring(0, 7) === ym).length;
    const studyDone = d.studyCards.filter((c) => c.status === "done").length;
    const tasksDone = d.tasks.filter((t) => t.status === "done").length;
    const todayCal = d.mealCal.get(d.today) || 0;
    const activeDay = (ds) => d.gym.has(ds) || d.mealCal.has(ds);
    let streak = 0;
    const base = /* @__PURE__ */ new Date(d.today + "T00:00:00");
    for (let i = 0; i < 365; i++) {
      const x = new Date(base);
      x.setDate(x.getDate() - i);
      if (activeDay(ymd(x)))
        streak++;
      else if (i === 0)
        continue;
      else
        break;
    }
    const row = root.createDiv({ cls: "pa-stats-row pa-kpis" });
    const kpi = (label, value) => {
      const c = row.createDiv({ cls: "pa-stat" });
      c.createDiv({ text: value, cls: "pa-stat-value" });
      c.createDiv({ text: label, cls: "pa-stat-label" });
    };
    kpi("\u{1F525} Active streak", streak + "d");
    kpi("\u{1F3CB}\uFE0F Workouts (month)", String(workoutsMonth));
    kpi("\u{1F957} Calories today", String(todayCal));
    kpi("\u{1F4A7} Water today", `${d.waterToday.toFixed(1)}L`);
    kpi("\u{1F4DA} Studies done", `${studyDone}/${d.studyCards.length}`);
    kpi("\u2705 Tasks done", `${tasksDone}/${d.tasks.length}`);
  }
  // ---- 3 donut charts ----
  renderDonuts(root, d) {
    const palette = ["#7c3aed", "#16a34a", "#f59e0b", "#3b82f6", "#ef4444", "#10b981"];
    const row = root.createDiv({ cls: "pa-donuts-row" });
    const ym = d.today.substring(0, 7);
    const bySplit = /* @__PURE__ */ new Map();
    d.workouts.forEach((w) => {
      if (w.date.substring(0, 7) === ym)
        bySplit.set(w.split, (bySplit.get(w.split) || 0) + 1);
    });
    this.donutPanel(
      row,
      "\u{1F3CB}\uFE0F Workouts by type (month)",
      Array.from(bySplit.entries()).map(([k, v], i) => ({ label: "Workout " + k, value: v, color: palette[i % palette.length] }))
    );
    const byStatus = /* @__PURE__ */ new Map();
    d.studyCards.forEach((c) => {
      const s = c.status || "backlog";
      byStatus.set(s, (byStatus.get(s) || 0) + 1);
    });
    this.donutPanel(
      row,
      "\u{1F4DA} Studies by status",
      Array.from(byStatus.entries()).map(([k, v], i) => ({ label: k, value: v, color: palette[i % palette.length] }))
    );
    const byTask = /* @__PURE__ */ new Map();
    d.tasks.forEach((t) => {
      const s = t.status || "todo";
      byTask.set(s, (byTask.get(s) || 0) + 1);
    });
    this.donutPanel(
      row,
      "\u2705 Tasks by status",
      Array.from(byTask.entries()).map(([k, v], i) => ({ label: k, value: v, color: palette[i % palette.length] }))
    );
  }
  donutPanel(row, title, segments) {
    const panel = row.createDiv({ cls: "pa-panel pa-donut-panel" });
    panel.createEl("h3", { text: title, cls: "pa-panel-title" });
    drawDonut(panel, segments);
  }
  // ---- Habit consistency ----
  renderHabitConsistency(root, systemHabits, habits, today) {
    const panel = root.createDiv({ cls: "pa-panel" });
    const head = panel.createDiv({ cls: "pa-section-head" });
    head.createEl("h3", { text: "\u{1F4CA} Habit Consistency", cls: "pa-panel-title" });
    const add = head.createEl("button", { text: "+ New Habit", cls: "pa-btn" });
    add.onclick = () => this.openHabitModal();
    const grid = panel.createDiv({ cls: "pa-habits-grid" });
    systemHabits.forEach((h) => this.renderSystemHabit(grid, h, today));
    habits.forEach((h) => this.renderCustomHabit(grid, h, today));
  }
  heatmap(card, done, color, today) {
    const hm = card.createDiv({ cls: "pa-heatmap" });
    const base = /* @__PURE__ */ new Date(today + "T00:00:00");
    for (let j = HEATMAP_DAYS - 1; j >= 0; j--) {
      const x = new Date(base);
      x.setDate(x.getDate() - j);
      const ds = ymd(x);
      const cell = hm.createDiv({ cls: "pa-hm-cell" });
      cell.setAttr("title", ds);
      if (done(ds))
        cell.style.background = color;
    }
  }
  renderSystemHabit(grid, h, today) {
    let streak = 0;
    const base = /* @__PURE__ */ new Date(today + "T00:00:00");
    for (let i = 0; i < 365; i++) {
      const x = new Date(base);
      x.setDate(x.getDate() - i);
      if (h.done(ymd(x)))
        streak++;
      else if (i === 0)
        continue;
      else
        break;
    }
    const card = grid.createDiv({ cls: "pa-habit-card" });
    const top = card.createDiv({ cls: "pa-habit-top" });
    top.createSpan({ text: h.label, cls: "pa-habit-name" });
    top.createSpan({ text: `\u{1F525} ${streak}`, cls: "pa-muted pa-streak" });
    this.heatmap(card, h.done, h.color, today);
  }
  renderCustomHabit(grid, h, today) {
    const isQuit = h.habitType === "quit";
    const color = isQuit ? "#ef4444" : "#0ea5e9";
    const done = isQuit ? (ds) => {
      const start = h.lastReset || h.created || today;
      return ds >= start && ds <= today;
    } : (ds) => !!h.log[ds];
    let streak;
    if (isQuit) {
      streak = daysBetween(h.lastReset || h.created || today, today);
    } else {
      streak = 0;
      const base = /* @__PURE__ */ new Date(today + "T00:00:00");
      for (let i = 0; i < 365; i++) {
        const x = new Date(base);
        x.setDate(x.getDate() - i);
        if (h.log[ymd(x)])
          streak++;
        else if (i === 0)
          continue;
        else
          break;
      }
    }
    const card = grid.createDiv({ cls: "pa-habit-card" });
    const top = card.createDiv({ cls: "pa-habit-top" });
    top.createSpan({ text: `${h.emoji || "\u2B50"} ${h.name}`, cls: "pa-habit-name" });
    const right = top.createDiv({ cls: "pa-habit-actions" });
    right.createSpan({ text: isQuit ? `\u{1F6AD} ${streak}d` : `\u{1F525} ${streak}`, cls: "pa-muted pa-streak" });
    if (isQuit) {
      const reset = right.createEl("button", { text: "\u21BA Reset", cls: "pa-mini-btn" });
      reset.onclick = async () => {
        await this.ctx.store.resetHabit(h, today);
        this.ctx.refresh();
      };
    } else {
      const marked = !!h.log[today];
      const mark = right.createEl("button", { text: marked ? "\u2713 Today" : "Mark today", cls: "pa-mini-btn" + (marked ? " on" : "") });
      if (marked) {
        mark.style.background = color;
        mark.style.color = "#fff";
      }
      mark.onclick = async () => {
        await this.ctx.store.toggleHabit(h, today);
        this.ctx.refresh();
      };
    }
    const del = right.createEl("button", { text: "\u{1F5D1}", cls: "pa-icon-btn" });
    del.onclick = () => new ConfirmModal(this.ctx.app, `Remove habit "${h.name}"?`, async () => {
      await this.ctx.store.deleteHabit(h);
      this.ctx.refresh();
    }).open();
    this.heatmap(card, done, color, today);
  }
  // ---- Study progress ----
  renderStudyProgress(root, boards, cards) {
    if (!boards.length)
      return;
    const panel = root.createDiv({ cls: "pa-panel" });
    panel.createEl("h3", { text: "\u{1F4DA} Study Progress", cls: "pa-panel-title" });
    boards.forEach((b) => {
      const topicCards = cards.filter((c) => c.topic === b.name);
      const done = topicCards.filter((c) => c.status === "done").length;
      const total = topicCards.length;
      const pct = total ? Math.round(done / total * 100) : 0;
      const color = pct >= 70 ? "#16a34a" : pct >= 30 ? "#d97706" : "var(--interactive-accent)";
      const labelRow = panel.createDiv({ cls: "pa-progress-label" });
      labelRow.createSpan({ text: `${b.emoji || ""} ${b.name}`.trim() });
      labelRow.createSpan({ text: `${pct}% (${done}/${total})`, cls: "pa-muted" });
      const bar = panel.createDiv({ cls: "pa-progress-track" });
      const fill = bar.createDiv({ cls: "pa-progress-fill" });
      fill.style.width = pct + "%";
      fill.style.background = color;
    });
  }
  // ---- New habit modal ----
  openHabitModal() {
    const fields = [
      { key: "name", label: "Name", type: "text", placeholder: "Walk the dog / Quit smoking" },
      { key: "emoji", label: "Emoji", type: "text", value: "\u2B50" },
      {
        key: "type",
        label: "Type",
        type: "dropdown",
        value: "do",
        options: [
          { value: "do", label: "\u2705 Do \u2014 mark when done" },
          { value: "quit", label: "\u{1F6AD} Quit \u2014 counts days, reset to restart" }
        ]
      }
    ];
    new FormModal(this.ctx.app, "New habit", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name)
        return;
      await this.ctx.store.saveHabit({ name, emoji: (v.emoji || "\u2B50").trim(), habitType: v.type === "quit" ? "quit" : "do", log: {} });
      this.ctx.refresh();
      toast("Habit created");
    }, "Create").open();
  }
};

// src/modules/tasks.ts
var PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" }
];
var RING_COLORS = ["#d97706", "#7c3aed", "#16a34a"];
var COLUMN_COLORS = ["#7c3aed", "#3b82f6", "#16a34a", "#f59e0b", "#ef4444", "#10b981"];
var TasksModule = class {
  constructor(ctx) {
    this.currentBoard = "all";
    this.view = "kanban";
    this.ctx = ctx;
  }
  cleanLabel(s) {
    return s.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  }
  colColor(index) {
    return COLUMN_COLORS[index % COLUMN_COLORS.length];
  }
  render(root) {
    root.empty();
    const boards = this.ctx.store.loadBoards();
    const tasks = this.ctx.store.loadTasks();
    const filtered = tasks.filter((t) => this.currentBoard === "all" || t.kanbanName === this.currentBoard);
    this.renderHeader(root, filtered);
    this.renderViewToggle(root);
    this.renderBoardTabs(root, boards);
    if (this.view === "kanban") {
      this.renderStats(root, filtered);
      this.renderBoardBar(root, boards);
      this.renderKanban(root, filtered, boards);
    } else {
      this.renderList(root, filtered);
    }
  }
  // ---- Header: title + subtitle + status rings ----
  renderHeader(root, filtered) {
    const head = root.createDiv({ cls: "pa-ht-header" });
    const left = head.createDiv();
    left.createDiv({ text: "\u2705 Tasks & Notes", cls: "pa-h1" });
    left.createDiv({ text: "Kanban and list", cls: "pa-muted" });
    const cols = this.ctx.config.taskColumns;
    const names = this.ctx.config.taskColumnNames;
    const colSet = new Set(cols);
    const eff = (t) => colSet.has(t.status) ? t.status : cols[0];
    const total = filtered.length || 1;
    const rings = head.createDiv({ cls: "pa-ht-rings" });
    cols.slice(0, 3).forEach((col, i) => {
      const cnt = filtered.filter((t) => eff(t) === col).length;
      const pct = Math.round(cnt / total * 100);
      drawRing(rings, pct, RING_COLORS[i] || "#7c3aed", this.cleanLabel(names[col] || col), 52);
    });
  }
  // ---- View toggle ----
  renderViewToggle(root) {
    const bar = root.createDiv({ cls: "pa-view-toggle" });
    const mk = (id, label) => {
      const b = bar.createEl("button", { text: label, cls: "pa-toggle-btn" + (this.view === id ? " on" : "") });
      b.onclick = () => {
        this.view = id;
        this.ctx.refresh();
      };
    };
    mk("kanban", "\u{1F4CB} Kanban");
    mk("list", "\u{1F4C3} List");
  }
  // ---- Board tabs ----
  renderBoardTabs(root, boards) {
    const bar = root.createDiv({ cls: "pa-tabs" });
    const mkTab = (id, label) => {
      const t = bar.createEl("button", { text: label, cls: "pa-tab" + (this.currentBoard === id ? " on" : "") });
      t.onclick = () => {
        this.currentBoard = id;
        this.ctx.refresh();
      };
    };
    mkTab("all", "\u{1F4CB} All");
    boards.forEach((b) => mkTab(b.name, `${b.emoji || ""} ${b.name}`.trim()));
    const add = bar.createEl("button", { text: "+ Board", cls: "pa-tab pa-tab-add" });
    add.onclick = () => this.openBoardModal(boards);
  }
  // ---- Stats row ----
  renderStats(root, filtered) {
    const cols = this.ctx.config.taskColumns;
    const names = this.ctx.config.taskColumnNames;
    const colSet = new Set(cols);
    const eff = (t) => colSet.has(t.status) ? t.status : cols[0];
    const total = filtered.length;
    const row = root.createDiv({ cls: "pa-stats-row" });
    const stat = (label, value, color) => {
      const c = row.createDiv({ cls: "pa-stat" });
      const v = c.createDiv({ text: value, cls: "pa-stat-value" });
      if (color)
        v.style.color = color;
      c.createDiv({ text: label, cls: "pa-stat-label" });
    };
    stat("\u{1F4CB} TOTAL", String(total));
    const trio = cols.slice(0, 3);
    trio.forEach((col, i) => {
      const cnt = filtered.filter((t) => eff(t) === col).length;
      const label = (names[col] || col).toUpperCase();
      const isPct = i === trio.length - 1;
      if (isPct)
        stat(label, (total ? Math.round(cnt / total * 100) : 0) + "%", this.colColor(i));
      else
        stat(label, String(cnt), this.colColor(i));
    });
  }
  // ---- Board bar (name + delete board + add column) ----
  renderBoardBar(root, boards) {
    const bar = root.createDiv({ cls: "pa-board-bar" });
    const board = boards.find((b) => b.name === this.currentBoard);
    bar.createDiv({ text: board ? `${board.emoji || ""} ${board.name}`.trim() : "\u{1F4CB} All boards", cls: "pa-board-title" });
    const actions = bar.createDiv({ cls: "pa-board-actions" });
    if (board) {
      const renameBtn = actions.createEl("button", { text: "\u270F\uFE0F Rename", cls: "pa-mini-btn" });
      renameBtn.onclick = () => this.openRenameBoardModal(board, boards);
      const delBtn = actions.createEl("button", { text: "\u{1F5D1} Delete board", cls: "pa-mini-btn" });
      delBtn.onclick = () => new ConfirmModal(this.ctx.app, `Delete board "${board.name}"? (tasks are kept, just untagged from this board view)`, async () => {
        await this.ctx.store.saveBoards(boards.filter((b) => b.name !== board.name));
        this.currentBoard = "all";
        this.ctx.refresh();
      }).open();
    }
    const addCol = actions.createEl("button", { text: "+ Column", cls: "pa-mini-btn" });
    addCol.onclick = () => this.openAddColumnModal();
  }
  openRenameBoardModal(board, boards) {
    const fields = [
      { key: "name", label: "Board name", type: "text", value: board.name },
      { key: "emoji", label: "Emoji", type: "text", value: board.emoji || "" }
    ];
    new FormModal(this.ctx.app, "Rename board", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name)
        return;
      if (name !== board.name && boards.some((b) => b.name === name)) {
        toast(`A board named "${name}" already exists.`);
        return;
      }
      const updated = boards.map((b) => b.name === board.name ? { ...b, name, emoji: (v.emoji || "").trim() } : b);
      await this.ctx.store.saveBoards(updated);
      if (name !== board.name) {
        for (const t of this.ctx.store.loadTasks().filter((t2) => t2.kanbanName === board.name)) {
          await this.ctx.store.updateTask(t, { kanbanName: name });
        }
        if (this.currentBoard === board.name)
          this.currentBoard = name;
      }
      this.ctx.refresh();
      toast("Board updated");
    }, "Save").open();
  }
  // ---- Kanban ----
  renderKanban(root, filtered, boards) {
    const cols = this.ctx.config.taskColumns;
    const names = this.ctx.config.taskColumnNames;
    const colSet = new Set(cols);
    const eff = (t) => colSet.has(t.status) ? t.status : cols[0];
    const board = root.createDiv({ cls: "pa-kanban" });
    cols.forEach((col, i) => {
      const color = this.colColor(i);
      const isLast = i === cols.length - 1;
      const colEl = board.createDiv({ cls: "pa-col" });
      colEl.style.borderColor = color;
      const colTasks = filtered.filter((t) => eff(t) === col);
      const head = colEl.createDiv({ cls: "pa-col-head" });
      const title = head.createSpan({ text: names[col] || col, cls: "pa-col-title" });
      title.style.color = color;
      const tools = head.createDiv({ cls: "pa-col-tools" });
      const count = tools.createSpan({ text: String(colTasks.length), cls: "pa-col-count" });
      count.style.background = color;
      if (i > 0) {
        const mvL = tools.createEl("button", { text: "\u25C0", cls: "pa-icon-btn" });
        mvL.onclick = () => this.moveColumn(col, -1);
      }
      if (i < cols.length - 1) {
        const mvR = tools.createEl("button", { text: "\u25B6", cls: "pa-icon-btn" });
        mvR.onclick = () => this.moveColumn(col, 1);
      }
      const editC = tools.createEl("button", { text: "\u270F\uFE0F", cls: "pa-icon-btn" });
      editC.onclick = () => this.openRenameColumnModal(col);
      const delC = tools.createEl("button", { text: "\u2715", cls: "pa-icon-btn" });
      delC.onclick = () => this.removeColumn(col, filtered);
      const list = colEl.createDiv({ cls: "pa-col-body" });
      list.addEventListener("dragover", (e) => {
        e.preventDefault();
        list.addClass("pa-drop");
      });
      list.addEventListener("dragleave", () => list.removeClass("pa-drop"));
      list.addEventListener("drop", async (e) => {
        var _a;
        e.preventDefault();
        list.removeClass("pa-drop");
        const path = (_a = e.dataTransfer) == null ? void 0 : _a.getData("text/plain");
        const task = filtered.find((t) => t.path === path);
        if (task && task.status !== col) {
          await this.ctx.store.updateTask(task, { status: col });
          this.ctx.refresh();
        }
      });
      colTasks.slice(0, isLast && colTasks.length > 7 ? 7 : colTasks.length).forEach((t) => this.renderCard(list, t, cols, eff(t), isLast));
      if (isLast && colTasks.length > 7) {
        const det = list.createEl("details", { cls: "pa-completed pa-kanban-more" });
        det.createEl("summary", { text: `Show ${colTasks.length - 7} more` });
        colTasks.slice(7).forEach((t) => this.renderCard(det, t, cols, eff(t), isLast));
      }
      const addBtn = colEl.createEl("button", { text: "+ Add card", cls: "pa-add-card" });
      addBtn.onclick = () => this.openTaskModal(null, col, boards);
    });
  }
  renderCard(list, t, cols, current, isDoneCol) {
    const card = list.createDiv({ cls: "pa-card pa-task prio-" + (t.priority || "medium") + (isDoneCol ? " done" : "") });
    card.setAttr("draggable", "true");
    card.addEventListener("dragstart", (e) => {
      var _a;
      (_a = e.dataTransfer) == null ? void 0 : _a.setData("text/plain", t.path);
      card.addClass("pa-dragging");
    });
    card.addEventListener("dragend", () => card.removeClass("pa-dragging"));
    const badgeText = (t.group || t.cat || t.kanbanName || "").toUpperCase();
    const topRow = card.createDiv({ cls: "pa-card-top" });
    if (badgeText)
      topRow.createDiv({ text: badgeText, cls: "pa-card-cat" });
    const del = topRow.createEl("button", { text: "\u2715", cls: "pa-icon-btn pa-card-x" });
    del.onclick = () => new ConfirmModal(this.ctx.app, `Delete task "${t.title}"?`, async () => {
      await this.ctx.store.deleteTask(t);
      this.ctx.refresh();
    }).open();
    card.createEl("div", { text: t.title, cls: "pa-card-title" });
    const dateStr = (t.created || "").substring(0, 10);
    card.createDiv({ cls: "pa-muted pa-card-meta", text: [t.priority, dateStr].filter(Boolean).join(" \xB7 ") });
    const actions = card.createDiv({ cls: "pa-card-actions" });
    const idx = cols.indexOf(current);
    if (idx > 0) {
      const left = actions.createEl("button", { text: "\u2190", cls: "pa-icon-btn" });
      left.onclick = async () => {
        await this.ctx.store.updateTask(t, { status: cols[idx - 1] });
        this.ctx.refresh();
      };
    }
    if (idx < cols.length - 1) {
      const right = actions.createEl("button", { text: "\u2192", cls: "pa-icon-btn" });
      right.onclick = async () => {
        await this.ctx.store.updateTask(t, { status: cols[idx + 1] });
        this.ctx.refresh();
      };
    }
    const edit = actions.createEl("button", { text: "\u270F\uFE0F", cls: "pa-icon-btn" });
    edit.onclick = () => this.openTaskModal(t, t.status, this.ctx.store.loadBoards());
    const open = actions.createEl("button", { text: "\u{1F517}", cls: "pa-icon-btn" });
    open.onclick = () => this.ctx.app.workspace.openLinkText(t.path, "", true);
  }
  // ---- List view (single list per board, with collapsed Completed) ----
  renderList(root, filtered) {
    const cols = this.ctx.config.taskColumns;
    const firstCol = cols[0];
    const lastCol = cols[cols.length - 1];
    const colSet = new Set(cols);
    const eff = (t) => colSet.has(t.status) ? t.status : cols[0];
    const isDone = (t) => eff(t) === lastCol;
    const boards = this.ctx.store.loadBoards();
    root.createDiv({ text: "\u{1F4DD} List de Tasks", cls: "pa-h2" });
    if (!filtered.length) {
      root.createEl("p", { cls: "pa-muted", text: "No tasks." });
      return;
    }
    const groups = /* @__PURE__ */ new Map();
    filtered.forEach((t) => {
      const k = t.kanbanName || "No board";
      if (!groups.has(k))
        groups.set(k, []);
      groups.get(k).push(t);
    });
    const wrap = root.createDiv({ cls: "pa-list-cards" });
    groups.forEach((tasks, boardName) => {
      const card = wrap.createDiv({ cls: "pa-list-card" });
      card.createDiv({ text: boardName, cls: "pa-list-card-title" });
      const add = card.createDiv({ cls: "pa-list-add", text: "\u270F\uFE0F Add a task" });
      add.onclick = () => this.openTaskModal(null, firstCol, boards, boardName === "No board" ? "" : boardName);
      const open = tasks.filter((t) => !isDone(t));
      const done = tasks.filter((t) => isDone(t));
      open.forEach((t) => this.renderListItem(card, t, false, lastCol, firstCol));
      if (done.length) {
        const det = card.createEl("details", { cls: "pa-completed" });
        det.createEl("summary", { text: `Completed (${done.length})` });
        done.forEach((t) => this.renderListItem(det, t, true, lastCol, firstCol));
      }
    });
  }
  renderListItem(parent, t, done, lastCol, firstCol) {
    const row = parent.createDiv({ cls: "pa-list-item" + (done ? " done" : "") });
    const circle = row.createSpan({ cls: "pa-list-circle" + (done ? " on" : ""), text: done ? "\u25CF" : "\u25CB" });
    circle.onclick = async () => {
      await this.ctx.store.updateTask(t, { status: done ? firstCol : lastCol });
      this.ctx.refresh();
    };
    const main = row.createDiv({ cls: "pa-list-item-main" });
    const title = main.createDiv({ text: t.title, cls: "pa-list-item-title" });
    title.onclick = () => this.ctx.app.workspace.openLinkText(t.path, "", true);
    if (t.group)
      main.createDiv({ text: t.group, cls: "pa-muted pa-list-item-sub" });
  }
  // ---- Modals & column management ----
  openBoardModal(boards) {
    const fields = [
      { key: "name", label: "Board name", type: "text" },
      { key: "emoji", label: "Emoji", type: "text", placeholder: "\u{1F4CB}" }
    ];
    new FormModal(this.ctx.app, "New board", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name)
        return;
      if (boards.some((b) => b.name === name)) {
        this.currentBoard = name;
        this.ctx.refresh();
        return;
      }
      boards.push({ id: name.toLowerCase().replace(/\s+/g, "-"), name, emoji: (v.emoji || "").trim() });
      await this.ctx.store.saveBoards(boards);
      this.currentBoard = name;
      this.ctx.refresh();
      toast("Board created");
    }).open();
  }
  openTaskModal(task, defaultStatus, boards, defaultBoard) {
    const boardOptions = [{ value: "", label: "\u2014 none \u2014" }].concat(boards.map((b) => ({ value: b.name, label: b.name })));
    const colOptions = this.ctx.config.taskColumns.map((c) => ({ value: c, label: this.ctx.config.taskColumnNames[c] || c }));
    const presetBoard = (task == null ? void 0 : task.kanbanName) || defaultBoard || (this.currentBoard !== "all" ? this.currentBoard : "");
    const fields = [
      { key: "title", label: "Title", type: "text", value: (task == null ? void 0 : task.title) || "" },
      { key: "status", label: "Column", type: "dropdown", options: colOptions, value: (task == null ? void 0 : task.status) || defaultStatus },
      { key: "priority", label: "Priority", type: "dropdown", options: PRIORITIES, value: (task == null ? void 0 : task.priority) || "medium" },
      { key: "kanbanName", label: "Board", type: "dropdown", options: boardOptions, value: presetBoard },
      { key: "group", label: "Group / tag", type: "text", value: (task == null ? void 0 : task.group) || "" },
      { key: "due", label: "Due date", type: "text", value: (task == null ? void 0 : task.due) || "", placeholder: "YYYY-MM-DD" }
    ];
    new FormModal(this.ctx.app, task ? "Edit task" : "New task", fields, async (v) => {
      if (!(v.title || "").trim())
        return;
      const data = { title: v.title.trim(), status: v.status, priority: v.priority, kanbanName: v.kanbanName, group: v.group, due: v.due };
      if (task)
        await this.ctx.store.updateTask(task, data);
      else
        await this.ctx.store.createTask(data);
      this.ctx.refresh();
    }, task ? "Save" : "Create").open();
  }
  openAddColumnModal() {
    const cfg = this.ctx.config;
    if (cfg.taskColumns.length >= 5) {
      toast("Maximum of 5 columns.");
      return;
    }
    new FormModal(this.ctx.app, "New column", [{ key: "name", label: "Column name", type: "text", placeholder: "Review, Blocked" }], async (v) => {
      const name = (v.name || "").trim();
      if (!name)
        return;
      if (cfg.taskColumns.length >= 5) {
        toast("Maximum of 5 columns.");
        return;
      }
      const id = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
      if (cfg.taskColumns.includes(id))
        return;
      cfg.taskColumns.push(id);
      cfg.taskColumnNames[id] = name;
      await this.ctx.store.saveConfig(cfg);
      this.ctx.refresh();
    }, "Add").open();
  }
  async moveColumn(col, dir) {
    const cfg = this.ctx.config;
    const i = cfg.taskColumns.indexOf(col);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cfg.taskColumns.length)
      return;
    [cfg.taskColumns[i], cfg.taskColumns[j]] = [cfg.taskColumns[j], cfg.taskColumns[i]];
    await this.ctx.store.saveConfig(cfg);
    this.ctx.refresh();
  }
  openRenameColumnModal(col) {
    const cfg = this.ctx.config;
    const current = cfg.taskColumnNames[col] || col;
    new FormModal(this.ctx.app, "Rename column", [{ key: "name", label: "New name", type: "text", value: current }], async (v) => {
      const name = (v.name || "").trim();
      if (!name)
        return;
      cfg.taskColumnNames[col] = name;
      await this.ctx.store.saveConfig(cfg);
      this.ctx.refresh();
    }, "Save").open();
  }
  removeColumn(col, tasks) {
    const cfg = this.ctx.config;
    if (cfg.taskColumns.length <= 1) {
      toast("You must keep at least one column.");
      return;
    }
    new ConfirmModal(this.ctx.app, `Delete column "${this.cleanLabel(cfg.taskColumnNames[col] || col)}"? Tasks move to the first column.`, async () => {
      const remaining = cfg.taskColumns.filter((c) => c !== col);
      const fallback = remaining[0];
      for (const t of tasks.filter((t2) => t2.status === col))
        await this.ctx.store.updateTask(t, { status: fallback });
      cfg.taskColumns = remaining;
      delete cfg.taskColumnNames[col];
      await this.ctx.store.saveConfig(cfg);
      this.ctx.refresh();
    }).open();
  }
};

// src/modules/fitness.ts
var SERIES_COLORS = ["#7c3aed", "#f59e0b", "#16a34a", "#3b82f6", "#ec4899", "#0ea5e9", "#ef4444", "#10b981", "#a855f7"];
var FitnessModule = class {
  constructor(ctx) {
    this.selectedSplit = null;
    // open workout (edit mode)
    this.workoutActive = false;
    // timer running / logging session
    this.selectedDate = null;
    // calendar day detail
    this.weightSplit = "A";
    // weight-progress chart
    this.startTime = null;
    this.checked = /* @__PURE__ */ new Set();
    this.timerId = null;
    this.timerEl = null;
    this.ctx = ctx;
    const now = /* @__PURE__ */ new Date();
    this.calMonth = now.getMonth();
    this.calYear = now.getFullYear();
  }
  destroy() {
    this.stopTimer();
  }
  stopTimer() {
    if (this.timerId != null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }
  getSplits() {
    const map = /* @__PURE__ */ new Map();
    DEFAULT_SPLITS.forEach((s) => map.set(s.id, { ...s }));
    this.ctx.store.loadSplits().forEach((s) => map.set(s.id, s));
    this.ctx.config.customSplits.forEach((s) => map.set(s.id, s));
    return Array.from(map.values());
  }
  render(root) {
    this.stopTimer();
    root.empty();
    const exercises = this.ctx.store.loadExercises();
    const workouts = this.ctx.store.loadWorkouts();
    const gymLog = new Set(workouts.map((w) => w.date));
    this.renderHeader(root, workouts);
    this.renderWorkoutPlan(root, exercises);
    if (this.selectedSplit)
      this.renderWorkoutEditor(root, exercises);
    this.renderStats(root, workouts, gymLog);
    const cols = root.createDiv({ cls: "pa-two-col" });
    this.renderCalendar(cols, workouts);
    this.renderWeightProgress(cols, exercises, workouts);
    if (this.selectedDate)
      this.renderDayDetail(root, workouts);
  }
  // ---- Header with 3 monthly rings ----
  renderHeader(root, workouts) {
    const head = root.createDiv({ cls: "pa-ht-header" });
    const left = head.createDiv();
    left.createDiv({ text: "\u{1F3CB}\uFE0F Fitness", cls: "pa-h1" });
    left.createDiv({ text: "Workouts & progress", cls: "pa-muted" });
    const rings = head.createDiv({ cls: "pa-ht-rings" });
    const now = /* @__PURE__ */ new Date();
    const monthAbbr = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (let m = 2; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const y = d.getFullYear();
      const mon = d.getMonth();
      const prefix = `${y}-${String(mon + 1).padStart(2, "0")}`;
      const isCurrent = m === 0;
      const daysElapsed = isCurrent ? now.getDate() : new Date(y, mon + 1, 0).getDate();
      const workoutDays = new Set(workouts.filter((w) => w.date.startsWith(prefix)).map((w) => w.date)).size;
      const pct = daysElapsed ? Math.round(workoutDays / daysElapsed * 100) : 0;
      const color = pct >= 70 ? "#16a34a" : pct >= 30 ? "#7c3aed" : "#d97706";
      drawRing(rings, pct, color, `${monthAbbr[mon]} ${String(y).slice(2)} \xB7 ${workoutDays}/${daysElapsed}d`, 58);
    }
  }
  // ---- Workout plan cards ----
  renderWorkoutPlan(root, exercises) {
    const splits = this.getSplits();
    const panel = root.createDiv({ cls: "pa-panel" });
    panel.createEl("h3", { text: `\u{1F4CB} Workout Plan \u2014 ${splits.length} slots \xB7 tap a card to edit`, cls: "pa-panel-title" });
    const grid = panel.createDiv({ cls: "pa-plan-grid" });
    splits.forEach((s) => {
      const exs = exercises.filter((e) => e.split === s.id);
      const card = grid.createDiv({ cls: "pa-plan-card pa-clickable" + (this.selectedSplit === s.id ? " on" : "") });
      card.onclick = () => {
        if (this.selectedSplit === s.id) {
          this.endWorkout();
        } else {
          this.selectedSplit = s.id;
          this.selectedDate = null;
          this.weightSplit = s.id;
          this.workoutActive = false;
          this.startTime = null;
          this.checked.clear();
        }
        this.ctx.refresh();
      };
      const ch = card.createDiv({ cls: "pa-plan-head" });
      ch.createSpan({ text: `${s.id} - ${s.name} (${exs.length} ex)`, cls: "pa-plan-title" });
      const listEl = card.createDiv({ cls: "pa-plan-list" });
      if (!exs.length)
        listEl.createDiv({ cls: "pa-muted", text: "No exercises" });
      else
        exs.forEach((ex) => listEl.createDiv({ cls: "pa-plan-ex", text: `${ex.name} \u2014 ${ex.sets}${ex.weight ? ` \xB7 ${ex.weight}kg` : ""}` }));
    });
  }
  endWorkout() {
    this.stopTimer();
    this.selectedSplit = null;
    this.workoutActive = false;
    this.startTime = null;
    this.checked.clear();
  }
  // ---- Stats ----
  renderStats(root, workouts, gymLog) {
    const total = workouts.length;
    const last = workouts.length ? workouts[workouts.length - 1].date : "\u2014";
    let streak = 0;
    for (let i = 0; i < 60; i++) {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() - i);
      if (gymLog.has(ymd(d)))
        streak++;
      else if (i > 0)
        break;
    }
    const durations = workouts.map((w) => w.duration).filter((d) => d > 0);
    const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const row = root.createDiv({ cls: "pa-stats-row" });
    const stat = (label, value) => {
      const c = row.createDiv({ cls: "pa-stat" });
      c.createDiv({ text: value, cls: "pa-stat-value" });
      c.createDiv({ text: label, cls: "pa-stat-label" });
    };
    stat("\u{1F3CB}\uFE0F SESSIONS", String(total));
    stat("\u{1F525} STREAK", String(streak));
    stat("\u23F1 AVG MIN", String(avg));
    stat("\u{1F4C5} LAST", last !== "\u2014" ? last.slice(5) : "\u2014");
  }
  // ---- Calendar ----
  renderCalendar(root, workouts) {
    const splitByDay = /* @__PURE__ */ new Map();
    workouts.forEach((w) => splitByDay.set(w.date, w.split));
    const card = root.createDiv({ cls: "pa-panel" });
    card.createEl("h3", { text: "\u{1F4C5} Workout Calendar", cls: "pa-panel-title" });
    const header = card.createDiv({ cls: "pa-cal-head" });
    const prev = header.createEl("button", { text: "\u2190", cls: "pa-icon-btn" });
    header.createSpan({ text: new Date(this.calYear, this.calMonth, 1).toLocaleString("default", { month: "long", year: "numeric" }), cls: "pa-cal-title" });
    const next = header.createEl("button", { text: "\u2192", cls: "pa-icon-btn" });
    prev.onclick = () => {
      this.calMonth--;
      if (this.calMonth < 0) {
        this.calMonth = 11;
        this.calYear--;
      }
      this.ctx.refresh();
    };
    next.onclick = () => {
      this.calMonth++;
      if (this.calMonth > 11) {
        this.calMonth = 0;
        this.calYear++;
      }
      this.ctx.refresh();
    };
    const grid = card.createDiv({ cls: "pa-cal-grid" });
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d) => grid.createDiv({ text: d, cls: "pa-cal-dow" }));
    const firstDow = new Date(this.calYear, this.calMonth, 1).getDay();
    const daysInMonth = new Date(this.calYear, this.calMonth + 1, 0).getDate();
    for (let i = 0; i < firstDow; i++)
      grid.createDiv({ cls: "pa-cal-cell empty" });
    const today = todayLocal();
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${this.calYear}-${String(this.calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const cell = grid.createDiv({ cls: "pa-cal-cell" });
      cell.createDiv({ text: String(day), cls: "pa-cal-day" });
      const sp = splitByDay.get(ds);
      if (sp) {
        cell.addClass("worked");
        cell.createDiv({ text: sp, cls: "pa-cal-tag" });
        cell.onclick = () => {
          this.selectedDate = ds;
          this.selectedSplit = null;
          this.ctx.refresh();
        };
      }
      if (ds === today)
        cell.addClass("today");
      if (ds === this.selectedDate)
        cell.addClass("selected");
    }
  }
  // ---- Weight progress ----
  renderWeightProgress(root, exercises, workouts) {
    const card = root.createDiv({ cls: "pa-panel" });
    const head = card.createDiv({ cls: "pa-section-head" });
    head.createEl("h3", { text: "\u{1F4C8} Weight Progress", cls: "pa-panel-title" });
    const sel = head.createEl("select", { cls: "pa-select" });
    this.getSplits().forEach((s) => {
      const o = sel.createEl("option", { text: `Workout ${s.id}`, value: s.id });
      if (s.id === this.weightSplit)
        o.selected = true;
    });
    sel.onchange = () => {
      this.weightSplit = sel.value;
      this.ctx.refresh();
    };
    const splitWorkouts = workouts.filter((w) => w.split === this.weightSplit).sort((a, b) => a.date.localeCompare(b.date));
    const labels = splitWorkouts.map((w) => w.date.slice(5));
    const exs = exercises.filter((e) => e.split === this.weightSplit);
    const series = exs.map((ex, i) => ({
      name: ex.name,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      values: splitWorkouts.map((w) => {
        const found = w.exercises.find((we) => we.exercise === ex.name);
        return found ? found.weight : null;
      })
    })).filter((s) => s.values.some((v) => v != null));
    drawLineChart(card, labels, series, { height: 220 });
  }
  // ---- Calendar day detail ----
  renderDayDetail(root, workouts) {
    const ds = this.selectedDate;
    const workout = workouts.find((w) => w.date === ds);
    const panel = root.createDiv({ cls: "pa-panel pa-active" });
    const top = panel.createDiv({ cls: "pa-active-top" });
    top.createEl("h3", { text: `\u{1F3CB}\uFE0F ${ds} \u2014 ${workout ? workout.exercises.length : 0} exercises`, cls: "pa-panel-title" });
    const close = top.createEl("button", { text: "\u2715", cls: "pa-icon-btn" });
    close.onclick = () => {
      this.selectedDate = null;
      this.ctx.refresh();
    };
    if (!workout || !workout.exercises.length) {
      panel.createEl("p", { cls: "pa-muted", text: "No exercises logged this day." });
      return;
    }
    const table = panel.createEl("table", { cls: "pa-fit-table" });
    const thr = table.createEl("thead").createEl("tr");
    ["Exercise", "Weight", "Sets", ""].forEach((h) => thr.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    workout.exercises.forEach((we) => {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: we.exercise, cls: "pa-fit-name" });
      tr.createEl("td", { text: `${we.weight}kg` });
      tr.createEl("td", { text: we.sets, cls: "pa-muted" });
      tr.createEl("td", { text: we.feel || "", cls: "pa-muted" });
    });
  }
  // ---- Workout editor (edit mode + optional active session) ----
  renderWorkoutEditor(root, exercises) {
    const splitId = this.selectedSplit;
    const exs = exercises.filter((e) => e.split === splitId);
    const panel = root.createDiv({ cls: "pa-panel pa-active" });
    const top = panel.createDiv({ cls: "pa-active-top" });
    const split = this.getSplits().find((s) => s.id === splitId);
    const titleWrap = top.createDiv({ cls: "pa-editor-title" });
    titleWrap.createEl("h3", { text: `${splitId} - ${(split == null ? void 0 : split.name) || ""}`, cls: "pa-panel-title" });
    if (split) {
      const rename = titleWrap.createEl("button", { text: "\u270F\uFE0F", cls: "pa-icon-btn" });
      rename.onclick = () => this.openSplitRename(split);
    }
    if (this.workoutActive) {
      this.timerEl = top.createSpan({ text: "\u23F1 00:00", cls: "pa-timer" });
      this.startTimer();
    }
    if (!exs.length) {
      panel.createEl("p", { cls: "pa-muted", text: "No exercises in this workout. Add some with + Exercise." });
    } else {
      const table = panel.createEl("table", { cls: "pa-fit-table" });
      const cols = this.workoutActive ? ["\u2713", "Exercise", "Weight", "Sets", "How-to", ""] : ["Exercise", "Weight", "Sets", "How-to", ""];
      const thead = table.createEl("thead").createEl("tr");
      cols.forEach((h) => thead.createEl("th", { text: h }));
      const tbody = table.createEl("tbody");
      exs.forEach((ex) => this.renderExerciseRow(tbody, ex));
    }
    const actions = panel.createDiv({ cls: "pa-active-actions" });
    if (this.workoutActive) {
      const finish = actions.createEl("button", { text: "\u2705 Finish workout", cls: "pa-btn" });
      finish.onclick = () => this.finishWorkout(splitId, exs, panel);
    } else {
      const start = actions.createEl("button", { text: "\u25B6 Start workout", cls: "pa-btn" });
      start.onclick = async () => {
        await this.persistRowEdits(exs, panel);
        this.workoutActive = true;
        this.startTime = Date.now();
        this.checked.clear();
        this.ctx.refresh();
      };
      const addEx = actions.createEl("button", { text: "+ Exercise", cls: "pa-mini-btn" });
      addEx.onclick = () => this.openExerciseModal(null);
      const save = actions.createEl("button", { text: "\u{1F4BE} Save changes", cls: "pa-mini-btn" });
      save.onclick = async () => {
        const n = await this.persistRowEdits(exs, panel);
        toast(n ? `\u{1F4BE} Saved (${n})` : "\u{1F4BE} Saved");
      };
    }
    const close = actions.createEl("button", { text: "Close", cls: "pa-mini-btn" });
    close.onclick = () => {
      this.endWorkout();
      this.ctx.refresh();
    };
  }
  /** Persist edited weight/sets back to the exercise files. Returns number changed. */
  async persistRowEdits(exs, panel) {
    let changed = 0;
    for (const ex of exs) {
      const wInput = panel.querySelector(`input.pa-weight-input[data-ex="${CSS.escape(ex.name)}"]`);
      const sInput = panel.querySelector(`input.pa-sets-input[data-ex="${CSS.escape(ex.name)}"]`);
      const newWeight = wInput ? parseFloat(wInput.value) || 0 : ex.weight;
      const newSets = sInput ? sInput.value.trim() || ex.sets : ex.sets;
      if (newWeight !== ex.weight || newSets !== ex.sets) {
        await this.ctx.store.saveExercise({ ...ex, weight: newWeight, sets: newSets });
        changed++;
      }
    }
    return changed;
  }
  renderExerciseRow(tbody, ex) {
    const tr = tbody.createEl("tr");
    if (this.workoutActive) {
      const check = tr.createEl("td").createEl("input");
      check.type = "checkbox";
      check.checked = this.checked.has(ex.name);
      check.onchange = () => {
        if (check.checked)
          this.checked.add(ex.name);
        else
          this.checked.delete(ex.name);
        tr.toggleClass("done", check.checked);
      };
      tr.toggleClass("done", check.checked);
    }
    const nameTd = tr.createEl("td", { cls: "pa-fit-name" });
    nameTd.createDiv({ text: ex.name });
    if (ex.howto)
      nameTd.setAttr("title", ex.howto);
    const wInput = tr.createEl("td").createEl("input", { cls: "pa-fit-input" });
    wInput.type = "number";
    wInput.value = String(ex.weight);
    wInput.dataset.ex = ex.name;
    wInput.addClass("pa-weight-input");
    const setsInput = tr.createEl("td").createEl("input", { cls: "pa-fit-input" });
    setsInput.value = ex.sets;
    setsInput.dataset.ex = ex.name;
    setsInput.addClass("pa-sets-input");
    tr.createEl("td", { text: ex.howto || "\u2014", cls: "pa-fit-howto" });
    const actionsTd = tr.createEl("td");
    const edit = actionsTd.createEl("button", { text: "\u270F\uFE0F", cls: "pa-icon-btn" });
    edit.onclick = () => this.openExerciseModal(ex);
    const del = actionsTd.createEl("button", { text: "\u{1F5D1}", cls: "pa-icon-btn" });
    del.onclick = () => new ConfirmModal(this.ctx.app, `Delete exercise "${ex.name}"?`, async () => {
      await this.ctx.store.deleteExercise(ex);
      this.ctx.refresh();
    }).open();
  }
  startTimer() {
    this.stopTimer();
    const tick = () => {
      if (!this.startTime || !this.timerEl)
        return;
      const diff = Math.floor((Date.now() - this.startTime) / 1e3);
      this.timerEl.setText(`\u23F1 ${String(Math.floor(diff / 60)).padStart(2, "0")}:${String(diff % 60).padStart(2, "0")}`);
    };
    tick();
    this.timerId = window.setInterval(tick, 1e3);
  }
  async finishWorkout(splitId, exs, panel) {
    if (!this.startTime)
      return;
    const duration = Math.max(1, Math.floor((Date.now() - this.startTime) / 1e3 / 60));
    const logged = [];
    for (const ex of exs) {
      const wInput = panel.querySelector(`input.pa-weight-input[data-ex="${CSS.escape(ex.name)}"]`);
      const sInput = panel.querySelector(`input.pa-sets-input[data-ex="${CSS.escape(ex.name)}"]`);
      const newWeight = wInput ? parseFloat(wInput.value) || 0 : ex.weight;
      const newSets = sInput ? sInput.value.trim() || ex.sets : ex.sets;
      if (newWeight !== ex.weight || newSets !== ex.sets)
        await this.ctx.store.saveExercise({ ...ex, weight: newWeight, sets: newSets });
      if (this.checked.has(ex.name))
        logged.push({ exercise: ex.name, weight: newWeight, sets: newSets, feel: "good", oldWeight: ex.weight });
    }
    if (!logged.length) {
      toast("Check at least one exercise to log.");
      return;
    }
    await this.ctx.store.logWorkout(splitId, duration, logged);
    this.endWorkout();
    this.selectedDate = todayLocal();
    this.ctx.refresh();
    toast(`\u{1F4AA} Workout logged (${logged.length} exercises, ${duration}min)`);
  }
  // ---- Modals ----
  openSplitRename(s) {
    new FormModal(this.ctx.app, "Rename workout", [{ key: "name", label: "Workout name", type: "text", value: s.name }], async (v) => {
      const name = (v.name || "").trim();
      if (!name)
        return;
      const splits = this.getSplits().map((x) => x.id === s.id ? { ...x, name } : x);
      await this.ctx.store.saveSplits(splits);
      this.ctx.refresh();
    }, "Save").open();
  }
  openExerciseModal(ex) {
    var _a;
    const splitOptions = this.getSplits().map((s) => ({ value: s.id, label: `${s.id} \u2014 ${s.name}` }));
    const fields = [
      { key: "name", label: "Name", type: "text", value: (ex == null ? void 0 : ex.name) || "" },
      { key: "split", label: "Workout", type: "dropdown", options: splitOptions, value: (ex == null ? void 0 : ex.split) || (this.selectedSplit || "A") },
      { key: "sets", label: "Sets x reps", type: "text", value: (ex == null ? void 0 : ex.sets) || "3x10" },
      { key: "weight", label: "Weight (kg)", type: "number", value: (_a = ex == null ? void 0 : ex.weight) != null ? _a : 0 },
      { key: "howto", label: "How-to", type: "textarea", value: (ex == null ? void 0 : ex.howto) || "" }
    ];
    new FormModal(this.ctx.app, ex ? "Edit exercise" : "New exercise", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name)
        return;
      const ok = await this.ctx.store.saveExercise({
        name,
        split: v.split,
        sets: v.sets || "3x10",
        weight: parseFloat(v.weight) || 0,
        howto: v.howto || "",
        // preserve metadata not edited here
        muscle: (ex == null ? void 0 : ex.muscle) || "",
        type: (ex == null ? void 0 : ex.type) || "machine"
      }, ex == null ? void 0 : ex.name);
      if (!ok) {
        toast(`An exercise named "${name}" already exists.`);
        return;
      }
      this.ctx.refresh();
    }, ex ? "Save" : "Create").open();
  }
};

// src/modules/nutrition.ts
var SLOTS = [
  { id: "breakfast", name: "Breakfast", emoji: "\u2615" },
  { id: "lunch", name: "Lunch", emoji: "\u{1F37D}\uFE0F" },
  { id: "dinner", name: "Dinner", emoji: "\u{1F319}" },
  { id: "snacks", name: "Snacks", emoji: "\u{1F34E}" }
];
var NutritionModule = class {
  constructor(ctx) {
    this.selectedMeal = null;
    this.selectedDate = null;
    this.addForm = { name: "", qty: "100", cal: "", meal: "lunch" };
    const now = /* @__PURE__ */ new Date();
    this.ctx = ctx;
    this.calMonth = now.getMonth();
    this.calYear = now.getFullYear();
  }
  /** The 4 fixed slots, hydrated with any saved plan file. */
  getMeals() {
    const saved = this.ctx.store.loadMeals();
    return SLOTS.map((s) => {
      const m = saved.find((x) => x.id === s.id);
      return m ? { ...m, name: s.name, emoji: s.emoji } : { id: s.id, name: s.name, emoji: s.emoji, totalCal: 0, items: [], path: "" };
    });
  }
  render(root) {
    root.empty();
    const meals = this.getMeals();
    const logs = this.ctx.store.loadMealLogs();
    const water = this.ctx.store.loadWaterLog();
    const today = todayLocal();
    const calByDay = /* @__PURE__ */ new Map();
    logs.forEach((l) => calByDay.set(l.date, (calByDay.get(l.date) || 0) + l.totalCal));
    this.renderHeader(root, calByDay, today);
    this.renderMealPlans(root, meals);
    this.renderAddFood(root, meals);
    if (this.selectedMeal)
      this.renderMealEditor(root, meals);
    this.renderStats(root, calByDay, water, today);
    const cols = root.createDiv({ cls: "pa-two-col" });
    this.renderCalendar(cols, calByDay);
    this.renderTrend(cols, calByDay, today);
    if (this.selectedDate)
      this.renderDayDetail(root, meals, logs);
  }
  // ---- Header rings (last 3 days calorie %) ----
  renderHeader(root, calByDay, today) {
    const head = root.createDiv({ cls: "pa-ht-header" });
    const left = head.createDiv();
    left.createDiv({ text: "\u{1F957} Nutrition", cls: "pa-h1" });
    left.createDiv({ text: "Daily food tracking", cls: "pa-muted" });
    const target = this.ctx.config.calorieTarget || 2e3;
    const rings = head.createDiv({ cls: "pa-ht-rings" });
    const dayN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const base = /* @__PURE__ */ new Date(today + "T00:00:00");
    for (let i = 2; i >= 0; i--) {
      const dt = new Date(base);
      dt.setDate(dt.getDate() - i);
      const ds = ymd(dt);
      const cal = calByDay.get(ds) || 0;
      const pct = target ? Math.round(cal / target * 100) : 0;
      const color = pct >= 80 && pct <= 110 ? "#16a34a" : pct > 110 ? "#ef4444" : "#d97706";
      const label = i === 0 ? `Today \xB7 ${cal} cal` : `${dayN[dt.getDay()]} ${dt.getDate()} \xB7 ${cal} cal`;
      drawRing(rings, pct, color, label, 58);
    }
  }
  // ---- Add a food (fixed bar) — to a plan (recurring) or just today's meal ----
  renderAddFood(root, meals) {
    const panel = root.createDiv({ cls: "pa-panel pa-addfood" });
    const head = panel.createDiv({ cls: "pa-section-head" });
    head.createEl("h4", { text: "\u{1F50E} Add a food \u2014 pick the meal, then add to the plan or just to today", cls: "pa-panel-title" });
    const water = head.createEl("button", { text: "\u{1F4A7} +250ml", cls: "pa-mini-btn" });
    water.onclick = async () => {
      await this.ctx.store.addWater(todayLocal(), 0.25);
      this.ctx.refresh();
      toast("\u{1F4A7} +250ml");
    };
    const row = panel.createDiv({ cls: "pa-addfood-row" });
    const nameInput = row.createEl("input", { cls: "pa-addfood-name", placeholder: "Food name\u2026" });
    nameInput.value = this.addForm.name;
    nameInput.oninput = () => this.addForm.name = nameInput.value;
    const qty = row.createEl("input", { cls: "pa-fit-input" });
    qty.type = "number";
    qty.value = this.addForm.qty;
    qty.title = "Qty (g)";
    qty.oninput = () => this.addForm.qty = qty.value;
    const cal = row.createEl("input", { cls: "pa-fit-input" });
    cal.type = "number";
    cal.placeholder = "Cal";
    cal.value = this.addForm.cal;
    cal.oninput = () => this.addForm.cal = cal.value;
    const mealSel = row.createEl("select", { cls: "pa-select" });
    SLOTS.forEach((s) => {
      const o = mealSel.createEl("option", { text: s.name, value: s.id });
      if (s.id === this.addForm.meal)
        o.selected = true;
    });
    mealSel.onchange = () => this.addForm.meal = mealSel.value;
    const buildItem = () => {
      const name = this.addForm.name.trim();
      if (!name) {
        toast("Enter a food name.");
        return null;
      }
      return { name, qty: parseFloat(this.addForm.qty) || 0, unit: "g", cal: parseInt(this.addForm.cal) || 0 };
    };
    const targetMeal = () => meals.find((m) => m.id === this.addForm.meal);
    const toToday = row.createEl("button", { text: "+ Add to Today", cls: "pa-btn" });
    toToday.onclick = async () => {
      const item = buildItem();
      if (!item)
        return;
      await this.ctx.store.logMeal(targetMeal(), [item]);
      this.addForm.name = "";
      this.addForm.cal = "";
      this.selectedDate = todayLocal();
      this.ctx.refresh();
      toast(`Logged ${item.name} to ${targetMeal().name}`);
    };
    const toPlan = row.createEl("button", { text: "+ Add to Plan", cls: "pa-mini-btn" });
    toPlan.onclick = async () => {
      const item = buildItem();
      if (!item)
        return;
      const meal = targetMeal();
      await this.ctx.store.saveMeal({ id: meal.id, name: meal.name, emoji: meal.emoji, items: [...meal.items, item] });
      this.addForm.name = "";
      this.addForm.cal = "";
      this.ctx.refresh();
      toast(`Added ${item.name} to ${meal.name} plan`);
    };
  }
  // ---- Meal plan cards (fixed 4, whole card clickable) ----
  renderMealPlans(root, meals) {
    const panel = root.createDiv({ cls: "pa-panel" });
    const head = panel.createDiv({ cls: "pa-section-head" });
    head.createEl("h3", { text: "\u{1F37D}\uFE0F Meal Plan \u2014 4 fixed slots \xB7 tap a card to edit", cls: "pa-panel-title" });
    const water = head.createEl("button", { text: "\u{1F4A7} +250ml", cls: "pa-mini-btn" });
    water.onclick = async () => {
      await this.ctx.store.addWater(todayLocal(), 0.25);
      this.ctx.refresh();
      toast("\u{1F4A7} +250ml");
    };
    const grid = panel.createDiv({ cls: "pa-plan-grid" });
    meals.forEach((m) => {
      const card = grid.createDiv({ cls: "pa-plan-card pa-clickable" + (this.selectedMeal === m.id ? " on" : "") });
      card.onclick = () => {
        this.selectedMeal = this.selectedMeal === m.id ? null : m.id;
        this.selectedDate = null;
        this.ctx.refresh();
      };
      card.createDiv({ text: `${m.emoji || ""} ${m.name} (${m.totalCal} cal)`.trim(), cls: "pa-plan-title" });
      const listEl = card.createDiv({ cls: "pa-plan-list" });
      if (!m.items.length)
        listEl.createDiv({ cls: "pa-muted", text: "No items" });
      else
        m.items.forEach((it) => listEl.createDiv({ cls: "pa-plan-ex", text: `${it.name} \u2014 ${it.qty} ${it.unit}` }));
    });
  }
  // ---- Meal editor (below plans) ----
  renderMealEditor(root, meals) {
    const meal = meals.find((m) => m.id === this.selectedMeal);
    if (!meal)
      return;
    const panel = root.createDiv({ cls: "pa-panel pa-active" });
    const top = panel.createDiv({ cls: "pa-active-top" });
    top.createEl("h3", { text: `${meal.emoji || ""} ${meal.name}`.trim(), cls: "pa-panel-title" });
    const totalEl = top.createSpan({ cls: "pa-muted" });
    const table = panel.createEl("table", { cls: "pa-fit-table" });
    const thr = table.createEl("thead").createEl("tr");
    ["\u2713", "Food", "Qty", "Unit", "Calories", ""].forEach((h) => thr.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    const recalc = () => {
      let sum = 0;
      tbody.querySelectorAll("tr").forEach((tr) => {
        const chk = tr.querySelector("input.pa-it-check");
        const calIn = tr.querySelector("input.pa-it-cal");
        if (chk == null ? void 0 : chk.checked)
          sum += parseInt(calIn.value) || 0;
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
        chk.type = "checkbox";
        chk.checked = true;
        chk.onchange = recalc;
        tr.createEl("td", { text: it.name, cls: "pa-fit-name" });
        const qtyIn = tr.createEl("td").createEl("input", { cls: "pa-fit-input pa-it-qty" });
        qtyIn.type = "number";
        qtyIn.value = String(it.qty);
        tr.createEl("td", { text: it.unit, cls: "pa-muted" });
        const calIn = tr.createEl("td").createEl("input", { cls: "pa-fit-input pa-it-cal" });
        calIn.type = "number";
        calIn.value = String(it.cal);
        calIn.oninput = recalc;
        const del = tr.createEl("td").createEl("button", { text: "\u{1F5D1}", cls: "pa-icon-btn" });
        del.onclick = () => {
          tr.remove();
          recalc();
        };
      });
    }
    recalc();
    const actions = panel.createDiv({ cls: "pa-active-actions" });
    const confirm = actions.createEl("button", { text: "\u2713 Confirm Meal", cls: "pa-btn" });
    confirm.onclick = async () => {
      const eaten = this.readRows(tbody, meal, true);
      if (!eaten.length) {
        toast("Check at least one item.");
        return;
      }
      await this.ctx.store.logMeal(meal, eaten);
      this.selectedMeal = null;
      this.selectedDate = todayLocal();
      this.ctx.refresh();
      toast(`\u2713 ${meal.name} confirmed`);
    };
    const save = actions.createEl("button", { text: "\u{1F4BE} Save Plan", cls: "pa-mini-btn" });
    save.onclick = async () => {
      await this.ctx.store.saveMeal({ id: meal.id, name: meal.name, emoji: meal.emoji, items: this.readRows(tbody, meal, false) });
      this.ctx.refresh();
      toast("\u{1F4BE} Plan saved");
    };
    const close = actions.createEl("button", { text: "Close", cls: "pa-mini-btn" });
    close.onclick = () => {
      this.selectedMeal = null;
      this.ctx.refresh();
    };
  }
  readRows(tbody, meal, onlyChecked) {
    const items = [];
    tbody.querySelectorAll("tr").forEach((tr) => {
      const chk = tr.querySelector("input.pa-it-check");
      if (onlyChecked && !chk.checked)
        return;
      const idx = parseInt(tr.dataset.idx || "0");
      const base = meal.items[idx] || { name: "Item", unit: "g" };
      items.push({
        name: base.name,
        unit: base.unit,
        qty: parseFloat(tr.querySelector("input.pa-it-qty").value) || 0,
        cal: parseInt(tr.querySelector("input.pa-it-cal").value) || 0,
        protein: base.protein,
        carbs: base.carbs
      });
    });
    return items;
  }
  // ---- Stats ----
  renderStats(root, calByDay, water, today) {
    const cfg = this.ctx.config;
    const consumed = calByDay.get(today) || 0;
    const remaining = cfg.calorieTarget - consumed;
    const waterToday = water[today] || 0;
    const row = root.createDiv({ cls: "pa-stats-row" });
    const stat = (label, value, color) => {
      const c = row.createDiv({ cls: "pa-stat" });
      const v = c.createDiv({ text: value, cls: "pa-stat-value" });
      if (color)
        v.style.color = color;
      c.createDiv({ text: label, cls: "pa-stat-label" });
    };
    stat("\u{1F957} CALORIES TODAY", String(consumed));
    stat("\u{1F3AF} DAILY GOAL", String(cfg.calorieTarget), "var(--text-accent)");
    stat("\u2796 REMAINING", String(remaining), remaining >= 0 ? "#16a34a" : "#ef4444");
    stat(`\u{1F4A7} WATER /${cfg.waterTarget}L`, `${waterToday.toFixed(1)}L`, "#3b82f6");
  }
  // ---- Calendar ----
  renderCalendar(root, calByDay) {
    const target = this.ctx.config.calorieTarget || 2e3;
    const card = root.createDiv({ cls: "pa-panel" });
    card.createEl("h3", { text: "\u{1F4C5} Meal Calendar", cls: "pa-panel-title" });
    const header = card.createDiv({ cls: "pa-cal-head" });
    const prev = header.createEl("button", { text: "\u2190", cls: "pa-icon-btn" });
    header.createSpan({ text: new Date(this.calYear, this.calMonth, 1).toLocaleString("default", { month: "long", year: "numeric" }), cls: "pa-cal-title" });
    const next = header.createEl("button", { text: "\u2192", cls: "pa-icon-btn" });
    prev.onclick = () => {
      this.calMonth--;
      if (this.calMonth < 0) {
        this.calMonth = 11;
        this.calYear--;
      }
      this.ctx.refresh();
    };
    next.onclick = () => {
      this.calMonth++;
      if (this.calMonth > 11) {
        this.calMonth = 0;
        this.calYear++;
      }
      this.ctx.refresh();
    };
    const grid = card.createDiv({ cls: "pa-cal-grid" });
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d) => grid.createDiv({ text: d, cls: "pa-cal-dow" }));
    const firstDow = new Date(this.calYear, this.calMonth, 1).getDay();
    const daysInMonth = new Date(this.calYear, this.calMonth + 1, 0).getDate();
    for (let i = 0; i < firstDow; i++)
      grid.createDiv({ cls: "pa-cal-cell empty" });
    const today = todayLocal();
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${this.calYear}-${String(this.calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const cell = grid.createDiv({ cls: "pa-cal-cell" });
      cell.createDiv({ text: String(day), cls: "pa-cal-day" });
      const cal = calByDay.get(ds);
      if (cal != null) {
        const pct = target ? cal / target * 100 : 0;
        const color = pct >= 80 && pct <= 110 ? "#16a34a" : pct > 110 ? "#ef4444" : "#f59e0b";
        cell.style.background = color;
        cell.style.color = "#fff";
        cell.createDiv({ text: String(cal), cls: "pa-cal-tag" });
        cell.onclick = () => {
          this.selectedDate = ds;
          this.selectedMeal = null;
          this.ctx.refresh();
        };
      }
      if (ds === today)
        cell.addClass("today");
    }
    const legend = card.createDiv({ cls: "pa-cal-legend" });
    [["#f59e0b", "<80%"], ["#16a34a", "80-110%"], ["#ef4444", ">110%"]].forEach(([c, l]) => {
      const item = legend.createDiv({ cls: "pa-legend-item" });
      const dot = item.createSpan({ cls: "pa-legend-dot" });
      dot.style.background = c;
      item.createSpan({ text: l });
    });
  }
  // ---- Calories last 7 days ----
  renderTrend(root, calByDay, today) {
    const card = root.createDiv({ cls: "pa-panel" });
    card.createEl("h3", { text: "\u{1F4C8} Calories Last 7 Days", cls: "pa-panel-title" });
    const labels = [];
    const values = [];
    const base = /* @__PURE__ */ new Date(today + "T00:00:00");
    for (let i = 6; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      const ds = ymd(d);
      labels.push(ds.slice(5));
      values.push(calByDay.get(ds) || 0);
    }
    drawLineChart(card, labels, [{ name: "Calories", color: "#f59e0b", values }], { goal: this.ctx.config.calorieTarget, height: 220 });
  }
  // ---- Selected day detail (log) ----
  renderDayDetail(root, meals, logs) {
    const ds = this.selectedDate;
    const dayLogs = logs.filter((l) => l.date === ds);
    const total = dayLogs.reduce((s, l) => s + l.totalCal, 0);
    const panel = root.createDiv({ cls: "pa-panel pa-active" });
    const top = panel.createDiv({ cls: "pa-active-top" });
    top.createEl("h3", { text: `\u{1F374} ${ds} \u2014 ${total} cal`, cls: "pa-panel-title" });
    const close = top.createEl("button", { text: "\u2715", cls: "pa-icon-btn" });
    close.onclick = () => {
      this.selectedDate = null;
      this.ctx.refresh();
    };
    if (!dayLogs.length) {
      panel.createEl("p", { cls: "pa-muted", text: "No meals logged this day." });
      return;
    }
    dayLogs.forEach((l) => {
      const meal = meals.find((m) => m.id === l.mealId);
      const card = panel.createDiv({ cls: "pa-card" });
      const tr = card.createDiv({ cls: "pa-card-title-row" });
      tr.createEl("strong", { text: meal ? `${meal.emoji || ""} ${meal.name}` : l.mealId || "Meal" });
      const del = tr.createEl("button", { text: "\u2715", cls: "pa-icon-btn" });
      del.onclick = async () => {
        await this.ctx.store.deleteMealLog(l);
        this.ctx.refresh();
      };
      l.items.forEach((it) => card.createDiv({ cls: "pa-muted", text: `${it.name} \u2014 ${it.qty}${it.unit} (${it.cal} cal)` }));
      card.createDiv({ cls: "pa-macro-total", text: `Total: ${l.totalCal} cal` });
    });
  }
};

// src/modules/studies.ts
var RING_COLORS2 = ["#d97706", "#7c3aed", "#16a34a"];
var COLUMN_COLORS2 = ["#7c3aed", "#3b82f6", "#16a34a", "#f59e0b", "#ef4444", "#10b981"];
var StudiesModule = class {
  constructor(ctx) {
    this.currentTopic = "all";
    this.view = "kanban";
    this.ctx = ctx;
  }
  cleanLabel(s) {
    return s.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  }
  colColor(i) {
    return COLUMN_COLORS2[i % COLUMN_COLORS2.length];
  }
  resolveTopics(cards) {
    const boards = this.ctx.store.loadStudyBoards();
    if (boards.length)
      return boards;
    const seen = /* @__PURE__ */ new Map();
    cards.forEach((c) => {
      if (c.topic && !seen.has(c.topic))
        seen.set(c.topic, { id: c.topic.toLowerCase().replace(/[^a-z0-9]/g, "-"), name: c.topic, emoji: "\u{1F4DA}" });
    });
    return Array.from(seen.values());
  }
  render(root) {
    root.empty();
    const cards = this.ctx.store.loadStudyCards();
    const topics = this.resolveTopics(cards);
    const filtered = cards.filter((c) => this.currentTopic === "all" || c.topic === this.currentTopic);
    this.renderHeader(root, filtered);
    this.renderViewToggle(root);
    this.renderTopicTabs(root, topics);
    if (this.view === "kanban") {
      this.renderStats(root, filtered);
      this.renderTopicBar(root, topics);
      this.renderKanban(root, filtered, topics);
    } else {
      this.renderList(root, filtered, topics);
    }
  }
  // ---- Header: title + subtitle + status rings ----
  renderHeader(root, filtered) {
    const head = root.createDiv({ cls: "pa-ht-header" });
    const left = head.createDiv();
    left.createDiv({ text: "\u{1F4DA} Studies", cls: "pa-h1" });
    left.createDiv({ text: "Kanban and list", cls: "pa-muted" });
    const cols = this.ctx.config.studyColumns;
    const names = this.ctx.config.studyColumnNames;
    const colSet = new Set(cols);
    const eff = (c) => colSet.has(c.status) ? c.status : cols[0];
    const total = filtered.length || 1;
    const rings = head.createDiv({ cls: "pa-ht-rings" });
    cols.slice(0, 3).forEach((col, i) => {
      const cnt = filtered.filter((c) => eff(c) === col).length;
      const pct = Math.round(cnt / total * 100);
      drawRing(rings, pct, RING_COLORS2[i] || "#7c3aed", this.cleanLabel(names[col] || col), 52);
    });
  }
  renderViewToggle(root) {
    const bar = root.createDiv({ cls: "pa-view-toggle" });
    const mk = (id, label) => {
      const b = bar.createEl("button", { text: label, cls: "pa-toggle-btn" + (this.view === id ? " on" : "") });
      b.onclick = () => {
        this.view = id;
        this.ctx.refresh();
      };
    };
    mk("kanban", "\u{1F4CB} Kanban");
    mk("list", "\u{1F4C3} List");
  }
  renderTopicTabs(root, topics) {
    const bar = root.createDiv({ cls: "pa-tabs" });
    const mkTab = (id, label) => {
      const t = bar.createEl("button", { text: label, cls: "pa-tab" + (this.currentTopic === id ? " on" : "") });
      t.onclick = () => {
        this.currentTopic = id;
        this.ctx.refresh();
      };
    };
    mkTab("all", "\u{1F4DA} All");
    topics.forEach((b) => mkTab(b.name, `${b.emoji || ""} ${b.name}`.trim()));
    const add = bar.createEl("button", { text: "+ Topic", cls: "pa-tab pa-tab-add" });
    add.onclick = () => this.openTopicModal(topics);
  }
  renderStats(root, filtered) {
    const cols = this.ctx.config.studyColumns;
    const names = this.ctx.config.studyColumnNames;
    const colSet = new Set(cols);
    const eff = (c) => colSet.has(c.status) ? c.status : cols[0];
    const total = filtered.length;
    const row = root.createDiv({ cls: "pa-stats-row" });
    const stat = (label, value, color) => {
      const c = row.createDiv({ cls: "pa-stat" });
      const v = c.createDiv({ text: value, cls: "pa-stat-value" });
      if (color)
        v.style.color = color;
      c.createDiv({ text: label, cls: "pa-stat-label" });
    };
    stat("\u{1F4CB} TOTAL", String(total));
    cols.slice(0, 3).forEach((col, i, arr) => {
      const cnt = filtered.filter((c) => eff(c) === col).length;
      const label = (names[col] || col).toUpperCase();
      if (i === arr.length - 1)
        stat(label, (total ? Math.round(cnt / total * 100) : 0) + "%", this.colColor(i));
      else
        stat(label, String(cnt), this.colColor(i));
    });
  }
  renderTopicBar(root, topics) {
    const bar = root.createDiv({ cls: "pa-board-bar" });
    const topic = topics.find((b) => b.name === this.currentTopic);
    bar.createDiv({ text: topic ? `${topic.emoji || ""} ${topic.name}`.trim() : "\u{1F4DA} All topics", cls: "pa-board-title" });
    const actions = bar.createDiv({ cls: "pa-board-actions" });
    if (topic) {
      const renameBtn = actions.createEl("button", { text: "\u270F\uFE0F Rename", cls: "pa-mini-btn" });
      renameBtn.onclick = () => this.openRenameTopicModal(topic, topics);
      const del = actions.createEl("button", { text: "\u{1F5D1} Delete topic", cls: "pa-mini-btn" });
      del.onclick = () => new ConfirmModal(this.ctx.app, `Delete topic "${topic.name}"? (cards are kept)`, async () => {
        await this.ctx.store.saveStudyBoards(topics.filter((b) => b.name !== topic.name));
        this.currentTopic = "all";
        this.ctx.refresh();
      }).open();
    }
    const addCol = actions.createEl("button", { text: "+ Column", cls: "pa-mini-btn" });
    addCol.onclick = () => this.openAddColumnModal();
  }
  openRenameTopicModal(topic, topics) {
    const fields = [
      { key: "name", label: "Topic name", type: "text", value: topic.name },
      { key: "emoji", label: "Emoji", type: "text", value: topic.emoji || "" }
    ];
    new FormModal(this.ctx.app, "Rename topic", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name)
        return;
      if (name !== topic.name && topics.some((b) => b.name === name)) {
        toast(`A topic named "${name}" already exists.`);
        return;
      }
      const updated = topics.map((b) => b.name === topic.name ? { ...b, name, emoji: (v.emoji || "").trim() } : b);
      await this.ctx.store.saveStudyBoards(updated);
      if (name !== topic.name) {
        for (const c of this.ctx.store.loadStudyCards().filter((c2) => c2.topic === topic.name)) {
          await this.ctx.store.updateStudyCard(c, { topic: name });
        }
        if (this.currentTopic === topic.name)
          this.currentTopic = name;
      }
      this.ctx.refresh();
      toast("Topic updated");
    }, "Save").open();
  }
  // ---- Kanban ----
  renderKanban(root, filtered, topics) {
    const cols = this.ctx.config.studyColumns;
    const names = this.ctx.config.studyColumnNames;
    const colSet = new Set(cols);
    const eff = (c) => colSet.has(c.status) ? c.status : cols[0];
    const board = root.createDiv({ cls: "pa-kanban" });
    cols.forEach((col, i) => {
      const color = this.colColor(i);
      const isLast = i === cols.length - 1;
      const colEl = board.createDiv({ cls: "pa-col" });
      colEl.style.borderColor = color;
      const colCards = filtered.filter((c) => eff(c) === col);
      const head = colEl.createDiv({ cls: "pa-col-head" });
      const title = head.createSpan({ text: names[col] || col, cls: "pa-col-title" });
      title.style.color = color;
      const tools = head.createDiv({ cls: "pa-col-tools" });
      const count = tools.createSpan({ text: String(colCards.length), cls: "pa-col-count" });
      count.style.background = color;
      if (i > 0) {
        const l = tools.createEl("button", { text: "\u25C0", cls: "pa-icon-btn" });
        l.onclick = () => this.moveColumn(col, -1);
      }
      if (i < cols.length - 1) {
        const r = tools.createEl("button", { text: "\u25B6", cls: "pa-icon-btn" });
        r.onclick = () => this.moveColumn(col, 1);
      }
      const editC = tools.createEl("button", { text: "\u270F\uFE0F", cls: "pa-icon-btn" });
      editC.onclick = () => this.openRenameColumnModal(col);
      const delC = tools.createEl("button", { text: "\u2715", cls: "pa-icon-btn" });
      delC.onclick = () => this.removeColumn(col, filtered);
      const list = colEl.createDiv({ cls: "pa-col-body" });
      list.addEventListener("dragover", (e) => {
        e.preventDefault();
        list.addClass("pa-drop");
      });
      list.addEventListener("dragleave", () => list.removeClass("pa-drop"));
      list.addEventListener("drop", async (e) => {
        var _a;
        e.preventDefault();
        list.removeClass("pa-drop");
        const path = (_a = e.dataTransfer) == null ? void 0 : _a.getData("text/plain");
        const card = filtered.find((c) => c.path === path);
        if (card && card.status !== col) {
          await this.ctx.store.updateStudyCardStatus(card, col);
          this.ctx.refresh();
        }
      });
      colCards.slice(0, isLast && colCards.length > 7 ? 7 : colCards.length).forEach((c) => this.renderCard(list, c, cols, eff(c), isLast, topics));
      if (isLast && colCards.length > 7) {
        const det = list.createEl("details", { cls: "pa-completed pa-kanban-more" });
        det.createEl("summary", { text: `Show ${colCards.length - 7} more` });
        colCards.slice(7).forEach((c) => this.renderCard(det, c, cols, eff(c), isLast, topics));
      }
      const addBtn = colEl.createEl("button", { text: "+ Add card", cls: "pa-add-card" });
      addBtn.onclick = () => this.openCardModal(null, col, topics);
    });
  }
  renderCard(list, c, cols, current, isDoneCol, topics) {
    const card = list.createDiv({ cls: "pa-card pa-study" + (isDoneCol ? " done" : "") });
    card.setAttr("draggable", "true");
    card.addEventListener("dragstart", (e) => {
      var _a;
      (_a = e.dataTransfer) == null ? void 0 : _a.setData("text/plain", c.path);
      card.addClass("pa-dragging");
    });
    card.addEventListener("dragend", () => card.removeClass("pa-dragging"));
    const badge = (c.subtopic || c.topic || "").toUpperCase();
    const topRow = card.createDiv({ cls: "pa-card-top" });
    if (badge)
      topRow.createDiv({ text: badge, cls: "pa-card-cat" });
    const del = topRow.createEl("button", { text: "\u2715", cls: "pa-icon-btn pa-card-x" });
    del.onclick = () => new ConfirmModal(this.ctx.app, `Delete study card "${c.title}"?`, async () => {
      await this.ctx.store.deleteStudyCard(c);
      this.ctx.refresh();
    }).open();
    card.createEl("div", { text: c.title, cls: "pa-card-title" });
    if (c.date)
      card.createDiv({ cls: "pa-muted pa-card-meta", text: c.date });
    const actions = card.createDiv({ cls: "pa-card-actions" });
    const idx = cols.indexOf(current);
    if (idx > 0) {
      const left = actions.createEl("button", { text: "\u2190", cls: "pa-icon-btn" });
      left.onclick = async () => {
        await this.ctx.store.updateStudyCardStatus(c, cols[idx - 1]);
        this.ctx.refresh();
      };
    }
    if (idx < cols.length - 1) {
      const right = actions.createEl("button", { text: "\u2192", cls: "pa-icon-btn" });
      right.onclick = async () => {
        await this.ctx.store.updateStudyCardStatus(c, cols[idx + 1]);
        this.ctx.refresh();
      };
    }
    if (c.url) {
      const link = actions.createEl("button", { text: "\u{1F517}", cls: "pa-icon-btn" });
      link.onclick = () => openExternal(c.url);
    }
    const edit = actions.createEl("button", { text: "\u270F\uFE0F", cls: "pa-icon-btn" });
    edit.onclick = () => this.openCardModal(c, c.status, topics);
    const open = actions.createEl("button", { text: "\u2197", cls: "pa-icon-btn" });
    open.onclick = () => this.ctx.app.workspace.openLinkText(c.path, "", true);
  }
  // ---- List view ----
  renderList(root, filtered, topics) {
    const cols = this.ctx.config.studyColumns;
    const firstCol = cols[0];
    const lastCol = cols[cols.length - 1];
    const colSet = new Set(cols);
    const eff = (c) => colSet.has(c.status) ? c.status : cols[0];
    const isDone = (c) => eff(c) === lastCol;
    root.createDiv({ text: "\u{1F4DD} List of Studies", cls: "pa-h2" });
    if (!filtered.length) {
      root.createEl("p", { cls: "pa-muted", text: "No study cards." });
      return;
    }
    const groups = /* @__PURE__ */ new Map();
    filtered.forEach((c) => {
      const k = c.topic || "No topic";
      if (!groups.has(k))
        groups.set(k, []);
      groups.get(k).push(c);
    });
    const wrap = root.createDiv({ cls: "pa-list-cards" });
    groups.forEach((cards, topicName) => {
      const card = wrap.createDiv({ cls: "pa-list-card" });
      card.createDiv({ text: topicName, cls: "pa-list-card-title" });
      const add = card.createDiv({ cls: "pa-list-add", text: "\u270F\uFE0F Add a card" });
      add.onclick = () => this.openCardModal(null, firstCol, topics, topicName === "No topic" ? "" : topicName);
      const open = cards.filter((c) => !isDone(c));
      const done = cards.filter((c) => isDone(c));
      open.forEach((c) => this.renderListItem(card, c, false, lastCol, firstCol));
      if (done.length) {
        const det = card.createEl("details", { cls: "pa-completed" });
        det.createEl("summary", { text: `Completed (${done.length})` });
        done.forEach((c) => this.renderListItem(det, c, true, lastCol, firstCol));
      }
    });
  }
  renderListItem(parent, c, done, lastCol, firstCol) {
    const row = parent.createDiv({ cls: "pa-list-item" + (done ? " done" : "") });
    const circle = row.createSpan({ cls: "pa-list-circle" + (done ? " on" : ""), text: done ? "\u25CF" : "\u25CB" });
    circle.onclick = async () => {
      await this.ctx.store.updateStudyCardStatus(c, done ? firstCol : lastCol);
      this.ctx.refresh();
    };
    const main = row.createDiv({ cls: "pa-list-item-main" });
    const title = main.createDiv({ text: c.title, cls: "pa-list-item-title" });
    title.onclick = () => c.url ? openExternal(c.url) : this.ctx.app.workspace.openLinkText(c.path, "", true);
    if (c.subtopic)
      main.createDiv({ text: c.subtopic, cls: "pa-muted pa-list-item-sub" });
  }
  // ---- Modals & column management ----
  openTopicModal(topics) {
    const fields = [
      { key: "name", label: "Topic name", type: "text", placeholder: "DevOps & SRE" },
      { key: "emoji", label: "Emoji", type: "text", value: "\u{1F4DA}" }
    ];
    new FormModal(this.ctx.app, "New study topic", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name)
        return;
      if (topics.some((b) => b.name === name)) {
        this.currentTopic = name;
        this.ctx.refresh();
        return;
      }
      topics.push({ id: name.toLowerCase().replace(/[^a-z0-9]/g, "-"), name, emoji: (v.emoji || "\u{1F4DA}").trim() });
      await this.ctx.store.saveStudyBoards(topics);
      this.currentTopic = name;
      this.ctx.refresh();
      toast("Topic created");
    }).open();
  }
  openCardModal(card, defaultStatus, topics, defaultTopic) {
    const topicOptions = topics.map((b) => ({ value: b.name, label: b.name }));
    if (!topicOptions.length)
      topicOptions.push({ value: "General", label: "General" });
    const colOptions = this.ctx.config.studyColumns.map((c) => ({ value: c, label: this.ctx.config.studyColumnNames[c] || c }));
    const preset = (card == null ? void 0 : card.topic) || defaultTopic || (this.currentTopic !== "all" ? this.currentTopic : topicOptions[0].value);
    const fields = [
      { key: "title", label: "Title", type: "text", value: (card == null ? void 0 : card.title) || "" },
      { key: "topic", label: "Topic", type: "dropdown", options: topicOptions, value: preset },
      { key: "subtopic", label: "Subtopic", type: "text", value: (card == null ? void 0 : card.subtopic) || "" },
      { key: "status", label: "Column", type: "dropdown", options: colOptions, value: (card == null ? void 0 : card.status) || defaultStatus },
      { key: "url", label: "URL", type: "text", value: (card == null ? void 0 : card.url) || "", placeholder: "https://..." }
    ];
    new FormModal(this.ctx.app, card ? "Edit study card" : "New study card", fields, async (v) => {
      if (!(v.title || "").trim())
        return;
      const data = { title: v.title.trim(), topic: v.topic, subtopic: v.subtopic, status: v.status, url: v.url };
      if (card) {
        const ok = await this.ctx.store.updateStudyCard(card, data);
        if (!ok) {
          toast(`A study card named "${data.title}" already exists in ${data.topic}.`);
          return;
        }
      } else {
        await this.ctx.store.createStudyCard(data);
      }
      this.ctx.refresh();
    }, card ? "Save" : "Create").open();
  }
  openAddColumnModal() {
    const cfg = this.ctx.config;
    if (cfg.studyColumns.length >= 5) {
      toast("Maximum of 5 columns.");
      return;
    }
    new FormModal(this.ctx.app, "New column", [{ key: "name", label: "Column name", type: "text", placeholder: "Reviewing, Paused" }], async (v) => {
      const name = (v.name || "").trim();
      if (!name)
        return;
      if (cfg.studyColumns.length >= 5) {
        toast("Maximum of 5 columns.");
        return;
      }
      const id = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
      if (cfg.studyColumns.includes(id))
        return;
      cfg.studyColumns.push(id);
      cfg.studyColumnNames[id] = name;
      await this.ctx.store.saveConfig(cfg);
      this.ctx.refresh();
    }, "Add").open();
  }
  openRenameColumnModal(col) {
    const cfg = this.ctx.config;
    new FormModal(this.ctx.app, "Rename column", [{ key: "name", label: "New name", type: "text", value: cfg.studyColumnNames[col] || col }], async (v) => {
      const name = (v.name || "").trim();
      if (!name)
        return;
      cfg.studyColumnNames[col] = name;
      await this.ctx.store.saveConfig(cfg);
      this.ctx.refresh();
    }, "Save").open();
  }
  async moveColumn(col, dir) {
    const cfg = this.ctx.config;
    const i = cfg.studyColumns.indexOf(col);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cfg.studyColumns.length)
      return;
    [cfg.studyColumns[i], cfg.studyColumns[j]] = [cfg.studyColumns[j], cfg.studyColumns[i]];
    await this.ctx.store.saveConfig(cfg);
    this.ctx.refresh();
  }
  removeColumn(col, cards) {
    const cfg = this.ctx.config;
    if (cfg.studyColumns.length <= 1) {
      toast("You must keep at least one column.");
      return;
    }
    new ConfirmModal(this.ctx.app, `Delete column "${this.cleanLabel(cfg.studyColumnNames[col] || col)}"? Cards move to the first column.`, async () => {
      const remaining = cfg.studyColumns.filter((c) => c !== col);
      const fallback = remaining[0];
      for (const c of cards.filter((c2) => c2.status === col))
        await this.ctx.store.updateStudyCardStatus(c, fallback);
      cfg.studyColumns = remaining;
      delete cfg.studyColumnNames[col];
      await this.ctx.store.saveConfig(cfg);
      this.ctx.refresh();
    }).open();
  }
};

// src/view.ts
var VIEW_TYPE_PA = "personal-assistant-view";
var PAGES = [
  { id: "habit-tracker", label: "\u{1F3AF} Habit Tracker" },
  { id: "tasks", label: "\u2705 Tasks & Notes" },
  { id: "fitness", label: "\u{1F3CB}\uFE0F Fitness" },
  { id: "nutrition", label: "\u{1F957} Nutrition" },
  { id: "studies", label: "\u{1F4DA} Studies" }
];
var PAView = class extends import_obsidian3.ItemView {
  constructor(leaf, store, host) {
    super(leaf);
    this.mainEl = null;
    this.host = host;
    this.ctx = new PAContext(this.app, store);
    this.ctx.refresh = () => this.renderPage();
    this.habitTrackerModule = new HabitTrackerModule(this.ctx);
    this.tasksModule = new TasksModule(this.ctx);
    this.fitnessModule = new FitnessModule(this.ctx);
    this.nutritionModule = new NutritionModule(this.ctx);
    this.studiesModule = new StudiesModule(this.ctx);
  }
  getViewType() {
    return VIEW_TYPE_PA;
  }
  getDisplayText() {
    const p = PAGES.find((x) => x.id === this.host.currentPage);
    return p ? p.label.replace(/^\S+\s/, "") : "Personal Assistant";
  }
  getIcon() {
    return "target";
  }
  async onOpen() {
    await this.ctx.reloadConfig();
    const root = this.contentEl;
    root.empty();
    root.addClass("pa-root", "pa-content-root");
    this.mainEl = root.createDiv({ cls: "pa-page" });
    this.renderPage();
    const refresh = (0, import_obsidian3.debounce)(() => this.renderPage(), 400, true);
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file.path.startsWith(DATA_ROOT + "/"))
          refresh();
      })
    );
  }
  async onClose() {
    this.fitnessModule.destroy();
  }
  /** Switch the active page (called by the nav view via the plugin). */
  setPage(id) {
    var _a, _b;
    if (this.mainEl)
      this.renderPage();
    (_b = (_a = this.leaf).updateHeader) == null ? void 0 : _b.call(_a);
  }
  renderPage() {
    const main = this.mainEl;
    if (!main)
      return;
    this.fitnessModule.destroy();
    main.empty();
    switch (this.host.currentPage) {
      case "habit-tracker":
        this.habitTrackerModule.render(main);
        break;
      case "tasks":
        this.tasksModule.render(main);
        break;
      case "fitness":
        this.fitnessModule.render(main);
        break;
      case "nutrition":
        this.nutritionModule.render(main);
        break;
      case "studies":
        this.studiesModule.render(main);
        break;
      default:
        this.habitTrackerModule.render(main);
    }
  }
};

// src/nav.ts
var import_obsidian4 = require("obsidian");
var VIEW_TYPE_PA_NAV = "personal-assistant-nav";
var PANavView = class extends import_obsidian4.ItemView {
  constructor(leaf, host) {
    super(leaf);
    this.host = host;
  }
  getViewType() {
    return VIEW_TYPE_PA_NAV;
  }
  getDisplayText() {
    return "Personal Assistant";
  }
  getIcon() {
    return "target";
  }
  async onOpen() {
    this.render();
  }
  async onClose() {
  }
  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("pa-root", "pa-nav-root");
    root.createDiv({ text: "\u{1F3AF} Personal Assistant", cls: "pa-logo" });
    PAGES.forEach((p) => {
      const btn = root.createEl("button", {
        text: p.label,
        cls: "pa-nav" + (p.id === this.host.currentPage ? " active" : "")
      });
      btn.onclick = () => this.host.openPage(p.id);
    });
  }
};

// src/main.ts
var DEFAULT_SETTINGS = { dataRoot: "Personal Assistant" };
var PersonalAssistantPlugin = class extends import_obsidian5.Plugin {
  constructor() {
    super(...arguments);
    this.currentPage = "habit-tracker";
  }
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    setDataRoot(this.settings.dataRoot);
    this.store = new PADataStore(this.app);
    this.registerView(VIEW_TYPE_PA, (leaf) => new PAView(leaf, this.store, this));
    this.registerView(VIEW_TYPE_PA_NAV, (leaf) => new PANavView(leaf, this));
    this.addCommand({
      id: "open-personal-assistant",
      name: "Open Personal Assistant",
      callback: () => this.activateView()
    });
    this.addSettingTab(new PASettingTab(this.app, this));
  }
  /** Open the nav panel in the left sidebar and the content in the main area. */
  async activateView() {
    var _a;
    const { workspace } = this.app;
    let navLeaf = (_a = workspace.getLeavesOfType(VIEW_TYPE_PA_NAV)[0]) != null ? _a : null;
    if (!navLeaf) {
      navLeaf = workspace.getLeftLeaf(false);
      await (navLeaf == null ? void 0 : navLeaf.setViewState({ type: VIEW_TYPE_PA_NAV, active: true }));
    }
    if (navLeaf)
      workspace.revealLeaf(navLeaf);
    await this.openPage(this.currentPage);
  }
  /** Set the active page and ensure the content view shows it. */
  async openPage(id) {
    var _a;
    this.currentPage = id;
    const { workspace } = this.app;
    let leaf = (_a = workspace.getLeavesOfType(VIEW_TYPE_PA)[0]) != null ? _a : null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_PA, active: true });
    }
    if (leaf.view instanceof PAView)
      leaf.view.setPage(id);
    workspace.revealLeaf(leaf);
    workspace.getLeavesOfType(VIEW_TYPE_PA_NAV).forEach((l) => {
      if (l.view instanceof PANavView)
        l.view.render();
    });
  }
  onunload() {
  }
  async saveSettings() {
    setDataRoot(this.settings.dataRoot);
    await this.saveData(this.settings);
  }
};
var PASettingTab = class extends import_obsidian5.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian5.Setting(containerEl).setName("Data root folder").setDesc("Vault folder that holds Tasks/, Fitness/, Nutrition/, Studies/, Habits/, Config/.").addText(
      (t) => t.setValue(this.plugin.settings.dataRoot).onChange(async (v) => {
        this.plugin.settings.dataRoot = v.trim();
        await this.plugin.saveSettings();
      })
    );
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2RhdGEudHMiLCAic3JjL3R5cGVzLnRzIiwgInNyYy91dGlsLnRzIiwgInNyYy92aWV3LnRzIiwgInNyYy9jb250ZXh0LnRzIiwgInNyYy91aS50cyIsICJzcmMvY2hhcnRzLnRzIiwgInNyYy9tb2R1bGVzL2hhYml0LXRyYWNrZXIudHMiLCAic3JjL21vZHVsZXMvdGFza3MudHMiLCAic3JjL21vZHVsZXMvZml0bmVzcy50cyIsICJzcmMvbW9kdWxlcy9udXRyaXRpb24udHMiLCAic3JjL21vZHVsZXMvc3R1ZGllcy50cyIsICJzcmMvbmF2LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgeyBQbHVnaW4sIFdvcmtzcGFjZUxlYWYsIFBsdWdpblNldHRpbmdUYWIsIEFwcCwgU2V0dGluZyB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHsgUEFEYXRhU3RvcmUsIHNldERhdGFSb290IH0gZnJvbSBcIi4vZGF0YVwiO1xuaW1wb3J0IHsgUEFWaWV3LCBWSUVXX1RZUEVfUEEsIFBBSG9zdCB9IGZyb20gXCIuL3ZpZXdcIjtcbmltcG9ydCB7IFBBTmF2VmlldywgVklFV19UWVBFX1BBX05BViB9IGZyb20gXCIuL25hdlwiO1xuXG5pbnRlcmZhY2UgUEFTZXR0aW5ncyB7IGRhdGFSb290OiBzdHJpbmc7IH1cbmNvbnN0IERFRkFVTFRfU0VUVElOR1M6IFBBU2V0dGluZ3MgPSB7IGRhdGFSb290OiBcIlBlcnNvbmFsIEFzc2lzdGFudFwiIH07XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFBlcnNvbmFsQXNzaXN0YW50UGx1Z2luIGV4dGVuZHMgUGx1Z2luIGltcGxlbWVudHMgUEFIb3N0IHtcbiAgc2V0dGluZ3M6IFBBU2V0dGluZ3M7XG4gIHN0b3JlOiBQQURhdGFTdG9yZTtcbiAgY3VycmVudFBhZ2UgPSBcImhhYml0LXRyYWNrZXJcIjtcblxuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XG4gICAgc2V0RGF0YVJvb3QodGhpcy5zZXR0aW5ncy5kYXRhUm9vdCk7XG4gICAgdGhpcy5zdG9yZSA9IG5ldyBQQURhdGFTdG9yZSh0aGlzLmFwcCk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyVmlldyhWSUVXX1RZUEVfUEEsIChsZWFmKSA9PiBuZXcgUEFWaWV3KGxlYWYsIHRoaXMuc3RvcmUsIHRoaXMpKTtcbiAgICB0aGlzLnJlZ2lzdGVyVmlldyhWSUVXX1RZUEVfUEFfTkFWLCAobGVhZikgPT4gbmV3IFBBTmF2VmlldyhsZWFmLCB0aGlzKSk7XG5cbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwib3Blbi1wZXJzb25hbC1hc3Npc3RhbnRcIixcbiAgICAgIG5hbWU6IFwiT3BlbiBQZXJzb25hbCBBc3Npc3RhbnRcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLmFjdGl2YXRlVmlldygpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBQQVNldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcbiAgfVxuXG4gIC8qKiBPcGVuIHRoZSBuYXYgcGFuZWwgaW4gdGhlIGxlZnQgc2lkZWJhciBhbmQgdGhlIGNvbnRlbnQgaW4gdGhlIG1haW4gYXJlYS4gKi9cbiAgYXN5bmMgYWN0aXZhdGVWaWV3KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgd29ya3NwYWNlIH0gPSB0aGlzLmFwcDtcbiAgICBsZXQgbmF2TGVhZjogV29ya3NwYWNlTGVhZiB8IG51bGwgPSB3b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRV9QQV9OQVYpWzBdID8/IG51bGw7XG4gICAgaWYgKCFuYXZMZWFmKSB7XG4gICAgICBuYXZMZWFmID0gd29ya3NwYWNlLmdldExlZnRMZWFmKGZhbHNlKTtcbiAgICAgIGF3YWl0IG5hdkxlYWY/LnNldFZpZXdTdGF0ZSh7IHR5cGU6IFZJRVdfVFlQRV9QQV9OQVYsIGFjdGl2ZTogdHJ1ZSB9KTtcbiAgICB9XG4gICAgaWYgKG5hdkxlYWYpIHdvcmtzcGFjZS5yZXZlYWxMZWFmKG5hdkxlYWYpO1xuICAgIGF3YWl0IHRoaXMub3BlblBhZ2UodGhpcy5jdXJyZW50UGFnZSk7XG4gIH1cblxuICAvKiogU2V0IHRoZSBhY3RpdmUgcGFnZSBhbmQgZW5zdXJlIHRoZSBjb250ZW50IHZpZXcgc2hvd3MgaXQuICovXG4gIGFzeW5jIG9wZW5QYWdlKGlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmN1cnJlbnRQYWdlID0gaWQ7XG4gICAgY29uc3QgeyB3b3Jrc3BhY2UgfSA9IHRoaXMuYXBwO1xuICAgIGxldCBsZWFmOiBXb3Jrc3BhY2VMZWFmIHwgbnVsbCA9IHdvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFX1BBKVswXSA/PyBudWxsO1xuICAgIGlmICghbGVhZikge1xuICAgICAgbGVhZiA9IHdvcmtzcGFjZS5nZXRMZWFmKFwidGFiXCIpO1xuICAgICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoeyB0eXBlOiBWSUVXX1RZUEVfUEEsIGFjdGl2ZTogdHJ1ZSB9KTtcbiAgICB9XG4gICAgaWYgKGxlYWYudmlldyBpbnN0YW5jZW9mIFBBVmlldykgbGVhZi52aWV3LnNldFBhZ2UoaWQpO1xuICAgIHdvcmtzcGFjZS5yZXZlYWxMZWFmKGxlYWYpO1xuICAgIHdvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFX1BBX05BVikuZm9yRWFjaCgobCkgPT4ge1xuICAgICAgaWYgKGwudmlldyBpbnN0YW5jZW9mIFBBTmF2VmlldykgbC52aWV3LnJlbmRlcigpO1xuICAgIH0pO1xuICB9XG5cbiAgb251bmxvYWQoKTogdm9pZCB7fVxuXG4gIGFzeW5jIHNhdmVTZXR0aW5ncygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBzZXREYXRhUm9vdCh0aGlzLnNldHRpbmdzLmRhdGFSb290KTtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xuICB9XG59XG5cbmNsYXNzIFBBU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBwbHVnaW46IFBlcnNvbmFsQXNzaXN0YW50UGx1Z2luO1xuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBQZXJzb25hbEFzc2lzdGFudFBsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuICBkaXNwbGF5KCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwiRGF0YSByb290IGZvbGRlclwiKVxuICAgICAgLnNldERlc2MoXCJWYXVsdCBmb2xkZXIgdGhhdCBob2xkcyBUYXNrcy8sIEZpdG5lc3MvLCBOdXRyaXRpb24vLCBTdHVkaWVzLywgSGFiaXRzLywgQ29uZmlnLy5cIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0LnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmRhdGFSb290KS5vbkNoYW5nZShhc3luYyAodikgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmRhdGFSb290ID0gdi50cmltKCk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgQXBwLCBURmlsZSwgVEZvbGRlciwgbm9ybWFsaXplUGF0aCB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHtcbiAgQm9hcmQsIFRhc2ssIE5vdGUsIEhhYml0LCBFeGVyY2lzZSwgV29ya291dCwgV29ya291dEV4ZXJjaXNlLCBTcGxpdCxcbiAgU3R1ZHlDYXJkLCBNZWFsLCBNZWFsSXRlbSwgTWVhbExvZywgUEFDb25maWcsIGRlZmF1bHRDb25maWcsXG59IGZyb20gXCIuL3R5cGVzXCI7XG5pbXBvcnQgeyB0b2RheUxvY2FsIH0gZnJvbSBcIi4vdXRpbFwiO1xuXG4vKiogUm9vdCBmb2xkZXIgaW5zaWRlIHRoZSB2YXVsdCB0aGF0IGhvbGRzIGFsbCBQZXJzb25hbCBBc3Npc3RhbnQgZGF0YS4gKi9cbmV4cG9ydCBsZXQgREFUQV9ST09UID0gXCJQZXJzb25hbCBBc3Npc3RhbnRcIjtcbmV4cG9ydCBmdW5jdGlvbiBzZXREYXRhUm9vdChyb290OiBzdHJpbmcpIHsgREFUQV9ST09UID0gcm9vdCB8fCBcIlwiOyB9XG5cbnR5cGUgRk0gPSBSZWNvcmQ8c3RyaW5nLCBhbnk+O1xuXG4vKiogQWNjZXB0IGVpdGhlciBhbiBhbHJlYWR5LXBhcnNlZCBvYmplY3QvYXJyYXkgb3IgYSBKU09OIHN0cmluZy4gKi9cbmZ1bmN0aW9uIGNvZXJjZTxUPih2OiBhbnksIGZhbGxiYWNrOiBUKTogVCB7XG4gIGlmICh2ID09IG51bGwpIHJldHVybiBmYWxsYmFjaztcbiAgaWYgKHR5cGVvZiB2ID09PSBcInN0cmluZ1wiKSB7XG4gICAgdHJ5IHsgcmV0dXJuIEpTT04ucGFyc2Uodik7IH0gY2F0Y2ggeyByZXR1cm4gZmFsbGJhY2s7IH1cbiAgfVxuICByZXR1cm4gdiBhcyBUO1xufVxuXG5mdW5jdGlvbiBzdHIodjogYW55KTogc3RyaW5nIHsgcmV0dXJuIHYgPT0gbnVsbCA/IFwiXCIgOiBTdHJpbmcodik7IH1cbmZ1bmN0aW9uIG51bSh2OiBhbnkpOiBudW1iZXIgeyBjb25zdCBuID0gcGFyc2VGbG9hdCh2KTsgcmV0dXJuIGlzTmFOKG4pID8gMCA6IG47IH1cblxuLyoqIEZpbGVzeXN0ZW0tc2FmZSBmaWxlbmFtZSBkZXJpdmVkIGZyb20gYSB0aXRsZSAoa2VlcHMgYWNjZW50cywgZHJvcHMgc3ltYm9scykuICovXG5leHBvcnQgZnVuY3Rpb24gc2FmZU5hbWUodGl0bGU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiAodGl0bGUgfHwgXCJ1bnRpdGxlZFwiKVxuICAgIC5yZXBsYWNlKC9bXFxcXC86Kj9cIjw+fCNeW1xcXV0vZywgXCJcIilcbiAgICAucmVwbGFjZSgvXFxzKy9nLCBcIiBcIilcbiAgICAudHJpbSgpIHx8IFwidW50aXRsZWRcIjtcbn1cblxuLyoqXG4gKiBEYXRhIGxheWVyOiByZWFkcy93cml0ZXMgdGhlIHNhbWUgbWFya2Rvd24gZmlsZXMgdGhlIHdlYiBhcHAgdXNlcyxcbiAqIHRocm91Z2ggdGhlIE9ic2lkaWFuIFZhdWx0ICsgbWV0YWRhdGEgY2FjaGUgKG5vIEdpdEh1YiB0b2tlbiwgbm8gZmV0Y2gpLlxuICovXG5leHBvcnQgY2xhc3MgUEFEYXRhU3RvcmUge1xuICBhcHA6IEFwcDtcbiAgY29uc3RydWN0b3IoYXBwOiBBcHApIHsgdGhpcy5hcHAgPSBhcHA7IH1cblxuICBmdWxsKHBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVBhdGgoREFUQV9ST09UID8gYCR7REFUQV9ST09UfS8ke3BhdGh9YCA6IHBhdGgpO1xuICB9XG5cbiAgbGlzdE1hcmtkb3duKGZvbGRlcjogc3RyaW5nKTogVEZpbGVbXSB7XG4gICAgY29uc3QgcHJlZml4ID0gdGhpcy5mdWxsKGZvbGRlcikucmVwbGFjZSgvXFwvJC8sIFwiXCIpICsgXCIvXCI7XG4gICAgcmV0dXJuIHRoaXMuYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKVxuICAgICAgLmZpbHRlcigoZikgPT4gZi5wYXRoLnN0YXJ0c1dpdGgocHJlZml4KSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBhLnBhdGgubG9jYWxlQ29tcGFyZShiLnBhdGgpKTtcbiAgfVxuXG4gIGZpbGVBdChwYXRoOiBzdHJpbmcpOiBURmlsZSB8IG51bGwge1xuICAgIGNvbnN0IGYgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgodGhpcy5mdWxsKHBhdGgpKTtcbiAgICByZXR1cm4gZiBpbnN0YW5jZW9mIFRGaWxlID8gZiA6IG51bGw7XG4gIH1cblxuICBhc3luYyByZWFkKHBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgbnVsbD4ge1xuICAgIGNvbnN0IGYgPSB0aGlzLmZpbGVBdChwYXRoKTtcbiAgICByZXR1cm4gZiA/IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZikgOiBudWxsO1xuICB9XG5cbiAgZnJvbnRtYXR0ZXIoZmlsZTogVEZpbGUpOiBGTSB7XG4gICAgcmV0dXJuICh0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXIgYXMgRk0pID8/IHt9O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVGb2xkZXIoZnVsbFBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGRpciA9IGZ1bGxQYXRoLnN1YnN0cmluZygwLCBmdWxsUGF0aC5sYXN0SW5kZXhPZihcIi9cIikpO1xuICAgIGlmIChkaXIgJiYgISh0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZGlyKSBpbnN0YW5jZW9mIFRGb2xkZXIpKSB7XG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGVGb2xkZXIoZGlyKS5jYXRjaCgoKSA9PiB7fSk7XG4gICAgfVxuICB9XG5cbiAgLyoqIENyZWF0ZSBhIGZpbGUgKG9yIG92ZXJ3cml0ZSBib2R5K2Zyb250bWF0dGVyKSBhdCBhIGxvZ2ljYWwgcGF0aC4gKi9cbiAgYXN5bmMgd3JpdGVGaWxlKHBhdGg6IHN0cmluZywgY29udGVudDogc3RyaW5nKTogUHJvbWlzZTxURmlsZT4ge1xuICAgIGNvbnN0IGZ1bGwgPSB0aGlzLmZ1bGwocGF0aCk7XG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZnVsbCk7XG4gICAgaWYgKGV4aXN0aW5nIGluc3RhbmNlb2YgVEZpbGUpIHtcbiAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShleGlzdGluZywgY29udGVudCk7XG4gICAgICByZXR1cm4gZXhpc3Rpbmc7XG4gICAgfVxuICAgIGF3YWl0IHRoaXMuZW5zdXJlRm9sZGVyKGZ1bGwpO1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGUoZnVsbCwgY29udGVudCk7XG4gIH1cblxuICBhc3luYyByZW1vdmUocGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZiA9IHRoaXMuZmlsZUF0KHBhdGgpO1xuICAgIGlmIChmKSBhd2FpdCB0aGlzLmFwcC5maWxlTWFuYWdlci50cmFzaEZpbGUoZik7XG4gIH1cblxuICBhc3luYyByZW1vdmVGaWxlKGZpbGU6IFRGaWxlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5hcHAuZmlsZU1hbmFnZXIudHJhc2hGaWxlKGZpbGUpO1xuICB9XG5cbiAgLyoqIEJ1aWxkIGEgbWFya2Rvd24gZG9jdW1lbnQgZnJvbSBhIGZyb250bWF0dGVyIG1hcCArIGJvZHkuICovXG4gIGJ1aWxkRG9jKG1ldGE6IEZNLCBib2R5OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGxpbmVzID0gW1wiLS0tXCJdO1xuICAgIGZvciAoY29uc3QgayBvZiBPYmplY3Qua2V5cyhtZXRhKSkge1xuICAgICAgY29uc3QgdiA9IG1ldGFba107XG4gICAgICBpZiAodiA9PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGlmICh0eXBlb2YgdiA9PT0gXCJvYmplY3RcIikgbGluZXMucHVzaChgJHtrfTogJHtKU09OLnN0cmluZ2lmeSh2KX1gKTtcbiAgICAgIGVsc2UgbGluZXMucHVzaChgJHtrfTogJHt0eXBlb2YgdiA9PT0gXCJzdHJpbmdcIiA/IEpTT04uc3RyaW5naWZ5KHYpIDogdn1gKTtcbiAgICB9XG4gICAgbGluZXMucHVzaChcIi0tLVwiLCBcIlwiLCBib2R5IHx8IFwiXCIpO1xuICAgIHJldHVybiBsaW5lcy5qb2luKFwiXFxuXCIpO1xuICB9XG5cbiAgLyoqIFVwZGF0ZSBmcm9udG1hdHRlciBvZiBhbiBleGlzdGluZyBmaWxlIGluIHBsYWNlLCBwcmVzZXJ2aW5nIGJvZHkuICovXG4gIGFzeW5jIHBhdGNoRnJvbnRtYXR0ZXIoZmlsZTogVEZpbGUsIG11dGF0ZTogKGZtOiBGTSkgPT4gdm9pZCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZm0pID0+IG11dGF0ZShmbSkpO1xuICB9XG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vIENPTkZJR1xuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgYXN5bmMgbG9hZENvbmZpZygpOiBQcm9taXNlPFBBQ29uZmlnPiB7XG4gICAgY29uc3QgY2ZnID0gZGVmYXVsdENvbmZpZygpO1xuICAgIGNvbnN0IGYgPSB0aGlzLmZpbGVBdChcIkNvbmZpZy9zZXR0aW5ncy5tZFwiKTtcbiAgICBpZiAoIWYpIHJldHVybiBjZmc7XG4gICAgY29uc3QgbSA9IHRoaXMuZnJvbnRtYXR0ZXIoZik7XG4gICAgaWYgKG0uY2Fsb3JpZV90YXJnZXQpIGNmZy5jYWxvcmllVGFyZ2V0ID0gbnVtKG0uY2Fsb3JpZV90YXJnZXQpO1xuICAgIGlmIChtLnByb3RlaW5fdGFyZ2V0KSBjZmcucHJvdGVpblRhcmdldCA9IG51bShtLnByb3RlaW5fdGFyZ2V0KTtcbiAgICBpZiAobS5jYXJic190YXJnZXQpIGNmZy5jYXJic1RhcmdldCA9IG51bShtLmNhcmJzX3RhcmdldCk7XG4gICAgaWYgKG0ud2F0ZXJfdGFyZ2V0KSBjZmcud2F0ZXJUYXJnZXQgPSBudW0obS53YXRlcl90YXJnZXQpO1xuICAgIGlmIChtLnRhc2tfY29sdW1ucykgY2ZnLnRhc2tDb2x1bW5zID0gY29lcmNlKG0udGFza19jb2x1bW5zLCBjZmcudGFza0NvbHVtbnMpO1xuICAgIGlmIChtLnRhc2tfY29sdW1uX25hbWVzKSBjZmcudGFza0NvbHVtbk5hbWVzID0gY29lcmNlKG0udGFza19jb2x1bW5fbmFtZXMsIGNmZy50YXNrQ29sdW1uTmFtZXMpO1xuICAgIGlmIChtLnN0dWR5X2NvbHVtbnMpIGNmZy5zdHVkeUNvbHVtbnMgPSBjb2VyY2UobS5zdHVkeV9jb2x1bW5zLCBjZmcuc3R1ZHlDb2x1bW5zKTtcbiAgICBpZiAobS5zdHVkeV9jb2x1bW5fbmFtZXMpIGNmZy5zdHVkeUNvbHVtbk5hbWVzID0gY29lcmNlKG0uc3R1ZHlfY29sdW1uX25hbWVzLCBjZmcuc3R1ZHlDb2x1bW5OYW1lcyk7XG4gICAgaWYgKG0uc3R1ZHlfdG9waWNzKSBjZmcuc3R1ZHlUb3BpY3MgPSBjb2VyY2UobS5zdHVkeV90b3BpY3MsIGNmZy5zdHVkeVRvcGljcyk7XG4gICAgaWYgKG0uY3VzdG9tX3NwbGl0cykgY2ZnLmN1c3RvbVNwbGl0cyA9IGNvZXJjZShtLmN1c3RvbV9zcGxpdHMsIGNmZy5jdXN0b21TcGxpdHMpO1xuICAgIGlmIChtLnNwbGl0X25hbWVzKSBjZmcuc3BsaXROYW1lcyA9IGNvZXJjZShtLnNwbGl0X25hbWVzLCBjZmcuc3BsaXROYW1lcyk7XG4gICAgcmV0dXJuIGNmZztcbiAgfVxuXG4gIGFzeW5jIHNhdmVDb25maWcoY2ZnOiBQQUNvbmZpZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldGE6IEZNID0ge1xuICAgICAgdHlwZTogXCJjb25maWdcIixcbiAgICAgIGNhbG9yaWVfdGFyZ2V0OiBjZmcuY2Fsb3JpZVRhcmdldCxcbiAgICAgIHByb3RlaW5fdGFyZ2V0OiBjZmcucHJvdGVpblRhcmdldCxcbiAgICAgIGNhcmJzX3RhcmdldDogY2ZnLmNhcmJzVGFyZ2V0LFxuICAgICAgd2F0ZXJfdGFyZ2V0OiBjZmcud2F0ZXJUYXJnZXQsXG4gICAgICB0YXNrX2NvbHVtbnM6IGNmZy50YXNrQ29sdW1ucyxcbiAgICAgIHRhc2tfY29sdW1uX25hbWVzOiBjZmcudGFza0NvbHVtbk5hbWVzLFxuICAgICAgc3R1ZHlfY29sdW1uczogY2ZnLnN0dWR5Q29sdW1ucyxcbiAgICAgIHN0dWR5X2NvbHVtbl9uYW1lczogY2ZnLnN0dWR5Q29sdW1uTmFtZXMsXG4gICAgICBzdHVkeV90b3BpY3M6IGNmZy5zdHVkeVRvcGljcyxcbiAgICAgIGN1c3RvbV9zcGxpdHM6IGNmZy5jdXN0b21TcGxpdHMsXG4gICAgICBzcGxpdF9uYW1lczogY2ZnLnNwbGl0TmFtZXMsXG4gICAgICBtb2RpZmllZDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIH07XG4gICAgYXdhaXQgdGhpcy53cml0ZUZpbGUoXCJDb25maWcvc2V0dGluZ3MubWRcIiwgdGhpcy5idWlsZERvYyhtZXRhLCBcIiMgUGVyc29uYWwgQXNzaXN0YW50IENvbmZpZ1xcblwiKSk7XG4gIH1cblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gQk9BUkRTIChUYXNrcy9ib2FyZHMubWQpICArICBTVFVEWSBCT0FSRFMgKFN0dWRpZXMvYm9hcmRzLm1kKVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgcHJpdmF0ZSBib2FyZHNGcm9tKGZpbGU6IFRGaWxlIHwgbnVsbCk6IEJvYXJkW10ge1xuICAgIGlmICghZmlsZSkgcmV0dXJuIFtdO1xuICAgIGNvbnN0IG0gPSB0aGlzLmZyb250bWF0dGVyKGZpbGUpO1xuICAgIGNvbnN0IGxpc3QgPSBjb2VyY2U8YW55W10+KG0uYm9hcmRzLCBbXSk7XG4gICAgcmV0dXJuIGxpc3QubWFwKChiKSA9PiAoeyBpZDogc3RyKGIuaWQpLCBuYW1lOiBzdHIoYi5uYW1lKSwgZW1vamk6IGIuZW1vamkgPyBzdHIoYi5lbW9qaSkgOiBcIlwiIH0pKVxuICAgICAgLmZpbHRlcigoYikgPT4gYi5pZCB8fCBiLm5hbWUpO1xuICB9XG5cbiAgbG9hZEJvYXJkcygpOiBCb2FyZFtdIHsgcmV0dXJuIHRoaXMuYm9hcmRzRnJvbSh0aGlzLmZpbGVBdChcIlRhc2tzL2JvYXJkcy5tZFwiKSk7IH1cbiAgbG9hZFN0dWR5Qm9hcmRzKCk6IEJvYXJkW10geyByZXR1cm4gdGhpcy5ib2FyZHNGcm9tKHRoaXMuZmlsZUF0KFwiU3R1ZGllcy9ib2FyZHMubWRcIikpOyB9XG5cbiAgYXN5bmMgc2F2ZUJvYXJkcyhib2FyZHM6IEJvYXJkW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLndyaXRlRmlsZShcIlRhc2tzL2JvYXJkcy5tZFwiLCB0aGlzLmJ1aWxkRG9jKHsgdHlwZTogXCJib2FyZHMtY29uZmlnXCIsIGJvYXJkcyB9LCBcIiMgQm9hcmRzXFxuXCIpKTtcbiAgfVxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBUQVNLU1xuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgbG9hZFRhc2tzKCk6IFRhc2tbXSB7XG4gICAgcmV0dXJuIHRoaXMubGlzdE1hcmtkb3duKFwiVGFza3NcIilcbiAgICAgIC5maWx0ZXIoKGYpID0+IGYubmFtZSAhPT0gXCJib2FyZHMubWRcIilcbiAgICAgIC5tYXAoKGYpID0+IHtcbiAgICAgICAgY29uc3QgbSA9IHRoaXMuZnJvbnRtYXR0ZXIoZik7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgaWQ6IHN0cihtLnRhc2tfaWQpIHx8IGYuYmFzZW5hbWUsXG4gICAgICAgICAgdGl0bGU6IHN0cihtLnRpdGxlKSB8fCBmLmJhc2VuYW1lLFxuICAgICAgICAgIHN0YXR1czogc3RyKG0uc3RhdHVzKSB8fCBcInRvZG9cIixcbiAgICAgICAgICBwcmlvcml0eTogc3RyKG0ucHJpb3JpdHkpIHx8IFwibWVkaXVtXCIsXG4gICAgICAgICAgY2F0OiBzdHIobS5jYXRlZ29yeSkgfHwgXCJ3b3JrXCIsXG4gICAgICAgICAgZ3JvdXA6IHN0cihtLmdyb3VwKSxcbiAgICAgICAgICBrYW5iYW5JZDogc3RyKG1bXCJrYW5iYW4taWRcIl0pLFxuICAgICAgICAgIGthbmJhbk5hbWU6IHN0cihtLmthbmJhbl9uYW1lIHx8IG1bXCJrYW5iYW4tbmFtZVwiXSksXG4gICAgICAgICAgZHVlOiBzdHIobS5kdWUpLFxuICAgICAgICAgIHNjaGVkdWxlZDogc3RyKG0uc2NoZWR1bGVkKSxcbiAgICAgICAgICBkdXJhdGlvbjogbnVtKG0uZHVyYXRpb24pLFxuICAgICAgICAgIGlzQWxsRGF5OiAhIW0uaXNfYWxsX2RheSxcbiAgICAgICAgICBjcmVhdGVkOiBzdHIobS5jcmVhdGVkKSxcbiAgICAgICAgICBtb2RpZmllZDogc3RyKG0ubW9kaWZpZWQpLFxuICAgICAgICAgIHBhdGg6IGYucGF0aCxcbiAgICAgICAgfSBhcyBUYXNrO1xuICAgICAgfSk7XG4gIH1cblxuICBhc3luYyBjcmVhdGVUYXNrKHQ6IFBhcnRpYWw8VGFzaz4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0aXRsZSA9IHQudGl0bGUgfHwgXCJVbnRpdGxlZFwiO1xuICAgIGNvbnN0IG1ldGE6IEZNID0ge1xuICAgICAgdGFza19pZDogY3J5cHRvSWQoKSxcbiAgICAgIHRpdGxlLFxuICAgICAgc3RhdHVzOiB0LnN0YXR1cyB8fCBcInRvZG9cIixcbiAgICAgIHByaW9yaXR5OiB0LnByaW9yaXR5IHx8IFwibWVkaXVtXCIsXG4gICAgICBjcmVhdGVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBtb2RpZmllZDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgdHlwZTogXCJ0YXNrXCIsXG4gICAgICBrYW5iYW5fbmFtZTogdC5rYW5iYW5OYW1lIHx8IFwiXCIsXG4gICAgICBncm91cDogdC5ncm91cCB8fCBcIlwiLFxuICAgIH07XG4gICAgaWYgKHQuZHVlKSBtZXRhLmR1ZSA9IHQuZHVlO1xuICAgIGF3YWl0IHRoaXMud3JpdGVGaWxlKHRoaXMudW5pcXVlUGF0aChcIlRhc2tzXCIsIHRpdGxlKSwgdGhpcy5idWlsZERvYyhtZXRhLCBgIyAke3RpdGxlfVxcbmApKTtcbiAgfVxuXG4gIC8qKiBBIHZhdWx0IHBhdGggdW5kZXIgYGZvbGRlcmAgZm9yIGB0aXRsZWAgdGhhdCBkb2VzIG5vdCBjb2xsaWRlIHdpdGggYW4gZXhpc3RpbmcgZmlsZS4gKi9cbiAgcHJpdmF0ZSB1bmlxdWVQYXRoKGZvbGRlcjogc3RyaW5nLCB0aXRsZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBiYXNlID0gc2FmZU5hbWUodGl0bGUpO1xuICAgIGxldCByZWwgPSBgJHtmb2xkZXJ9LyR7YmFzZX0ubWRgO1xuICAgIGxldCBuID0gMjtcbiAgICB3aGlsZSAodGhpcy5maWxlQXQocmVsKSkgeyByZWwgPSBgJHtmb2xkZXJ9LyR7YmFzZX0gJHtufS5tZGA7IG4rKzsgfVxuICAgIHJldHVybiByZWw7XG4gIH1cblxuICBhc3luYyB1cGRhdGVUYXNrKHRhc2s6IFRhc2ssIGNoYW5nZXM6IFBhcnRpYWw8VGFzaz4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHRhc2sucGF0aCk7XG4gICAgaWYgKCEoZiBpbnN0YW5jZW9mIFRGaWxlKSkgcmV0dXJuO1xuICAgIGF3YWl0IHRoaXMucGF0Y2hGcm9udG1hdHRlcihmLCAoZm0pID0+IHtcbiAgICAgIGlmIChjaGFuZ2VzLnN0YXR1cyAhPT0gdW5kZWZpbmVkKSBmbS5zdGF0dXMgPSBjaGFuZ2VzLnN0YXR1cztcbiAgICAgIGlmIChjaGFuZ2VzLnByaW9yaXR5ICE9PSB1bmRlZmluZWQpIGZtLnByaW9yaXR5ID0gY2hhbmdlcy5wcmlvcml0eTtcbiAgICAgIGlmIChjaGFuZ2VzLnRpdGxlICE9PSB1bmRlZmluZWQpIGZtLnRpdGxlID0gY2hhbmdlcy50aXRsZTtcbiAgICAgIGlmIChjaGFuZ2VzLmthbmJhbk5hbWUgIT09IHVuZGVmaW5lZCkgZm0ua2FuYmFuX25hbWUgPSBjaGFuZ2VzLmthbmJhbk5hbWU7XG4gICAgICBpZiAoY2hhbmdlcy5ncm91cCAhPT0gdW5kZWZpbmVkKSBmbS5ncm91cCA9IGNoYW5nZXMuZ3JvdXA7XG4gICAgICBpZiAoY2hhbmdlcy5kdWUgIT09IHVuZGVmaW5lZCkgZm0uZHVlID0gY2hhbmdlcy5kdWU7XG4gICAgICBmbS5tb2RpZmllZCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZVRhc2sodGFzazogVGFzayk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGYgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgodGFzay5wYXRoKTtcbiAgICBpZiAoZiBpbnN0YW5jZW9mIFRGaWxlKSBhd2FpdCB0aGlzLnJlbW92ZUZpbGUoZik7XG4gIH1cblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gTk9URVMgKE5vdGVzLyoubWQpXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICBsb2FkTm90ZXMoKTogTm90ZVtdIHtcbiAgICAvLyBCb2R5IGlzIGxvYWRlZCBsYXppbHkgdmlhIHJlYWROb3RlQm9keSgpIHdoZW4gZWRpdGluZywgdG8ga2VlcCBsb2FkIHN5bmMuXG4gICAgcmV0dXJuIHRoaXMubGlzdE1hcmtkb3duKFwiTm90ZXNcIikubWFwKChmKSA9PiB7XG4gICAgICBjb25zdCBtID0gdGhpcy5mcm9udG1hdHRlcihmKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGlkOiBmLmJhc2VuYW1lLFxuICAgICAgICB0aXRsZTogc3RyKG0udGl0bGUpIHx8IGYuYmFzZW5hbWUsXG4gICAgICAgIGNvbnRlbnQ6IFwiXCIsXG4gICAgICAgIGNvbG9yOiBzdHIobS5jb2xvcikgfHwgXCJ5ZWxsb3dcIixcbiAgICAgICAgYm9hcmQ6IHN0cihtLmJvYXJkKSxcbiAgICAgICAgZGF0ZTogc3RyKG0uZGF0ZSksXG4gICAgICAgIHBhdGg6IGYucGF0aCxcbiAgICAgIH0gYXMgTm90ZTtcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIHJlYWROb3RlQm9keShwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IGYgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gICAgaWYgKCEoZiBpbnN0YW5jZW9mIFRGaWxlKSkgcmV0dXJuIFwiXCI7XG4gICAgY29uc3QgcmF3ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmKTtcbiAgICBpZiAoIXJhdy5zdGFydHNXaXRoKFwiLS0tXCIpKSByZXR1cm4gcmF3LnRyaW0oKTtcbiAgICBjb25zdCBlbmQgPSByYXcuaW5kZXhPZihcIi0tLVwiLCAzKTtcbiAgICByZXR1cm4gZW5kID09PSAtMSA/IHJhdy50cmltKCkgOiByYXcuc3Vic3RyaW5nKGVuZCArIDMpLnRyaW0oKTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVOb3RlKG5vdGU6IFBhcnRpYWw8Tm90ZT4gJiB7IHRpdGxlOiBzdHJpbmcgfSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldGE6IEZNID0ge1xuICAgICAgdGl0bGU6IG5vdGUudGl0bGUsXG4gICAgICBjb2xvcjogbm90ZS5jb2xvciB8fCBcInllbGxvd1wiLFxuICAgICAgZGF0ZTogbm90ZS5kYXRlIHx8IHRvZGF5TG9jYWwoKSxcbiAgICAgIHR5cGU6IFwibm90ZVwiLFxuICAgIH07XG4gICAgaWYgKG5vdGUuYm9hcmQpIG1ldGEuYm9hcmQgPSBub3RlLmJvYXJkO1xuICAgIGF3YWl0IHRoaXMud3JpdGVGaWxlKGBOb3Rlcy8ke3NhZmVOYW1lKG5vdGUudGl0bGUpfS5tZGAsIHRoaXMuYnVpbGREb2MobWV0YSwgbm90ZS5jb250ZW50IHx8IFwiXCIpKTtcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZU5vdGUobm90ZTogTm90ZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGYgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgobm90ZS5wYXRoKTtcbiAgICBpZiAoZiBpbnN0YW5jZW9mIFRGaWxlKSBhd2FpdCB0aGlzLnJlbW92ZUZpbGUoZik7XG4gIH1cblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gSEFCSVRTIChIYWJpdHMvKi5tZClcbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIGxvYWRIYWJpdHMoKTogSGFiaXRbXSB7XG4gICAgcmV0dXJuIHRoaXMubGlzdE1hcmtkb3duKFwiSGFiaXRzXCIpLm1hcCgoZikgPT4ge1xuICAgICAgY29uc3QgbSA9IHRoaXMuZnJvbnRtYXR0ZXIoZik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBpZDogc3RyKG0uaWQpIHx8IGYuYmFzZW5hbWUsXG4gICAgICAgIG5hbWU6IHN0cihtLm5hbWUpIHx8IGYuYmFzZW5hbWUsXG4gICAgICAgIGVtb2ppOiBzdHIobS5lbW9qaSkgfHwgXCJcdTJCNTBcIixcbiAgICAgICAgaGFiaXRUeXBlOiBzdHIobS5oYWJpdF90eXBlKSB8fCBcImRvXCIsXG4gICAgICAgIGxvZzogY29lcmNlPFJlY29yZDxzdHJpbmcsIGJvb2xlYW4+PihtLmxvZywge30pLFxuICAgICAgICBjcmVhdGVkOiBzdHIobS5jcmVhdGVkKSxcbiAgICAgICAgbGFzdFJlc2V0OiBzdHIobS5sYXN0UmVzZXQpLFxuICAgICAgICBtb2RpZmllZDogc3RyKG0ubW9kaWZpZWQpLFxuICAgICAgICBwYXRoOiBmLnBhdGgsXG4gICAgICB9IGFzIEhhYml0O1xuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgc2F2ZUhhYml0KGg6IFBhcnRpYWw8SGFiaXQ+ICYgeyBuYW1lOiBzdHJpbmcgfSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldGE6IEZNID0ge1xuICAgICAgaWQ6IGguaWQgfHwgKFwiaFwiICsgRGF0ZS5ub3coKSksXG4gICAgICB0eXBlOiBcImhhYml0XCIsXG4gICAgICBoYWJpdF90eXBlOiBoLmhhYml0VHlwZSB8fCBcImRvXCIsXG4gICAgICBuYW1lOiBoLm5hbWUsXG4gICAgICBlbW9qaTogaC5lbW9qaSB8fCBcIlx1MkI1MFwiLFxuICAgICAgbG9nOiBoLmxvZyB8fCB7fSxcbiAgICAgIGNyZWF0ZWQ6IGguY3JlYXRlZCB8fCB0b2RheUxvY2FsKCksXG4gICAgICBsYXN0UmVzZXQ6IGgubGFzdFJlc2V0IHx8IHRvZGF5TG9jYWwoKSxcbiAgICAgIG1vZGlmaWVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgfTtcbiAgICBhd2FpdCB0aGlzLndyaXRlRmlsZShgSGFiaXRzLyR7c2FmZU5hbWUoaC5uYW1lKX0ubWRgLCB0aGlzLmJ1aWxkRG9jKG1ldGEsIGAjICR7aC5uYW1lfVxcbmApKTtcbiAgfVxuXG4gIGFzeW5jIHRvZ2dsZUhhYml0KGhhYml0OiBIYWJpdCwgZGF0ZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZiA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChoYWJpdC5wYXRoIHx8IFwiXCIpO1xuICAgIGlmICghKGYgaW5zdGFuY2VvZiBURmlsZSkpIHJldHVybjtcbiAgICBhd2FpdCB0aGlzLnBhdGNoRnJvbnRtYXR0ZXIoZiwgKGZtKSA9PiB7XG4gICAgICBjb25zdCBsb2cgPSBjb2VyY2U8UmVjb3JkPHN0cmluZywgYm9vbGVhbj4+KGZtLmxvZywge30pO1xuICAgICAgaWYgKGxvZ1tkYXRlXSkgZGVsZXRlIGxvZ1tkYXRlXTsgZWxzZSBsb2dbZGF0ZV0gPSB0cnVlO1xuICAgICAgZm0ubG9nID0gbG9nO1xuICAgICAgZm0ubW9kaWZpZWQgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyByZXNldEhhYml0KGhhYml0OiBIYWJpdCwgZGF0ZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZiA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChoYWJpdC5wYXRoIHx8IFwiXCIpO1xuICAgIGlmICghKGYgaW5zdGFuY2VvZiBURmlsZSkpIHJldHVybjtcbiAgICBhd2FpdCB0aGlzLnBhdGNoRnJvbnRtYXR0ZXIoZiwgKGZtKSA9PiB7XG4gICAgICBmbS5sYXN0UmVzZXQgPSBkYXRlO1xuICAgICAgZm0ubW9kaWZpZWQgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBkZWxldGVIYWJpdChoYWJpdDogSGFiaXQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGhhYml0LnBhdGggfHwgXCJcIik7XG4gICAgaWYgKGYgaW5zdGFuY2VvZiBURmlsZSkgYXdhaXQgdGhpcy5yZW1vdmVGaWxlKGYpO1xuICB9XG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vIEZJVE5FU1NcbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIGxvYWRTcGxpdHMoKTogU3BsaXRbXSB7XG4gICAgY29uc3QgZiA9IHRoaXMuZmlsZUF0KFwiRml0bmVzcy9zcGxpdHMubWRcIik7XG4gICAgaWYgKCFmKSByZXR1cm4gW107XG4gICAgY29uc3QgbGlzdCA9IGNvZXJjZTxhbnlbXT4odGhpcy5mcm9udG1hdHRlcihmKS5zcGxpdHMsIFtdKTtcbiAgICByZXR1cm4gbGlzdC5tYXAoKHMpID0+ICh7IGlkOiBzdHIocy5pZCksIG5hbWU6IHN0cihzLm5hbWUpIH0pKS5maWx0ZXIoKHMpID0+IHMuaWQpO1xuICB9XG5cbiAgbG9hZEV4ZXJjaXNlcygpOiBFeGVyY2lzZVtdIHtcbiAgICByZXR1cm4gdGhpcy5saXN0TWFya2Rvd24oXCJGaXRuZXNzL0V4ZXJjaXNlc1wiKS5tYXAoKGYpID0+IHtcbiAgICAgIGNvbnN0IG0gPSB0aGlzLmZyb250bWF0dGVyKGYpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbmFtZTogc3RyKG0ubmFtZSkgfHwgZi5iYXNlbmFtZSxcbiAgICAgICAgc3BsaXQ6IHN0cihtLnNwbGl0KSB8fCBcIkFcIixcbiAgICAgICAgdHlwZTogc3RyKG0uZXF1aXBtZW50KSB8fCBcIm1hY2hpbmVcIixcbiAgICAgICAgbXVzY2xlOiBzdHIobS5tdXNjbGUpLFxuICAgICAgICBzZXRzOiBzdHIobS5zZXRzKSB8fCBcIjN4MTBcIixcbiAgICAgICAgd2VpZ2h0OiBudW0obS53ZWlnaHQpLFxuICAgICAgICBob3d0bzogc3RyKG0uaG93dG8pLFxuICAgICAgICBwYXRoOiBmLnBhdGgsXG4gICAgICB9IGFzIEV4ZXJjaXNlO1xuICAgIH0pO1xuICB9XG5cbiAgbG9hZFdvcmtvdXRzKCk6IFdvcmtvdXRbXSB7XG4gICAgcmV0dXJuIHRoaXMubGlzdE1hcmtkb3duKFwiRml0bmVzcy9Xb3Jrb3V0c1wiKS5tYXAoKGYpID0+IHtcbiAgICAgIGNvbnN0IG0gPSB0aGlzLmZyb250bWF0dGVyKGYpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaWQ6IHN0cihtLmlkKSB8fCBmLmJhc2VuYW1lLFxuICAgICAgICBkYXRlOiBzdHIobS5kYXRlKS5zdWJzdHJpbmcoMCwgMTApLFxuICAgICAgICBzcGxpdDogc3RyKG0uc3BsaXQpIHx8IFwiQVwiLFxuICAgICAgICBkdXJhdGlvbjogbnVtKG0uZHVyYXRpb24pLFxuICAgICAgICBleGVyY2lzZXM6IGNvZXJjZTxXb3Jrb3V0RXhlcmNpc2VbXT4obS5leGVyY2lzZXMsIFtdKSxcbiAgICAgICAgcGF0aDogZi5wYXRoLFxuICAgICAgfSBhcyBXb3Jrb3V0O1xuICAgIH0pLmZpbHRlcigodykgPT4gdy5kYXRlKTtcbiAgfVxuXG4gIC8qKiBSZXR1cm5zIGZhbHNlIGlmIGEgcmVuYW1lIHdvdWxkIG92ZXJ3cml0ZSBhIGRpZmZlcmVudCBleGlzdGluZyBleGVyY2lzZS4gKi9cbiAgYXN5bmMgc2F2ZUV4ZXJjaXNlKGV4OiBFeGVyY2lzZSwgb3JpZ2luYWxOYW1lPzogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgcmVuYW1pbmcgPSAhIW9yaWdpbmFsTmFtZSAmJiBvcmlnaW5hbE5hbWUgIT09IGV4Lm5hbWU7XG4gICAgY29uc3QgdGFyZ2V0UmVsID0gYEZpdG5lc3MvRXhlcmNpc2VzLyR7c2FmZU5hbWUoZXgubmFtZSl9Lm1kYDtcbiAgICBjb25zdCB0YXJnZXRGdWxsID0gdGhpcy5mdWxsKHRhcmdldFJlbCk7XG4gICAgY29uc3QgdGFyZ2V0RmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aCh0YXJnZXRGdWxsKTtcbiAgICBjb25zdCBvcmlnaW5hbEZ1bGwgPSBvcmlnaW5hbE5hbWUgPyB0aGlzLmZ1bGwoYEZpdG5lc3MvRXhlcmNpc2VzLyR7c2FmZU5hbWUob3JpZ2luYWxOYW1lKX0ubWRgKSA6IG51bGw7XG5cbiAgICAvLyBHdWFyZDogbmV2ZXIgY2xvYmJlciBhIGRpZmZlcmVudCBleGVyY2lzZSdzIGZpbGUgd2hlbiByZW5hbWluZy5cbiAgICBpZiAocmVuYW1pbmcgJiYgdGFyZ2V0RmlsZSAmJiBvcmlnaW5hbEZ1bGwgIT09IHRhcmdldEZ1bGwpIHJldHVybiBmYWxzZTtcblxuICAgIGNvbnN0IG1ldGE6IEZNID0ge1xuICAgICAgbmFtZTogZXgubmFtZSxcbiAgICAgIHNwbGl0OiBleC5zcGxpdCB8fCBcIkFcIixcbiAgICAgIG11c2NsZTogZXgubXVzY2xlIHx8IFwiXCIsXG4gICAgICBzZXRzOiBleC5zZXRzIHx8IFwiM3gxMFwiLFxuICAgICAgd2VpZ2h0OiBleC53ZWlnaHQgfHwgMCxcbiAgICAgIGVxdWlwbWVudDogZXgudHlwZSB8fCBcIm1hY2hpbmVcIixcbiAgICAgIGhvd3RvOiBleC5ob3d0byB8fCBcIlwiLFxuICAgICAgdHlwZTogXCJleGVyY2lzZVwiLFxuICAgICAgbW9kaWZpZWQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICB9O1xuICAgIGF3YWl0IHRoaXMud3JpdGVGaWxlKHRhcmdldFJlbCwgdGhpcy5idWlsZERvYyhtZXRhLCBgIyAke2V4Lm5hbWV9XFxuYCkpO1xuXG4gICAgaWYgKHJlbmFtaW5nICYmIG9yaWdpbmFsRnVsbCAmJiBvcmlnaW5hbEZ1bGwgIT09IHRhcmdldEZ1bGwpIHtcbiAgICAgIGNvbnN0IG9sZCA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChvcmlnaW5hbEZ1bGwpO1xuICAgICAgaWYgKG9sZCBpbnN0YW5jZW9mIFRGaWxlKSBhd2FpdCB0aGlzLnJlbW92ZUZpbGUob2xkKTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBhc3luYyBkZWxldGVFeGVyY2lzZShleDogRXhlcmNpc2UpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGV4LnBhdGggfHwgXCJcIik7XG4gICAgaWYgKGYgaW5zdGFuY2VvZiBURmlsZSkgYXdhaXQgdGhpcy5yZW1vdmVGaWxlKGYpO1xuICB9XG5cbiAgYXN5bmMgc2F2ZVNwbGl0cyhzcGxpdHM6IFNwbGl0W10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLndyaXRlRmlsZShcIkZpdG5lc3Mvc3BsaXRzLm1kXCIsIHRoaXMuYnVpbGREb2MoeyB0eXBlOiBcInNwbGl0cy1jb25maWdcIiwgc3BsaXRzIH0sIFwiIyBXb3Jrb3V0IFNwbGl0c1xcblwiKSk7XG4gIH1cblxuICBhc3luYyBsb2dXb3Jrb3V0KHNwbGl0SWQ6IHN0cmluZywgZHVyYXRpb246IG51bWJlciwgZXhlcmNpc2VzOiBXb3Jrb3V0RXhlcmNpc2VbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGRhdGUgPSB0b2RheUxvY2FsKCk7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgICBjb25zdCB0aW1lID0gU3RyaW5nKG5vdy5nZXRIb3VycygpKS5wYWRTdGFydCgyLCBcIjBcIikgKyBTdHJpbmcobm93LmdldE1pbnV0ZXMoKSkucGFkU3RhcnQoMiwgXCIwXCIpO1xuICAgIGNvbnN0IG1ldGE6IEZNID0ge1xuICAgICAgaWQ6IERhdGUubm93KCksXG4gICAgICB0eXBlOiBcIndvcmtvdXQtbG9nXCIsXG4gICAgICBkYXRlLFxuICAgICAgc3BsaXQ6IHNwbGl0SWQsXG4gICAgICBkdXJhdGlvbixcbiAgICAgIGV4ZXJjaXNlcyxcbiAgICAgIGxvZ2dlZDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIH07XG4gICAgbGV0IGJvZHkgPSBgIyBUcmVpbm8gJHtzcGxpdElkfSAtICR7ZGF0ZX1cXG5cXG5gO1xuICAgIGV4ZXJjaXNlcy5mb3JFYWNoKChlKSA9PiB7XG4gICAgICBib2R5ICs9IGAtICR7ZS5leGVyY2lzZX06ICR7ZS53ZWlnaHR9a2cgeCAke2Uuc2V0c30ke2UuZmVlbCA/IGAgKCR7ZS5mZWVsfSlgIDogXCJcIn1cXG5gO1xuICAgIH0pO1xuICAgIGF3YWl0IHRoaXMud3JpdGVGaWxlKGBGaXRuZXNzL1dvcmtvdXRzLyR7ZGF0ZX0tJHtzcGxpdElkfS0ke3RpbWV9Lm1kYCwgdGhpcy5idWlsZERvYyhtZXRhLCBib2R5KSk7XG4gIH1cblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gU1RVRElFU1xuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgbG9hZFN0dWR5Q2FyZHMoKTogU3R1ZHlDYXJkW10ge1xuICAgIHJldHVybiB0aGlzLmxpc3RNYXJrZG93bihcIlN0dWRpZXNcIilcbiAgICAgIC5maWx0ZXIoKGYpID0+IGYubmFtZSAhPT0gXCJib2FyZHMubWRcIilcbiAgICAgIC5tYXAoKGYpID0+IHtcbiAgICAgICAgY29uc3QgbSA9IHRoaXMuZnJvbnRtYXR0ZXIoZik7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgaWQ6IHN0cihtLmlkKSB8fCBmLmJhc2VuYW1lLFxuICAgICAgICAgIHRpdGxlOiBzdHIobS50aXRsZSkgfHwgZi5iYXNlbmFtZSxcbiAgICAgICAgICB0b3BpYzogc3RyKG0udG9waWMpLFxuICAgICAgICAgIHN1YnRvcGljOiBzdHIobS5zdWJ0b3BpYyksXG4gICAgICAgICAgc3RhdHVzOiBzdHIobS5zdGF0dXMpIHx8IFwiYmFja2xvZ1wiLFxuICAgICAgICAgIHVybDogc3RyKG0udXJsKSxcbiAgICAgICAgICBkYXRlOiBzdHIobS5kYXRlKSxcbiAgICAgICAgICBtb2RpZmllZDogc3RyKG0ubW9kaWZpZWQpLFxuICAgICAgICAgIHBhdGg6IGYucGF0aCxcbiAgICAgICAgfSBhcyBTdHVkeUNhcmQ7XG4gICAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVTdHVkeUJvYXJkcyhib2FyZHM6IEJvYXJkW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLndyaXRlRmlsZShcbiAgICAgIFwiU3R1ZGllcy9ib2FyZHMubWRcIixcbiAgICAgIHRoaXMuYnVpbGREb2MoeyB0eXBlOiBcInN0dWR5LWJvYXJkcy1jb25maWdcIiwgYm9hcmRzIH0sIFwiIyBTdHVkeSBCb2FyZHNcXG5cIilcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBzdHVkeUNhcmREb2MoYzogUGFydGlhbDxTdHVkeUNhcmQ+LCBleGlzdGluZz86IEZNKTogc3RyaW5nIHtcbiAgICBjb25zdCBtZXRhOiBGTSA9IHtcbiAgICAgIGlkOiBjLmlkIHx8IGV4aXN0aW5nPy5pZCB8fCBjcnlwdG9JZCgpLFxuICAgICAgdGl0bGU6IGMudGl0bGUsXG4gICAgICB0b3BpYzogYy50b3BpYyB8fCBcIlwiLFxuICAgICAgc3VidG9waWM6IGMuc3VidG9waWMgfHwgXCJcIixcbiAgICAgIHN0YXR1czogYy5zdGF0dXMgfHwgXCJiYWNrbG9nXCIsXG4gICAgICB1cmw6IGMudXJsIHx8IFwiXCIsXG4gICAgICBkYXRlOiBjLmRhdGUgfHwgZXhpc3Rpbmc/LmRhdGUgfHwgdG9kYXlMb2NhbCgpLFxuICAgICAgY3JlYXRlZDogZXhpc3Rpbmc/LmNyZWF0ZWQgfHwgbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgbW9kaWZpZWQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIHR5cGU6IFwic3R1ZHlcIixcbiAgICB9O1xuICAgIHJldHVybiB0aGlzLmJ1aWxkRG9jKG1ldGEsIGAjICR7Yy50aXRsZX1cXG5gKTtcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZVN0dWR5Q2FyZChjOiBQYXJ0aWFsPFN0dWR5Q2FyZD4gJiB7IHRpdGxlOiBzdHJpbmc7IHRvcGljOiBzdHJpbmcgfSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMud3JpdGVGaWxlKHRoaXMudW5pcXVlUGF0aChgU3R1ZGllcy8ke2MudG9waWN9YCwgYy50aXRsZSksIHRoaXMuc3R1ZHlDYXJkRG9jKGMpKTtcbiAgfVxuXG4gIGFzeW5jIHVwZGF0ZVN0dWR5Q2FyZFN0YXR1cyhjYXJkOiBTdHVkeUNhcmQsIHN0YXR1czogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZiA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChjYXJkLnBhdGgpO1xuICAgIGlmICghKGYgaW5zdGFuY2VvZiBURmlsZSkpIHJldHVybjtcbiAgICBhd2FpdCB0aGlzLnBhdGNoRnJvbnRtYXR0ZXIoZiwgKGZtKSA9PiB7XG4gICAgICBmbS5zdGF0dXMgPSBzdGF0dXM7XG4gICAgICBmbS5tb2RpZmllZCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKiBSZXR1cm5zIGZhbHNlIGlmIGEgcmVuYW1lIHdvdWxkIG92ZXJ3cml0ZSBhIGRpZmZlcmVudCBleGlzdGluZyBzdHVkeSBjYXJkLiAqL1xuICBhc3luYyB1cGRhdGVTdHVkeUNhcmQoY2FyZDogU3R1ZHlDYXJkLCBjaGFuZ2VzOiBQYXJ0aWFsPFN0dWR5Q2FyZD4pOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBtZXJnZWQ6IFN0dWR5Q2FyZCA9IHsgLi4uY2FyZCwgLi4uY2hhbmdlcyB9O1xuICAgIGNvbnN0IGYgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoY2FyZC5wYXRoKTtcbiAgICBjb25zdCBmaWxlID0gZiBpbnN0YW5jZW9mIFRGaWxlID8gZiA6IG51bGw7XG4gICAgY29uc3QgcmVuYW1lZCA9IG1lcmdlZC50aXRsZSAhPT0gY2FyZC50aXRsZSB8fCBtZXJnZWQudG9waWMgIT09IGNhcmQudG9waWM7XG4gICAgaWYgKGZpbGUgJiYgIXJlbmFtZWQpIHtcbiAgICAgIGF3YWl0IHRoaXMucGF0Y2hGcm9udG1hdHRlcihmaWxlLCAoZm0pID0+IHtcbiAgICAgICAgZm0uc3VidG9waWMgPSBtZXJnZWQuc3VidG9waWMgfHwgXCJcIjtcbiAgICAgICAgZm0uc3RhdHVzID0gbWVyZ2VkLnN0YXR1cyB8fCBcImJhY2tsb2dcIjtcbiAgICAgICAgZm0udXJsID0gbWVyZ2VkLnVybCB8fCBcIlwiO1xuICAgICAgICBmbS5tb2RpZmllZCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGNvbnN0IHRhcmdldEZ1bGwgPSB0aGlzLmZ1bGwoYFN0dWRpZXMvJHttZXJnZWQudG9waWN9LyR7c2FmZU5hbWUobWVyZ2VkLnRpdGxlKX0ubWRgKTtcbiAgICBjb25zdCB0YXJnZXRFeGlzdGluZyA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aCh0YXJnZXRGdWxsKTtcbiAgICAvLyBHdWFyZDogbmV2ZXIgY2xvYmJlciBhIGRpZmZlcmVudCBjYXJkIG9uIHJlbmFtZS9tb3ZlLlxuICAgIGlmIChyZW5hbWVkICYmIHRhcmdldEV4aXN0aW5nICYmIHRhcmdldEV4aXN0aW5nICE9PSBmaWxlKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgZXhpc3RpbmcgPSBmaWxlID8gdGhpcy5mcm9udG1hdHRlcihmaWxlKSA6IHVuZGVmaW5lZDtcbiAgICBhd2FpdCB0aGlzLndyaXRlRmlsZShgU3R1ZGllcy8ke21lcmdlZC50b3BpY30vJHtzYWZlTmFtZShtZXJnZWQudGl0bGUpfS5tZGAsIHRoaXMuc3R1ZHlDYXJkRG9jKG1lcmdlZCwgZXhpc3RpbmcpKTtcbiAgICBpZiAoZmlsZSAmJiByZW5hbWVkKSBhd2FpdCB0aGlzLnJlbW92ZUZpbGUoZmlsZSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBhc3luYyBkZWxldGVTdHVkeUNhcmQoY2FyZDogU3R1ZHlDYXJkKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZiA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChjYXJkLnBhdGgpO1xuICAgIGlmIChmIGluc3RhbmNlb2YgVEZpbGUpIGF3YWl0IHRoaXMucmVtb3ZlRmlsZShmKTtcbiAgfVxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBOVVRSSVRJT05cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIGxvYWRNZWFscygpOiBNZWFsW10ge1xuICAgIHJldHVybiB0aGlzLmxpc3RNYXJrZG93bihcIk51dHJpdGlvbi9QbGFuXCIpLm1hcCgoZikgPT4ge1xuICAgICAgY29uc3QgbSA9IHRoaXMuZnJvbnRtYXR0ZXIoZik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBpZDogc3RyKG0uaWQpIHx8IGYuYmFzZW5hbWUsXG4gICAgICAgIG5hbWU6IHN0cihtLm5hbWUpIHx8IGYuYmFzZW5hbWUsXG4gICAgICAgIGVtb2ppOiBzdHIobS5lbW9qaSksXG4gICAgICAgIHRvdGFsQ2FsOiBudW0obS50b3RhbF9jYWwpLFxuICAgICAgICBpdGVtczogY29lcmNlPE1lYWxJdGVtW10+KG0uaXRlbXMsIFtdKSxcbiAgICAgICAgcGF0aDogZi5wYXRoLFxuICAgICAgfSBhcyBNZWFsO1xuICAgIH0pO1xuICB9XG5cbiAgbG9hZE1lYWxMb2dzKCk6IE1lYWxMb2dbXSB7XG4gICAgcmV0dXJuIHRoaXMubGlzdE1hcmtkb3duKFwiTnV0cml0aW9uL0xvZ3NcIikubWFwKChmKSA9PiB7XG4gICAgICBjb25zdCBtID0gdGhpcy5mcm9udG1hdHRlcihmKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGlkOiBzdHIobS5pZCkgfHwgZi5iYXNlbmFtZSxcbiAgICAgICAgZGF0ZTogc3RyKG0uZGF0ZSkuc3Vic3RyaW5nKDAsIDEwKSxcbiAgICAgICAgbWVhbElkOiBzdHIobS5tZWFsKSxcbiAgICAgICAgdG90YWxDYWw6IG51bShtLmNhbG9yaWVzKSxcbiAgICAgICAgdG90YWxQcm90ZWluOiBudW0obS5wcm90ZWluKSxcbiAgICAgICAgdG90YWxDYXJiczogbnVtKG0uY2FyYnMpLFxuICAgICAgICBpdGVtczogY29lcmNlPE1lYWxJdGVtW10+KG0uaXRlbXMsIFtdKSxcbiAgICAgICAgcGF0aDogZi5wYXRoLFxuICAgICAgfSBhcyBNZWFsTG9nO1xuICAgIH0pLmZpbHRlcigobCkgPT4gbC5kYXRlKTtcbiAgfVxuXG4gIGFzeW5jIHNhdmVNZWFsKG1lYWw6IFBhcnRpYWw8TWVhbD4gJiB7IG5hbWU6IHN0cmluZzsgaXRlbXM6IE1lYWxJdGVtW10gfSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHRvdGFsID0gbWVhbC5pdGVtcy5yZWR1Y2UoKHMsIGl0KSA9PiBzICsgKE51bWJlcihpdC5jYWwpIHx8IDApLCAwKTtcbiAgICBjb25zdCBpZCA9IG1lYWwuaWQgfHwgKFwibVwiICsgRGF0ZS5ub3coKSk7XG4gICAgY29uc3QgbWV0YTogRk0gPSB7XG4gICAgICB0eXBlOiBcIm1lYWwtcGxhblwiLFxuICAgICAgaWQsXG4gICAgICBuYW1lOiBtZWFsLm5hbWUsXG4gICAgICBlbW9qaTogbWVhbC5lbW9qaSB8fCBcIlwiLFxuICAgICAgdG90YWxfY2FsOiB0b3RhbCxcbiAgICAgIGl0ZW1zOiBtZWFsLml0ZW1zLFxuICAgIH07XG4gICAgbGV0IGJvZHkgPSBgIyAke21lYWwuZW1vamkgfHwgXCJcIn0gJHttZWFsLm5hbWV9ICgke3RvdGFsfSBjYWwpXFxuXFxuYDtcbiAgICBtZWFsLml0ZW1zLmZvckVhY2goKGl0KSA9PiB7IGJvZHkgKz0gYC0gJHtpdC5uYW1lfTogJHtpdC5xdHkgfHwgMH0ke2l0LnVuaXQgfHwgXCJcIn0gKCR7aXQuY2FsIHx8IDB9IGNhbClcXG5gOyB9KTtcbiAgICBhd2FpdCB0aGlzLndyaXRlRmlsZShgTnV0cml0aW9uL1BsYW4vJHtzYWZlTmFtZShpZCl9Lm1kYCwgdGhpcy5idWlsZERvYyhtZXRhLCBib2R5KSk7XG4gIH1cblxuICBhc3luYyBkZWxldGVNZWFsKG1lYWw6IE1lYWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKG1lYWwucGF0aCk7XG4gICAgaWYgKGYgaW5zdGFuY2VvZiBURmlsZSkgYXdhaXQgdGhpcy5yZW1vdmVGaWxlKGYpO1xuICB9XG5cbiAgYXN5bmMgbG9nTWVhbChtZWFsOiBNZWFsLCBpdGVtczogTWVhbEl0ZW1bXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGRhdGUgPSB0b2RheUxvY2FsKCk7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgICBjb25zdCB0aW1lID0gU3RyaW5nKG5vdy5nZXRIb3VycygpKS5wYWRTdGFydCgyLCBcIjBcIikgKyBTdHJpbmcobm93LmdldE1pbnV0ZXMoKSkucGFkU3RhcnQoMiwgXCIwXCIpO1xuICAgIGNvbnN0IHRvdGFsQ2FsID0gaXRlbXMucmVkdWNlKChzLCBpdCkgPT4gcyArIChOdW1iZXIoaXQuY2FsKSB8fCAwKSwgMCk7XG4gICAgY29uc3QgdG90YWxQcm90ZWluID0gaXRlbXMucmVkdWNlKChzLCBpdCkgPT4gcyArIChOdW1iZXIoaXQucHJvdGVpbikgfHwgMCksIDApO1xuICAgIGNvbnN0IHRvdGFsQ2FyYnMgPSBpdGVtcy5yZWR1Y2UoKHMsIGl0KSA9PiBzICsgKE51bWJlcihpdC5jYXJicykgfHwgMCksIDApO1xuICAgIGNvbnN0IG1ldGE6IEZNID0ge1xuICAgICAgaWQ6IERhdGUubm93KCksXG4gICAgICBkYXRlLFxuICAgICAgbWVhbDogbWVhbC5pZCxcbiAgICAgIGNhbG9yaWVzOiB0b3RhbENhbCxcbiAgICAgIHByb3RlaW46IHRvdGFsUHJvdGVpbixcbiAgICAgIGNhcmJzOiB0b3RhbENhcmJzLFxuICAgICAgaXRlbXMsXG4gICAgICBsb2dnZWQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICB9O1xuICAgIGxldCBib2R5ID0gYCMgJHttZWFsLm5hbWV9IC0gJHtkYXRlfVxcblxcbmA7XG4gICAgaXRlbXMuZm9yRWFjaCgoaXQpID0+IHsgYm9keSArPSBgLSAke2l0Lm5hbWV9OiAke2l0LnF0eX0ke2l0LnVuaXR9ICgke2l0LmNhbH0gY2FsKVxcbmA7IH0pO1xuICAgIGJvZHkgKz0gYFxcblRvdGFsOiAke3RvdGFsQ2FsfSBjYWxcXG5gO1xuICAgIGF3YWl0IHRoaXMud3JpdGVGaWxlKGBOdXRyaXRpb24vTG9ncy8ke2RhdGV9LSR7bWVhbC5pZH0tJHt0aW1lfS5tZGAsIHRoaXMuYnVpbGREb2MobWV0YSwgYm9keSkpO1xuICB9XG5cbiAgYXN5bmMgZGVsZXRlTWVhbExvZyhsb2c6IE1lYWxMb2cpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGxvZy5wYXRoKTtcbiAgICBpZiAoZiBpbnN0YW5jZW9mIFRGaWxlKSBhd2FpdCB0aGlzLnJlbW92ZUZpbGUoZik7XG4gIH1cblxuICAvLyAtLS0tIFdhdGVyIChzdG9yZWQgaW4gTnV0cml0aW9uL3dhdGVyLm1kIGFzIGEge2RhdGU6IGxpdGVyc30gbWFwKSAtLS0tXG4gIGxvYWRXYXRlckxvZygpOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+IHtcbiAgICBjb25zdCBmID0gdGhpcy5maWxlQXQoXCJOdXRyaXRpb24vd2F0ZXIubWRcIik7XG4gICAgaWYgKCFmKSByZXR1cm4ge307XG4gICAgcmV0dXJuIGNvZXJjZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+Pih0aGlzLmZyb250bWF0dGVyKGYpLmxvZywge30pO1xuICB9XG5cbiAgYXN5bmMgYWRkV2F0ZXIoZGF0ZTogc3RyaW5nLCBkZWx0YUxpdGVyczogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZiA9IHRoaXMuZmlsZUF0KFwiTnV0cml0aW9uL3dhdGVyLm1kXCIpO1xuICAgIGlmIChmKSB7XG4gICAgICBhd2FpdCB0aGlzLnBhdGNoRnJvbnRtYXR0ZXIoZiwgKGZtKSA9PiB7XG4gICAgICAgIGNvbnN0IGxvZyA9IGNvZXJjZTxSZWNvcmQ8c3RyaW5nLCBudW1iZXI+PihmbS5sb2csIHt9KTtcbiAgICAgICAgbG9nW2RhdGVdID0gTWF0aC5tYXgoMCwgTWF0aC5yb3VuZCgoKGxvZ1tkYXRlXSB8fCAwKSArIGRlbHRhTGl0ZXJzKSAqIDEwMCkgLyAxMDApO1xuICAgICAgICBmbS5sb2cgPSBsb2c7XG4gICAgICAgIGZtLm1vZGlmaWVkID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGxvZzogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xuICAgIGxvZ1tkYXRlXSA9IE1hdGgubWF4KDAsIGRlbHRhTGl0ZXJzKTtcbiAgICBhd2FpdCB0aGlzLndyaXRlRmlsZShcIk51dHJpdGlvbi93YXRlci5tZFwiLCB0aGlzLmJ1aWxkRG9jKHsgdHlwZTogXCJ3YXRlci1sb2dcIiwgbG9nLCBtb2RpZmllZDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0sIFwiIyBXYXRlciBsb2dcXG5cIikpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNyeXB0b0lkKCk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgLy8gQHRzLWlnbm9yZVxuICAgIGlmICh0eXBlb2YgY3J5cHRvICE9PSBcInVuZGVmaW5lZFwiICYmIGNyeXB0by5yYW5kb21VVUlEKSByZXR1cm4gY3J5cHRvLnJhbmRvbVVVSUQoKTtcbiAgfSBjYXRjaCB7IC8qIG5vb3AgKi8gfVxuICByZXR1cm4gXCJ0XCIgKyBEYXRlLm5vdygpICsgXCItXCIgKyBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCA4KTtcbn1cbiIsICIvLyBEb21haW4gbW9kZWwgZm9yIHRoZSBQZXJzb25hbCBBc3Npc3RhbnQgcGx1Z2luLlxuLy8gTWlycm9ycyB0aGUgbWFya2Rvd24gc2NoZW1hIHVzZWQgYnkgdGhlIHNpYmxpbmcgd2ViIGFwcCBzbyBib3RoIHJlYWQvd3JpdGVcbi8vIHRoZSBleGFjdCBzYW1lIGBQZXJzb25hbCBBc3Npc3RhbnQvKi5tZGAgZmlsZXMuXG5cbmV4cG9ydCBpbnRlcmZhY2UgQm9hcmQge1xuICBpZDogc3RyaW5nO1xuICBuYW1lOiBzdHJpbmc7XG4gIGVtb2ppPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFRhc2sge1xuICBpZDogc3RyaW5nOyAvLyB0YXNrX2lkICh1dWlkKSBvciBmaWxlbmFtZSBmYWxsYmFja1xuICB0aXRsZTogc3RyaW5nO1xuICBzdGF0dXM6IHN0cmluZzsgLy8gbWF0Y2hlcyBhIHRhc2sgY29sdW1uIGtleSwgZS5nLiBcInRvZG9cIiB8IFwiaW4gcHJvZ3Jlc3NcIiB8IFwiZG9uZVwiXG4gIHByaW9yaXR5OiBcImxvd1wiIHwgXCJtZWRpdW1cIiB8IFwiaGlnaFwiIHwgc3RyaW5nO1xuICBjYXQ/OiBzdHJpbmc7XG4gIGdyb3VwPzogc3RyaW5nO1xuICBrYW5iYW5JZD86IHN0cmluZztcbiAga2FuYmFuTmFtZT86IHN0cmluZzsgLy8gYm9hcmQgbmFtZVxuICBkdWU/OiBzdHJpbmc7XG4gIHNjaGVkdWxlZD86IHN0cmluZztcbiAgZHVyYXRpb24/OiBudW1iZXI7XG4gIGlzQWxsRGF5PzogYm9vbGVhbjtcbiAgY3JlYXRlZD86IHN0cmluZztcbiAgbW9kaWZpZWQ/OiBzdHJpbmc7XG4gIHBhdGg6IHN0cmluZzsgLy8gdmF1bHQgcGF0aCBvZiB0aGUgc291cmNlIGZpbGVcbiAgYm9keT86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBOb3RlIHtcbiAgaWQ6IHN0cmluZzsgLy8gZmlsZW5hbWUgYmFzZW5hbWVcbiAgdGl0bGU6IHN0cmluZztcbiAgY29udGVudDogc3RyaW5nO1xuICBjb2xvcjogc3RyaW5nOyAvLyB5ZWxsb3cgfCBncmVlbiB8IGJsdWUgfCAuLi5cbiAgYm9hcmQ/OiBzdHJpbmc7XG4gIGRhdGU/OiBzdHJpbmc7XG4gIHBhdGg6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBIYWJpdCB7XG4gIGlkOiBzdHJpbmc7XG4gIG5hbWU6IHN0cmluZztcbiAgZW1vamk6IHN0cmluZztcbiAgaGFiaXRUeXBlOiBcImRvXCIgfCBcInF1aXRcIiB8IHN0cmluZztcbiAgbG9nOiBSZWNvcmQ8c3RyaW5nLCBib29sZWFuPjtcbiAgY3JlYXRlZD86IHN0cmluZztcbiAgbGFzdFJlc2V0Pzogc3RyaW5nO1xuICBtb2RpZmllZD86IHN0cmluZztcbiAgcGF0aD86IHN0cmluZzsgLy8gcHJlc2VudCB3aGVuIHN0b3JlZCBhcyBhbiBpbmRpdmlkdWFsIGZpbGVcbn1cblxuZXhwb3J0IGludGVyZmFjZSBFeGVyY2lzZSB7XG4gIG5hbWU6IHN0cmluZztcbiAgc3BsaXQ6IHN0cmluZztcbiAgdHlwZTogc3RyaW5nOyAvLyBlcXVpcG1lbnQgdHlwZSAvIG1hY2hpbmUgfCBmcmVlIC4uLlxuICBtdXNjbGU6IHN0cmluZztcbiAgc2V0czogc3RyaW5nOyAvLyBlLmcuIFwiM3gxMFwiXG4gIHdlaWdodDogbnVtYmVyO1xuICBob3d0bzogc3RyaW5nO1xuICBwYXRoPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFdvcmtvdXRFeGVyY2lzZSB7XG4gIGV4ZXJjaXNlOiBzdHJpbmc7XG4gIHdlaWdodDogbnVtYmVyO1xuICBzZXRzOiBzdHJpbmc7XG4gIGZlZWw/OiBzdHJpbmc7XG4gIG9sZFdlaWdodD86IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBXb3Jrb3V0IHtcbiAgaWQ6IHN0cmluZztcbiAgZGF0ZTogc3RyaW5nOyAvLyBZWVlZLU1NLUREXG4gIHNwbGl0OiBzdHJpbmc7XG4gIGR1cmF0aW9uOiBudW1iZXI7IC8vIG1pbnV0ZXNcbiAgZXhlcmNpc2VzOiBXb3Jrb3V0RXhlcmNpc2VbXTtcbiAgcGF0aDogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNwbGl0IHtcbiAgaWQ6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN0dWR5Q2FyZCB7XG4gIGlkOiBzdHJpbmc7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIHRvcGljOiBzdHJpbmc7XG4gIHN1YnRvcGljPzogc3RyaW5nO1xuICBzdGF0dXM6IHN0cmluZztcbiAgdXJsPzogc3RyaW5nO1xuICBkYXRlPzogc3RyaW5nO1xuICBtb2RpZmllZD86IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIE1lYWxJdGVtIHtcbiAgbmFtZTogc3RyaW5nO1xuICBxdHk6IG51bWJlcjtcbiAgdW5pdDogc3RyaW5nO1xuICBjYWw6IG51bWJlcjtcbiAgcHJvdGVpbj86IG51bWJlcjtcbiAgY2FyYnM/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWVhbCB7XG4gIGlkOiBzdHJpbmc7XG4gIG5hbWU6IHN0cmluZztcbiAgZW1vamk/OiBzdHJpbmc7XG4gIHRvdGFsQ2FsOiBudW1iZXI7XG4gIGl0ZW1zOiBNZWFsSXRlbVtdO1xuICBwYXRoOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWVhbExvZyB7XG4gIGlkOiBzdHJpbmc7XG4gIGRhdGU6IHN0cmluZztcbiAgbWVhbElkOiBzdHJpbmc7XG4gIHRvdGFsQ2FsOiBudW1iZXI7XG4gIHRvdGFsUHJvdGVpbjogbnVtYmVyO1xuICB0b3RhbENhcmJzOiBudW1iZXI7XG4gIGl0ZW1zOiBNZWFsSXRlbVtdO1xuICBwYXRoOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUEFDb25maWcge1xuICBjYWxvcmllVGFyZ2V0OiBudW1iZXI7XG4gIHByb3RlaW5UYXJnZXQ6IG51bWJlcjtcbiAgY2FyYnNUYXJnZXQ6IG51bWJlcjtcbiAgd2F0ZXJUYXJnZXQ6IG51bWJlcjtcbiAgdGFza0NvbHVtbnM6IHN0cmluZ1tdO1xuICB0YXNrQ29sdW1uTmFtZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIHN0dWR5Q29sdW1uczogc3RyaW5nW107XG4gIHN0dWR5Q29sdW1uTmFtZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIHN0dWR5VG9waWNzOiBCb2FyZFtdO1xuICBjdXN0b21TcGxpdHM6IFNwbGl0W107XG4gIHNwbGl0TmFtZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1RBU0tfQ09MVU1OUyA9IFtcInRvZG9cIiwgXCJpbiBwcm9ncmVzc1wiLCBcImRvbmVcIl07XG5leHBvcnQgY29uc3QgREVGQVVMVF9UQVNLX0NPTFVNTl9OQU1FUzogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgdG9kbzogXCJcdUQ4M0RcdURDQ0MgQkFDS0xPR1wiLFxuICBcImluIHByb2dyZXNzXCI6IFwiXHVEODNEXHVERDA0IElOIFBST0dSRVNTXCIsXG4gIGRvbmU6IFwiXHUyNzA1IERPTkVcIixcbiAgXCJvbi1ob2xkXCI6IFwiT24taG9sZFwiLFxufTtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1NUVURZX0NPTFVNTlMgPSBbXCJiYWNrbG9nXCIsIFwiaW4gcHJvZ3Jlc3NcIiwgXCJkb25lXCJdO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfU1RVRFlfQ09MVU1OX05BTUVTOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICBiYWNrbG9nOiBcIlx1RDgzRFx1RENDQyBCQUNLTE9HXCIsXG4gIFwiaW4gcHJvZ3Jlc3NcIjogXCJcdUQ4M0RcdUREMDQgSU4gUFJPR1JFU1NcIixcbiAgZG9uZTogXCJcdTI3MDUgRE9ORVwiLFxufTtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1NQTElUUzogU3BsaXRbXSA9IFtcbiAgeyBpZDogXCJBXCIsIG5hbWU6IFwiUGVpdG8vT21icm8vVHJcdTAwRURjZXBzXCIgfSxcbiAgeyBpZDogXCJCXCIsIG5hbWU6IFwiQ29zdGFzL0JcdTAwRURjZXBzXCIgfSxcbiAgeyBpZDogXCJDXCIsIG5hbWU6IFwiUGVybmFzXCIgfSxcbiAgeyBpZDogXCJEXCIsIG5hbWU6IFwiQ29yZS9Mb21iYXJcIiB9LFxuXTtcblxuZXhwb3J0IGNvbnN0IE5PVEVfQ09MT1JTOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICB5ZWxsb3c6IFwiI2ZmZjljNFwiLFxuICBncmVlbjogXCIjYzhlNmM5XCIsXG4gIGJsdWU6IFwiI2JiZGVmYlwiLFxuICBwaW5rOiBcIiNmOGJiZDBcIixcbiAgcHVycGxlOiBcIiNlMWJlZTdcIixcbiAgb3JhbmdlOiBcIiNmZmUwYjJcIixcbiAgd2hpdGU6IFwiI2ZmZmZmZlwiLFxufTtcblxuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRDb25maWcoKTogUEFDb25maWcge1xuICByZXR1cm4ge1xuICAgIGNhbG9yaWVUYXJnZXQ6IDIwMDAsXG4gICAgcHJvdGVpblRhcmdldDogMTIwLFxuICAgIGNhcmJzVGFyZ2V0OiAyMDAsXG4gICAgd2F0ZXJUYXJnZXQ6IDIuNSxcbiAgICB0YXNrQ29sdW1uczogREVGQVVMVF9UQVNLX0NPTFVNTlMuc2xpY2UoKSxcbiAgICB0YXNrQ29sdW1uTmFtZXM6IHsgLi4uREVGQVVMVF9UQVNLX0NPTFVNTl9OQU1FUyB9LFxuICAgIHN0dWR5Q29sdW1uczogREVGQVVMVF9TVFVEWV9DT0xVTU5TLnNsaWNlKCksXG4gICAgc3R1ZHlDb2x1bW5OYW1lczogeyAuLi5ERUZBVUxUX1NUVURZX0NPTFVNTl9OQU1FUyB9LFxuICAgIHN0dWR5VG9waWNzOiBbXSxcbiAgICBjdXN0b21TcGxpdHM6IFtdLFxuICAgIHNwbGl0TmFtZXM6IHt9LFxuICB9O1xufVxuIiwgIi8qKiBMb2NhbC10aW1lem9uZSBkYXRlIGhlbHBlcnMgKG1hdGNoIHRoZSB3ZWIgYXBwJ3MgdG9kYXlMb2NhbC9faHRGbXQpLiAqL1xuXG5leHBvcnQgZnVuY3Rpb24geW1kKGQ6IERhdGUpOiBzdHJpbmcge1xuICByZXR1cm4gKFxuICAgIGQuZ2V0RnVsbFllYXIoKSArXG4gICAgXCItXCIgK1xuICAgIFN0cmluZyhkLmdldE1vbnRoKCkgKyAxKS5wYWRTdGFydCgyLCBcIjBcIikgK1xuICAgIFwiLVwiICtcbiAgICBTdHJpbmcoZC5nZXREYXRlKCkpLnBhZFN0YXJ0KDIsIFwiMFwiKVxuICApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9kYXlMb2NhbCgpOiBzdHJpbmcge1xuICByZXR1cm4geW1kKG5ldyBEYXRlKCkpO1xufVxuXG4vKiogRGF5cyBiZXR3ZWVuIHR3byBZWVlZLU1NLUREIHN0cmluZ3MgKGIgLSBhKSwgZmxvb3JlZCBhdCAwLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRheXNCZXR3ZWVuKGFTdHI6IHN0cmluZywgYlN0cjogc3RyaW5nKTogbnVtYmVyIHtcbiAgY29uc3QgYSA9IG5ldyBEYXRlKGFTdHIgKyBcIlQwMDowMDowMFwiKTtcbiAgY29uc3QgYiA9IG5ldyBEYXRlKGJTdHIgKyBcIlQwMDowMDowMFwiKTtcbiAgY29uc3QgZGlmZiA9IE1hdGgucm91bmQoKGIuZ2V0VGltZSgpIC0gYS5nZXRUaW1lKCkpIC8gODY0MDAwMDApO1xuICByZXR1cm4gZGlmZiA+PSAwID8gZGlmZiA6IDA7XG59XG4iLCAiaW1wb3J0IHsgSXRlbVZpZXcsIFdvcmtzcGFjZUxlYWYsIGRlYm91bmNlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBQQUNvbnRleHQgfSBmcm9tIFwiLi9jb250ZXh0XCI7XG5pbXBvcnQgeyBQQURhdGFTdG9yZSwgREFUQV9ST09UIH0gZnJvbSBcIi4vZGF0YVwiO1xuaW1wb3J0IHsgSGFiaXRUcmFja2VyTW9kdWxlIH0gZnJvbSBcIi4vbW9kdWxlcy9oYWJpdC10cmFja2VyXCI7XG5pbXBvcnQgeyBUYXNrc01vZHVsZSB9IGZyb20gXCIuL21vZHVsZXMvdGFza3NcIjtcbmltcG9ydCB7IEZpdG5lc3NNb2R1bGUgfSBmcm9tIFwiLi9tb2R1bGVzL2ZpdG5lc3NcIjtcbmltcG9ydCB7IE51dHJpdGlvbk1vZHVsZSB9IGZyb20gXCIuL21vZHVsZXMvbnV0cml0aW9uXCI7XG5pbXBvcnQgeyBTdHVkaWVzTW9kdWxlIH0gZnJvbSBcIi4vbW9kdWxlcy9zdHVkaWVzXCI7XG5cbmV4cG9ydCBjb25zdCBWSUVXX1RZUEVfUEEgPSBcInBlcnNvbmFsLWFzc2lzdGFudC12aWV3XCI7XG5cbmV4cG9ydCBjb25zdCBQQUdFUyA9IFtcbiAgeyBpZDogXCJoYWJpdC10cmFja2VyXCIsIGxhYmVsOiBcIlx1RDgzQ1x1REZBRiBIYWJpdCBUcmFja2VyXCIgfSxcbiAgeyBpZDogXCJ0YXNrc1wiLCBsYWJlbDogXCJcdTI3MDUgVGFza3MgJiBOb3Rlc1wiIH0sXG4gIHsgaWQ6IFwiZml0bmVzc1wiLCBsYWJlbDogXCJcdUQ4M0NcdURGQ0JcdUZFMEYgRml0bmVzc1wiIH0sXG4gIHsgaWQ6IFwibnV0cml0aW9uXCIsIGxhYmVsOiBcIlx1RDgzRVx1REQ1NyBOdXRyaXRpb25cIiB9LFxuICB7IGlkOiBcInN0dWRpZXNcIiwgbGFiZWw6IFwiXHVEODNEXHVEQ0RBIFN0dWRpZXNcIiB9LFxuXTtcblxuLyoqIEltcGxlbWVudGVkIGJ5IHRoZSBwbHVnaW4gc28gdGhlIG5hdiArIGNvbnRlbnQgdmlld3Mgc3RheSBpbiBzeW5jLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQQUhvc3Qge1xuICBjdXJyZW50UGFnZTogc3RyaW5nO1xuICBvcGVuUGFnZShpZDogc3RyaW5nKTogdm9pZCB8IFByb21pc2U8dm9pZD47XG59XG5cbmV4cG9ydCBjbGFzcyBQQVZpZXcgZXh0ZW5kcyBJdGVtVmlldyB7XG4gIHByaXZhdGUgY3R4OiBQQUNvbnRleHQ7XG4gIHByaXZhdGUgaG9zdDogUEFIb3N0O1xuICBwcml2YXRlIG1haW5FbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcblxuICBwcml2YXRlIGhhYml0VHJhY2tlck1vZHVsZTogSGFiaXRUcmFja2VyTW9kdWxlO1xuICBwcml2YXRlIHRhc2tzTW9kdWxlOiBUYXNrc01vZHVsZTtcbiAgcHJpdmF0ZSBmaXRuZXNzTW9kdWxlOiBGaXRuZXNzTW9kdWxlO1xuICBwcml2YXRlIG51dHJpdGlvbk1vZHVsZTogTnV0cml0aW9uTW9kdWxlO1xuICBwcml2YXRlIHN0dWRpZXNNb2R1bGU6IFN0dWRpZXNNb2R1bGU7XG5cbiAgY29uc3RydWN0b3IobGVhZjogV29ya3NwYWNlTGVhZiwgc3RvcmU6IFBBRGF0YVN0b3JlLCBob3N0OiBQQUhvc3QpIHtcbiAgICBzdXBlcihsZWFmKTtcbiAgICB0aGlzLmhvc3QgPSBob3N0O1xuICAgIHRoaXMuY3R4ID0gbmV3IFBBQ29udGV4dCh0aGlzLmFwcCwgc3RvcmUpO1xuICAgIHRoaXMuY3R4LnJlZnJlc2ggPSAoKSA9PiB0aGlzLnJlbmRlclBhZ2UoKTtcbiAgICB0aGlzLmhhYml0VHJhY2tlck1vZHVsZSA9IG5ldyBIYWJpdFRyYWNrZXJNb2R1bGUodGhpcy5jdHgpO1xuICAgIHRoaXMudGFza3NNb2R1bGUgPSBuZXcgVGFza3NNb2R1bGUodGhpcy5jdHgpO1xuICAgIHRoaXMuZml0bmVzc01vZHVsZSA9IG5ldyBGaXRuZXNzTW9kdWxlKHRoaXMuY3R4KTtcbiAgICB0aGlzLm51dHJpdGlvbk1vZHVsZSA9IG5ldyBOdXRyaXRpb25Nb2R1bGUodGhpcy5jdHgpO1xuICAgIHRoaXMuc3R1ZGllc01vZHVsZSA9IG5ldyBTdHVkaWVzTW9kdWxlKHRoaXMuY3R4KTtcbiAgfVxuXG4gIGdldFZpZXdUeXBlKCk6IHN0cmluZyB7IHJldHVybiBWSUVXX1RZUEVfUEE7IH1cbiAgZ2V0RGlzcGxheVRleHQoKTogc3RyaW5nIHtcbiAgICBjb25zdCBwID0gUEFHRVMuZmluZCgoeCkgPT4geC5pZCA9PT0gdGhpcy5ob3N0LmN1cnJlbnRQYWdlKTtcbiAgICByZXR1cm4gcCA/IHAubGFiZWwucmVwbGFjZSgvXlxcUytcXHMvLCBcIlwiKSA6IFwiUGVyc29uYWwgQXNzaXN0YW50XCI7XG4gIH1cbiAgZ2V0SWNvbigpOiBzdHJpbmcgeyByZXR1cm4gXCJ0YXJnZXRcIjsgfVxuXG4gIGFzeW5jIG9uT3BlbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmN0eC5yZWxvYWRDb25maWcoKTtcbiAgICBjb25zdCByb290ID0gdGhpcy5jb250ZW50RWw7XG4gICAgcm9vdC5lbXB0eSgpO1xuICAgIHJvb3QuYWRkQ2xhc3MoXCJwYS1yb290XCIsIFwicGEtY29udGVudC1yb290XCIpO1xuICAgIHRoaXMubWFpbkVsID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtcGFnZVwiIH0pO1xuICAgIHRoaXMucmVuZGVyUGFnZSgpO1xuXG4gICAgY29uc3QgcmVmcmVzaCA9IGRlYm91bmNlKCgpID0+IHRoaXMucmVuZGVyUGFnZSgpLCA0MDAsIHRydWUpO1xuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJjaGFuZ2VkXCIsIChmaWxlKSA9PiB7XG4gICAgICAgIGlmIChmaWxlLnBhdGguc3RhcnRzV2l0aChEQVRBX1JPT1QgKyBcIi9cIikpIHJlZnJlc2goKTtcbiAgICAgIH0pXG4gICAgKTtcbiAgfVxuXG4gIGFzeW5jIG9uQ2xvc2UoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5maXRuZXNzTW9kdWxlLmRlc3Ryb3koKTtcbiAgfVxuXG4gIC8qKiBTd2l0Y2ggdGhlIGFjdGl2ZSBwYWdlIChjYWxsZWQgYnkgdGhlIG5hdiB2aWV3IHZpYSB0aGUgcGx1Z2luKS4gKi9cbiAgc2V0UGFnZShpZDogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKHRoaXMubWFpbkVsKSB0aGlzLnJlbmRlclBhZ2UoKTtcbiAgICAvLyBSZWZyZXNoIHRoZSB0YWIgdGl0bGUgdG8gcmVmbGVjdCB0aGUgY3VycmVudCBwYWdlLlxuICAgICh0aGlzLmxlYWYgYXMgdW5rbm93biBhcyB7IHVwZGF0ZUhlYWRlcj86ICgpID0+IHZvaWQgfSkudXBkYXRlSGVhZGVyPy4oKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyUGFnZSgpOiB2b2lkIHtcbiAgICBjb25zdCBtYWluID0gdGhpcy5tYWluRWw7XG4gICAgaWYgKCFtYWluKSByZXR1cm47XG4gICAgdGhpcy5maXRuZXNzTW9kdWxlLmRlc3Ryb3koKTtcbiAgICBtYWluLmVtcHR5KCk7XG5cbiAgICBzd2l0Y2ggKHRoaXMuaG9zdC5jdXJyZW50UGFnZSkge1xuICAgICAgY2FzZSBcImhhYml0LXRyYWNrZXJcIjogdGhpcy5oYWJpdFRyYWNrZXJNb2R1bGUucmVuZGVyKG1haW4pOyBicmVhaztcbiAgICAgIGNhc2UgXCJ0YXNrc1wiOiB0aGlzLnRhc2tzTW9kdWxlLnJlbmRlcihtYWluKTsgYnJlYWs7XG4gICAgICBjYXNlIFwiZml0bmVzc1wiOiB0aGlzLmZpdG5lc3NNb2R1bGUucmVuZGVyKG1haW4pOyBicmVhaztcbiAgICAgIGNhc2UgXCJudXRyaXRpb25cIjogdGhpcy5udXRyaXRpb25Nb2R1bGUucmVuZGVyKG1haW4pOyBicmVhaztcbiAgICAgIGNhc2UgXCJzdHVkaWVzXCI6IHRoaXMuc3R1ZGllc01vZHVsZS5yZW5kZXIobWFpbik7IGJyZWFrO1xuICAgICAgZGVmYXVsdDogdGhpcy5oYWJpdFRyYWNrZXJNb2R1bGUucmVuZGVyKG1haW4pO1xuICAgIH1cbiAgfVxufVxuIiwgImltcG9ydCB7IEFwcCB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHsgUEFEYXRhU3RvcmUgfSBmcm9tIFwiLi9kYXRhXCI7XG5pbXBvcnQgeyBQQUNvbmZpZywgZGVmYXVsdENvbmZpZyB9IGZyb20gXCIuL3R5cGVzXCI7XG5cbi8qKlxuICogU2hhcmVkIGNvbnRleHQgcGFzc2VkIHRvIGV2ZXJ5IG1vZHVsZSByZW5kZXJlci4gSG9sZHMgdGhlIGRhdGEgc3RvcmUsXG4gKiB0aGUgbG9hZGVkIGNvbmZpZywgYW5kIGEgY2FsbGJhY2sgdG8gcmUtcmVuZGVyIHRoZSBjdXJyZW50IHBhZ2UgYWZ0ZXJcbiAqIGEgZGF0YSBtdXRhdGlvbi5cbiAqL1xuZXhwb3J0IGNsYXNzIFBBQ29udGV4dCB7XG4gIGFwcDogQXBwO1xuICBzdG9yZTogUEFEYXRhU3RvcmU7XG4gIGNvbmZpZzogUEFDb25maWcgPSBkZWZhdWx0Q29uZmlnKCk7XG4gIC8qKiBSZS1yZW5kZXIgdGhlIGN1cnJlbnRseSBhY3RpdmUgcGFnZS4gU2V0IGJ5IHRoZSB2aWV3LiAqL1xuICByZWZyZXNoOiAoKSA9PiB2b2lkID0gKCkgPT4ge307XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHN0b3JlOiBQQURhdGFTdG9yZSkge1xuICAgIHRoaXMuYXBwID0gYXBwO1xuICAgIHRoaXMuc3RvcmUgPSBzdG9yZTtcbiAgfVxuXG4gIGFzeW5jIHJlbG9hZENvbmZpZygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmNvbmZpZyA9IGF3YWl0IHRoaXMuc3RvcmUubG9hZENvbmZpZygpO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgQXBwLCBNb2RhbCwgTm90aWNlLCBTZXR0aW5nIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiB0b2FzdChtc2c6IHN0cmluZyk6IHZvaWQge1xuICBuZXcgTm90aWNlKG1zZyk7XG59XG5cbi8qKiBPcGVuIGFuIGV4dGVybmFsIGxpbmsgb25seSBpZiBpdCdzIGEgc2FmZSBodHRwKHMpIFVSTCwgd2l0aCBub29wZW5lci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcGVuRXh0ZXJuYWwodXJsOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgdSA9ICh1cmwgfHwgXCJcIikudHJpbSgpO1xuICBpZiAoL15odHRwcz86XFwvXFwvL2kudGVzdCh1KSkge1xuICAgIHdpbmRvdy5vcGVuKHUsIFwiX2JsYW5rXCIsIFwibm9vcGVuZXIsbm9yZWZlcnJlclwiKTtcbiAgfSBlbHNlIHtcbiAgICBuZXcgTm90aWNlKFwiT25seSBodHRwKHMpIGxpbmtzIGNhbiBiZSBvcGVuZWQuXCIpO1xuICB9XG59XG5cbmV4cG9ydCB0eXBlIEZpZWxkVHlwZSA9IFwidGV4dFwiIHwgXCJ0ZXh0YXJlYVwiIHwgXCJudW1iZXJcIiB8IFwiZHJvcGRvd25cIiB8IFwidG9nZ2xlXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRmllbGRTcGVjIHtcbiAga2V5OiBzdHJpbmc7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIHR5cGU6IEZpZWxkVHlwZTtcbiAgdmFsdWU/OiBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuO1xuICBvcHRpb25zPzogQXJyYXk8eyB2YWx1ZTogc3RyaW5nOyBsYWJlbDogc3RyaW5nIH0+O1xuICBwbGFjZWhvbGRlcj86IHN0cmluZztcbn1cblxuLyoqIEdlbmVyaWMgZm9ybSBtb2RhbCB0aGF0IHJlc29sdmVzIHRvIGEgbWFwIG9mIGZpZWxkIHZhbHVlcyAob3IgbnVsbCBpZiBjYW5jZWxsZWQpLiAqL1xuZXhwb3J0IGNsYXNzIEZvcm1Nb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcHJpdmF0ZSBmaWVsZHM6IEZpZWxkU3BlY1tdO1xuICBwcml2YXRlIHRpdGxlOiBzdHJpbmc7XG4gIHByaXZhdGUgc3VibWl0TGFiZWw6IHN0cmluZztcbiAgcHJpdmF0ZSBvblN1Ym1pdDogKHZhbHVlczogUmVjb3JkPHN0cmluZywgc3RyaW5nPikgPT4gdm9pZDtcbiAgcHJpdmF0ZSB2YWx1ZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICB0aXRsZTogc3RyaW5nLFxuICAgIGZpZWxkczogRmllbGRTcGVjW10sXG4gICAgb25TdWJtaXQ6ICh2YWx1ZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pID0+IHZvaWQsXG4gICAgc3VibWl0TGFiZWwgPSBcIlNhdmVcIlxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMudGl0bGUgPSB0aXRsZTtcbiAgICB0aGlzLmZpZWxkcyA9IGZpZWxkcztcbiAgICB0aGlzLm9uU3VibWl0ID0gb25TdWJtaXQ7XG4gICAgdGhpcy5zdWJtaXRMYWJlbCA9IHN1Ym1pdExhYmVsO1xuICAgIGZpZWxkcy5mb3JFYWNoKChmKSA9PiB7IHRoaXMudmFsdWVzW2Yua2V5XSA9IGYudmFsdWUgPT0gbnVsbCA/IFwiXCIgOiBTdHJpbmcoZi52YWx1ZSk7IH0pO1xuICB9XG5cbiAgb25PcGVuKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogdGhpcy50aXRsZSB9KTtcblxuICAgIHRoaXMuZmllbGRzLmZvckVhY2goKGYpID0+IHtcbiAgICAgIGNvbnN0IHNldHRpbmcgPSBuZXcgU2V0dGluZyhjb250ZW50RWwpLnNldE5hbWUoZi5sYWJlbCk7XG4gICAgICBzd2l0Y2ggKGYudHlwZSkge1xuICAgICAgICBjYXNlIFwidGV4dGFyZWFcIjpcbiAgICAgICAgICBzZXR0aW5nLmFkZFRleHRBcmVhKCh0KSA9PiB7XG4gICAgICAgICAgICB0LnNldFZhbHVlKHRoaXMudmFsdWVzW2Yua2V5XSkub25DaGFuZ2UoKHYpID0+ICh0aGlzLnZhbHVlc1tmLmtleV0gPSB2KSk7XG4gICAgICAgICAgICBpZiAoZi5wbGFjZWhvbGRlcikgdC5zZXRQbGFjZWhvbGRlcihmLnBsYWNlaG9sZGVyKTtcbiAgICAgICAgICAgIHQuaW5wdXRFbC5yb3dzID0gNDtcbiAgICAgICAgICAgIHQuaW5wdXRFbC5zdHlsZS53aWR0aCA9IFwiMTAwJVwiO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwibnVtYmVyXCI6XG4gICAgICAgICAgc2V0dGluZy5hZGRUZXh0KCh0KSA9PiB7XG4gICAgICAgICAgICB0LmlucHV0RWwudHlwZSA9IFwibnVtYmVyXCI7XG4gICAgICAgICAgICB0LnNldFZhbHVlKHRoaXMudmFsdWVzW2Yua2V5XSkub25DaGFuZ2UoKHYpID0+ICh0aGlzLnZhbHVlc1tmLmtleV0gPSB2KSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgXCJkcm9wZG93blwiOlxuICAgICAgICAgIHNldHRpbmcuYWRkRHJvcGRvd24oKGQpID0+IHtcbiAgICAgICAgICAgIChmLm9wdGlvbnMgfHwgW10pLmZvckVhY2goKG8pID0+IGQuYWRkT3B0aW9uKG8udmFsdWUsIG8ubGFiZWwpKTtcbiAgICAgICAgICAgIGQuc2V0VmFsdWUodGhpcy52YWx1ZXNbZi5rZXldIHx8IChmLm9wdGlvbnM/LlswXT8udmFsdWUgPz8gXCJcIikpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZSgodikgPT4gKHRoaXMudmFsdWVzW2Yua2V5XSA9IHYpKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcInRvZ2dsZVwiOlxuICAgICAgICAgIHNldHRpbmcuYWRkVG9nZ2xlKCh0ZykgPT4ge1xuICAgICAgICAgICAgdGcuc2V0VmFsdWUodGhpcy52YWx1ZXNbZi5rZXldID09PSBcInRydWVcIikub25DaGFuZ2UoKHYpID0+ICh0aGlzLnZhbHVlc1tmLmtleV0gPSBTdHJpbmcodikpKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICBzZXR0aW5nLmFkZFRleHQoKHQpID0+IHtcbiAgICAgICAgICAgIHQuc2V0VmFsdWUodGhpcy52YWx1ZXNbZi5rZXldKS5vbkNoYW5nZSgodikgPT4gKHRoaXMudmFsdWVzW2Yua2V5XSA9IHYpKTtcbiAgICAgICAgICAgIGlmIChmLnBsYWNlaG9sZGVyKSB0LnNldFBsYWNlaG9sZGVyKGYucGxhY2Vob2xkZXIpO1xuICAgICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLmFkZEJ1dHRvbigoYikgPT4gYi5zZXRCdXR0b25UZXh0KFwiQ2FuY2VsXCIpLm9uQ2xpY2soKCkgPT4gdGhpcy5jbG9zZSgpKSlcbiAgICAgIC5hZGRCdXR0b24oKGIpID0+XG4gICAgICAgIGIuc2V0QnV0dG9uVGV4dCh0aGlzLnN1Ym1pdExhYmVsKS5zZXRDdGEoKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICB0aGlzLm9uU3VibWl0KHRoaXMudmFsdWVzKTtcbiAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICB9XG5cbiAgb25DbG9zZSgpOiB2b2lkIHsgdGhpcy5jb250ZW50RWwuZW1wdHkoKTsgfVxufVxuXG4vKiogU2ltcGxlIHllcy9ubyBjb25maXJtYXRpb24gbW9kYWwuICovXG5leHBvcnQgY2xhc3MgQ29uZmlybU1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBwcml2YXRlIG1lc3NhZ2U6IHN0cmluZztcbiAgcHJpdmF0ZSBvbkNvbmZpcm06ICgpID0+IHZvaWQ7XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIG1lc3NhZ2U6IHN0cmluZywgb25Db25maXJtOiAoKSA9PiB2b2lkKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLm1lc3NhZ2UgPSBtZXNzYWdlO1xuICAgIHRoaXMub25Db25maXJtID0gb25Db25maXJtO1xuICB9XG5cbiAgb25PcGVuKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0OiB0aGlzLm1lc3NhZ2UgfSk7XG4gICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgLmFkZEJ1dHRvbigoYikgPT4gYi5zZXRCdXR0b25UZXh0KFwiQ2FuY2VsXCIpLm9uQ2xpY2soKCkgPT4gdGhpcy5jbG9zZSgpKSlcbiAgICAgIC5hZGRCdXR0b24oKGIpID0+XG4gICAgICAgIGIuc2V0QnV0dG9uVGV4dChcIkNvbmZpcm1cIikuc2V0V2FybmluZygpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgIHRoaXMub25Db25maXJtKCk7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICB9KVxuICAgICAgKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKTogdm9pZCB7IHRoaXMuY29udGVudEVsLmVtcHR5KCk7IH1cbn1cbiIsICIvLyBMaWdodHdlaWdodCBpbmxpbmUtU1ZHIGNoYXJ0cy4gTm8gZXh0ZXJuYWwgZGVwZW5kZW5jaWVzLCB0aGVtZS1hd2FyZS5cblxuY29uc3QgU1ZHX05TID0gXCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiO1xuXG5mdW5jdGlvbiBzdmdFbDxLIGV4dGVuZHMga2V5b2YgU1ZHRWxlbWVudFRhZ05hbWVNYXA+KFxuICB0YWc6IEssXG4gIGF0dHJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+XG4pOiBTVkdFbGVtZW50VGFnTmFtZU1hcFtLXSB7XG4gIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudE5TKFNWR19OUywgdGFnKTtcbiAgZm9yIChjb25zdCBrIG9mIE9iamVjdC5rZXlzKGF0dHJzKSkgZWwuc2V0QXR0cmlidXRlKGssIFN0cmluZyhhdHRyc1trXSkpO1xuICByZXR1cm4gZWw7XG59XG5cbi8qKiBBIGNpcmN1bGFyIHByb2dyZXNzIHJpbmcgd2l0aCBhIGNlbnRlcmVkIHBlcmNlbnRhZ2UgYW5kIGFuIG9wdGlvbmFsIGxhYmVsLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRyYXdSaW5nKFxuICBwYXJlbnQ6IEhUTUxFbGVtZW50LFxuICBwZXJjZW50OiBudW1iZXIsXG4gIGNvbG9yOiBzdHJpbmcsXG4gIGxhYmVsPzogc3RyaW5nLFxuICBzaXplID0gNjZcbik6IHZvaWQge1xuICBjb25zdCB3cmFwID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJwYS1yaW5nXCIgfSk7XG4gIGNvbnN0IHIgPSAoc2l6ZSAtIDEwKSAvIDI7XG4gIGNvbnN0IGN4ID0gc2l6ZSAvIDI7XG4gIGNvbnN0IGNpcmMgPSAyICogTWF0aC5QSSAqIHI7XG4gIGNvbnN0IHBjdCA9IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgcGVyY2VudCkpO1xuICBjb25zdCBvZmZzZXQgPSBjaXJjICogKDEgLSBwY3QgLyAxMDApO1xuXG4gIGNvbnN0IHN2ZyA9IHN2Z0VsKFwic3ZnXCIsIHsgd2lkdGg6IHNpemUsIGhlaWdodDogc2l6ZSwgdmlld0JveDogYDAgMCAke3NpemV9ICR7c2l6ZX1gIH0pO1xuICBzdmcuYXBwZW5kQ2hpbGQoc3ZnRWwoXCJjaXJjbGVcIiwge1xuICAgIGN4LCBjeTogY3gsIHIsIGZpbGw6IFwibm9uZVwiLCBzdHJva2U6IFwidmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXIpXCIsIFwic3Ryb2tlLXdpZHRoXCI6IDcsXG4gIH0pKTtcbiAgY29uc3QgYXJjID0gc3ZnRWwoXCJjaXJjbGVcIiwge1xuICAgIGN4LCBjeTogY3gsIHIsIGZpbGw6IFwibm9uZVwiLCBzdHJva2U6IGNvbG9yLCBcInN0cm9rZS13aWR0aFwiOiA3LCBcInN0cm9rZS1saW5lY2FwXCI6IFwicm91bmRcIixcbiAgICBcInN0cm9rZS1kYXNoYXJyYXlcIjogY2lyYywgXCJzdHJva2UtZGFzaG9mZnNldFwiOiBvZmZzZXQsXG4gICAgdHJhbnNmb3JtOiBgcm90YXRlKC05MCAke2N4fSAke2N4fSlgLFxuICB9KTtcbiAgc3ZnLmFwcGVuZENoaWxkKGFyYyk7XG4gIGNvbnN0IHRleHQgPSBzdmdFbChcInRleHRcIiwge1xuICAgIHg6IGN4LCB5OiBjeCwgXCJ0ZXh0LWFuY2hvclwiOiBcIm1pZGRsZVwiLCBcImRvbWluYW50LWJhc2VsaW5lXCI6IFwiY2VudHJhbFwiLFxuICAgIFwiZm9udC1zaXplXCI6IDE0LCBcImZvbnQtd2VpZ2h0XCI6IDcwMCwgZmlsbDogXCJ2YXIoLS10ZXh0LW5vcm1hbClcIixcbiAgfSk7XG4gIHRleHQudGV4dENvbnRlbnQgPSBwY3QgKyBcIiVcIjtcbiAgc3ZnLmFwcGVuZENoaWxkKHRleHQpO1xuICB3cmFwLmFwcGVuZENoaWxkKHN2Zyk7XG4gIGlmIChsYWJlbCkgd3JhcC5jcmVhdGVEaXYoeyB0ZXh0OiBsYWJlbCwgY2xzOiBcInBhLXJpbmctbGFiZWxcIiB9KTtcbn1cblxuLyoqIEEgc2ltcGxlIHZlcnRpY2FsIGJhciBjaGFydC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkcmF3QmFycyhcbiAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgZGF0YTogQXJyYXk8eyBsYWJlbDogc3RyaW5nOyB2YWx1ZTogbnVtYmVyIH0+LFxuICBtYXg6IG51bWJlcixcbiAgY29sb3I6IHN0cmluZyxcbiAgaGVpZ2h0ID0gMTIwXG4pOiB2b2lkIHtcbiAgY29uc3Qgd3JhcCA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtYmFyc1wiIH0pO1xuICBjb25zdCB3ID0gTWF0aC5tYXgoZGF0YS5sZW5ndGggKiA0NCwgMTIwKTtcbiAgY29uc3QgYmFyVyA9IDI2O1xuICBjb25zdCBnYXAgPSAodyAtIGRhdGEubGVuZ3RoICogYmFyVykgLyAoZGF0YS5sZW5ndGggKyAxKTtcbiAgY29uc3QgdG9wID0gODtcbiAgY29uc3QgY2hhcnRIID0gaGVpZ2h0IC0gMjQ7XG4gIGNvbnN0IHN2ZyA9IHN2Z0VsKFwic3ZnXCIsIHsgd2lkdGg6IFwiMTAwJVwiLCBoZWlnaHQsIHZpZXdCb3g6IGAwIDAgJHt3fSAke2hlaWdodH1gIH0pO1xuICBzdmcuc2V0QXR0cmlidXRlKFwicHJlc2VydmVBc3BlY3RSYXRpb1wiLCBcIm5vbmVcIik7XG5cbiAgZGF0YS5mb3JFYWNoKChkLCBpKSA9PiB7XG4gICAgY29uc3QgeCA9IGdhcCArIGkgKiAoYmFyVyArIGdhcCk7XG4gICAgY29uc3QgaCA9IG1heCA+IDAgPyBNYXRoLnJvdW5kKChkLnZhbHVlIC8gbWF4KSAqIGNoYXJ0SCkgOiAwO1xuICAgIGNvbnN0IHkgPSB0b3AgKyAoY2hhcnRIIC0gaCk7XG4gICAgc3ZnLmFwcGVuZENoaWxkKHN2Z0VsKFwicmVjdFwiLCB7IHgsIHksIHdpZHRoOiBiYXJXLCBoZWlnaHQ6IGgsIHJ4OiA0LCBmaWxsOiBjb2xvciB9KSk7XG4gICAgY29uc3QgdmFsID0gc3ZnRWwoXCJ0ZXh0XCIsIHsgeDogeCArIGJhclcgLyAyLCB5OiB5IC0gMywgXCJ0ZXh0LWFuY2hvclwiOiBcIm1pZGRsZVwiLCBcImZvbnQtc2l6ZVwiOiA5LCBmaWxsOiBcInZhcigtLXRleHQtbXV0ZWQpXCIgfSk7XG4gICAgdmFsLnRleHRDb250ZW50ID0gU3RyaW5nKGQudmFsdWUpO1xuICAgIHN2Zy5hcHBlbmRDaGlsZCh2YWwpO1xuICAgIGNvbnN0IGxhYiA9IHN2Z0VsKFwidGV4dFwiLCB7IHg6IHggKyBiYXJXIC8gMiwgeTogaGVpZ2h0IC0gNCwgXCJ0ZXh0LWFuY2hvclwiOiBcIm1pZGRsZVwiLCBcImZvbnQtc2l6ZVwiOiA5LCBmaWxsOiBcInZhcigtLXRleHQtbXV0ZWQpXCIgfSk7XG4gICAgbGFiLnRleHRDb250ZW50ID0gZC5sYWJlbDtcbiAgICBzdmcuYXBwZW5kQ2hpbGQobGFiKTtcbiAgfSk7XG4gIHdyYXAuYXBwZW5kQ2hpbGQoc3ZnKTtcbn1cblxuLyoqIEEgbXVsdGktc2VnbWVudCBkb251dCBjaGFydCB3aXRoIGEgY2VudGVyZWQgdG90YWwgYW5kIGEgbGVnZW5kLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRyYXdEb251dChcbiAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgc2VnbWVudHM6IEFycmF5PHsgbGFiZWw6IHN0cmluZzsgdmFsdWU6IG51bWJlcjsgY29sb3I6IHN0cmluZyB9PixcbiAgc2l6ZSA9IDE1MFxuKTogdm9pZCB7XG4gIGNvbnN0IHdyYXAgPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWRvbnV0LXdyYXBcIiB9KTtcbiAgY29uc3QgdG90YWwgPSBzZWdtZW50cy5yZWR1Y2UoKGEsIHMpID0+IGEgKyBzLnZhbHVlLCAwKTtcbiAgY29uc3QgciA9IChzaXplIC0gMjIpIC8gMjtcbiAgY29uc3QgY3ggPSBzaXplIC8gMjtcbiAgY29uc3QgY2lyYyA9IDIgKiBNYXRoLlBJICogcjtcblxuICBjb25zdCBzdmcgPSBzdmdFbChcInN2Z1wiLCB7IHdpZHRoOiBzaXplLCBoZWlnaHQ6IHNpemUsIHZpZXdCb3g6IGAwIDAgJHtzaXplfSAke3NpemV9YCB9KTtcbiAgaWYgKCF0b3RhbCkge1xuICAgIHN2Zy5hcHBlbmRDaGlsZChzdmdFbChcImNpcmNsZVwiLCB7IGN4LCBjeTogY3gsIHIsIGZpbGw6IFwibm9uZVwiLCBzdHJva2U6IFwidmFyKC0tYmFja2dyb3VuZC1tb2RpZmllci1ib3JkZXIpXCIsIFwic3Ryb2tlLXdpZHRoXCI6IDE2IH0pKTtcbiAgfSBlbHNlIHtcbiAgICBsZXQgY3VtdWxhdGl2ZSA9IDA7XG4gICAgc2VnbWVudHMuZm9yRWFjaCgocykgPT4ge1xuICAgICAgaWYgKHMudmFsdWUgPD0gMCkgcmV0dXJuO1xuICAgICAgY29uc3Qgc2VnTGVuID0gKHMudmFsdWUgLyB0b3RhbCkgKiBjaXJjO1xuICAgICAgY29uc3QgYXJjID0gc3ZnRWwoXCJjaXJjbGVcIiwge1xuICAgICAgICBjeCwgY3k6IGN4LCByLCBmaWxsOiBcIm5vbmVcIiwgc3Ryb2tlOiBzLmNvbG9yLCBcInN0cm9rZS13aWR0aFwiOiAxNixcbiAgICAgICAgXCJzdHJva2UtZGFzaGFycmF5XCI6IGAke3NlZ0xlbn0gJHtjaXJjIC0gc2VnTGVufWAsXG4gICAgICAgIFwic3Ryb2tlLWRhc2hvZmZzZXRcIjogLWN1bXVsYXRpdmUsXG4gICAgICAgIHRyYW5zZm9ybTogYHJvdGF0ZSgtOTAgJHtjeH0gJHtjeH0pYCxcbiAgICAgIH0pO1xuICAgICAgc3ZnLmFwcGVuZENoaWxkKGFyYyk7XG4gICAgICBjdW11bGF0aXZlICs9IHNlZ0xlbjtcbiAgICB9KTtcbiAgfVxuICBjb25zdCB0b3RhbFRleHQgPSBzdmdFbChcInRleHRcIiwgeyB4OiBjeCwgeTogY3ggLSA0LCBcInRleHQtYW5jaG9yXCI6IFwibWlkZGxlXCIsIFwiZG9taW5hbnQtYmFzZWxpbmVcIjogXCJjZW50cmFsXCIsIFwiZm9udC1zaXplXCI6IDIyLCBcImZvbnQtd2VpZ2h0XCI6IDcwMCwgZmlsbDogXCJ2YXIoLS10ZXh0LW5vcm1hbClcIiB9KTtcbiAgdG90YWxUZXh0LnRleHRDb250ZW50ID0gU3RyaW5nKHRvdGFsKTtcbiAgc3ZnLmFwcGVuZENoaWxkKHRvdGFsVGV4dCk7XG4gIGNvbnN0IGxhYmVsVGV4dCA9IHN2Z0VsKFwidGV4dFwiLCB7IHg6IGN4LCB5OiBjeCArIDE0LCBcInRleHQtYW5jaG9yXCI6IFwibWlkZGxlXCIsIFwiZG9taW5hbnQtYmFzZWxpbmVcIjogXCJjZW50cmFsXCIsIFwiZm9udC1zaXplXCI6IDEwLCBmaWxsOiBcInZhcigtLXRleHQtbXV0ZWQpXCIgfSk7XG4gIGxhYmVsVGV4dC50ZXh0Q29udGVudCA9IFwiVG90YWxcIjtcbiAgc3ZnLmFwcGVuZENoaWxkKGxhYmVsVGV4dCk7XG4gIHdyYXAuYXBwZW5kQ2hpbGQoc3ZnKTtcblxuICBjb25zdCBsZWdlbmQgPSB3cmFwLmNyZWF0ZURpdih7IGNsczogXCJwYS1kb251dC1sZWdlbmRcIiB9KTtcbiAgc2VnbWVudHMuZmlsdGVyKChzKSA9PiBzLnZhbHVlID4gMCkuZm9yRWFjaCgocykgPT4ge1xuICAgIGNvbnN0IGl0ZW0gPSBsZWdlbmQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWxlZ2VuZC1pdGVtXCIgfSk7XG4gICAgY29uc3QgZG90ID0gaXRlbS5jcmVhdGVTcGFuKHsgY2xzOiBcInBhLWxlZ2VuZC1kb3RcIiB9KTtcbiAgICBkb3Quc3R5bGUuYmFja2dyb3VuZCA9IHMuY29sb3I7XG4gICAgaXRlbS5jcmVhdGVTcGFuKHsgdGV4dDogYCR7cy5sYWJlbH0gKCR7cy52YWx1ZX0pYCB9KTtcbiAgfSk7XG59XG5cbi8qKiBBIGxpbmUgc3BhcmtsaW5lIGZvciBhIHNlcmllcyBvZiBudW1lcmljIHZhbHVlcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkcmF3U3BhcmtsaW5lKFxuICBwYXJlbnQ6IEhUTUxFbGVtZW50LFxuICB2YWx1ZXM6IG51bWJlcltdLFxuICBjb2xvcjogc3RyaW5nLFxuICBoZWlnaHQgPSA4MFxuKTogdm9pZCB7XG4gIGNvbnN0IHdyYXAgPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXNwYXJrXCIgfSk7XG4gIGlmICh2YWx1ZXMubGVuZ3RoIDwgMikge1xuICAgIHdyYXAuY3JlYXRlRGl2KHsgY2xzOiBcInBhLW11dGVkXCIsIHRleHQ6IFwiTm90IGVub3VnaCBkYXRhIHlldC5cIiB9KTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdyA9IDI4MDtcbiAgY29uc3QgcGFkID0gODtcbiAgY29uc3QgbWluID0gTWF0aC5taW4oLi4udmFsdWVzKTtcbiAgY29uc3QgbWF4ID0gTWF0aC5tYXgoLi4udmFsdWVzKTtcbiAgY29uc3QgcmFuZ2UgPSBtYXggLSBtaW4gfHwgMTtcbiAgY29uc3Qgc3RlcCA9ICh3IC0gcGFkICogMikgLyAodmFsdWVzLmxlbmd0aCAtIDEpO1xuICBjb25zdCBwb2ludHMgPSB2YWx1ZXMubWFwKCh2LCBpKSA9PiB7XG4gICAgY29uc3QgeCA9IHBhZCArIGkgKiBzdGVwO1xuICAgIGNvbnN0IHkgPSBwYWQgKyAoaGVpZ2h0IC0gcGFkICogMikgKiAoMSAtICh2IC0gbWluKSAvIHJhbmdlKTtcbiAgICByZXR1cm4gYCR7eC50b0ZpeGVkKDEpfSwke3kudG9GaXhlZCgxKX1gO1xuICB9KTtcbiAgY29uc3Qgc3ZnID0gc3ZnRWwoXCJzdmdcIiwgeyB3aWR0aDogXCIxMDAlXCIsIGhlaWdodCwgdmlld0JveDogYDAgMCAke3d9ICR7aGVpZ2h0fWAgfSk7XG4gIHN2Zy5zZXRBdHRyaWJ1dGUoXCJwcmVzZXJ2ZUFzcGVjdFJhdGlvXCIsIFwibm9uZVwiKTtcbiAgY29uc3QgcG9seSA9IHN2Z0VsKFwicG9seWxpbmVcIiwgeyBmaWxsOiBcIm5vbmVcIiwgc3Ryb2tlOiBjb2xvciwgXCJzdHJva2Utd2lkdGhcIjogMiwgcG9pbnRzOiBwb2ludHMuam9pbihcIiBcIikgfSk7XG4gIHN2Zy5hcHBlbmRDaGlsZChwb2x5KTtcbiAgdmFsdWVzLmZvckVhY2goKHYsIGkpID0+IHtcbiAgICBjb25zdCBbeCwgeV0gPSBwb2ludHNbaV0uc3BsaXQoXCIsXCIpO1xuICAgIHN2Zy5hcHBlbmRDaGlsZChzdmdFbChcImNpcmNsZVwiLCB7IGN4OiB4LCBjeTogeSwgcjogMi41LCBmaWxsOiBjb2xvciB9KSk7XG4gIH0pO1xuICB3cmFwLmFwcGVuZENoaWxkKHN2Zyk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTGluZVNlcmllcyB7XG4gIG5hbWU6IHN0cmluZztcbiAgY29sb3I6IHN0cmluZztcbiAgdmFsdWVzOiBBcnJheTxudW1iZXIgfCBudWxsPjtcbn1cblxuLyoqIEEgbXVsdGktc2VyaWVzIGxpbmUgY2hhcnQgd2l0aCBheGlzIGxhYmVscywgYW4gb3B0aW9uYWwgZGFzaGVkIGdvYWwgbGluZSBhbmQgYSBsZWdlbmQuICovXG5leHBvcnQgZnVuY3Rpb24gZHJhd0xpbmVDaGFydChcbiAgcGFyZW50OiBIVE1MRWxlbWVudCxcbiAgbGFiZWxzOiBzdHJpbmdbXSxcbiAgc2VyaWVzOiBMaW5lU2VyaWVzW10sXG4gIG9wdHM6IHsgZ29hbD86IG51bWJlcjsgZ29hbENvbG9yPzogc3RyaW5nOyBoZWlnaHQ/OiBudW1iZXIgfSA9IHt9XG4pOiB2b2lkIHtcbiAgY29uc3Qgd3JhcCA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtbGluZWNoYXJ0XCIgfSk7XG4gIGNvbnN0IGhlaWdodCA9IG9wdHMuaGVpZ2h0ID8/IDIyMDtcbiAgaWYgKCFsYWJlbHMubGVuZ3RoIHx8ICFzZXJpZXMubGVuZ3RoKSB7XG4gICAgd3JhcC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtbXV0ZWRcIiwgdGV4dDogXCJOb3QgZW5vdWdoIGRhdGEgeWV0LlwiIH0pO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB3ID0gNTIwO1xuICBjb25zdCBwYWRMID0gMzQ7XG4gIGNvbnN0IHBhZFIgPSAxMDtcbiAgY29uc3QgcGFkVCA9IDEwO1xuICBjb25zdCBwYWRCID0gMjY7XG5cbiAgbGV0IG1heCA9IG9wdHMuZ29hbCA/PyAwO1xuICBsZXQgbWluID0gSW5maW5pdHk7XG4gIHNlcmllcy5mb3JFYWNoKChzKSA9PiBzLnZhbHVlcy5mb3JFYWNoKCh2KSA9PiB7IGlmICh2ICE9IG51bGwpIHsgaWYgKHYgPiBtYXgpIG1heCA9IHY7IGlmICh2IDwgbWluKSBtaW4gPSB2OyB9IH0pKTtcbiAgaWYgKCFpc0Zpbml0ZShtaW4pKSBtaW4gPSAwO1xuICBtaW4gPSBNYXRoLm1pbihtaW4sIDApO1xuICBpZiAobWF4IDw9IG1pbikgbWF4ID0gbWluICsgMTtcblxuICBjb25zdCBwbG90VyA9IHcgLSBwYWRMIC0gcGFkUjtcbiAgY29uc3QgcGxvdEggPSBoZWlnaHQgLSBwYWRUIC0gcGFkQjtcbiAgY29uc3QgeEF0ID0gKGk6IG51bWJlcikgPT4gcGFkTCArIChsYWJlbHMubGVuZ3RoID09PSAxID8gcGxvdFcgLyAyIDogKGkgLyAobGFiZWxzLmxlbmd0aCAtIDEpKSAqIHBsb3RXKTtcbiAgY29uc3QgeUF0ID0gKHY6IG51bWJlcikgPT4gcGFkVCArIHBsb3RIICogKDEgLSAodiAtIG1pbikgLyAobWF4IC0gbWluKSk7XG5cbiAgY29uc3Qgc3ZnID0gc3ZnRWwoXCJzdmdcIiwgeyB3aWR0aDogXCIxMDAlXCIsIGhlaWdodCwgdmlld0JveDogYDAgMCAke3d9ICR7aGVpZ2h0fWAgfSk7XG5cbiAgLy8gWSBncmlkbGluZXMgKyBsYWJlbHMgKDQgc3RlcHMpXG4gIGZvciAobGV0IGcgPSAwOyBnIDw9IDQ7IGcrKykge1xuICAgIGNvbnN0IHZhbCA9IG1pbiArICgobWF4IC0gbWluKSAqIGcpIC8gNDtcbiAgICBjb25zdCB5ID0geUF0KHZhbCk7XG4gICAgc3ZnLmFwcGVuZENoaWxkKHN2Z0VsKFwibGluZVwiLCB7IHgxOiBwYWRMLCB5MTogeSwgeDI6IHcgLSBwYWRSLCB5MjogeSwgc3Ryb2tlOiBcInZhcigtLWJhY2tncm91bmQtbW9kaWZpZXItYm9yZGVyKVwiLCBcInN0cm9rZS13aWR0aFwiOiAxIH0pKTtcbiAgICBjb25zdCBsYWIgPSBzdmdFbChcInRleHRcIiwgeyB4OiBwYWRMIC0gNCwgeSwgXCJ0ZXh0LWFuY2hvclwiOiBcImVuZFwiLCBcImRvbWluYW50LWJhc2VsaW5lXCI6IFwiY2VudHJhbFwiLCBcImZvbnQtc2l6ZVwiOiA5LCBmaWxsOiBcInZhcigtLXRleHQtbXV0ZWQpXCIgfSk7XG4gICAgbGFiLnRleHRDb250ZW50ID0gU3RyaW5nKE1hdGgucm91bmQodmFsKSk7XG4gICAgc3ZnLmFwcGVuZENoaWxkKGxhYik7XG4gIH1cblxuICAvLyBHb2FsIGxpbmVcbiAgaWYgKG9wdHMuZ29hbCAhPSBudWxsKSB7XG4gICAgY29uc3QgeSA9IHlBdChvcHRzLmdvYWwpO1xuICAgIHN2Zy5hcHBlbmRDaGlsZChzdmdFbChcImxpbmVcIiwgeyB4MTogcGFkTCwgeTE6IHksIHgyOiB3IC0gcGFkUiwgeTI6IHksIHN0cm9rZTogb3B0cy5nb2FsQ29sb3IgfHwgXCIjZGMyNjI2XCIsIFwic3Ryb2tlLXdpZHRoXCI6IDEuNSwgXCJzdHJva2UtZGFzaGFycmF5XCI6IFwiNSA0XCIgfSkpO1xuICB9XG5cbiAgLy8gWCBsYWJlbHNcbiAgbGFiZWxzLmZvckVhY2goKGxhYiwgaSkgPT4ge1xuICAgIGNvbnN0IHQgPSBzdmdFbChcInRleHRcIiwgeyB4OiB4QXQoaSksIHk6IGhlaWdodCAtIDgsIFwidGV4dC1hbmNob3JcIjogXCJtaWRkbGVcIiwgXCJmb250LXNpemVcIjogOSwgZmlsbDogXCJ2YXIoLS10ZXh0LW11dGVkKVwiIH0pO1xuICAgIHQudGV4dENvbnRlbnQgPSBsYWI7XG4gICAgc3ZnLmFwcGVuZENoaWxkKHQpO1xuICB9KTtcblxuICAvLyBTZXJpZXNcbiAgc2VyaWVzLmZvckVhY2goKHMpID0+IHtcbiAgICBjb25zdCBwdHM6IHN0cmluZ1tdID0gW107XG4gICAgcy52YWx1ZXMuZm9yRWFjaCgodiwgaSkgPT4geyBpZiAodiAhPSBudWxsKSBwdHMucHVzaChgJHt4QXQoaSkudG9GaXhlZCgxKX0sJHt5QXQodikudG9GaXhlZCgxKX1gKTsgfSk7XG4gICAgaWYgKHB0cy5sZW5ndGgpIHtcbiAgICAgIHN2Zy5hcHBlbmRDaGlsZChzdmdFbChcInBvbHlsaW5lXCIsIHsgZmlsbDogXCJub25lXCIsIHN0cm9rZTogcy5jb2xvciwgXCJzdHJva2Utd2lkdGhcIjogMiwgcG9pbnRzOiBwdHMuam9pbihcIiBcIikgfSkpO1xuICAgICAgcy52YWx1ZXMuZm9yRWFjaCgodiwgaSkgPT4geyBpZiAodiAhPSBudWxsKSBzdmcuYXBwZW5kQ2hpbGQoc3ZnRWwoXCJjaXJjbGVcIiwgeyBjeDogeEF0KGkpLCBjeTogeUF0KHYpLCByOiAyLjUsIGZpbGw6IHMuY29sb3IgfSkpOyB9KTtcbiAgICB9XG4gIH0pO1xuXG4gIHdyYXAuYXBwZW5kQ2hpbGQoc3ZnKTtcblxuICBpZiAoc2VyaWVzLmxlbmd0aCA+IDEgfHwgc2VyaWVzWzBdPy5uYW1lKSB7XG4gICAgY29uc3QgbGVnZW5kID0gd3JhcC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtZG9udXQtbGVnZW5kXCIgfSk7XG4gICAgc2VyaWVzLmZvckVhY2goKHMpID0+IHtcbiAgICAgIGNvbnN0IGl0ZW0gPSBsZWdlbmQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWxlZ2VuZC1pdGVtXCIgfSk7XG4gICAgICBjb25zdCBkb3QgPSBpdGVtLmNyZWF0ZVNwYW4oeyBjbHM6IFwicGEtbGVnZW5kLWRvdFwiIH0pO1xuICAgICAgZG90LnN0eWxlLmJhY2tncm91bmQgPSBzLmNvbG9yO1xuICAgICAgaXRlbS5jcmVhdGVTcGFuKHsgdGV4dDogcy5uYW1lIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgUEFDb250ZXh0IH0gZnJvbSBcIi4uL2NvbnRleHRcIjtcbmltcG9ydCB7IEJvYXJkLCBIYWJpdCwgTWVhbExvZywgU3R1ZHlDYXJkLCBUYXNrLCBXb3Jrb3V0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5pbXBvcnQgeyBDb25maXJtTW9kYWwsIEZpZWxkU3BlYywgRm9ybU1vZGFsLCB0b2FzdCB9IGZyb20gXCIuLi91aVwiO1xuaW1wb3J0IHsgZGF5c0JldHdlZW4sIHRvZGF5TG9jYWwsIHltZCB9IGZyb20gXCIuLi91dGlsXCI7XG5pbXBvcnQgeyBkcmF3RG9udXQsIGRyYXdSaW5nIH0gZnJvbSBcIi4uL2NoYXJ0c1wiO1xuXG5jb25zdCBIRUFUTUFQX1dFRUtTID0gMTg7XG5jb25zdCBIRUFUTUFQX0RBWVMgPSBIRUFUTUFQX1dFRUtTICogNztcblxuaW50ZXJmYWNlIFN5c3RlbUhhYml0IHtcbiAgbGFiZWw6IHN0cmluZztcbiAgY29sb3I6IHN0cmluZztcbiAgZG9uZTogKGRzOiBzdHJpbmcpID0+IGJvb2xlYW47XG59XG5cbi8qKiBUaGUgZmlyc3QgdGFiOiBhbiBvdmVydmlldyBkYXNoYm9hcmQgZnVzZWQgd2l0aCB0aGUgaGFiaXQgaGVhdG1hcHMuICovXG5leHBvcnQgY2xhc3MgSGFiaXRUcmFja2VyTW9kdWxlIHtcbiAgcHJpdmF0ZSBjdHg6IFBBQ29udGV4dDtcbiAgY29uc3RydWN0b3IoY3R4OiBQQUNvbnRleHQpIHsgdGhpcy5jdHggPSBjdHg7IH1cblxuICByZW5kZXIocm9vdDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICByb290LmVtcHR5KCk7XG4gICAgY29uc3QgdG9kYXkgPSB0b2RheUxvY2FsKCk7XG4gICAgY29uc3QgY2ZnID0gdGhpcy5jdHguY29uZmlnO1xuXG4gICAgY29uc3QgdGFza3MgPSB0aGlzLmN0eC5zdG9yZS5sb2FkVGFza3MoKTtcbiAgICBjb25zdCBoYWJpdHMgPSB0aGlzLmN0eC5zdG9yZS5sb2FkSGFiaXRzKCk7XG4gICAgY29uc3Qgd29ya291dHMgPSB0aGlzLmN0eC5zdG9yZS5sb2FkV29ya291dHMoKTtcbiAgICBjb25zdCBzdHVkeUNhcmRzID0gdGhpcy5jdHguc3RvcmUubG9hZFN0dWR5Q2FyZHMoKTtcbiAgICBjb25zdCBtZWFsTG9ncyA9IHRoaXMuY3R4LnN0b3JlLmxvYWRNZWFsTG9ncygpO1xuICAgIGNvbnN0IHN0dWR5Qm9hcmRzID0gdGhpcy5jdHguc3RvcmUubG9hZFN0dWR5Qm9hcmRzKCk7XG5cbiAgICAvLyBEYXktaW5kZXhlZCBsb29rdXBzXG4gICAgY29uc3QgZ3ltID0gbmV3IFNldCh3b3Jrb3V0cy5tYXAoKHcpID0+IHcuZGF0ZSkpO1xuICAgIGNvbnN0IG1lYWxEYXlzID0gbmV3IFNldChtZWFsTG9ncy5tYXAoKG0pID0+IG0uZGF0ZSkpO1xuICAgIGNvbnN0IG1lYWxDYWwgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICAgIG1lYWxMb2dzLmZvckVhY2goKG0pID0+IG1lYWxDYWwuc2V0KG0uZGF0ZSwgKG1lYWxDYWwuZ2V0KG0uZGF0ZSkgfHwgMCkgKyBtLnRvdGFsQ2FsKSk7XG4gICAgY29uc3QgdGFza0RvbmUgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICB0YXNrcy5mb3JFYWNoKCh0KSA9PiB7IGlmICh0LnN0YXR1cyA9PT0gXCJkb25lXCIgJiYgdC5tb2RpZmllZCkgdGFza0RvbmUuYWRkKHQubW9kaWZpZWQuc3Vic3RyaW5nKDAsIDEwKSk7IH0pO1xuICAgIGNvbnN0IHN0dWR5RGF5cyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIHN0dWR5Q2FyZHMuZm9yRWFjaCgoYykgPT4geyBpZiAoYy5tb2RpZmllZCkgc3R1ZHlEYXlzLmFkZChjLm1vZGlmaWVkLnN1YnN0cmluZygwLCAxMCkpOyB9KTtcbiAgICBjb25zdCB3YXRlckxvZyA9IHRoaXMuY3R4LnN0b3JlLmxvYWRXYXRlckxvZygpO1xuICAgIGNvbnN0IHd0ID0gY2ZnLndhdGVyVGFyZ2V0IHx8IDIuNTtcbiAgICBjb25zdCBjYWxUYXJnZXQgPSBjZmcuY2Fsb3JpZVRhcmdldCB8fCAyMDAwO1xuXG4gICAgY29uc3Qgc3lzdGVtSGFiaXRzOiBTeXN0ZW1IYWJpdFtdID0gW1xuICAgICAgeyBsYWJlbDogXCJcdUQ4M0NcdURGQ0JcdUZFMEYgV29ya291dFwiLCBjb2xvcjogXCIjMTZhMzRhXCIsIGRvbmU6IChkcykgPT4gZ3ltLmhhcyhkcykgfSxcbiAgICAgIHsgbGFiZWw6IFwiXHVEODNFXHVERDU3IExvZ2dlZCBtZWFsXCIsIGNvbG9yOiBcIiNmNTllMGJcIiwgZG9uZTogKGRzKSA9PiBtZWFsRGF5cy5oYXMoZHMpIH0sXG4gICAgICB7IGxhYmVsOiBcIlx1RDgzRFx1RENBNyBXYXRlciBnb2FsXCIsIGNvbG9yOiBcIiMzYjgyZjZcIiwgZG9uZTogKGRzKSA9PiAod2F0ZXJMb2dbZHNdIHx8IDApID49IHd0IH0sXG4gICAgICB7IGxhYmVsOiBcIlx1RDgzQ1x1REZBRiBDYWxvcmllIGdvYWxcIiwgY29sb3I6IFwiIzEwYjk4MVwiLCBkb25lOiAoZHMpID0+IHsgY29uc3QgYyA9IG1lYWxDYWwuZ2V0KGRzKSB8fCAwOyByZXR1cm4gYyA+IDAgJiYgYyA8PSBjYWxUYXJnZXQ7IH0gfSxcbiAgICAgIHsgbGFiZWw6IFwiXHUyNzA1IENvbXBsZXRlZCB0YXNrXCIsIGNvbG9yOiBcIiM3YzNhZWRcIiwgZG9uZTogKGRzKSA9PiB0YXNrRG9uZS5oYXMoZHMpIH0sXG4gICAgICB7IGxhYmVsOiBcIlx1RDgzRFx1RENEQSBTdHVkaWVkXCIsIGNvbG9yOiBcIiNlYzQ4OTlcIiwgZG9uZTogKGRzKSA9PiBzdHVkeURheXMuaGFzKGRzKSB9LFxuICAgIF07XG5cbiAgICBjb25zdCBzY29yZUZvckRheSA9IChkczogc3RyaW5nKTogeyBkb25lOiBudW1iZXI7IHRvdGFsOiBudW1iZXIgfSA9PiB7XG4gICAgICBjb25zdCBjaGVja3MgPSBzeXN0ZW1IYWJpdHMubWFwKChoKSA9PiBoLmRvbmUoZHMpKTtcbiAgICAgIGhhYml0cy5mb3JFYWNoKChoKSA9PiB7XG4gICAgICAgIGlmIChoLmhhYml0VHlwZSA9PT0gXCJxdWl0XCIpIGNoZWNrcy5wdXNoKChoLmxhc3RSZXNldCB8fCBoLmNyZWF0ZWQgfHwgZHMpIDw9IGRzKTtcbiAgICAgICAgZWxzZSBjaGVja3MucHVzaCghIWgubG9nW2RzXSk7XG4gICAgICB9KTtcbiAgICAgIHJldHVybiB7IGRvbmU6IGNoZWNrcy5maWx0ZXIoQm9vbGVhbikubGVuZ3RoLCB0b3RhbDogY2hlY2tzLmxlbmd0aCB9O1xuICAgIH07XG5cbiAgICB0aGlzLnJlbmRlckhlYWRlcihyb290LCB0b2RheSwgc2NvcmVGb3JEYXkpO1xuICAgIHRoaXMucmVuZGVyS3Bpcyhyb290LCB7IHRhc2tzLCB3b3Jrb3V0cywgc3R1ZHlDYXJkcywgbWVhbENhbCwgZ3ltLCB0b2RheSwgd2F0ZXJUb2RheTogd2F0ZXJMb2dbdG9kYXldIHx8IDAgfSk7XG4gICAgdGhpcy5yZW5kZXJEb251dHMocm9vdCwgeyB3b3Jrb3V0cywgc3R1ZHlDYXJkcywgdGFza3MsIHRvZGF5IH0pO1xuICAgIHRoaXMucmVuZGVySGFiaXRDb25zaXN0ZW5jeShyb290LCBzeXN0ZW1IYWJpdHMsIGhhYml0cywgdG9kYXkpO1xuICAgIHRoaXMucmVuZGVyU3R1ZHlQcm9ncmVzcyhyb290LCBzdHVkeUJvYXJkcywgc3R1ZHlDYXJkcyk7XG4gIH1cblxuICAvLyAtLS0tIEhlYWRlcjogdGl0bGUgKyBncmVldGluZyArIDMgY29uc2lzdGVuY3kgcmluZ3MgLS0tLVxuICBwcml2YXRlIHJlbmRlckhlYWRlcihyb290OiBIVE1MRWxlbWVudCwgdG9kYXk6IHN0cmluZywgc2NvcmVGb3JEYXk6IChkczogc3RyaW5nKSA9PiB7IGRvbmU6IG51bWJlcjsgdG90YWw6IG51bWJlciB9KTogdm9pZCB7XG4gICAgY29uc3QgaGVhZCA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWh0LWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IGxlZnQgPSBoZWFkLmNyZWF0ZURpdigpO1xuICAgIGxlZnQuY3JlYXRlRGl2KHsgdGV4dDogXCJcdUQ4M0NcdURGQUYgSGFiaXQgVHJhY2tlclwiLCBjbHM6IFwicGEtaDFcIiB9KTtcbiAgICBjb25zdCBob3VyID0gbmV3IERhdGUoKS5nZXRIb3VycygpO1xuICAgIGNvbnN0IGdyZWV0aW5nID0gaG91ciA8IDEyID8gXCJHb29kIG1vcm5pbmdcIiA6IGhvdXIgPCAxOCA/IFwiR29vZCBhZnRlcm5vb25cIiA6IFwiR29vZCBldmVuaW5nXCI7XG4gICAgY29uc3QgZGF0ZVN0ciA9IG5ldyBEYXRlKCkudG9Mb2NhbGVEYXRlU3RyaW5nKFwiZGVmYXVsdFwiLCB7IHdlZWtkYXk6IFwibG9uZ1wiLCBkYXk6IFwibnVtZXJpY1wiLCBtb250aDogXCJzaG9ydFwiIH0pO1xuICAgIGxlZnQuY3JlYXRlRGl2KHsgdGV4dDogYCR7Z3JlZXRpbmd9LCBKYWltZSBcdTAwQjcgJHtkYXRlU3RyfWAsIGNsczogXCJwYS1tdXRlZFwiIH0pO1xuXG4gICAgY29uc3QgcmluZ3MgPSBoZWFkLmNyZWF0ZURpdih7IGNsczogXCJwYS1odC1yaW5nc1wiIH0pO1xuICAgIGNvbnN0IGRheU4gPSBbXCJTdW5cIiwgXCJNb25cIiwgXCJUdWVcIiwgXCJXZWRcIiwgXCJUaHVcIiwgXCJGcmlcIiwgXCJTYXRcIl07XG4gICAgY29uc3QgYmFzZSA9IG5ldyBEYXRlKHRvZGF5ICsgXCJUMDA6MDA6MDBcIik7XG4gICAgZm9yIChsZXQgaSA9IDI7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBkdCA9IG5ldyBEYXRlKGJhc2UpO1xuICAgICAgZHQuc2V0RGF0ZShkdC5nZXREYXRlKCkgLSBpKTtcbiAgICAgIGNvbnN0IGRzID0geW1kKGR0KTtcbiAgICAgIGNvbnN0IHMgPSBzY29yZUZvckRheShkcyk7XG4gICAgICBjb25zdCBwY3QgPSBzLnRvdGFsID8gTWF0aC5yb3VuZCgocy5kb25lIC8gcy50b3RhbCkgKiAxMDApIDogMDtcbiAgICAgIGNvbnN0IGNvbG9yID0gcGN0ID49IDcwID8gXCIjMTZhMzRhXCIgOiBwY3QgPj0gMzAgPyBcIiNkOTc3MDZcIiA6IFwiIzdjM2FlZFwiO1xuICAgICAgY29uc3QgbGFiZWwgPSBpID09PSAwID8gXCJUb2RheVwiIDogYCR7ZGF5TltkdC5nZXREYXkoKV19ICR7ZHQuZ2V0RGF0ZSgpfWA7XG4gICAgICBkcmF3UmluZyhyaW5ncywgcGN0LCBjb2xvciwgbGFiZWwsIDU4KTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tIEtQSSByb3cgLS0tLVxuICBwcml2YXRlIHJlbmRlcktwaXMoXG4gICAgcm9vdDogSFRNTEVsZW1lbnQsXG4gICAgZDogeyB0YXNrczogVGFza1tdOyB3b3Jrb3V0czogV29ya291dFtdOyBzdHVkeUNhcmRzOiBTdHVkeUNhcmRbXTsgbWVhbENhbDogTWFwPHN0cmluZywgbnVtYmVyPjsgZ3ltOiBTZXQ8c3RyaW5nPjsgdG9kYXk6IHN0cmluZzsgd2F0ZXJUb2RheTogbnVtYmVyIH1cbiAgKTogdm9pZCB7XG4gICAgY29uc3QgeW0gPSBkLnRvZGF5LnN1YnN0cmluZygwLCA3KTtcbiAgICBjb25zdCB3b3Jrb3V0c01vbnRoID0gZC53b3Jrb3V0cy5maWx0ZXIoKHcpID0+IHcuZGF0ZS5zdWJzdHJpbmcoMCwgNykgPT09IHltKS5sZW5ndGg7XG4gICAgY29uc3Qgc3R1ZHlEb25lID0gZC5zdHVkeUNhcmRzLmZpbHRlcigoYykgPT4gYy5zdGF0dXMgPT09IFwiZG9uZVwiKS5sZW5ndGg7XG4gICAgY29uc3QgdGFza3NEb25lID0gZC50YXNrcy5maWx0ZXIoKHQpID0+IHQuc3RhdHVzID09PSBcImRvbmVcIikubGVuZ3RoO1xuICAgIGNvbnN0IHRvZGF5Q2FsID0gZC5tZWFsQ2FsLmdldChkLnRvZGF5KSB8fCAwO1xuXG4gICAgY29uc3QgYWN0aXZlRGF5ID0gKGRzOiBzdHJpbmcpID0+IGQuZ3ltLmhhcyhkcykgfHwgZC5tZWFsQ2FsLmhhcyhkcyk7XG4gICAgbGV0IHN0cmVhayA9IDA7XG4gICAgY29uc3QgYmFzZSA9IG5ldyBEYXRlKGQudG9kYXkgKyBcIlQwMDowMDowMFwiKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IDM2NTsgaSsrKSB7XG4gICAgICBjb25zdCB4ID0gbmV3IERhdGUoYmFzZSk7XG4gICAgICB4LnNldERhdGUoeC5nZXREYXRlKCkgLSBpKTtcbiAgICAgIGlmIChhY3RpdmVEYXkoeW1kKHgpKSkgc3RyZWFrKys7XG4gICAgICBlbHNlIGlmIChpID09PSAwKSBjb250aW51ZTtcbiAgICAgIGVsc2UgYnJlYWs7XG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtc3RhdHMtcm93IHBhLWtwaXNcIiB9KTtcbiAgICBjb25zdCBrcGkgPSAobGFiZWw6IHN0cmluZywgdmFsdWU6IHN0cmluZykgPT4ge1xuICAgICAgY29uc3QgYyA9IHJvdy5jcmVhdGVEaXYoeyBjbHM6IFwicGEtc3RhdFwiIH0pO1xuICAgICAgYy5jcmVhdGVEaXYoeyB0ZXh0OiB2YWx1ZSwgY2xzOiBcInBhLXN0YXQtdmFsdWVcIiB9KTtcbiAgICAgIGMuY3JlYXRlRGl2KHsgdGV4dDogbGFiZWwsIGNsczogXCJwYS1zdGF0LWxhYmVsXCIgfSk7XG4gICAgfTtcbiAgICBrcGkoXCJcdUQ4M0RcdUREMjUgQWN0aXZlIHN0cmVha1wiLCBzdHJlYWsgKyBcImRcIik7XG4gICAga3BpKFwiXHVEODNDXHVERkNCXHVGRTBGIFdvcmtvdXRzIChtb250aClcIiwgU3RyaW5nKHdvcmtvdXRzTW9udGgpKTtcbiAgICBrcGkoXCJcdUQ4M0VcdURENTcgQ2Fsb3JpZXMgdG9kYXlcIiwgU3RyaW5nKHRvZGF5Q2FsKSk7XG4gICAga3BpKFwiXHVEODNEXHVEQ0E3IFdhdGVyIHRvZGF5XCIsIGAke2Qud2F0ZXJUb2RheS50b0ZpeGVkKDEpfUxgKTtcbiAgICBrcGkoXCJcdUQ4M0RcdURDREEgU3R1ZGllcyBkb25lXCIsIGAke3N0dWR5RG9uZX0vJHtkLnN0dWR5Q2FyZHMubGVuZ3RofWApO1xuICAgIGtwaShcIlx1MjcwNSBUYXNrcyBkb25lXCIsIGAke3Rhc2tzRG9uZX0vJHtkLnRhc2tzLmxlbmd0aH1gKTtcbiAgfVxuXG4gIC8vIC0tLS0gMyBkb251dCBjaGFydHMgLS0tLVxuICBwcml2YXRlIHJlbmRlckRvbnV0cyhcbiAgICByb290OiBIVE1MRWxlbWVudCxcbiAgICBkOiB7IHdvcmtvdXRzOiBXb3Jrb3V0W107IHN0dWR5Q2FyZHM6IFN0dWR5Q2FyZFtdOyB0YXNrczogVGFza1tdOyB0b2RheTogc3RyaW5nIH1cbiAgKTogdm9pZCB7XG4gICAgY29uc3QgcGFsZXR0ZSA9IFtcIiM3YzNhZWRcIiwgXCIjMTZhMzRhXCIsIFwiI2Y1OWUwYlwiLCBcIiMzYjgyZjZcIiwgXCIjZWY0NDQ0XCIsIFwiIzEwYjk4MVwiXTtcbiAgICBjb25zdCByb3cgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS1kb251dHMtcm93XCIgfSk7XG5cbiAgICAvLyBXb3Jrb3V0cyBieSB0eXBlIChtb250aClcbiAgICBjb25zdCB5bSA9IGQudG9kYXkuc3Vic3RyaW5nKDAsIDcpO1xuICAgIGNvbnN0IGJ5U3BsaXQgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICAgIGQud29ya291dHMuZm9yRWFjaCgodykgPT4geyBpZiAody5kYXRlLnN1YnN0cmluZygwLCA3KSA9PT0geW0pIGJ5U3BsaXQuc2V0KHcuc3BsaXQsIChieVNwbGl0LmdldCh3LnNwbGl0KSB8fCAwKSArIDEpOyB9KTtcbiAgICB0aGlzLmRvbnV0UGFuZWwocm93LCBcIlx1RDgzQ1x1REZDQlx1RkUwRiBXb3Jrb3V0cyBieSB0eXBlIChtb250aClcIixcbiAgICAgIEFycmF5LmZyb20oYnlTcGxpdC5lbnRyaWVzKCkpLm1hcCgoW2ssIHZdLCBpKSA9PiAoeyBsYWJlbDogXCJXb3Jrb3V0IFwiICsgaywgdmFsdWU6IHYsIGNvbG9yOiBwYWxldHRlW2kgJSBwYWxldHRlLmxlbmd0aF0gfSkpKTtcblxuICAgIC8vIFN0dWRpZXMgYnkgc3RhdHVzXG4gICAgY29uc3QgYnlTdGF0dXMgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICAgIGQuc3R1ZHlDYXJkcy5mb3JFYWNoKChjKSA9PiB7IGNvbnN0IHMgPSBjLnN0YXR1cyB8fCBcImJhY2tsb2dcIjsgYnlTdGF0dXMuc2V0KHMsIChieVN0YXR1cy5nZXQocykgfHwgMCkgKyAxKTsgfSk7XG4gICAgdGhpcy5kb251dFBhbmVsKHJvdywgXCJcdUQ4M0RcdURDREEgU3R1ZGllcyBieSBzdGF0dXNcIixcbiAgICAgIEFycmF5LmZyb20oYnlTdGF0dXMuZW50cmllcygpKS5tYXAoKFtrLCB2XSwgaSkgPT4gKHsgbGFiZWw6IGssIHZhbHVlOiB2LCBjb2xvcjogcGFsZXR0ZVtpICUgcGFsZXR0ZS5sZW5ndGhdIH0pKSk7XG5cbiAgICAvLyBUYXNrcyBieSBzdGF0dXNcbiAgICBjb25zdCBieVRhc2sgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICAgIGQudGFza3MuZm9yRWFjaCgodCkgPT4geyBjb25zdCBzID0gdC5zdGF0dXMgfHwgXCJ0b2RvXCI7IGJ5VGFzay5zZXQocywgKGJ5VGFzay5nZXQocykgfHwgMCkgKyAxKTsgfSk7XG4gICAgdGhpcy5kb251dFBhbmVsKHJvdywgXCJcdTI3MDUgVGFza3MgYnkgc3RhdHVzXCIsXG4gICAgICBBcnJheS5mcm9tKGJ5VGFzay5lbnRyaWVzKCkpLm1hcCgoW2ssIHZdLCBpKSA9PiAoeyBsYWJlbDogaywgdmFsdWU6IHYsIGNvbG9yOiBwYWxldHRlW2kgJSBwYWxldHRlLmxlbmd0aF0gfSkpKTtcbiAgfVxuXG4gIHByaXZhdGUgZG9udXRQYW5lbChyb3c6IEhUTUxFbGVtZW50LCB0aXRsZTogc3RyaW5nLCBzZWdtZW50czogQXJyYXk8eyBsYWJlbDogc3RyaW5nOyB2YWx1ZTogbnVtYmVyOyBjb2xvcjogc3RyaW5nIH0+KTogdm9pZCB7XG4gICAgY29uc3QgcGFuZWwgPSByb3cuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXBhbmVsIHBhLWRvbnV0LXBhbmVsXCIgfSk7XG4gICAgcGFuZWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IHRpdGxlLCBjbHM6IFwicGEtcGFuZWwtdGl0bGVcIiB9KTtcbiAgICBkcmF3RG9udXQocGFuZWwsIHNlZ21lbnRzKTtcbiAgfVxuXG4gIC8vIC0tLS0gSGFiaXQgY29uc2lzdGVuY3kgLS0tLVxuICBwcml2YXRlIHJlbmRlckhhYml0Q29uc2lzdGVuY3kocm9vdDogSFRNTEVsZW1lbnQsIHN5c3RlbUhhYml0czogU3lzdGVtSGFiaXRbXSwgaGFiaXRzOiBIYWJpdFtdLCB0b2RheTogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgcGFuZWwgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS1wYW5lbFwiIH0pO1xuICAgIGNvbnN0IGhlYWQgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtc2VjdGlvbi1oZWFkXCIgfSk7XG4gICAgaGVhZC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJcdUQ4M0RcdURDQ0EgSGFiaXQgQ29uc2lzdGVuY3lcIiwgY2xzOiBcInBhLXBhbmVsLXRpdGxlXCIgfSk7XG4gICAgY29uc3QgYWRkID0gaGVhZC5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiKyBOZXcgSGFiaXRcIiwgY2xzOiBcInBhLWJ0blwiIH0pO1xuICAgIGFkZC5vbmNsaWNrID0gKCkgPT4gdGhpcy5vcGVuSGFiaXRNb2RhbCgpO1xuXG4gICAgY29uc3QgZ3JpZCA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJwYS1oYWJpdHMtZ3JpZFwiIH0pO1xuICAgIHN5c3RlbUhhYml0cy5mb3JFYWNoKChoKSA9PiB0aGlzLnJlbmRlclN5c3RlbUhhYml0KGdyaWQsIGgsIHRvZGF5KSk7XG4gICAgaGFiaXRzLmZvckVhY2goKGgpID0+IHRoaXMucmVuZGVyQ3VzdG9tSGFiaXQoZ3JpZCwgaCwgdG9kYXkpKTtcbiAgfVxuXG4gIHByaXZhdGUgaGVhdG1hcChjYXJkOiBIVE1MRWxlbWVudCwgZG9uZTogKGRzOiBzdHJpbmcpID0+IGJvb2xlYW4sIGNvbG9yOiBzdHJpbmcsIHRvZGF5OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBobSA9IGNhcmQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWhlYXRtYXBcIiB9KTtcbiAgICBjb25zdCBiYXNlID0gbmV3IERhdGUodG9kYXkgKyBcIlQwMDowMDowMFwiKTtcbiAgICBmb3IgKGxldCBqID0gSEVBVE1BUF9EQVlTIC0gMTsgaiA+PSAwOyBqLS0pIHtcbiAgICAgIGNvbnN0IHggPSBuZXcgRGF0ZShiYXNlKTtcbiAgICAgIHguc2V0RGF0ZSh4LmdldERhdGUoKSAtIGopO1xuICAgICAgY29uc3QgZHMgPSB5bWQoeCk7XG4gICAgICBjb25zdCBjZWxsID0gaG0uY3JlYXRlRGl2KHsgY2xzOiBcInBhLWhtLWNlbGxcIiB9KTtcbiAgICAgIGNlbGwuc2V0QXR0cihcInRpdGxlXCIsIGRzKTtcbiAgICAgIGlmIChkb25lKGRzKSkgY2VsbC5zdHlsZS5iYWNrZ3JvdW5kID0gY29sb3I7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJTeXN0ZW1IYWJpdChncmlkOiBIVE1MRWxlbWVudCwgaDogU3lzdGVtSGFiaXQsIHRvZGF5OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBsZXQgc3RyZWFrID0gMDtcbiAgICBjb25zdCBiYXNlID0gbmV3IERhdGUodG9kYXkgKyBcIlQwMDowMDowMFwiKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IDM2NTsgaSsrKSB7XG4gICAgICBjb25zdCB4ID0gbmV3IERhdGUoYmFzZSk7XG4gICAgICB4LnNldERhdGUoeC5nZXREYXRlKCkgLSBpKTtcbiAgICAgIGlmIChoLmRvbmUoeW1kKHgpKSkgc3RyZWFrKys7XG4gICAgICBlbHNlIGlmIChpID09PSAwKSBjb250aW51ZTtcbiAgICAgIGVsc2UgYnJlYWs7XG4gICAgfVxuICAgIGNvbnN0IGNhcmQgPSBncmlkLmNyZWF0ZURpdih7IGNsczogXCJwYS1oYWJpdC1jYXJkXCIgfSk7XG4gICAgY29uc3QgdG9wID0gY2FyZC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtaGFiaXQtdG9wXCIgfSk7XG4gICAgdG9wLmNyZWF0ZVNwYW4oeyB0ZXh0OiBoLmxhYmVsLCBjbHM6IFwicGEtaGFiaXQtbmFtZVwiIH0pO1xuICAgIHRvcC5jcmVhdGVTcGFuKHsgdGV4dDogYFx1RDgzRFx1REQyNSAke3N0cmVha31gLCBjbHM6IFwicGEtbXV0ZWQgcGEtc3RyZWFrXCIgfSk7XG4gICAgdGhpcy5oZWF0bWFwKGNhcmQsIGguZG9uZSwgaC5jb2xvciwgdG9kYXkpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJDdXN0b21IYWJpdChncmlkOiBIVE1MRWxlbWVudCwgaDogSGFiaXQsIHRvZGF5OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBpc1F1aXQgPSBoLmhhYml0VHlwZSA9PT0gXCJxdWl0XCI7XG4gICAgY29uc3QgY29sb3IgPSBpc1F1aXQgPyBcIiNlZjQ0NDRcIiA6IFwiIzBlYTVlOVwiO1xuICAgIGNvbnN0IGRvbmUgPSBpc1F1aXRcbiAgICAgID8gKGRzOiBzdHJpbmcpID0+IHsgY29uc3Qgc3RhcnQgPSBoLmxhc3RSZXNldCB8fCBoLmNyZWF0ZWQgfHwgdG9kYXk7IHJldHVybiBkcyA+PSBzdGFydCAmJiBkcyA8PSB0b2RheTsgfVxuICAgICAgOiAoZHM6IHN0cmluZykgPT4gISFoLmxvZ1tkc107XG5cbiAgICBsZXQgc3RyZWFrOiBudW1iZXI7XG4gICAgaWYgKGlzUXVpdCkge1xuICAgICAgc3RyZWFrID0gZGF5c0JldHdlZW4oaC5sYXN0UmVzZXQgfHwgaC5jcmVhdGVkIHx8IHRvZGF5LCB0b2RheSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN0cmVhayA9IDA7XG4gICAgICBjb25zdCBiYXNlID0gbmV3IERhdGUodG9kYXkgKyBcIlQwMDowMDowMFwiKTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMzY1OyBpKyspIHtcbiAgICAgICAgY29uc3QgeCA9IG5ldyBEYXRlKGJhc2UpO1xuICAgICAgICB4LnNldERhdGUoeC5nZXREYXRlKCkgLSBpKTtcbiAgICAgICAgaWYgKGgubG9nW3ltZCh4KV0pIHN0cmVhaysrO1xuICAgICAgICBlbHNlIGlmIChpID09PSAwKSBjb250aW51ZTtcbiAgICAgICAgZWxzZSBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBjYXJkID0gZ3JpZC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtaGFiaXQtY2FyZFwiIH0pO1xuICAgIGNvbnN0IHRvcCA9IGNhcmQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWhhYml0LXRvcFwiIH0pO1xuICAgIHRvcC5jcmVhdGVTcGFuKHsgdGV4dDogYCR7aC5lbW9qaSB8fCBcIlx1MkI1MFwifSAke2gubmFtZX1gLCBjbHM6IFwicGEtaGFiaXQtbmFtZVwiIH0pO1xuICAgIGNvbnN0IHJpZ2h0ID0gdG9wLmNyZWF0ZURpdih7IGNsczogXCJwYS1oYWJpdC1hY3Rpb25zXCIgfSk7XG4gICAgcmlnaHQuY3JlYXRlU3Bhbih7IHRleHQ6IGlzUXVpdCA/IGBcdUQ4M0RcdURFQUQgJHtzdHJlYWt9ZGAgOiBgXHVEODNEXHVERDI1ICR7c3RyZWFrfWAsIGNsczogXCJwYS1tdXRlZCBwYS1zdHJlYWtcIiB9KTtcblxuICAgIGlmIChpc1F1aXQpIHtcbiAgICAgIGNvbnN0IHJlc2V0ID0gcmlnaHQuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjFCQSBSZXNldFwiLCBjbHM6IFwicGEtbWluaS1idG5cIiB9KTtcbiAgICAgIHJlc2V0Lm9uY2xpY2sgPSBhc3luYyAoKSA9PiB7IGF3YWl0IHRoaXMuY3R4LnN0b3JlLnJlc2V0SGFiaXQoaCwgdG9kYXkpOyB0aGlzLmN0eC5yZWZyZXNoKCk7IH07XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG1hcmtlZCA9ICEhaC5sb2dbdG9kYXldO1xuICAgICAgY29uc3QgbWFyayA9IHJpZ2h0LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogbWFya2VkID8gXCJcdTI3MTMgVG9kYXlcIiA6IFwiTWFyayB0b2RheVwiLCBjbHM6IFwicGEtbWluaS1idG5cIiArIChtYXJrZWQgPyBcIiBvblwiIDogXCJcIikgfSk7XG4gICAgICBpZiAobWFya2VkKSB7IG1hcmsuc3R5bGUuYmFja2dyb3VuZCA9IGNvbG9yOyBtYXJrLnN0eWxlLmNvbG9yID0gXCIjZmZmXCI7IH1cbiAgICAgIG1hcmsub25jbGljayA9IGFzeW5jICgpID0+IHsgYXdhaXQgdGhpcy5jdHguc3RvcmUudG9nZ2xlSGFiaXQoaCwgdG9kYXkpOyB0aGlzLmN0eC5yZWZyZXNoKCk7IH07XG4gICAgfVxuICAgIGNvbnN0IGRlbCA9IHJpZ2h0LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdUQ4M0RcdURERDFcIiwgY2xzOiBcInBhLWljb24tYnRuXCIgfSk7XG4gICAgZGVsLm9uY2xpY2sgPSAoKSA9PlxuICAgICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmN0eC5hcHAsIGBSZW1vdmUgaGFiaXQgXCIke2gubmFtZX1cIj9gLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuY3R4LnN0b3JlLmRlbGV0ZUhhYml0KGgpO1xuICAgICAgICB0aGlzLmN0eC5yZWZyZXNoKCk7XG4gICAgICB9KS5vcGVuKCk7XG5cbiAgICB0aGlzLmhlYXRtYXAoY2FyZCwgZG9uZSwgY29sb3IsIHRvZGF5KTtcbiAgfVxuXG4gIC8vIC0tLS0gU3R1ZHkgcHJvZ3Jlc3MgLS0tLVxuICBwcml2YXRlIHJlbmRlclN0dWR5UHJvZ3Jlc3Mocm9vdDogSFRNTEVsZW1lbnQsIGJvYXJkczogQm9hcmRbXSwgY2FyZHM6IFN0dWR5Q2FyZFtdKTogdm9pZCB7XG4gICAgaWYgKCFib2FyZHMubGVuZ3RoKSByZXR1cm47XG4gICAgY29uc3QgcGFuZWwgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS1wYW5lbFwiIH0pO1xuICAgIHBhbmVsLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcIlx1RDgzRFx1RENEQSBTdHVkeSBQcm9ncmVzc1wiLCBjbHM6IFwicGEtcGFuZWwtdGl0bGVcIiB9KTtcbiAgICBib2FyZHMuZm9yRWFjaCgoYikgPT4ge1xuICAgICAgY29uc3QgdG9waWNDYXJkcyA9IGNhcmRzLmZpbHRlcigoYykgPT4gYy50b3BpYyA9PT0gYi5uYW1lKTtcbiAgICAgIGNvbnN0IGRvbmUgPSB0b3BpY0NhcmRzLmZpbHRlcigoYykgPT4gYy5zdGF0dXMgPT09IFwiZG9uZVwiKS5sZW5ndGg7XG4gICAgICBjb25zdCB0b3RhbCA9IHRvcGljQ2FyZHMubGVuZ3RoO1xuICAgICAgY29uc3QgcGN0ID0gdG90YWwgPyBNYXRoLnJvdW5kKChkb25lIC8gdG90YWwpICogMTAwKSA6IDA7XG4gICAgICBjb25zdCBjb2xvciA9IHBjdCA+PSA3MCA/IFwiIzE2YTM0YVwiIDogcGN0ID49IDMwID8gXCIjZDk3NzA2XCIgOiBcInZhcigtLWludGVyYWN0aXZlLWFjY2VudClcIjtcblxuICAgICAgY29uc3QgbGFiZWxSb3cgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtcHJvZ3Jlc3MtbGFiZWxcIiB9KTtcbiAgICAgIGxhYmVsUm93LmNyZWF0ZVNwYW4oeyB0ZXh0OiBgJHtiLmVtb2ppIHx8IFwiXCJ9ICR7Yi5uYW1lfWAudHJpbSgpIH0pO1xuICAgICAgbGFiZWxSb3cuY3JlYXRlU3Bhbih7IHRleHQ6IGAke3BjdH0lICgke2RvbmV9LyR7dG90YWx9KWAsIGNsczogXCJwYS1tdXRlZFwiIH0pO1xuICAgICAgY29uc3QgYmFyID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXByb2dyZXNzLXRyYWNrXCIgfSk7XG4gICAgICBjb25zdCBmaWxsID0gYmFyLmNyZWF0ZURpdih7IGNsczogXCJwYS1wcm9ncmVzcy1maWxsXCIgfSk7XG4gICAgICBmaWxsLnN0eWxlLndpZHRoID0gcGN0ICsgXCIlXCI7XG4gICAgICBmaWxsLnN0eWxlLmJhY2tncm91bmQgPSBjb2xvcjtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIC0tLS0gTmV3IGhhYml0IG1vZGFsIC0tLS1cbiAgcHJpdmF0ZSBvcGVuSGFiaXRNb2RhbCgpOiB2b2lkIHtcbiAgICBjb25zdCBmaWVsZHM6IEZpZWxkU3BlY1tdID0gW1xuICAgICAgeyBrZXk6IFwibmFtZVwiLCBsYWJlbDogXCJOYW1lXCIsIHR5cGU6IFwidGV4dFwiLCBwbGFjZWhvbGRlcjogXCJXYWxrIHRoZSBkb2cgLyBRdWl0IHNtb2tpbmdcIiB9LFxuICAgICAgeyBrZXk6IFwiZW1vamlcIiwgbGFiZWw6IFwiRW1vamlcIiwgdHlwZTogXCJ0ZXh0XCIsIHZhbHVlOiBcIlx1MkI1MFwiIH0sXG4gICAgICB7XG4gICAgICAgIGtleTogXCJ0eXBlXCIsIGxhYmVsOiBcIlR5cGVcIiwgdHlwZTogXCJkcm9wZG93blwiLCB2YWx1ZTogXCJkb1wiLFxuICAgICAgICBvcHRpb25zOiBbXG4gICAgICAgICAgeyB2YWx1ZTogXCJkb1wiLCBsYWJlbDogXCJcdTI3MDUgRG8gXHUyMDE0IG1hcmsgd2hlbiBkb25lXCIgfSxcbiAgICAgICAgICB7IHZhbHVlOiBcInF1aXRcIiwgbGFiZWw6IFwiXHVEODNEXHVERUFEIFF1aXQgXHUyMDE0IGNvdW50cyBkYXlzLCByZXNldCB0byByZXN0YXJ0XCIgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgXTtcbiAgICBuZXcgRm9ybU1vZGFsKHRoaXMuY3R4LmFwcCwgXCJOZXcgaGFiaXRcIiwgZmllbGRzLCBhc3luYyAodikgPT4ge1xuICAgICAgY29uc3QgbmFtZSA9ICh2Lm5hbWUgfHwgXCJcIikudHJpbSgpO1xuICAgICAgaWYgKCFuYW1lKSByZXR1cm47XG4gICAgICBhd2FpdCB0aGlzLmN0eC5zdG9yZS5zYXZlSGFiaXQoeyBuYW1lLCBlbW9qaTogKHYuZW1vamkgfHwgXCJcdTJCNTBcIikudHJpbSgpLCBoYWJpdFR5cGU6IHYudHlwZSA9PT0gXCJxdWl0XCIgPyBcInF1aXRcIiA6IFwiZG9cIiwgbG9nOiB7fSB9KTtcbiAgICAgIHRoaXMuY3R4LnJlZnJlc2goKTtcbiAgICAgIHRvYXN0KFwiSGFiaXQgY3JlYXRlZFwiKTtcbiAgICB9LCBcIkNyZWF0ZVwiKS5vcGVuKCk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBQQUNvbnRleHQgfSBmcm9tIFwiLi4vY29udGV4dFwiO1xuaW1wb3J0IHsgQm9hcmQsIFRhc2sgfSBmcm9tIFwiLi4vdHlwZXNcIjtcbmltcG9ydCB7IENvbmZpcm1Nb2RhbCwgRmllbGRTcGVjLCBGb3JtTW9kYWwsIHRvYXN0IH0gZnJvbSBcIi4uL3VpXCI7XG5pbXBvcnQgeyBkcmF3UmluZyB9IGZyb20gXCIuLi9jaGFydHNcIjtcblxuY29uc3QgUFJJT1JJVElFUyA9IFtcbiAgeyB2YWx1ZTogXCJsb3dcIiwgbGFiZWw6IFwiTG93XCIgfSxcbiAgeyB2YWx1ZTogXCJtZWRpdW1cIiwgbGFiZWw6IFwiTWVkaXVtXCIgfSxcbiAgeyB2YWx1ZTogXCJoaWdoXCIsIGxhYmVsOiBcIkhpZ2hcIiB9LFxuXTtcblxuY29uc3QgUklOR19DT0xPUlMgPSBbXCIjZDk3NzA2XCIsIFwiIzdjM2FlZFwiLCBcIiMxNmEzNGFcIl07XG5jb25zdCBDT0xVTU5fQ09MT1JTID0gW1wiIzdjM2FlZFwiLCBcIiMzYjgyZjZcIiwgXCIjMTZhMzRhXCIsIFwiI2Y1OWUwYlwiLCBcIiNlZjQ0NDRcIiwgXCIjMTBiOTgxXCJdO1xuXG4vKiogUmVuZGVycyB0aGUgXCJUYXNrcyAmIE5vdGVzXCIgcGFnZTogYSBLYW5iYW4gLyBMaXN0IGJvYXJkIG92ZXIgVGFza3MvKi5tZC4gKi9cbmV4cG9ydCBjbGFzcyBUYXNrc01vZHVsZSB7XG4gIHByaXZhdGUgY3R4OiBQQUNvbnRleHQ7XG4gIHByaXZhdGUgY3VycmVudEJvYXJkID0gXCJhbGxcIjtcbiAgcHJpdmF0ZSB2aWV3OiBcImthbmJhblwiIHwgXCJsaXN0XCIgPSBcImthbmJhblwiO1xuXG4gIGNvbnN0cnVjdG9yKGN0eDogUEFDb250ZXh0KSB7IHRoaXMuY3R4ID0gY3R4OyB9XG5cbiAgcHJpdmF0ZSBjbGVhbkxhYmVsKHM6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHMucmVwbGFjZSgvXlteXFxwe0x9XFxwe059XSsvdSwgXCJcIikudHJpbSgpO1xuICB9XG4gIHByaXZhdGUgY29sQ29sb3IoaW5kZXg6IG51bWJlcik6IHN0cmluZyB7XG4gICAgcmV0dXJuIENPTFVNTl9DT0xPUlNbaW5kZXggJSBDT0xVTU5fQ09MT1JTLmxlbmd0aF07XG4gIH1cblxuICByZW5kZXIocm9vdDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICByb290LmVtcHR5KCk7XG4gICAgY29uc3QgYm9hcmRzID0gdGhpcy5jdHguc3RvcmUubG9hZEJvYXJkcygpO1xuICAgIGNvbnN0IHRhc2tzID0gdGhpcy5jdHguc3RvcmUubG9hZFRhc2tzKCk7XG4gICAgY29uc3QgZmlsdGVyZWQgPSB0YXNrcy5maWx0ZXIoKHQpID0+IHRoaXMuY3VycmVudEJvYXJkID09PSBcImFsbFwiIHx8IHQua2FuYmFuTmFtZSA9PT0gdGhpcy5jdXJyZW50Qm9hcmQpO1xuXG4gICAgdGhpcy5yZW5kZXJIZWFkZXIocm9vdCwgZmlsdGVyZWQpO1xuICAgIHRoaXMucmVuZGVyVmlld1RvZ2dsZShyb290KTtcbiAgICB0aGlzLnJlbmRlckJvYXJkVGFicyhyb290LCBib2FyZHMpO1xuXG4gICAgaWYgKHRoaXMudmlldyA9PT0gXCJrYW5iYW5cIikge1xuICAgICAgdGhpcy5yZW5kZXJTdGF0cyhyb290LCBmaWx0ZXJlZCk7XG4gICAgICB0aGlzLnJlbmRlckJvYXJkQmFyKHJvb3QsIGJvYXJkcyk7XG4gICAgICB0aGlzLnJlbmRlckthbmJhbihyb290LCBmaWx0ZXJlZCwgYm9hcmRzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZW5kZXJMaXN0KHJvb3QsIGZpbHRlcmVkKTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tIEhlYWRlcjogdGl0bGUgKyBzdWJ0aXRsZSArIHN0YXR1cyByaW5ncyAtLS0tXG4gIHByaXZhdGUgcmVuZGVySGVhZGVyKHJvb3Q6IEhUTUxFbGVtZW50LCBmaWx0ZXJlZDogVGFza1tdKTogdm9pZCB7XG4gICAgY29uc3QgaGVhZCA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWh0LWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IGxlZnQgPSBoZWFkLmNyZWF0ZURpdigpO1xuICAgIGxlZnQuY3JlYXRlRGl2KHsgdGV4dDogXCJcdTI3MDUgVGFza3MgJiBOb3Rlc1wiLCBjbHM6IFwicGEtaDFcIiB9KTtcbiAgICBsZWZ0LmNyZWF0ZURpdih7IHRleHQ6IFwiS2FuYmFuIGFuZCBsaXN0XCIsIGNsczogXCJwYS1tdXRlZFwiIH0pO1xuXG4gICAgY29uc3QgY29scyA9IHRoaXMuY3R4LmNvbmZpZy50YXNrQ29sdW1ucztcbiAgICBjb25zdCBuYW1lcyA9IHRoaXMuY3R4LmNvbmZpZy50YXNrQ29sdW1uTmFtZXM7XG4gICAgY29uc3QgY29sU2V0ID0gbmV3IFNldChjb2xzKTtcbiAgICBjb25zdCBlZmYgPSAodDogVGFzaykgPT4gKGNvbFNldC5oYXModC5zdGF0dXMpID8gdC5zdGF0dXMgOiBjb2xzWzBdKTtcbiAgICBjb25zdCB0b3RhbCA9IGZpbHRlcmVkLmxlbmd0aCB8fCAxO1xuXG4gICAgY29uc3QgcmluZ3MgPSBoZWFkLmNyZWF0ZURpdih7IGNsczogXCJwYS1odC1yaW5nc1wiIH0pO1xuICAgIGNvbHMuc2xpY2UoMCwgMykuZm9yRWFjaCgoY29sLCBpKSA9PiB7XG4gICAgICBjb25zdCBjbnQgPSBmaWx0ZXJlZC5maWx0ZXIoKHQpID0+IGVmZih0KSA9PT0gY29sKS5sZW5ndGg7XG4gICAgICBjb25zdCBwY3QgPSBNYXRoLnJvdW5kKChjbnQgLyB0b3RhbCkgKiAxMDApO1xuICAgICAgZHJhd1JpbmcocmluZ3MsIHBjdCwgUklOR19DT0xPUlNbaV0gfHwgXCIjN2MzYWVkXCIsIHRoaXMuY2xlYW5MYWJlbChuYW1lc1tjb2xdIHx8IGNvbCksIDUyKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIC0tLS0gVmlldyB0b2dnbGUgLS0tLVxuICBwcml2YXRlIHJlbmRlclZpZXdUb2dnbGUocm9vdDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCBiYXIgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS12aWV3LXRvZ2dsZVwiIH0pO1xuICAgIGNvbnN0IG1rID0gKGlkOiBcImthbmJhblwiIHwgXCJsaXN0XCIsIGxhYmVsOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbnN0IGIgPSBiYXIuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBsYWJlbCwgY2xzOiBcInBhLXRvZ2dsZS1idG5cIiArICh0aGlzLnZpZXcgPT09IGlkID8gXCIgb25cIiA6IFwiXCIpIH0pO1xuICAgICAgYi5vbmNsaWNrID0gKCkgPT4geyB0aGlzLnZpZXcgPSBpZDsgdGhpcy5jdHgucmVmcmVzaCgpOyB9O1xuICAgIH07XG4gICAgbWsoXCJrYW5iYW5cIiwgXCJcdUQ4M0RcdURDQ0IgS2FuYmFuXCIpO1xuICAgIG1rKFwibGlzdFwiLCBcIlx1RDgzRFx1RENDMyBMaXN0XCIpO1xuICB9XG5cbiAgLy8gLS0tLSBCb2FyZCB0YWJzIC0tLS1cbiAgcHJpdmF0ZSByZW5kZXJCb2FyZFRhYnMocm9vdDogSFRNTEVsZW1lbnQsIGJvYXJkczogQm9hcmRbXSk6IHZvaWQge1xuICAgIGNvbnN0IGJhciA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXRhYnNcIiB9KTtcbiAgICBjb25zdCBta1RhYiA9IChpZDogc3RyaW5nLCBsYWJlbDogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCB0ID0gYmFyLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogbGFiZWwsIGNsczogXCJwYS10YWJcIiArICh0aGlzLmN1cnJlbnRCb2FyZCA9PT0gaWQgPyBcIiBvblwiIDogXCJcIikgfSk7XG4gICAgICB0Lm9uY2xpY2sgPSAoKSA9PiB7IHRoaXMuY3VycmVudEJvYXJkID0gaWQ7IHRoaXMuY3R4LnJlZnJlc2goKTsgfTtcbiAgICB9O1xuICAgIG1rVGFiKFwiYWxsXCIsIFwiXHVEODNEXHVEQ0NCIEFsbFwiKTtcbiAgICBib2FyZHMuZm9yRWFjaCgoYikgPT4gbWtUYWIoYi5uYW1lLCBgJHtiLmVtb2ppIHx8IFwiXCJ9ICR7Yi5uYW1lfWAudHJpbSgpKSk7XG4gICAgY29uc3QgYWRkID0gYmFyLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCIrIEJvYXJkXCIsIGNsczogXCJwYS10YWIgcGEtdGFiLWFkZFwiIH0pO1xuICAgIGFkZC5vbmNsaWNrID0gKCkgPT4gdGhpcy5vcGVuQm9hcmRNb2RhbChib2FyZHMpO1xuICB9XG5cbiAgLy8gLS0tLSBTdGF0cyByb3cgLS0tLVxuICBwcml2YXRlIHJlbmRlclN0YXRzKHJvb3Q6IEhUTUxFbGVtZW50LCBmaWx0ZXJlZDogVGFza1tdKTogdm9pZCB7XG4gICAgY29uc3QgY29scyA9IHRoaXMuY3R4LmNvbmZpZy50YXNrQ29sdW1ucztcbiAgICBjb25zdCBuYW1lcyA9IHRoaXMuY3R4LmNvbmZpZy50YXNrQ29sdW1uTmFtZXM7XG4gICAgY29uc3QgY29sU2V0ID0gbmV3IFNldChjb2xzKTtcbiAgICBjb25zdCBlZmYgPSAodDogVGFzaykgPT4gKGNvbFNldC5oYXModC5zdGF0dXMpID8gdC5zdGF0dXMgOiBjb2xzWzBdKTtcbiAgICBjb25zdCB0b3RhbCA9IGZpbHRlcmVkLmxlbmd0aDtcblxuICAgIGNvbnN0IHJvdyA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXN0YXRzLXJvd1wiIH0pO1xuICAgIGNvbnN0IHN0YXQgPSAobGFiZWw6IHN0cmluZywgdmFsdWU6IHN0cmluZywgY29sb3I/OiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbnN0IGMgPSByb3cuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXN0YXRcIiB9KTtcbiAgICAgIGNvbnN0IHYgPSBjLmNyZWF0ZURpdih7IHRleHQ6IHZhbHVlLCBjbHM6IFwicGEtc3RhdC12YWx1ZVwiIH0pO1xuICAgICAgaWYgKGNvbG9yKSB2LnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBjLmNyZWF0ZURpdih7IHRleHQ6IGxhYmVsLCBjbHM6IFwicGEtc3RhdC1sYWJlbFwiIH0pO1xuICAgIH07XG4gICAgc3RhdChcIlx1RDgzRFx1RENDQiBUT1RBTFwiLCBTdHJpbmcodG90YWwpKTtcbiAgICAvLyBPbmx5IHRoZSBzdGFuZGFyZCB0cmlvIChmaXJzdCAzIGNvbHVtbnMpOiB0d28gY291bnRzICsgbGFzdCBhcyAlIGRvbmUuXG4gICAgY29uc3QgdHJpbyA9IGNvbHMuc2xpY2UoMCwgMyk7XG4gICAgdHJpby5mb3JFYWNoKChjb2wsIGkpID0+IHtcbiAgICAgIGNvbnN0IGNudCA9IGZpbHRlcmVkLmZpbHRlcigodCkgPT4gZWZmKHQpID09PSBjb2wpLmxlbmd0aDtcbiAgICAgIGNvbnN0IGxhYmVsID0gKG5hbWVzW2NvbF0gfHwgY29sKS50b1VwcGVyQ2FzZSgpO1xuICAgICAgY29uc3QgaXNQY3QgPSBpID09PSB0cmlvLmxlbmd0aCAtIDE7XG4gICAgICBpZiAoaXNQY3QpIHN0YXQobGFiZWwsICh0b3RhbCA/IE1hdGgucm91bmQoKGNudCAvIHRvdGFsKSAqIDEwMCkgOiAwKSArIFwiJVwiLCB0aGlzLmNvbENvbG9yKGkpKTtcbiAgICAgIGVsc2Ugc3RhdChsYWJlbCwgU3RyaW5nKGNudCksIHRoaXMuY29sQ29sb3IoaSkpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gLS0tLSBCb2FyZCBiYXIgKG5hbWUgKyBkZWxldGUgYm9hcmQgKyBhZGQgY29sdW1uKSAtLS0tXG4gIHByaXZhdGUgcmVuZGVyQm9hcmRCYXIocm9vdDogSFRNTEVsZW1lbnQsIGJvYXJkczogQm9hcmRbXSk6IHZvaWQge1xuICAgIGNvbnN0IGJhciA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWJvYXJkLWJhclwiIH0pO1xuICAgIGNvbnN0IGJvYXJkID0gYm9hcmRzLmZpbmQoKGIpID0+IGIubmFtZSA9PT0gdGhpcy5jdXJyZW50Qm9hcmQpO1xuICAgIGJhci5jcmVhdGVEaXYoeyB0ZXh0OiBib2FyZCA/IGAke2JvYXJkLmVtb2ppIHx8IFwiXCJ9ICR7Ym9hcmQubmFtZX1gLnRyaW0oKSA6IFwiXHVEODNEXHVEQ0NCIEFsbCBib2FyZHNcIiwgY2xzOiBcInBhLWJvYXJkLXRpdGxlXCIgfSk7XG5cbiAgICBjb25zdCBhY3Rpb25zID0gYmFyLmNyZWF0ZURpdih7IGNsczogXCJwYS1ib2FyZC1hY3Rpb25zXCIgfSk7XG4gICAgaWYgKGJvYXJkKSB7XG4gICAgICBjb25zdCByZW5hbWVCdG4gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdTI3MEZcdUZFMEYgUmVuYW1lXCIsIGNsczogXCJwYS1taW5pLWJ0blwiIH0pO1xuICAgICAgcmVuYW1lQnRuLm9uY2xpY2sgPSAoKSA9PiB0aGlzLm9wZW5SZW5hbWVCb2FyZE1vZGFsKGJvYXJkLCBib2FyZHMpO1xuICAgICAgY29uc3QgZGVsQnRuID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiXHVEODNEXHVEREQxIERlbGV0ZSBib2FyZFwiLCBjbHM6IFwicGEtbWluaS1idG5cIiB9KTtcbiAgICAgIGRlbEJ0bi5vbmNsaWNrID0gKCkgPT5cbiAgICAgICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmN0eC5hcHAsIGBEZWxldGUgYm9hcmQgXCIke2JvYXJkLm5hbWV9XCI/ICh0YXNrcyBhcmUga2VwdCwganVzdCB1bnRhZ2dlZCBmcm9tIHRoaXMgYm9hcmQgdmlldylgLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5jdHguc3RvcmUuc2F2ZUJvYXJkcyhib2FyZHMuZmlsdGVyKChiKSA9PiBiLm5hbWUgIT09IGJvYXJkLm5hbWUpKTtcbiAgICAgICAgICB0aGlzLmN1cnJlbnRCb2FyZCA9IFwiYWxsXCI7XG4gICAgICAgICAgdGhpcy5jdHgucmVmcmVzaCgpO1xuICAgICAgICB9KS5vcGVuKCk7XG4gICAgfVxuICAgIGNvbnN0IGFkZENvbCA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIisgQ29sdW1uXCIsIGNsczogXCJwYS1taW5pLWJ0blwiIH0pO1xuICAgIGFkZENvbC5vbmNsaWNrID0gKCkgPT4gdGhpcy5vcGVuQWRkQ29sdW1uTW9kYWwoKTtcbiAgfVxuXG4gIHByaXZhdGUgb3BlblJlbmFtZUJvYXJkTW9kYWwoYm9hcmQ6IEJvYXJkLCBib2FyZHM6IEJvYXJkW10pOiB2b2lkIHtcbiAgICBjb25zdCBmaWVsZHM6IEZpZWxkU3BlY1tdID0gW1xuICAgICAgeyBrZXk6IFwibmFtZVwiLCBsYWJlbDogXCJCb2FyZCBuYW1lXCIsIHR5cGU6IFwidGV4dFwiLCB2YWx1ZTogYm9hcmQubmFtZSB9LFxuICAgICAgeyBrZXk6IFwiZW1vamlcIiwgbGFiZWw6IFwiRW1vamlcIiwgdHlwZTogXCJ0ZXh0XCIsIHZhbHVlOiBib2FyZC5lbW9qaSB8fCBcIlwiIH0sXG4gICAgXTtcbiAgICBuZXcgRm9ybU1vZGFsKHRoaXMuY3R4LmFwcCwgXCJSZW5hbWUgYm9hcmRcIiwgZmllbGRzLCBhc3luYyAodikgPT4ge1xuICAgICAgY29uc3QgbmFtZSA9ICh2Lm5hbWUgfHwgXCJcIikudHJpbSgpO1xuICAgICAgaWYgKCFuYW1lKSByZXR1cm47XG4gICAgICBpZiAobmFtZSAhPT0gYm9hcmQubmFtZSAmJiBib2FyZHMuc29tZSgoYikgPT4gYi5uYW1lID09PSBuYW1lKSkgeyB0b2FzdChgQSBib2FyZCBuYW1lZCBcIiR7bmFtZX1cIiBhbHJlYWR5IGV4aXN0cy5gKTsgcmV0dXJuOyB9XG4gICAgICBjb25zdCB1cGRhdGVkID0gYm9hcmRzLm1hcCgoYikgPT4gKGIubmFtZSA9PT0gYm9hcmQubmFtZSA/IHsgLi4uYiwgbmFtZSwgZW1vamk6ICh2LmVtb2ppIHx8IFwiXCIpLnRyaW0oKSB9IDogYikpO1xuICAgICAgYXdhaXQgdGhpcy5jdHguc3RvcmUuc2F2ZUJvYXJkcyh1cGRhdGVkKTtcbiAgICAgIGlmIChuYW1lICE9PSBib2FyZC5uYW1lKSB7XG4gICAgICAgIGZvciAoY29uc3QgdCBvZiB0aGlzLmN0eC5zdG9yZS5sb2FkVGFza3MoKS5maWx0ZXIoKHQpID0+IHQua2FuYmFuTmFtZSA9PT0gYm9hcmQubmFtZSkpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmN0eC5zdG9yZS51cGRhdGVUYXNrKHQsIHsga2FuYmFuTmFtZTogbmFtZSB9KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5jdXJyZW50Qm9hcmQgPT09IGJvYXJkLm5hbWUpIHRoaXMuY3VycmVudEJvYXJkID0gbmFtZTtcbiAgICAgIH1cbiAgICAgIHRoaXMuY3R4LnJlZnJlc2goKTtcbiAgICAgIHRvYXN0KFwiQm9hcmQgdXBkYXRlZFwiKTtcbiAgICB9LCBcIlNhdmVcIikub3BlbigpO1xuICB9XG5cbiAgLy8gLS0tLSBLYW5iYW4gLS0tLVxuICBwcml2YXRlIHJlbmRlckthbmJhbihyb290OiBIVE1MRWxlbWVudCwgZmlsdGVyZWQ6IFRhc2tbXSwgYm9hcmRzOiBCb2FyZFtdKTogdm9pZCB7XG4gICAgY29uc3QgY29scyA9IHRoaXMuY3R4LmNvbmZpZy50YXNrQ29sdW1ucztcbiAgICBjb25zdCBuYW1lcyA9IHRoaXMuY3R4LmNvbmZpZy50YXNrQ29sdW1uTmFtZXM7XG4gICAgY29uc3QgY29sU2V0ID0gbmV3IFNldChjb2xzKTtcbiAgICBjb25zdCBlZmYgPSAodDogVGFzaykgPT4gKGNvbFNldC5oYXModC5zdGF0dXMpID8gdC5zdGF0dXMgOiBjb2xzWzBdKTtcblxuICAgIGNvbnN0IGJvYXJkID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwicGEta2FuYmFuXCIgfSk7XG4gICAgY29scy5mb3JFYWNoKChjb2wsIGkpID0+IHtcbiAgICAgIGNvbnN0IGNvbG9yID0gdGhpcy5jb2xDb2xvcihpKTtcbiAgICAgIGNvbnN0IGlzTGFzdCA9IGkgPT09IGNvbHMubGVuZ3RoIC0gMTtcbiAgICAgIGNvbnN0IGNvbEVsID0gYm9hcmQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWNvbFwiIH0pO1xuICAgICAgY29sRWwuc3R5bGUuYm9yZGVyQ29sb3IgPSBjb2xvcjtcbiAgICAgIGNvbnN0IGNvbFRhc2tzID0gZmlsdGVyZWQuZmlsdGVyKCh0KSA9PiBlZmYodCkgPT09IGNvbCk7XG5cbiAgICAgIGNvbnN0IGhlYWQgPSBjb2xFbC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtY29sLWhlYWRcIiB9KTtcbiAgICAgIGNvbnN0IHRpdGxlID0gaGVhZC5jcmVhdGVTcGFuKHsgdGV4dDogbmFtZXNbY29sXSB8fCBjb2wsIGNsczogXCJwYS1jb2wtdGl0bGVcIiB9KTtcbiAgICAgIHRpdGxlLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBjb25zdCB0b29scyA9IGhlYWQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWNvbC10b29sc1wiIH0pO1xuICAgICAgY29uc3QgY291bnQgPSB0b29scy5jcmVhdGVTcGFuKHsgdGV4dDogU3RyaW5nKGNvbFRhc2tzLmxlbmd0aCksIGNsczogXCJwYS1jb2wtY291bnRcIiB9KTtcbiAgICAgIGNvdW50LnN0eWxlLmJhY2tncm91bmQgPSBjb2xvcjtcbiAgICAgIGlmIChpID4gMCkge1xuICAgICAgICBjb25zdCBtdkwgPSB0b29scy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiXHUyNUMwXCIsIGNsczogXCJwYS1pY29uLWJ0blwiIH0pO1xuICAgICAgICBtdkwub25jbGljayA9ICgpID0+IHRoaXMubW92ZUNvbHVtbihjb2wsIC0xKTtcbiAgICAgIH1cbiAgICAgIGlmIChpIDwgY29scy5sZW5ndGggLSAxKSB7XG4gICAgICAgIGNvbnN0IG12UiA9IHRvb2xzLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdTI1QjZcIiwgY2xzOiBcInBhLWljb24tYnRuXCIgfSk7XG4gICAgICAgIG12Ui5vbmNsaWNrID0gKCkgPT4gdGhpcy5tb3ZlQ29sdW1uKGNvbCwgMSk7XG4gICAgICB9XG4gICAgICBjb25zdCBlZGl0QyA9IHRvb2xzLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdTI3MEZcdUZFMEZcIiwgY2xzOiBcInBhLWljb24tYnRuXCIgfSk7XG4gICAgICBlZGl0Qy5vbmNsaWNrID0gKCkgPT4gdGhpcy5vcGVuUmVuYW1lQ29sdW1uTW9kYWwoY29sKTtcbiAgICAgIGNvbnN0IGRlbEMgPSB0b29scy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiXHUyNzE1XCIsIGNsczogXCJwYS1pY29uLWJ0blwiIH0pO1xuICAgICAgZGVsQy5vbmNsaWNrID0gKCkgPT4gdGhpcy5yZW1vdmVDb2x1bW4oY29sLCBmaWx0ZXJlZCk7XG5cbiAgICAgIGNvbnN0IGxpc3QgPSBjb2xFbC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtY29sLWJvZHlcIiB9KTtcbiAgICAgIGxpc3QuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdvdmVyXCIsIChlKSA9PiB7IGUucHJldmVudERlZmF1bHQoKTsgbGlzdC5hZGRDbGFzcyhcInBhLWRyb3BcIik7IH0pO1xuICAgICAgbGlzdC5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2xlYXZlXCIsICgpID0+IGxpc3QucmVtb3ZlQ2xhc3MoXCJwYS1kcm9wXCIpKTtcbiAgICAgIGxpc3QuYWRkRXZlbnRMaXN0ZW5lcihcImRyb3BcIiwgYXN5bmMgKGUpID0+IHtcbiAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBsaXN0LnJlbW92ZUNsYXNzKFwicGEtZHJvcFwiKTtcbiAgICAgICAgY29uc3QgcGF0aCA9IGUuZGF0YVRyYW5zZmVyPy5nZXREYXRhKFwidGV4dC9wbGFpblwiKTtcbiAgICAgICAgY29uc3QgdGFzayA9IGZpbHRlcmVkLmZpbmQoKHQpID0+IHQucGF0aCA9PT0gcGF0aCk7XG4gICAgICAgIGlmICh0YXNrICYmIHRhc2suc3RhdHVzICE9PSBjb2wpIHsgYXdhaXQgdGhpcy5jdHguc3RvcmUudXBkYXRlVGFzayh0YXNrLCB7IHN0YXR1czogY29sIH0pOyB0aGlzLmN0eC5yZWZyZXNoKCk7IH1cbiAgICAgIH0pO1xuXG4gICAgICBjb2xUYXNrcy5zbGljZSgwLCBpc0xhc3QgJiYgY29sVGFza3MubGVuZ3RoID4gNyA/IDcgOiBjb2xUYXNrcy5sZW5ndGgpXG4gICAgICAgIC5mb3JFYWNoKCh0KSA9PiB0aGlzLnJlbmRlckNhcmQobGlzdCwgdCwgY29scywgZWZmKHQpLCBpc0xhc3QpKTtcblxuICAgICAgaWYgKGlzTGFzdCAmJiBjb2xUYXNrcy5sZW5ndGggPiA3KSB7XG4gICAgICAgIGNvbnN0IGRldCA9IGxpc3QuY3JlYXRlRWwoXCJkZXRhaWxzXCIsIHsgY2xzOiBcInBhLWNvbXBsZXRlZCBwYS1rYW5iYW4tbW9yZVwiIH0pO1xuICAgICAgICBkZXQuY3JlYXRlRWwoXCJzdW1tYXJ5XCIsIHsgdGV4dDogYFNob3cgJHtjb2xUYXNrcy5sZW5ndGggLSA3fSBtb3JlYCB9KTtcbiAgICAgICAgY29sVGFza3Muc2xpY2UoNykuZm9yRWFjaCgodCkgPT4gdGhpcy5yZW5kZXJDYXJkKGRldCwgdCwgY29scywgZWZmKHQpLCBpc0xhc3QpKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWRkQnRuID0gY29sRWwuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIisgQWRkIGNhcmRcIiwgY2xzOiBcInBhLWFkZC1jYXJkXCIgfSk7XG4gICAgICBhZGRCdG4ub25jbGljayA9ICgpID0+IHRoaXMub3BlblRhc2tNb2RhbChudWxsLCBjb2wsIGJvYXJkcyk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckNhcmQobGlzdDogSFRNTEVsZW1lbnQsIHQ6IFRhc2ssIGNvbHM6IHN0cmluZ1tdLCBjdXJyZW50OiBzdHJpbmcsIGlzRG9uZUNvbDogYm9vbGVhbik6IHZvaWQge1xuICAgIGNvbnN0IGNhcmQgPSBsaXN0LmNyZWF0ZURpdih7IGNsczogXCJwYS1jYXJkIHBhLXRhc2sgcHJpby1cIiArICh0LnByaW9yaXR5IHx8IFwibWVkaXVtXCIpICsgKGlzRG9uZUNvbCA/IFwiIGRvbmVcIiA6IFwiXCIpIH0pO1xuICAgIGNhcmQuc2V0QXR0cihcImRyYWdnYWJsZVwiLCBcInRydWVcIik7XG4gICAgY2FyZC5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ3N0YXJ0XCIsIChlKSA9PiB7IGUuZGF0YVRyYW5zZmVyPy5zZXREYXRhKFwidGV4dC9wbGFpblwiLCB0LnBhdGgpOyBjYXJkLmFkZENsYXNzKFwicGEtZHJhZ2dpbmdcIik7IH0pO1xuICAgIGNhcmQuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdlbmRcIiwgKCkgPT4gY2FyZC5yZW1vdmVDbGFzcyhcInBhLWRyYWdnaW5nXCIpKTtcblxuICAgIGNvbnN0IGJhZGdlVGV4dCA9ICh0Lmdyb3VwIHx8IHQuY2F0IHx8IHQua2FuYmFuTmFtZSB8fCBcIlwiKS50b1VwcGVyQ2FzZSgpO1xuICAgIGNvbnN0IHRvcFJvdyA9IGNhcmQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWNhcmQtdG9wXCIgfSk7XG4gICAgaWYgKGJhZGdlVGV4dCkgdG9wUm93LmNyZWF0ZURpdih7IHRleHQ6IGJhZGdlVGV4dCwgY2xzOiBcInBhLWNhcmQtY2F0XCIgfSk7XG4gICAgY29uc3QgZGVsID0gdG9wUm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdTI3MTVcIiwgY2xzOiBcInBhLWljb24tYnRuIHBhLWNhcmQteFwiIH0pO1xuICAgIGRlbC5vbmNsaWNrID0gKCkgPT5cbiAgICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5jdHguYXBwLCBgRGVsZXRlIHRhc2sgXCIke3QudGl0bGV9XCI/YCwgYXN5bmMgKCkgPT4geyBhd2FpdCB0aGlzLmN0eC5zdG9yZS5kZWxldGVUYXNrKHQpOyB0aGlzLmN0eC5yZWZyZXNoKCk7IH0pLm9wZW4oKTtcblxuICAgIGNhcmQuY3JlYXRlRWwoXCJkaXZcIiwgeyB0ZXh0OiB0LnRpdGxlLCBjbHM6IFwicGEtY2FyZC10aXRsZVwiIH0pO1xuICAgIGNvbnN0IGRhdGVTdHIgPSAodC5jcmVhdGVkIHx8IFwiXCIpLnN1YnN0cmluZygwLCAxMCk7XG4gICAgY2FyZC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtbXV0ZWQgcGEtY2FyZC1tZXRhXCIsIHRleHQ6IFt0LnByaW9yaXR5LCBkYXRlU3RyXS5maWx0ZXIoQm9vbGVhbikuam9pbihcIiBcdTAwQjcgXCIpIH0pO1xuXG4gICAgY29uc3QgYWN0aW9ucyA9IGNhcmQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWNhcmQtYWN0aW9uc1wiIH0pO1xuICAgIGNvbnN0IGlkeCA9IGNvbHMuaW5kZXhPZihjdXJyZW50KTtcbiAgICBpZiAoaWR4ID4gMCkge1xuICAgICAgY29uc3QgbGVmdCA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjE5MFwiLCBjbHM6IFwicGEtaWNvbi1idG5cIiB9KTtcbiAgICAgIGxlZnQub25jbGljayA9IGFzeW5jICgpID0+IHsgYXdhaXQgdGhpcy5jdHguc3RvcmUudXBkYXRlVGFzayh0LCB7IHN0YXR1czogY29sc1tpZHggLSAxXSB9KTsgdGhpcy5jdHgucmVmcmVzaCgpOyB9O1xuICAgIH1cbiAgICBpZiAoaWR4IDwgY29scy5sZW5ndGggLSAxKSB7XG4gICAgICBjb25zdCByaWdodCA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjE5MlwiLCBjbHM6IFwicGEtaWNvbi1idG5cIiB9KTtcbiAgICAgIHJpZ2h0Lm9uY2xpY2sgPSBhc3luYyAoKSA9PiB7IGF3YWl0IHRoaXMuY3R4LnN0b3JlLnVwZGF0ZVRhc2sodCwgeyBzdGF0dXM6IGNvbHNbaWR4ICsgMV0gfSk7IHRoaXMuY3R4LnJlZnJlc2goKTsgfTtcbiAgICB9XG4gICAgY29uc3QgZWRpdCA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjcwRlx1RkUwRlwiLCBjbHM6IFwicGEtaWNvbi1idG5cIiB9KTtcbiAgICBlZGl0Lm9uY2xpY2sgPSAoKSA9PiB0aGlzLm9wZW5UYXNrTW9kYWwodCwgdC5zdGF0dXMsIHRoaXMuY3R4LnN0b3JlLmxvYWRCb2FyZHMoKSk7XG4gICAgY29uc3Qgb3BlbiA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1RDgzRFx1REQxN1wiLCBjbHM6IFwicGEtaWNvbi1idG5cIiB9KTtcbiAgICBvcGVuLm9uY2xpY2sgPSAoKSA9PiB0aGlzLmN0eC5hcHAud29ya3NwYWNlLm9wZW5MaW5rVGV4dCh0LnBhdGgsIFwiXCIsIHRydWUpO1xuICB9XG5cbiAgLy8gLS0tLSBMaXN0IHZpZXcgKHNpbmdsZSBsaXN0IHBlciBib2FyZCwgd2l0aCBjb2xsYXBzZWQgQ29tcGxldGVkKSAtLS0tXG4gIHByaXZhdGUgcmVuZGVyTGlzdChyb290OiBIVE1MRWxlbWVudCwgZmlsdGVyZWQ6IFRhc2tbXSk6IHZvaWQge1xuICAgIGNvbnN0IGNvbHMgPSB0aGlzLmN0eC5jb25maWcudGFza0NvbHVtbnM7XG4gICAgY29uc3QgZmlyc3RDb2wgPSBjb2xzWzBdO1xuICAgIGNvbnN0IGxhc3RDb2wgPSBjb2xzW2NvbHMubGVuZ3RoIC0gMV07XG4gICAgY29uc3QgY29sU2V0ID0gbmV3IFNldChjb2xzKTtcbiAgICBjb25zdCBlZmYgPSAodDogVGFzaykgPT4gKGNvbFNldC5oYXModC5zdGF0dXMpID8gdC5zdGF0dXMgOiBjb2xzWzBdKTtcbiAgICBjb25zdCBpc0RvbmUgPSAodDogVGFzaykgPT4gZWZmKHQpID09PSBsYXN0Q29sO1xuICAgIGNvbnN0IGJvYXJkcyA9IHRoaXMuY3R4LnN0b3JlLmxvYWRCb2FyZHMoKTtcblxuICAgIHJvb3QuY3JlYXRlRGl2KHsgdGV4dDogXCJcdUQ4M0RcdURDREQgTGlzdCBkZSBUYXNrc1wiLCBjbHM6IFwicGEtaDJcIiB9KTtcbiAgICBpZiAoIWZpbHRlcmVkLmxlbmd0aCkgeyByb290LmNyZWF0ZUVsKFwicFwiLCB7IGNsczogXCJwYS1tdXRlZFwiLCB0ZXh0OiBcIk5vIHRhc2tzLlwiIH0pOyByZXR1cm47IH1cblxuICAgIGNvbnN0IGdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBUYXNrW10+KCk7XG4gICAgZmlsdGVyZWQuZm9yRWFjaCgodCkgPT4geyBjb25zdCBrID0gdC5rYW5iYW5OYW1lIHx8IFwiTm8gYm9hcmRcIjsgaWYgKCFncm91cHMuaGFzKGspKSBncm91cHMuc2V0KGssIFtdKTsgZ3JvdXBzLmdldChrKSEucHVzaCh0KTsgfSk7XG5cbiAgICBjb25zdCB3cmFwID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtbGlzdC1jYXJkc1wiIH0pO1xuICAgIGdyb3Vwcy5mb3JFYWNoKCh0YXNrcywgYm9hcmROYW1lKSA9PiB7XG4gICAgICBjb25zdCBjYXJkID0gd3JhcC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtbGlzdC1jYXJkXCIgfSk7XG4gICAgICBjYXJkLmNyZWF0ZURpdih7IHRleHQ6IGJvYXJkTmFtZSwgY2xzOiBcInBhLWxpc3QtY2FyZC10aXRsZVwiIH0pO1xuICAgICAgY29uc3QgYWRkID0gY2FyZC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtbGlzdC1hZGRcIiwgdGV4dDogXCJcdTI3MEZcdUZFMEYgQWRkIGEgdGFza1wiIH0pO1xuICAgICAgYWRkLm9uY2xpY2sgPSAoKSA9PiB0aGlzLm9wZW5UYXNrTW9kYWwobnVsbCwgZmlyc3RDb2wsIGJvYXJkcywgYm9hcmROYW1lID09PSBcIk5vIGJvYXJkXCIgPyBcIlwiIDogYm9hcmROYW1lKTtcblxuICAgICAgY29uc3Qgb3BlbiA9IHRhc2tzLmZpbHRlcigodCkgPT4gIWlzRG9uZSh0KSk7XG4gICAgICBjb25zdCBkb25lID0gdGFza3MuZmlsdGVyKCh0KSA9PiBpc0RvbmUodCkpO1xuICAgICAgb3Blbi5mb3JFYWNoKCh0KSA9PiB0aGlzLnJlbmRlckxpc3RJdGVtKGNhcmQsIHQsIGZhbHNlLCBsYXN0Q29sLCBmaXJzdENvbCkpO1xuXG4gICAgICBpZiAoZG9uZS5sZW5ndGgpIHtcbiAgICAgICAgY29uc3QgZGV0ID0gY2FyZC5jcmVhdGVFbChcImRldGFpbHNcIiwgeyBjbHM6IFwicGEtY29tcGxldGVkXCIgfSk7XG4gICAgICAgIGRldC5jcmVhdGVFbChcInN1bW1hcnlcIiwgeyB0ZXh0OiBgQ29tcGxldGVkICgke2RvbmUubGVuZ3RofSlgIH0pO1xuICAgICAgICBkb25lLmZvckVhY2goKHQpID0+IHRoaXMucmVuZGVyTGlzdEl0ZW0oZGV0LCB0LCB0cnVlLCBsYXN0Q29sLCBmaXJzdENvbCkpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJMaXN0SXRlbShwYXJlbnQ6IEhUTUxFbGVtZW50LCB0OiBUYXNrLCBkb25lOiBib29sZWFuLCBsYXN0Q29sOiBzdHJpbmcsIGZpcnN0Q29sOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCByb3cgPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWxpc3QtaXRlbVwiICsgKGRvbmUgPyBcIiBkb25lXCIgOiBcIlwiKSB9KTtcbiAgICBjb25zdCBjaXJjbGUgPSByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJwYS1saXN0LWNpcmNsZVwiICsgKGRvbmUgPyBcIiBvblwiIDogXCJcIiksIHRleHQ6IGRvbmUgPyBcIlx1MjVDRlwiIDogXCJcdTI1Q0JcIiB9KTtcbiAgICBjaXJjbGUub25jbGljayA9IGFzeW5jICgpID0+IHsgYXdhaXQgdGhpcy5jdHguc3RvcmUudXBkYXRlVGFzayh0LCB7IHN0YXR1czogZG9uZSA/IGZpcnN0Q29sIDogbGFzdENvbCB9KTsgdGhpcy5jdHgucmVmcmVzaCgpOyB9O1xuICAgIGNvbnN0IG1haW4gPSByb3cuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWxpc3QtaXRlbS1tYWluXCIgfSk7XG4gICAgY29uc3QgdGl0bGUgPSBtYWluLmNyZWF0ZURpdih7IHRleHQ6IHQudGl0bGUsIGNsczogXCJwYS1saXN0LWl0ZW0tdGl0bGVcIiB9KTtcbiAgICB0aXRsZS5vbmNsaWNrID0gKCkgPT4gdGhpcy5jdHguYXBwLndvcmtzcGFjZS5vcGVuTGlua1RleHQodC5wYXRoLCBcIlwiLCB0cnVlKTtcbiAgICBpZiAodC5ncm91cCkgbWFpbi5jcmVhdGVEaXYoeyB0ZXh0OiB0Lmdyb3VwLCBjbHM6IFwicGEtbXV0ZWQgcGEtbGlzdC1pdGVtLXN1YlwiIH0pO1xuICB9XG5cbiAgLy8gLS0tLSBNb2RhbHMgJiBjb2x1bW4gbWFuYWdlbWVudCAtLS0tXG4gIHByaXZhdGUgb3BlbkJvYXJkTW9kYWwoYm9hcmRzOiBCb2FyZFtdKTogdm9pZCB7XG4gICAgY29uc3QgZmllbGRzOiBGaWVsZFNwZWNbXSA9IFtcbiAgICAgIHsga2V5OiBcIm5hbWVcIiwgbGFiZWw6IFwiQm9hcmQgbmFtZVwiLCB0eXBlOiBcInRleHRcIiB9LFxuICAgICAgeyBrZXk6IFwiZW1vamlcIiwgbGFiZWw6IFwiRW1vamlcIiwgdHlwZTogXCJ0ZXh0XCIsIHBsYWNlaG9sZGVyOiBcIlx1RDgzRFx1RENDQlwiIH0sXG4gICAgXTtcbiAgICBuZXcgRm9ybU1vZGFsKHRoaXMuY3R4LmFwcCwgXCJOZXcgYm9hcmRcIiwgZmllbGRzLCBhc3luYyAodikgPT4ge1xuICAgICAgY29uc3QgbmFtZSA9ICh2Lm5hbWUgfHwgXCJcIikudHJpbSgpO1xuICAgICAgaWYgKCFuYW1lKSByZXR1cm47XG4gICAgICBpZiAoYm9hcmRzLnNvbWUoKGIpID0+IGIubmFtZSA9PT0gbmFtZSkpIHsgdGhpcy5jdXJyZW50Qm9hcmQgPSBuYW1lOyB0aGlzLmN0eC5yZWZyZXNoKCk7IHJldHVybjsgfVxuICAgICAgYm9hcmRzLnB1c2goeyBpZDogbmFtZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1xccysvZywgXCItXCIpLCBuYW1lLCBlbW9qaTogKHYuZW1vamkgfHwgXCJcIikudHJpbSgpIH0pO1xuICAgICAgYXdhaXQgdGhpcy5jdHguc3RvcmUuc2F2ZUJvYXJkcyhib2FyZHMpO1xuICAgICAgdGhpcy5jdXJyZW50Qm9hcmQgPSBuYW1lO1xuICAgICAgdGhpcy5jdHgucmVmcmVzaCgpO1xuICAgICAgdG9hc3QoXCJCb2FyZCBjcmVhdGVkXCIpO1xuICAgIH0pLm9wZW4oKTtcbiAgfVxuXG4gIHByaXZhdGUgb3BlblRhc2tNb2RhbCh0YXNrOiBUYXNrIHwgbnVsbCwgZGVmYXVsdFN0YXR1czogc3RyaW5nLCBib2FyZHM6IEJvYXJkW10sIGRlZmF1bHRCb2FyZD86IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IGJvYXJkT3B0aW9ucyA9IFt7IHZhbHVlOiBcIlwiLCBsYWJlbDogXCJcdTIwMTQgbm9uZSBcdTIwMTRcIiB9XS5jb25jYXQoYm9hcmRzLm1hcCgoYikgPT4gKHsgdmFsdWU6IGIubmFtZSwgbGFiZWw6IGIubmFtZSB9KSkpO1xuICAgIGNvbnN0IGNvbE9wdGlvbnMgPSB0aGlzLmN0eC5jb25maWcudGFza0NvbHVtbnMubWFwKChjKSA9PiAoeyB2YWx1ZTogYywgbGFiZWw6IHRoaXMuY3R4LmNvbmZpZy50YXNrQ29sdW1uTmFtZXNbY10gfHwgYyB9KSk7XG4gICAgY29uc3QgcHJlc2V0Qm9hcmQgPSB0YXNrPy5rYW5iYW5OYW1lIHx8IGRlZmF1bHRCb2FyZCB8fCAodGhpcy5jdXJyZW50Qm9hcmQgIT09IFwiYWxsXCIgPyB0aGlzLmN1cnJlbnRCb2FyZCA6IFwiXCIpO1xuICAgIGNvbnN0IGZpZWxkczogRmllbGRTcGVjW10gPSBbXG4gICAgICB7IGtleTogXCJ0aXRsZVwiLCBsYWJlbDogXCJUaXRsZVwiLCB0eXBlOiBcInRleHRcIiwgdmFsdWU6IHRhc2s/LnRpdGxlIHx8IFwiXCIgfSxcbiAgICAgIHsga2V5OiBcInN0YXR1c1wiLCBsYWJlbDogXCJDb2x1bW5cIiwgdHlwZTogXCJkcm9wZG93blwiLCBvcHRpb25zOiBjb2xPcHRpb25zLCB2YWx1ZTogdGFzaz8uc3RhdHVzIHx8IGRlZmF1bHRTdGF0dXMgfSxcbiAgICAgIHsga2V5OiBcInByaW9yaXR5XCIsIGxhYmVsOiBcIlByaW9yaXR5XCIsIHR5cGU6IFwiZHJvcGRvd25cIiwgb3B0aW9uczogUFJJT1JJVElFUywgdmFsdWU6IHRhc2s/LnByaW9yaXR5IHx8IFwibWVkaXVtXCIgfSxcbiAgICAgIHsga2V5OiBcImthbmJhbk5hbWVcIiwgbGFiZWw6IFwiQm9hcmRcIiwgdHlwZTogXCJkcm9wZG93blwiLCBvcHRpb25zOiBib2FyZE9wdGlvbnMsIHZhbHVlOiBwcmVzZXRCb2FyZCB9LFxuICAgICAgeyBrZXk6IFwiZ3JvdXBcIiwgbGFiZWw6IFwiR3JvdXAgLyB0YWdcIiwgdHlwZTogXCJ0ZXh0XCIsIHZhbHVlOiB0YXNrPy5ncm91cCB8fCBcIlwiIH0sXG4gICAgICB7IGtleTogXCJkdWVcIiwgbGFiZWw6IFwiRHVlIGRhdGVcIiwgdHlwZTogXCJ0ZXh0XCIsIHZhbHVlOiB0YXNrPy5kdWUgfHwgXCJcIiwgcGxhY2Vob2xkZXI6IFwiWVlZWS1NTS1ERFwiIH0sXG4gICAgXTtcbiAgICBuZXcgRm9ybU1vZGFsKHRoaXMuY3R4LmFwcCwgdGFzayA/IFwiRWRpdCB0YXNrXCIgOiBcIk5ldyB0YXNrXCIsIGZpZWxkcywgYXN5bmMgKHYpID0+IHtcbiAgICAgIGlmICghKHYudGl0bGUgfHwgXCJcIikudHJpbSgpKSByZXR1cm47XG4gICAgICBjb25zdCBkYXRhID0geyB0aXRsZTogdi50aXRsZS50cmltKCksIHN0YXR1czogdi5zdGF0dXMsIHByaW9yaXR5OiB2LnByaW9yaXR5LCBrYW5iYW5OYW1lOiB2LmthbmJhbk5hbWUsIGdyb3VwOiB2Lmdyb3VwLCBkdWU6IHYuZHVlIH07XG4gICAgICBpZiAodGFzaykgYXdhaXQgdGhpcy5jdHguc3RvcmUudXBkYXRlVGFzayh0YXNrLCBkYXRhKTtcbiAgICAgIGVsc2UgYXdhaXQgdGhpcy5jdHguc3RvcmUuY3JlYXRlVGFzayhkYXRhKTtcbiAgICAgIHRoaXMuY3R4LnJlZnJlc2goKTtcbiAgICB9LCB0YXNrID8gXCJTYXZlXCIgOiBcIkNyZWF0ZVwiKS5vcGVuKCk7XG4gIH1cblxuICBwcml2YXRlIG9wZW5BZGRDb2x1bW5Nb2RhbCgpOiB2b2lkIHtcbiAgICBjb25zdCBjZmcgPSB0aGlzLmN0eC5jb25maWc7XG4gICAgaWYgKGNmZy50YXNrQ29sdW1ucy5sZW5ndGggPj0gNSkgeyB0b2FzdChcIk1heGltdW0gb2YgNSBjb2x1bW5zLlwiKTsgcmV0dXJuOyB9XG4gICAgbmV3IEZvcm1Nb2RhbCh0aGlzLmN0eC5hcHAsIFwiTmV3IGNvbHVtblwiLCBbeyBrZXk6IFwibmFtZVwiLCBsYWJlbDogXCJDb2x1bW4gbmFtZVwiLCB0eXBlOiBcInRleHRcIiwgcGxhY2Vob2xkZXI6IFwiUmV2aWV3LCBCbG9ja2VkXCIgfV0sIGFzeW5jICh2KSA9PiB7XG4gICAgICBjb25zdCBuYW1lID0gKHYubmFtZSB8fCBcIlwiKS50cmltKCk7XG4gICAgICBpZiAoIW5hbWUpIHJldHVybjtcbiAgICAgIGlmIChjZmcudGFza0NvbHVtbnMubGVuZ3RoID49IDUpIHsgdG9hc3QoXCJNYXhpbXVtIG9mIDUgY29sdW1ucy5cIik7IHJldHVybjsgfVxuICAgICAgY29uc3QgaWQgPSBuYW1lLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXowLTldL2csIFwiLVwiKTtcbiAgICAgIGlmIChjZmcudGFza0NvbHVtbnMuaW5jbHVkZXMoaWQpKSByZXR1cm47XG4gICAgICBjZmcudGFza0NvbHVtbnMucHVzaChpZCk7XG4gICAgICBjZmcudGFza0NvbHVtbk5hbWVzW2lkXSA9IG5hbWU7XG4gICAgICBhd2FpdCB0aGlzLmN0eC5zdG9yZS5zYXZlQ29uZmlnKGNmZyk7XG4gICAgICB0aGlzLmN0eC5yZWZyZXNoKCk7XG4gICAgfSwgXCJBZGRcIikub3BlbigpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBtb3ZlQ29sdW1uKGNvbDogc3RyaW5nLCBkaXI6IC0xIHwgMSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGNmZyA9IHRoaXMuY3R4LmNvbmZpZztcbiAgICBjb25zdCBpID0gY2ZnLnRhc2tDb2x1bW5zLmluZGV4T2YoY29sKTtcbiAgICBjb25zdCBqID0gaSArIGRpcjtcbiAgICBpZiAoaSA8IDAgfHwgaiA8IDAgfHwgaiA+PSBjZmcudGFza0NvbHVtbnMubGVuZ3RoKSByZXR1cm47XG4gICAgW2NmZy50YXNrQ29sdW1uc1tpXSwgY2ZnLnRhc2tDb2x1bW5zW2pdXSA9IFtjZmcudGFza0NvbHVtbnNbal0sIGNmZy50YXNrQ29sdW1uc1tpXV07XG4gICAgYXdhaXQgdGhpcy5jdHguc3RvcmUuc2F2ZUNvbmZpZyhjZmcpO1xuICAgIHRoaXMuY3R4LnJlZnJlc2goKTtcbiAgfVxuXG4gIHByaXZhdGUgb3BlblJlbmFtZUNvbHVtbk1vZGFsKGNvbDogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgY2ZnID0gdGhpcy5jdHguY29uZmlnO1xuICAgIGNvbnN0IGN1cnJlbnQgPSBjZmcudGFza0NvbHVtbk5hbWVzW2NvbF0gfHwgY29sO1xuICAgIG5ldyBGb3JtTW9kYWwodGhpcy5jdHguYXBwLCBcIlJlbmFtZSBjb2x1bW5cIiwgW3sga2V5OiBcIm5hbWVcIiwgbGFiZWw6IFwiTmV3IG5hbWVcIiwgdHlwZTogXCJ0ZXh0XCIsIHZhbHVlOiBjdXJyZW50IH1dLCBhc3luYyAodikgPT4ge1xuICAgICAgY29uc3QgbmFtZSA9ICh2Lm5hbWUgfHwgXCJcIikudHJpbSgpO1xuICAgICAgaWYgKCFuYW1lKSByZXR1cm47XG4gICAgICBjZmcudGFza0NvbHVtbk5hbWVzW2NvbF0gPSBuYW1lO1xuICAgICAgYXdhaXQgdGhpcy5jdHguc3RvcmUuc2F2ZUNvbmZpZyhjZmcpO1xuICAgICAgdGhpcy5jdHgucmVmcmVzaCgpO1xuICAgIH0sIFwiU2F2ZVwiKS5vcGVuKCk7XG4gIH1cblxuICBwcml2YXRlIHJlbW92ZUNvbHVtbihjb2w6IHN0cmluZywgdGFza3M6IFRhc2tbXSk6IHZvaWQge1xuICAgIGNvbnN0IGNmZyA9IHRoaXMuY3R4LmNvbmZpZztcbiAgICBpZiAoY2ZnLnRhc2tDb2x1bW5zLmxlbmd0aCA8PSAxKSB7IHRvYXN0KFwiWW91IG11c3Qga2VlcCBhdCBsZWFzdCBvbmUgY29sdW1uLlwiKTsgcmV0dXJuOyB9XG4gICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmN0eC5hcHAsIGBEZWxldGUgY29sdW1uIFwiJHt0aGlzLmNsZWFuTGFiZWwoY2ZnLnRhc2tDb2x1bW5OYW1lc1tjb2xdIHx8IGNvbCl9XCI/IFRhc2tzIG1vdmUgdG8gdGhlIGZpcnN0IGNvbHVtbi5gLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZW1haW5pbmcgPSBjZmcudGFza0NvbHVtbnMuZmlsdGVyKChjKSA9PiBjICE9PSBjb2wpO1xuICAgICAgY29uc3QgZmFsbGJhY2sgPSByZW1haW5pbmdbMF07XG4gICAgICBmb3IgKGNvbnN0IHQgb2YgdGFza3MuZmlsdGVyKCh0KSA9PiB0LnN0YXR1cyA9PT0gY29sKSkgYXdhaXQgdGhpcy5jdHguc3RvcmUudXBkYXRlVGFzayh0LCB7IHN0YXR1czogZmFsbGJhY2sgfSk7XG4gICAgICBjZmcudGFza0NvbHVtbnMgPSByZW1haW5pbmc7XG4gICAgICBkZWxldGUgY2ZnLnRhc2tDb2x1bW5OYW1lc1tjb2xdO1xuICAgICAgYXdhaXQgdGhpcy5jdHguc3RvcmUuc2F2ZUNvbmZpZyhjZmcpO1xuICAgICAgdGhpcy5jdHgucmVmcmVzaCgpO1xuICAgIH0pLm9wZW4oKTtcbiAgfVxufVxuIiwgImltcG9ydCB7IFBBQ29udGV4dCB9IGZyb20gXCIuLi9jb250ZXh0XCI7XG5pbXBvcnQgeyBFeGVyY2lzZSwgU3BsaXQsIFdvcmtvdXQsIFdvcmtvdXRFeGVyY2lzZSwgREVGQVVMVF9TUExJVFMgfSBmcm9tIFwiLi4vdHlwZXNcIjtcbmltcG9ydCB7IENvbmZpcm1Nb2RhbCwgRmllbGRTcGVjLCBGb3JtTW9kYWwsIHRvYXN0IH0gZnJvbSBcIi4uL3VpXCI7XG5pbXBvcnQgeyB0b2RheUxvY2FsLCB5bWQgfSBmcm9tIFwiLi4vdXRpbFwiO1xuaW1wb3J0IHsgZHJhd1JpbmcsIGRyYXdMaW5lQ2hhcnQsIExpbmVTZXJpZXMgfSBmcm9tIFwiLi4vY2hhcnRzXCI7XG5cbmNvbnN0IFNFUklFU19DT0xPUlMgPSBbXCIjN2MzYWVkXCIsIFwiI2Y1OWUwYlwiLCBcIiMxNmEzNGFcIiwgXCIjM2I4MmY2XCIsIFwiI2VjNDg5OVwiLCBcIiMwZWE1ZTlcIiwgXCIjZWY0NDQ0XCIsIFwiIzEwYjk4MVwiLCBcIiNhODU1ZjdcIl07XG5cbi8qKiBSZW5kZXJzIHRoZSBGaXRuZXNzIHBhZ2U6IG1vbnRobHkgcmluZ3MsIHdvcmtvdXQgcGxhbiwgc3RhdHMsIGNhbGVuZGFyLCB3ZWlnaHQgcHJvZ3Jlc3MgYW5kIGFuIGFjdGl2ZS13b3Jrb3V0IGZsb3cuICovXG5leHBvcnQgY2xhc3MgRml0bmVzc01vZHVsZSB7XG4gIHByaXZhdGUgY3R4OiBQQUNvbnRleHQ7XG4gIHByaXZhdGUgc2VsZWN0ZWRTcGxpdDogc3RyaW5nIHwgbnVsbCA9IG51bGw7IC8vIG9wZW4gd29ya291dCAoZWRpdCBtb2RlKVxuICBwcml2YXRlIHdvcmtvdXRBY3RpdmUgPSBmYWxzZTsgICAgICAgICAgICAgICAgLy8gdGltZXIgcnVubmluZyAvIGxvZ2dpbmcgc2Vzc2lvblxuICBwcml2YXRlIHNlbGVjdGVkRGF0ZTogc3RyaW5nIHwgbnVsbCA9IG51bGw7ICAvLyBjYWxlbmRhciBkYXkgZGV0YWlsXG4gIHByaXZhdGUgd2VpZ2h0U3BsaXQgPSBcIkFcIjsgICAgICAgICAgICAgICAgICAgIC8vIHdlaWdodC1wcm9ncmVzcyBjaGFydFxuICBwcml2YXRlIHN0YXJ0VGltZTogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2hlY2tlZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBwcml2YXRlIHRpbWVySWQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHRpbWVyRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2FsTW9udGg6IG51bWJlcjtcbiAgcHJpdmF0ZSBjYWxZZWFyOiBudW1iZXI7XG5cbiAgY29uc3RydWN0b3IoY3R4OiBQQUNvbnRleHQpIHtcbiAgICB0aGlzLmN0eCA9IGN0eDtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICAgIHRoaXMuY2FsTW9udGggPSBub3cuZ2V0TW9udGgoKTtcbiAgICB0aGlzLmNhbFllYXIgPSBub3cuZ2V0RnVsbFllYXIoKTtcbiAgfVxuXG4gIGRlc3Ryb3koKTogdm9pZCB7IHRoaXMuc3RvcFRpbWVyKCk7IH1cbiAgcHJpdmF0ZSBzdG9wVGltZXIoKTogdm9pZCB7IGlmICh0aGlzLnRpbWVySWQgIT0gbnVsbCkgeyB3aW5kb3cuY2xlYXJJbnRlcnZhbCh0aGlzLnRpbWVySWQpOyB0aGlzLnRpbWVySWQgPSBudWxsOyB9IH1cblxuICBwcml2YXRlIGdldFNwbGl0cygpOiBTcGxpdFtdIHtcbiAgICBjb25zdCBtYXAgPSBuZXcgTWFwPHN0cmluZywgU3BsaXQ+KCk7XG4gICAgREVGQVVMVF9TUExJVFMuZm9yRWFjaCgocykgPT4gbWFwLnNldChzLmlkLCB7IC4uLnMgfSkpO1xuICAgIHRoaXMuY3R4LnN0b3JlLmxvYWRTcGxpdHMoKS5mb3JFYWNoKChzKSA9PiBtYXAuc2V0KHMuaWQsIHMpKTtcbiAgICB0aGlzLmN0eC5jb25maWcuY3VzdG9tU3BsaXRzLmZvckVhY2goKHMpID0+IG1hcC5zZXQocy5pZCwgcykpO1xuICAgIHJldHVybiBBcnJheS5mcm9tKG1hcC52YWx1ZXMoKSk7XG4gIH1cblxuICByZW5kZXIocm9vdDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BUaW1lcigpO1xuICAgIHJvb3QuZW1wdHkoKTtcblxuICAgIGNvbnN0IGV4ZXJjaXNlcyA9IHRoaXMuY3R4LnN0b3JlLmxvYWRFeGVyY2lzZXMoKTtcbiAgICBjb25zdCB3b3Jrb3V0cyA9IHRoaXMuY3R4LnN0b3JlLmxvYWRXb3Jrb3V0cygpO1xuICAgIGNvbnN0IGd5bUxvZyA9IG5ldyBTZXQod29ya291dHMubWFwKCh3KSA9PiB3LmRhdGUpKTtcblxuICAgIHRoaXMucmVuZGVySGVhZGVyKHJvb3QsIHdvcmtvdXRzKTtcbiAgICB0aGlzLnJlbmRlcldvcmtvdXRQbGFuKHJvb3QsIGV4ZXJjaXNlcyk7XG4gICAgaWYgKHRoaXMuc2VsZWN0ZWRTcGxpdCkgdGhpcy5yZW5kZXJXb3Jrb3V0RWRpdG9yKHJvb3QsIGV4ZXJjaXNlcyk7XG4gICAgdGhpcy5yZW5kZXJTdGF0cyhyb290LCB3b3Jrb3V0cywgZ3ltTG9nKTtcblxuICAgIGNvbnN0IGNvbHMgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS10d28tY29sXCIgfSk7XG4gICAgdGhpcy5yZW5kZXJDYWxlbmRhcihjb2xzLCB3b3Jrb3V0cyk7XG4gICAgdGhpcy5yZW5kZXJXZWlnaHRQcm9ncmVzcyhjb2xzLCBleGVyY2lzZXMsIHdvcmtvdXRzKTtcblxuICAgIGlmICh0aGlzLnNlbGVjdGVkRGF0ZSkgdGhpcy5yZW5kZXJEYXlEZXRhaWwocm9vdCwgd29ya291dHMpO1xuICB9XG5cbiAgLy8gLS0tLSBIZWFkZXIgd2l0aCAzIG1vbnRobHkgcmluZ3MgLS0tLVxuICBwcml2YXRlIHJlbmRlckhlYWRlcihyb290OiBIVE1MRWxlbWVudCwgd29ya291dHM6IFdvcmtvdXRbXSk6IHZvaWQge1xuICAgIGNvbnN0IGhlYWQgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS1odC1oZWFkZXJcIiB9KTtcbiAgICBjb25zdCBsZWZ0ID0gaGVhZC5jcmVhdGVEaXYoKTtcbiAgICBsZWZ0LmNyZWF0ZURpdih7IHRleHQ6IFwiXHVEODNDXHVERkNCXHVGRTBGIEZpdG5lc3NcIiwgY2xzOiBcInBhLWgxXCIgfSk7XG4gICAgbGVmdC5jcmVhdGVEaXYoeyB0ZXh0OiBcIldvcmtvdXRzICYgcHJvZ3Jlc3NcIiwgY2xzOiBcInBhLW11dGVkXCIgfSk7XG5cbiAgICBjb25zdCByaW5ncyA9IGhlYWQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWh0LXJpbmdzXCIgfSk7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgICBjb25zdCBtb250aEFiYnIgPSBbXCJKYW5cIiwgXCJGZWJcIiwgXCJNYXJcIiwgXCJBcHJcIiwgXCJNYXlcIiwgXCJKdW5cIiwgXCJKdWxcIiwgXCJBdWdcIiwgXCJTZXBcIiwgXCJPY3RcIiwgXCJOb3ZcIiwgXCJEZWNcIl07XG4gICAgZm9yIChsZXQgbSA9IDI7IG0gPj0gMDsgbS0tKSB7XG4gICAgICBjb25zdCBkID0gbmV3IERhdGUobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpIC0gbSwgMSk7XG4gICAgICBjb25zdCB5ID0gZC5nZXRGdWxsWWVhcigpO1xuICAgICAgY29uc3QgbW9uID0gZC5nZXRNb250aCgpO1xuICAgICAgY29uc3QgcHJlZml4ID0gYCR7eX0tJHtTdHJpbmcobW9uICsgMSkucGFkU3RhcnQoMiwgXCIwXCIpfWA7XG4gICAgICBjb25zdCBpc0N1cnJlbnQgPSBtID09PSAwO1xuICAgICAgY29uc3QgZGF5c0VsYXBzZWQgPSBpc0N1cnJlbnQgPyBub3cuZ2V0RGF0ZSgpIDogbmV3IERhdGUoeSwgbW9uICsgMSwgMCkuZ2V0RGF0ZSgpO1xuICAgICAgY29uc3Qgd29ya291dERheXMgPSBuZXcgU2V0KHdvcmtvdXRzLmZpbHRlcigodykgPT4gdy5kYXRlLnN0YXJ0c1dpdGgocHJlZml4KSkubWFwKCh3KSA9PiB3LmRhdGUpKS5zaXplO1xuICAgICAgY29uc3QgcGN0ID0gZGF5c0VsYXBzZWQgPyBNYXRoLnJvdW5kKCh3b3Jrb3V0RGF5cyAvIGRheXNFbGFwc2VkKSAqIDEwMCkgOiAwO1xuICAgICAgY29uc3QgY29sb3IgPSBwY3QgPj0gNzAgPyBcIiMxNmEzNGFcIiA6IHBjdCA+PSAzMCA/IFwiIzdjM2FlZFwiIDogXCIjZDk3NzA2XCI7XG4gICAgICBkcmF3UmluZyhyaW5ncywgcGN0LCBjb2xvciwgYCR7bW9udGhBYmJyW21vbl19ICR7U3RyaW5nKHkpLnNsaWNlKDIpfSBcdTAwQjcgJHt3b3Jrb3V0RGF5c30vJHtkYXlzRWxhcHNlZH1kYCwgNTgpO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLS0gV29ya291dCBwbGFuIGNhcmRzIC0tLS1cbiAgcHJpdmF0ZSByZW5kZXJXb3Jrb3V0UGxhbihyb290OiBIVE1MRWxlbWVudCwgZXhlcmNpc2VzOiBFeGVyY2lzZVtdKTogdm9pZCB7XG4gICAgY29uc3Qgc3BsaXRzID0gdGhpcy5nZXRTcGxpdHMoKTtcbiAgICBjb25zdCBwYW5lbCA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXBhbmVsXCIgfSk7XG4gICAgcGFuZWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IGBcdUQ4M0RcdURDQ0IgV29ya291dCBQbGFuIFx1MjAxNCAke3NwbGl0cy5sZW5ndGh9IHNsb3RzIFx1MDBCNyB0YXAgYSBjYXJkIHRvIGVkaXRgLCBjbHM6IFwicGEtcGFuZWwtdGl0bGVcIiB9KTtcblxuICAgIGNvbnN0IGdyaWQgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtcGxhbi1ncmlkXCIgfSk7XG4gICAgc3BsaXRzLmZvckVhY2goKHMpID0+IHtcbiAgICAgIGNvbnN0IGV4cyA9IGV4ZXJjaXNlcy5maWx0ZXIoKGUpID0+IGUuc3BsaXQgPT09IHMuaWQpO1xuICAgICAgY29uc3QgY2FyZCA9IGdyaWQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXBsYW4tY2FyZCBwYS1jbGlja2FibGVcIiArICh0aGlzLnNlbGVjdGVkU3BsaXQgPT09IHMuaWQgPyBcIiBvblwiIDogXCJcIikgfSk7XG4gICAgICBjYXJkLm9uY2xpY2sgPSAoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLnNlbGVjdGVkU3BsaXQgPT09IHMuaWQpIHsgdGhpcy5lbmRXb3Jrb3V0KCk7IH1cbiAgICAgICAgZWxzZSB7IHRoaXMuc2VsZWN0ZWRTcGxpdCA9IHMuaWQ7IHRoaXMuc2VsZWN0ZWREYXRlID0gbnVsbDsgdGhpcy53ZWlnaHRTcGxpdCA9IHMuaWQ7IHRoaXMud29ya291dEFjdGl2ZSA9IGZhbHNlOyB0aGlzLnN0YXJ0VGltZSA9IG51bGw7IHRoaXMuY2hlY2tlZC5jbGVhcigpOyB9XG4gICAgICAgIHRoaXMuY3R4LnJlZnJlc2goKTtcbiAgICAgIH07XG4gICAgICBjb25zdCBjaCA9IGNhcmQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXBsYW4taGVhZFwiIH0pO1xuICAgICAgY2guY3JlYXRlU3Bhbih7IHRleHQ6IGAke3MuaWR9IC0gJHtzLm5hbWV9ICgke2V4cy5sZW5ndGh9IGV4KWAsIGNsczogXCJwYS1wbGFuLXRpdGxlXCIgfSk7XG4gICAgICBjb25zdCBsaXN0RWwgPSBjYXJkLmNyZWF0ZURpdih7IGNsczogXCJwYS1wbGFuLWxpc3RcIiB9KTtcbiAgICAgIGlmICghZXhzLmxlbmd0aCkgbGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJwYS1tdXRlZFwiLCB0ZXh0OiBcIk5vIGV4ZXJjaXNlc1wiIH0pO1xuICAgICAgZWxzZSBleHMuZm9yRWFjaCgoZXgpID0+IGxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtcGxhbi1leFwiLCB0ZXh0OiBgJHtleC5uYW1lfSBcdTIwMTQgJHtleC5zZXRzfSR7ZXgud2VpZ2h0ID8gYCBcdTAwQjcgJHtleC53ZWlnaHR9a2dgIDogXCJcIn1gIH0pKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZW5kV29ya291dCgpOiB2b2lkIHsgdGhpcy5zdG9wVGltZXIoKTsgdGhpcy5zZWxlY3RlZFNwbGl0ID0gbnVsbDsgdGhpcy53b3Jrb3V0QWN0aXZlID0gZmFsc2U7IHRoaXMuc3RhcnRUaW1lID0gbnVsbDsgdGhpcy5jaGVja2VkLmNsZWFyKCk7IH1cblxuICAvLyAtLS0tIFN0YXRzIC0tLS1cbiAgcHJpdmF0ZSByZW5kZXJTdGF0cyhyb290OiBIVE1MRWxlbWVudCwgd29ya291dHM6IFdvcmtvdXRbXSwgZ3ltTG9nOiBTZXQ8c3RyaW5nPik6IHZvaWQge1xuICAgIGNvbnN0IHRvdGFsID0gd29ya291dHMubGVuZ3RoO1xuICAgIGNvbnN0IGxhc3QgPSB3b3Jrb3V0cy5sZW5ndGggPyB3b3Jrb3V0c1t3b3Jrb3V0cy5sZW5ndGggLSAxXS5kYXRlIDogXCJcdTIwMTRcIjtcbiAgICBsZXQgc3RyZWFrID0gMDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IDYwOyBpKyspIHsgY29uc3QgZCA9IG5ldyBEYXRlKCk7IGQuc2V0RGF0ZShkLmdldERhdGUoKSAtIGkpOyBpZiAoZ3ltTG9nLmhhcyh5bWQoZCkpKSBzdHJlYWsrKzsgZWxzZSBpZiAoaSA+IDApIGJyZWFrOyB9XG4gICAgY29uc3QgZHVyYXRpb25zID0gd29ya291dHMubWFwKCh3KSA9PiB3LmR1cmF0aW9uKS5maWx0ZXIoKGQpID0+IGQgPiAwKTtcbiAgICBjb25zdCBhdmcgPSBkdXJhdGlvbnMubGVuZ3RoID8gTWF0aC5yb3VuZChkdXJhdGlvbnMucmVkdWNlKChhLCBiKSA9PiBhICsgYiwgMCkgLyBkdXJhdGlvbnMubGVuZ3RoKSA6IDA7XG5cbiAgICBjb25zdCByb3cgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS1zdGF0cy1yb3dcIiB9KTtcbiAgICBjb25zdCBzdGF0ID0gKGxhYmVsOiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbnN0IGMgPSByb3cuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXN0YXRcIiB9KTtcbiAgICAgIGMuY3JlYXRlRGl2KHsgdGV4dDogdmFsdWUsIGNsczogXCJwYS1zdGF0LXZhbHVlXCIgfSk7XG4gICAgICBjLmNyZWF0ZURpdih7IHRleHQ6IGxhYmVsLCBjbHM6IFwicGEtc3RhdC1sYWJlbFwiIH0pO1xuICAgIH07XG4gICAgc3RhdChcIlx1RDgzQ1x1REZDQlx1RkUwRiBTRVNTSU9OU1wiLCBTdHJpbmcodG90YWwpKTtcbiAgICBzdGF0KFwiXHVEODNEXHVERDI1IFNUUkVBS1wiLCBTdHJpbmcoc3RyZWFrKSk7XG4gICAgc3RhdChcIlx1MjNGMSBBVkcgTUlOXCIsIFN0cmluZyhhdmcpKTtcbiAgICBzdGF0KFwiXHVEODNEXHVEQ0M1IExBU1RcIiwgbGFzdCAhPT0gXCJcdTIwMTRcIiA/IGxhc3Quc2xpY2UoNSkgOiBcIlx1MjAxNFwiKTtcbiAgfVxuXG4gIC8vIC0tLS0gQ2FsZW5kYXIgLS0tLVxuICBwcml2YXRlIHJlbmRlckNhbGVuZGFyKHJvb3Q6IEhUTUxFbGVtZW50LCB3b3Jrb3V0czogV29ya291dFtdKTogdm9pZCB7XG4gICAgY29uc3Qgc3BsaXRCeURheSA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gICAgd29ya291dHMuZm9yRWFjaCgodykgPT4gc3BsaXRCeURheS5zZXQody5kYXRlLCB3LnNwbGl0KSk7XG5cbiAgICBjb25zdCBjYXJkID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtcGFuZWxcIiB9KTtcbiAgICBjYXJkLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcIlx1RDgzRFx1RENDNSBXb3Jrb3V0IENhbGVuZGFyXCIsIGNsczogXCJwYS1wYW5lbC10aXRsZVwiIH0pO1xuICAgIGNvbnN0IGhlYWRlciA9IGNhcmQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWNhbC1oZWFkXCIgfSk7XG4gICAgY29uc3QgcHJldiA9IGhlYWRlci5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiXHUyMTkwXCIsIGNsczogXCJwYS1pY29uLWJ0blwiIH0pO1xuICAgIGhlYWRlci5jcmVhdGVTcGFuKHsgdGV4dDogbmV3IERhdGUodGhpcy5jYWxZZWFyLCB0aGlzLmNhbE1vbnRoLCAxKS50b0xvY2FsZVN0cmluZyhcImRlZmF1bHRcIiwgeyBtb250aDogXCJsb25nXCIsIHllYXI6IFwibnVtZXJpY1wiIH0pLCBjbHM6IFwicGEtY2FsLXRpdGxlXCIgfSk7XG4gICAgY29uc3QgbmV4dCA9IGhlYWRlci5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiXHUyMTkyXCIsIGNsczogXCJwYS1pY29uLWJ0blwiIH0pO1xuICAgIHByZXYub25jbGljayA9ICgpID0+IHsgdGhpcy5jYWxNb250aC0tOyBpZiAodGhpcy5jYWxNb250aCA8IDApIHsgdGhpcy5jYWxNb250aCA9IDExOyB0aGlzLmNhbFllYXItLTsgfSB0aGlzLmN0eC5yZWZyZXNoKCk7IH07XG4gICAgbmV4dC5vbmNsaWNrID0gKCkgPT4geyB0aGlzLmNhbE1vbnRoKys7IGlmICh0aGlzLmNhbE1vbnRoID4gMTEpIHsgdGhpcy5jYWxNb250aCA9IDA7IHRoaXMuY2FsWWVhcisrOyB9IHRoaXMuY3R4LnJlZnJlc2goKTsgfTtcblxuICAgIGNvbnN0IGdyaWQgPSBjYXJkLmNyZWF0ZURpdih7IGNsczogXCJwYS1jYWwtZ3JpZFwiIH0pO1xuICAgIFtcIlN1blwiLCBcIk1vblwiLCBcIlR1ZVwiLCBcIldlZFwiLCBcIlRodVwiLCBcIkZyaVwiLCBcIlNhdFwiXS5mb3JFYWNoKChkKSA9PiBncmlkLmNyZWF0ZURpdih7IHRleHQ6IGQsIGNsczogXCJwYS1jYWwtZG93XCIgfSkpO1xuICAgIGNvbnN0IGZpcnN0RG93ID0gbmV3IERhdGUodGhpcy5jYWxZZWFyLCB0aGlzLmNhbE1vbnRoLCAxKS5nZXREYXkoKTtcbiAgICBjb25zdCBkYXlzSW5Nb250aCA9IG5ldyBEYXRlKHRoaXMuY2FsWWVhciwgdGhpcy5jYWxNb250aCArIDEsIDApLmdldERhdGUoKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGZpcnN0RG93OyBpKyspIGdyaWQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWNhbC1jZWxsIGVtcHR5XCIgfSk7XG4gICAgY29uc3QgdG9kYXkgPSB0b2RheUxvY2FsKCk7XG4gICAgZm9yIChsZXQgZGF5ID0gMTsgZGF5IDw9IGRheXNJbk1vbnRoOyBkYXkrKykge1xuICAgICAgY29uc3QgZHMgPSBgJHt0aGlzLmNhbFllYXJ9LSR7U3RyaW5nKHRoaXMuY2FsTW9udGggKyAxKS5wYWRTdGFydCgyLCBcIjBcIil9LSR7U3RyaW5nKGRheSkucGFkU3RhcnQoMiwgXCIwXCIpfWA7XG4gICAgICBjb25zdCBjZWxsID0gZ3JpZC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtY2FsLWNlbGxcIiB9KTtcbiAgICAgIGNlbGwuY3JlYXRlRGl2KHsgdGV4dDogU3RyaW5nKGRheSksIGNsczogXCJwYS1jYWwtZGF5XCIgfSk7XG4gICAgICBjb25zdCBzcCA9IHNwbGl0QnlEYXkuZ2V0KGRzKTtcbiAgICAgIGlmIChzcCkge1xuICAgICAgICBjZWxsLmFkZENsYXNzKFwid29ya2VkXCIpO1xuICAgICAgICBjZWxsLmNyZWF0ZURpdih7IHRleHQ6IHNwLCBjbHM6IFwicGEtY2FsLXRhZ1wiIH0pO1xuICAgICAgICBjZWxsLm9uY2xpY2sgPSAoKSA9PiB7IHRoaXMuc2VsZWN0ZWREYXRlID0gZHM7IHRoaXMuc2VsZWN0ZWRTcGxpdCA9IG51bGw7IHRoaXMuY3R4LnJlZnJlc2goKTsgfTtcbiAgICAgIH1cbiAgICAgIGlmIChkcyA9PT0gdG9kYXkpIGNlbGwuYWRkQ2xhc3MoXCJ0b2RheVwiKTtcbiAgICAgIGlmIChkcyA9PT0gdGhpcy5zZWxlY3RlZERhdGUpIGNlbGwuYWRkQ2xhc3MoXCJzZWxlY3RlZFwiKTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tIFdlaWdodCBwcm9ncmVzcyAtLS0tXG4gIHByaXZhdGUgcmVuZGVyV2VpZ2h0UHJvZ3Jlc3Mocm9vdDogSFRNTEVsZW1lbnQsIGV4ZXJjaXNlczogRXhlcmNpc2VbXSwgd29ya291dHM6IFdvcmtvdXRbXSk6IHZvaWQge1xuICAgIGNvbnN0IGNhcmQgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS1wYW5lbFwiIH0pO1xuICAgIGNvbnN0IGhlYWQgPSBjYXJkLmNyZWF0ZURpdih7IGNsczogXCJwYS1zZWN0aW9uLWhlYWRcIiB9KTtcbiAgICBoZWFkLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcIlx1RDgzRFx1RENDOCBXZWlnaHQgUHJvZ3Jlc3NcIiwgY2xzOiBcInBhLXBhbmVsLXRpdGxlXCIgfSk7XG4gICAgY29uc3Qgc2VsID0gaGVhZC5jcmVhdGVFbChcInNlbGVjdFwiLCB7IGNsczogXCJwYS1zZWxlY3RcIiB9KTtcbiAgICB0aGlzLmdldFNwbGl0cygpLmZvckVhY2goKHMpID0+IHsgY29uc3QgbyA9IHNlbC5jcmVhdGVFbChcIm9wdGlvblwiLCB7IHRleHQ6IGBXb3Jrb3V0ICR7cy5pZH1gLCB2YWx1ZTogcy5pZCB9KTsgaWYgKHMuaWQgPT09IHRoaXMud2VpZ2h0U3BsaXQpIG8uc2VsZWN0ZWQgPSB0cnVlOyB9KTtcbiAgICBzZWwub25jaGFuZ2UgPSAoKSA9PiB7IHRoaXMud2VpZ2h0U3BsaXQgPSBzZWwudmFsdWU7IHRoaXMuY3R4LnJlZnJlc2goKTsgfTtcblxuICAgIGNvbnN0IHNwbGl0V29ya291dHMgPSB3b3Jrb3V0cy5maWx0ZXIoKHcpID0+IHcuc3BsaXQgPT09IHRoaXMud2VpZ2h0U3BsaXQpLnNvcnQoKGEsIGIpID0+IGEuZGF0ZS5sb2NhbGVDb21wYXJlKGIuZGF0ZSkpO1xuICAgIGNvbnN0IGxhYmVscyA9IHNwbGl0V29ya291dHMubWFwKCh3KSA9PiB3LmRhdGUuc2xpY2UoNSkpO1xuICAgIGNvbnN0IGV4cyA9IGV4ZXJjaXNlcy5maWx0ZXIoKGUpID0+IGUuc3BsaXQgPT09IHRoaXMud2VpZ2h0U3BsaXQpO1xuICAgIGNvbnN0IHNlcmllczogTGluZVNlcmllc1tdID0gZXhzLm1hcCgoZXgsIGkpID0+ICh7XG4gICAgICBuYW1lOiBleC5uYW1lLFxuICAgICAgY29sb3I6IFNFUklFU19DT0xPUlNbaSAlIFNFUklFU19DT0xPUlMubGVuZ3RoXSxcbiAgICAgIHZhbHVlczogc3BsaXRXb3Jrb3V0cy5tYXAoKHcpID0+IHtcbiAgICAgICAgY29uc3QgZm91bmQgPSB3LmV4ZXJjaXNlcy5maW5kKCh3ZSkgPT4gd2UuZXhlcmNpc2UgPT09IGV4Lm5hbWUpO1xuICAgICAgICByZXR1cm4gZm91bmQgPyBmb3VuZC53ZWlnaHQgOiBudWxsO1xuICAgICAgfSksXG4gICAgfSkpLmZpbHRlcigocykgPT4gcy52YWx1ZXMuc29tZSgodikgPT4gdiAhPSBudWxsKSk7XG5cbiAgICBkcmF3TGluZUNoYXJ0KGNhcmQsIGxhYmVscywgc2VyaWVzLCB7IGhlaWdodDogMjIwIH0pO1xuICB9XG5cbiAgLy8gLS0tLSBDYWxlbmRhciBkYXkgZGV0YWlsIC0tLS1cbiAgcHJpdmF0ZSByZW5kZXJEYXlEZXRhaWwocm9vdDogSFRNTEVsZW1lbnQsIHdvcmtvdXRzOiBXb3Jrb3V0W10pOiB2b2lkIHtcbiAgICBjb25zdCBkcyA9IHRoaXMuc2VsZWN0ZWREYXRlITtcbiAgICBjb25zdCB3b3Jrb3V0ID0gd29ya291dHMuZmluZCgodykgPT4gdy5kYXRlID09PSBkcyk7XG4gICAgY29uc3QgcGFuZWwgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS1wYW5lbCBwYS1hY3RpdmVcIiB9KTtcbiAgICBjb25zdCB0b3AgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtYWN0aXZlLXRvcFwiIH0pO1xuICAgIHRvcC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogYFx1RDgzQ1x1REZDQlx1RkUwRiAke2RzfSBcdTIwMTQgJHt3b3Jrb3V0ID8gd29ya291dC5leGVyY2lzZXMubGVuZ3RoIDogMH0gZXhlcmNpc2VzYCwgY2xzOiBcInBhLXBhbmVsLXRpdGxlXCIgfSk7XG4gICAgY29uc3QgY2xvc2UgPSB0b3AuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjcxNVwiLCBjbHM6IFwicGEtaWNvbi1idG5cIiB9KTtcbiAgICBjbG9zZS5vbmNsaWNrID0gKCkgPT4geyB0aGlzLnNlbGVjdGVkRGF0ZSA9IG51bGw7IHRoaXMuY3R4LnJlZnJlc2goKTsgfTtcblxuICAgIGlmICghd29ya291dCB8fCAhd29ya291dC5leGVyY2lzZXMubGVuZ3RoKSB7IHBhbmVsLmNyZWF0ZUVsKFwicFwiLCB7IGNsczogXCJwYS1tdXRlZFwiLCB0ZXh0OiBcIk5vIGV4ZXJjaXNlcyBsb2dnZWQgdGhpcyBkYXkuXCIgfSk7IHJldHVybjsgfVxuICAgIGNvbnN0IHRhYmxlID0gcGFuZWwuY3JlYXRlRWwoXCJ0YWJsZVwiLCB7IGNsczogXCJwYS1maXQtdGFibGVcIiB9KTtcbiAgICBjb25zdCB0aHIgPSB0YWJsZS5jcmVhdGVFbChcInRoZWFkXCIpLmNyZWF0ZUVsKFwidHJcIik7XG4gICAgW1wiRXhlcmNpc2VcIiwgXCJXZWlnaHRcIiwgXCJTZXRzXCIsIFwiXCJdLmZvckVhY2goKGgpID0+IHRoci5jcmVhdGVFbChcInRoXCIsIHsgdGV4dDogaCB9KSk7XG4gICAgY29uc3QgdGJvZHkgPSB0YWJsZS5jcmVhdGVFbChcInRib2R5XCIpO1xuICAgIHdvcmtvdXQuZXhlcmNpc2VzLmZvckVhY2goKHdlKSA9PiB7XG4gICAgICBjb25zdCB0ciA9IHRib2R5LmNyZWF0ZUVsKFwidHJcIik7XG4gICAgICB0ci5jcmVhdGVFbChcInRkXCIsIHsgdGV4dDogd2UuZXhlcmNpc2UsIGNsczogXCJwYS1maXQtbmFtZVwiIH0pO1xuICAgICAgdHIuY3JlYXRlRWwoXCJ0ZFwiLCB7IHRleHQ6IGAke3dlLndlaWdodH1rZ2AgfSk7XG4gICAgICB0ci5jcmVhdGVFbChcInRkXCIsIHsgdGV4dDogd2Uuc2V0cywgY2xzOiBcInBhLW11dGVkXCIgfSk7XG4gICAgICB0ci5jcmVhdGVFbChcInRkXCIsIHsgdGV4dDogd2UuZmVlbCB8fCBcIlwiICwgY2xzOiBcInBhLW11dGVkXCIgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvLyAtLS0tIFdvcmtvdXQgZWRpdG9yIChlZGl0IG1vZGUgKyBvcHRpb25hbCBhY3RpdmUgc2Vzc2lvbikgLS0tLVxuICBwcml2YXRlIHJlbmRlcldvcmtvdXRFZGl0b3Iocm9vdDogSFRNTEVsZW1lbnQsIGV4ZXJjaXNlczogRXhlcmNpc2VbXSk6IHZvaWQge1xuICAgIGNvbnN0IHNwbGl0SWQgPSB0aGlzLnNlbGVjdGVkU3BsaXQhO1xuICAgIGNvbnN0IGV4cyA9IGV4ZXJjaXNlcy5maWx0ZXIoKGUpID0+IGUuc3BsaXQgPT09IHNwbGl0SWQpO1xuICAgIGNvbnN0IHBhbmVsID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtcGFuZWwgcGEtYWN0aXZlXCIgfSk7XG5cbiAgICBjb25zdCB0b3AgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtYWN0aXZlLXRvcFwiIH0pO1xuICAgIGNvbnN0IHNwbGl0ID0gdGhpcy5nZXRTcGxpdHMoKS5maW5kKChzKSA9PiBzLmlkID09PSBzcGxpdElkKTtcbiAgICBjb25zdCB0aXRsZVdyYXAgPSB0b3AuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWVkaXRvci10aXRsZVwiIH0pO1xuICAgIHRpdGxlV3JhcC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogYCR7c3BsaXRJZH0gLSAke3NwbGl0Py5uYW1lIHx8IFwiXCJ9YCwgY2xzOiBcInBhLXBhbmVsLXRpdGxlXCIgfSk7XG4gICAgaWYgKHNwbGl0KSB7XG4gICAgICBjb25zdCByZW5hbWUgPSB0aXRsZVdyYXAuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjcwRlx1RkUwRlwiLCBjbHM6IFwicGEtaWNvbi1idG5cIiB9KTtcbiAgICAgIHJlbmFtZS5vbmNsaWNrID0gKCkgPT4gdGhpcy5vcGVuU3BsaXRSZW5hbWUoc3BsaXQpO1xuICAgIH1cbiAgICBpZiAodGhpcy53b3Jrb3V0QWN0aXZlKSB7XG4gICAgICB0aGlzLnRpbWVyRWwgPSB0b3AuY3JlYXRlU3Bhbih7IHRleHQ6IFwiXHUyM0YxIDAwOjAwXCIsIGNsczogXCJwYS10aW1lclwiIH0pO1xuICAgICAgdGhpcy5zdGFydFRpbWVyKCk7XG4gICAgfVxuXG4gICAgaWYgKCFleHMubGVuZ3RoKSB7XG4gICAgICBwYW5lbC5jcmVhdGVFbChcInBcIiwgeyBjbHM6IFwicGEtbXV0ZWRcIiwgdGV4dDogXCJObyBleGVyY2lzZXMgaW4gdGhpcyB3b3Jrb3V0LiBBZGQgc29tZSB3aXRoICsgRXhlcmNpc2UuXCIgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHRhYmxlID0gcGFuZWwuY3JlYXRlRWwoXCJ0YWJsZVwiLCB7IGNsczogXCJwYS1maXQtdGFibGVcIiB9KTtcbiAgICAgIGNvbnN0IGNvbHMgPSB0aGlzLndvcmtvdXRBY3RpdmUgPyBbXCJcdTI3MTNcIiwgXCJFeGVyY2lzZVwiLCBcIldlaWdodFwiLCBcIlNldHNcIiwgXCJIb3ctdG9cIiwgXCJcIl0gOiBbXCJFeGVyY2lzZVwiLCBcIldlaWdodFwiLCBcIlNldHNcIiwgXCJIb3ctdG9cIiwgXCJcIl07XG4gICAgICBjb25zdCB0aGVhZCA9IHRhYmxlLmNyZWF0ZUVsKFwidGhlYWRcIikuY3JlYXRlRWwoXCJ0clwiKTtcbiAgICAgIGNvbHMuZm9yRWFjaCgoaCkgPT4gdGhlYWQuY3JlYXRlRWwoXCJ0aFwiLCB7IHRleHQ6IGggfSkpO1xuICAgICAgY29uc3QgdGJvZHkgPSB0YWJsZS5jcmVhdGVFbChcInRib2R5XCIpO1xuICAgICAgZXhzLmZvckVhY2goKGV4KSA9PiB0aGlzLnJlbmRlckV4ZXJjaXNlUm93KHRib2R5LCBleCkpO1xuICAgIH1cblxuICAgIGNvbnN0IGFjdGlvbnMgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtYWN0aXZlLWFjdGlvbnNcIiB9KTtcbiAgICBpZiAodGhpcy53b3Jrb3V0QWN0aXZlKSB7XG4gICAgICBjb25zdCBmaW5pc2ggPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdTI3MDUgRmluaXNoIHdvcmtvdXRcIiwgY2xzOiBcInBhLWJ0blwiIH0pO1xuICAgICAgZmluaXNoLm9uY2xpY2sgPSAoKSA9PiB0aGlzLmZpbmlzaFdvcmtvdXQoc3BsaXRJZCwgZXhzLCBwYW5lbCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHN0YXJ0ID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiXHUyNUI2IFN0YXJ0IHdvcmtvdXRcIiwgY2xzOiBcInBhLWJ0blwiIH0pO1xuICAgICAgc3RhcnQub25jbGljayA9IGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5wZXJzaXN0Um93RWRpdHMoZXhzLCBwYW5lbCk7IC8vIGtlZXAgZWRpdHMgYmVmb3JlIHRpbWluZyBiZWdpbnNcbiAgICAgICAgdGhpcy53b3Jrb3V0QWN0aXZlID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5zdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgICB0aGlzLmNoZWNrZWQuY2xlYXIoKTtcbiAgICAgICAgdGhpcy5jdHgucmVmcmVzaCgpO1xuICAgICAgfTtcbiAgICAgIGNvbnN0IGFkZEV4ID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiKyBFeGVyY2lzZVwiLCBjbHM6IFwicGEtbWluaS1idG5cIiB9KTtcbiAgICAgIGFkZEV4Lm9uY2xpY2sgPSAoKSA9PiB0aGlzLm9wZW5FeGVyY2lzZU1vZGFsKG51bGwpO1xuICAgICAgY29uc3Qgc2F2ZSA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1RDgzRFx1RENCRSBTYXZlIGNoYW5nZXNcIiwgY2xzOiBcInBhLW1pbmktYnRuXCIgfSk7XG4gICAgICBzYXZlLm9uY2xpY2sgPSBhc3luYyAoKSA9PiB7IGNvbnN0IG4gPSBhd2FpdCB0aGlzLnBlcnNpc3RSb3dFZGl0cyhleHMsIHBhbmVsKTsgdG9hc3QobiA/IGBcdUQ4M0RcdURDQkUgU2F2ZWQgKCR7bn0pYCA6IFwiXHVEODNEXHVEQ0JFIFNhdmVkXCIpOyB9O1xuICAgIH1cbiAgICBjb25zdCBjbG9zZSA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNsb3NlXCIsIGNsczogXCJwYS1taW5pLWJ0blwiIH0pO1xuICAgIGNsb3NlLm9uY2xpY2sgPSAoKSA9PiB7IHRoaXMuZW5kV29ya291dCgpOyB0aGlzLmN0eC5yZWZyZXNoKCk7IH07XG4gIH1cblxuICAvKiogUGVyc2lzdCBlZGl0ZWQgd2VpZ2h0L3NldHMgYmFjayB0byB0aGUgZXhlcmNpc2UgZmlsZXMuIFJldHVybnMgbnVtYmVyIGNoYW5nZWQuICovXG4gIHByaXZhdGUgYXN5bmMgcGVyc2lzdFJvd0VkaXRzKGV4czogRXhlcmNpc2VbXSwgcGFuZWw6IEhUTUxFbGVtZW50KTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBsZXQgY2hhbmdlZCA9IDA7XG4gICAgZm9yIChjb25zdCBleCBvZiBleHMpIHtcbiAgICAgIGNvbnN0IHdJbnB1dCA9IHBhbmVsLnF1ZXJ5U2VsZWN0b3IoYGlucHV0LnBhLXdlaWdodC1pbnB1dFtkYXRhLWV4PVwiJHtDU1MuZXNjYXBlKGV4Lm5hbWUpfVwiXWApIGFzIEhUTUxJbnB1dEVsZW1lbnQgfCBudWxsO1xuICAgICAgY29uc3Qgc0lucHV0ID0gcGFuZWwucXVlcnlTZWxlY3RvcihgaW5wdXQucGEtc2V0cy1pbnB1dFtkYXRhLWV4PVwiJHtDU1MuZXNjYXBlKGV4Lm5hbWUpfVwiXWApIGFzIEhUTUxJbnB1dEVsZW1lbnQgfCBudWxsO1xuICAgICAgY29uc3QgbmV3V2VpZ2h0ID0gd0lucHV0ID8gcGFyc2VGbG9hdCh3SW5wdXQudmFsdWUpIHx8IDAgOiBleC53ZWlnaHQ7XG4gICAgICBjb25zdCBuZXdTZXRzID0gc0lucHV0ID8gKHNJbnB1dC52YWx1ZS50cmltKCkgfHwgZXguc2V0cykgOiBleC5zZXRzO1xuICAgICAgaWYgKG5ld1dlaWdodCAhPT0gZXgud2VpZ2h0IHx8IG5ld1NldHMgIT09IGV4LnNldHMpIHsgYXdhaXQgdGhpcy5jdHguc3RvcmUuc2F2ZUV4ZXJjaXNlKHsgLi4uZXgsIHdlaWdodDogbmV3V2VpZ2h0LCBzZXRzOiBuZXdTZXRzIH0pOyBjaGFuZ2VkKys7IH1cbiAgICB9XG4gICAgcmV0dXJuIGNoYW5nZWQ7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckV4ZXJjaXNlUm93KHRib2R5OiBIVE1MRWxlbWVudCwgZXg6IEV4ZXJjaXNlKTogdm9pZCB7XG4gICAgY29uc3QgdHIgPSB0Ym9keS5jcmVhdGVFbChcInRyXCIpO1xuICAgIGlmICh0aGlzLndvcmtvdXRBY3RpdmUpIHtcbiAgICAgIGNvbnN0IGNoZWNrID0gdHIuY3JlYXRlRWwoXCJ0ZFwiKS5jcmVhdGVFbChcImlucHV0XCIpO1xuICAgICAgY2hlY2sudHlwZSA9IFwiY2hlY2tib3hcIjtcbiAgICAgIGNoZWNrLmNoZWNrZWQgPSB0aGlzLmNoZWNrZWQuaGFzKGV4Lm5hbWUpO1xuICAgICAgY2hlY2sub25jaGFuZ2UgPSAoKSA9PiB7IGlmIChjaGVjay5jaGVja2VkKSB0aGlzLmNoZWNrZWQuYWRkKGV4Lm5hbWUpOyBlbHNlIHRoaXMuY2hlY2tlZC5kZWxldGUoZXgubmFtZSk7IHRyLnRvZ2dsZUNsYXNzKFwiZG9uZVwiLCBjaGVjay5jaGVja2VkKTsgfTtcbiAgICAgIHRyLnRvZ2dsZUNsYXNzKFwiZG9uZVwiLCBjaGVjay5jaGVja2VkKTtcbiAgICB9XG5cbiAgICBjb25zdCBuYW1lVGQgPSB0ci5jcmVhdGVFbChcInRkXCIsIHsgY2xzOiBcInBhLWZpdC1uYW1lXCIgfSk7XG4gICAgbmFtZVRkLmNyZWF0ZURpdih7IHRleHQ6IGV4Lm5hbWUgfSk7XG4gICAgaWYgKGV4Lmhvd3RvKSBuYW1lVGQuc2V0QXR0cihcInRpdGxlXCIsIGV4Lmhvd3RvKTtcblxuICAgIGNvbnN0IHdJbnB1dCA9IHRyLmNyZWF0ZUVsKFwidGRcIikuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IGNsczogXCJwYS1maXQtaW5wdXRcIiB9KTtcbiAgICB3SW5wdXQudHlwZSA9IFwibnVtYmVyXCI7IHdJbnB1dC52YWx1ZSA9IFN0cmluZyhleC53ZWlnaHQpOyB3SW5wdXQuZGF0YXNldC5leCA9IGV4Lm5hbWU7IHdJbnB1dC5hZGRDbGFzcyhcInBhLXdlaWdodC1pbnB1dFwiKTtcblxuICAgIGNvbnN0IHNldHNJbnB1dCA9IHRyLmNyZWF0ZUVsKFwidGRcIikuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IGNsczogXCJwYS1maXQtaW5wdXRcIiB9KTtcbiAgICBzZXRzSW5wdXQudmFsdWUgPSBleC5zZXRzOyBzZXRzSW5wdXQuZGF0YXNldC5leCA9IGV4Lm5hbWU7IHNldHNJbnB1dC5hZGRDbGFzcyhcInBhLXNldHMtaW5wdXRcIik7XG5cbiAgICB0ci5jcmVhdGVFbChcInRkXCIsIHsgdGV4dDogZXguaG93dG8gfHwgXCJcdTIwMTRcIiwgY2xzOiBcInBhLWZpdC1ob3d0b1wiIH0pO1xuXG4gICAgY29uc3QgYWN0aW9uc1RkID0gdHIuY3JlYXRlRWwoXCJ0ZFwiKTtcbiAgICBjb25zdCBlZGl0ID0gYWN0aW9uc1RkLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdTI3MEZcdUZFMEZcIiwgY2xzOiBcInBhLWljb24tYnRuXCIgfSk7XG4gICAgZWRpdC5vbmNsaWNrID0gKCkgPT4gdGhpcy5vcGVuRXhlcmNpc2VNb2RhbChleCk7XG4gICAgY29uc3QgZGVsID0gYWN0aW9uc1RkLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdUQ4M0RcdURERDFcIiwgY2xzOiBcInBhLWljb24tYnRuXCIgfSk7XG4gICAgZGVsLm9uY2xpY2sgPSAoKSA9PiBuZXcgQ29uZmlybU1vZGFsKHRoaXMuY3R4LmFwcCwgYERlbGV0ZSBleGVyY2lzZSBcIiR7ZXgubmFtZX1cIj9gLCBhc3luYyAoKSA9PiB7IGF3YWl0IHRoaXMuY3R4LnN0b3JlLmRlbGV0ZUV4ZXJjaXNlKGV4KTsgdGhpcy5jdHgucmVmcmVzaCgpOyB9KS5vcGVuKCk7XG4gIH1cblxuICBwcml2YXRlIHN0YXJ0VGltZXIoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wVGltZXIoKTtcbiAgICBjb25zdCB0aWNrID0gKCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLnN0YXJ0VGltZSB8fCAhdGhpcy50aW1lckVsKSByZXR1cm47XG4gICAgICBjb25zdCBkaWZmID0gTWF0aC5mbG9vcigoRGF0ZS5ub3coKSAtIHRoaXMuc3RhcnRUaW1lKSAvIDEwMDApO1xuICAgICAgdGhpcy50aW1lckVsLnNldFRleHQoYFx1MjNGMSAke1N0cmluZyhNYXRoLmZsb29yKGRpZmYgLyA2MCkpLnBhZFN0YXJ0KDIsIFwiMFwiKX06JHtTdHJpbmcoZGlmZiAlIDYwKS5wYWRTdGFydCgyLCBcIjBcIil9YCk7XG4gICAgfTtcbiAgICB0aWNrKCk7XG4gICAgdGhpcy50aW1lcklkID0gd2luZG93LnNldEludGVydmFsKHRpY2ssIDEwMDApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBmaW5pc2hXb3Jrb3V0KHNwbGl0SWQ6IHN0cmluZywgZXhzOiBFeGVyY2lzZVtdLCBwYW5lbDogSFRNTEVsZW1lbnQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc3RhcnRUaW1lKSByZXR1cm47XG4gICAgY29uc3QgZHVyYXRpb24gPSBNYXRoLm1heCgxLCBNYXRoLmZsb29yKChEYXRlLm5vdygpIC0gdGhpcy5zdGFydFRpbWUpIC8gMTAwMCAvIDYwKSk7XG4gICAgY29uc3QgbG9nZ2VkOiBXb3Jrb3V0RXhlcmNpc2VbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgZXggb2YgZXhzKSB7XG4gICAgICBjb25zdCB3SW5wdXQgPSBwYW5lbC5xdWVyeVNlbGVjdG9yKGBpbnB1dC5wYS13ZWlnaHQtaW5wdXRbZGF0YS1leD1cIiR7Q1NTLmVzY2FwZShleC5uYW1lKX1cIl1gKSBhcyBIVE1MSW5wdXRFbGVtZW50IHwgbnVsbDtcbiAgICAgIGNvbnN0IHNJbnB1dCA9IHBhbmVsLnF1ZXJ5U2VsZWN0b3IoYGlucHV0LnBhLXNldHMtaW5wdXRbZGF0YS1leD1cIiR7Q1NTLmVzY2FwZShleC5uYW1lKX1cIl1gKSBhcyBIVE1MSW5wdXRFbGVtZW50IHwgbnVsbDtcbiAgICAgIGNvbnN0IG5ld1dlaWdodCA9IHdJbnB1dCA/IHBhcnNlRmxvYXQod0lucHV0LnZhbHVlKSB8fCAwIDogZXgud2VpZ2h0O1xuICAgICAgY29uc3QgbmV3U2V0cyA9IHNJbnB1dCA/IChzSW5wdXQudmFsdWUudHJpbSgpIHx8IGV4LnNldHMpIDogZXguc2V0cztcbiAgICAgIGlmIChuZXdXZWlnaHQgIT09IGV4LndlaWdodCB8fCBuZXdTZXRzICE9PSBleC5zZXRzKSBhd2FpdCB0aGlzLmN0eC5zdG9yZS5zYXZlRXhlcmNpc2UoeyAuLi5leCwgd2VpZ2h0OiBuZXdXZWlnaHQsIHNldHM6IG5ld1NldHMgfSk7XG4gICAgICBpZiAodGhpcy5jaGVja2VkLmhhcyhleC5uYW1lKSkgbG9nZ2VkLnB1c2goeyBleGVyY2lzZTogZXgubmFtZSwgd2VpZ2h0OiBuZXdXZWlnaHQsIHNldHM6IG5ld1NldHMsIGZlZWw6IFwiZ29vZFwiLCBvbGRXZWlnaHQ6IGV4LndlaWdodCB9KTtcbiAgICB9XG4gICAgaWYgKCFsb2dnZWQubGVuZ3RoKSB7IHRvYXN0KFwiQ2hlY2sgYXQgbGVhc3Qgb25lIGV4ZXJjaXNlIHRvIGxvZy5cIik7IHJldHVybjsgfVxuICAgIGF3YWl0IHRoaXMuY3R4LnN0b3JlLmxvZ1dvcmtvdXQoc3BsaXRJZCwgZHVyYXRpb24sIGxvZ2dlZCk7XG4gICAgdGhpcy5lbmRXb3Jrb3V0KCk7XG4gICAgdGhpcy5zZWxlY3RlZERhdGUgPSB0b2RheUxvY2FsKCk7IC8vIHNob3cgdGhlIGp1c3QtbG9nZ2VkIHdvcmtvdXQgYXMgYSBsb2cgYXQgdGhlIGJvdHRvbVxuICAgIHRoaXMuY3R4LnJlZnJlc2goKTtcbiAgICB0b2FzdChgXHVEODNEXHVEQ0FBIFdvcmtvdXQgbG9nZ2VkICgke2xvZ2dlZC5sZW5ndGh9IGV4ZXJjaXNlcywgJHtkdXJhdGlvbn1taW4pYCk7XG4gIH1cblxuICAvLyAtLS0tIE1vZGFscyAtLS0tXG4gIHByaXZhdGUgb3BlblNwbGl0UmVuYW1lKHM6IFNwbGl0KTogdm9pZCB7XG4gICAgbmV3IEZvcm1Nb2RhbCh0aGlzLmN0eC5hcHAsIFwiUmVuYW1lIHdvcmtvdXRcIiwgW3sga2V5OiBcIm5hbWVcIiwgbGFiZWw6IFwiV29ya291dCBuYW1lXCIsIHR5cGU6IFwidGV4dFwiLCB2YWx1ZTogcy5uYW1lIH1dLCBhc3luYyAodikgPT4ge1xuICAgICAgY29uc3QgbmFtZSA9ICh2Lm5hbWUgfHwgXCJcIikudHJpbSgpO1xuICAgICAgaWYgKCFuYW1lKSByZXR1cm47XG4gICAgICBjb25zdCBzcGxpdHMgPSB0aGlzLmdldFNwbGl0cygpLm1hcCgoeCkgPT4gKHguaWQgPT09IHMuaWQgPyB7IC4uLngsIG5hbWUgfSA6IHgpKTtcbiAgICAgIGF3YWl0IHRoaXMuY3R4LnN0b3JlLnNhdmVTcGxpdHMoc3BsaXRzKTtcbiAgICAgIHRoaXMuY3R4LnJlZnJlc2goKTtcbiAgICB9LCBcIlNhdmVcIikub3BlbigpO1xuICB9XG5cbiAgcHJpdmF0ZSBvcGVuRXhlcmNpc2VNb2RhbChleDogRXhlcmNpc2UgfCBudWxsKTogdm9pZCB7XG4gICAgY29uc3Qgc3BsaXRPcHRpb25zID0gdGhpcy5nZXRTcGxpdHMoKS5tYXAoKHMpID0+ICh7IHZhbHVlOiBzLmlkLCBsYWJlbDogYCR7cy5pZH0gXHUyMDE0ICR7cy5uYW1lfWAgfSkpO1xuICAgIGNvbnN0IGZpZWxkczogRmllbGRTcGVjW10gPSBbXG4gICAgICB7IGtleTogXCJuYW1lXCIsIGxhYmVsOiBcIk5hbWVcIiwgdHlwZTogXCJ0ZXh0XCIsIHZhbHVlOiBleD8ubmFtZSB8fCBcIlwiIH0sXG4gICAgICB7IGtleTogXCJzcGxpdFwiLCBsYWJlbDogXCJXb3Jrb3V0XCIsIHR5cGU6IFwiZHJvcGRvd25cIiwgb3B0aW9uczogc3BsaXRPcHRpb25zLCB2YWx1ZTogZXg/LnNwbGl0IHx8ICh0aGlzLnNlbGVjdGVkU3BsaXQgfHwgXCJBXCIpIH0sXG4gICAgICB7IGtleTogXCJzZXRzXCIsIGxhYmVsOiBcIlNldHMgeCByZXBzXCIsIHR5cGU6IFwidGV4dFwiLCB2YWx1ZTogZXg/LnNldHMgfHwgXCIzeDEwXCIgfSxcbiAgICAgIHsga2V5OiBcIndlaWdodFwiLCBsYWJlbDogXCJXZWlnaHQgKGtnKVwiLCB0eXBlOiBcIm51bWJlclwiLCB2YWx1ZTogZXg/LndlaWdodCA/PyAwIH0sXG4gICAgICB7IGtleTogXCJob3d0b1wiLCBsYWJlbDogXCJIb3ctdG9cIiwgdHlwZTogXCJ0ZXh0YXJlYVwiLCB2YWx1ZTogZXg/Lmhvd3RvIHx8IFwiXCIgfSxcbiAgICBdO1xuICAgIG5ldyBGb3JtTW9kYWwodGhpcy5jdHguYXBwLCBleCA/IFwiRWRpdCBleGVyY2lzZVwiIDogXCJOZXcgZXhlcmNpc2VcIiwgZmllbGRzLCBhc3luYyAodikgPT4ge1xuICAgICAgY29uc3QgbmFtZSA9ICh2Lm5hbWUgfHwgXCJcIikudHJpbSgpO1xuICAgICAgaWYgKCFuYW1lKSByZXR1cm47XG4gICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMuY3R4LnN0b3JlLnNhdmVFeGVyY2lzZSh7XG4gICAgICAgIG5hbWUsIHNwbGl0OiB2LnNwbGl0LCBzZXRzOiB2LnNldHMgfHwgXCIzeDEwXCIsIHdlaWdodDogcGFyc2VGbG9hdCh2LndlaWdodCkgfHwgMCwgaG93dG86IHYuaG93dG8gfHwgXCJcIixcbiAgICAgICAgLy8gcHJlc2VydmUgbWV0YWRhdGEgbm90IGVkaXRlZCBoZXJlXG4gICAgICAgIG11c2NsZTogZXg/Lm11c2NsZSB8fCBcIlwiLCB0eXBlOiBleD8udHlwZSB8fCBcIm1hY2hpbmVcIixcbiAgICAgIH0sIGV4Py5uYW1lKTtcbiAgICAgIGlmICghb2spIHsgdG9hc3QoYEFuIGV4ZXJjaXNlIG5hbWVkIFwiJHtuYW1lfVwiIGFscmVhZHkgZXhpc3RzLmApOyByZXR1cm47IH1cbiAgICAgIHRoaXMuY3R4LnJlZnJlc2goKTtcbiAgICB9LCBleCA/IFwiU2F2ZVwiIDogXCJDcmVhdGVcIikub3BlbigpO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgUEFDb250ZXh0IH0gZnJvbSBcIi4uL2NvbnRleHRcIjtcbmltcG9ydCB7IE1lYWwsIE1lYWxJdGVtLCBNZWFsTG9nIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5pbXBvcnQgeyB0b2FzdCB9IGZyb20gXCIuLi91aVwiO1xuaW1wb3J0IHsgdG9kYXlMb2NhbCwgeW1kIH0gZnJvbSBcIi4uL3V0aWxcIjtcbmltcG9ydCB7IGRyYXdSaW5nLCBkcmF3TGluZUNoYXJ0IH0gZnJvbSBcIi4uL2NoYXJ0c1wiO1xuXG4vKiogRml4ZWQgbWVhbCBzbG90cyBcdTIwMTQgbmFtZXMgYXJlIG5vdCBlZGl0YWJsZSwgb25seSB0aGVpciBwbGFucy4gKi9cbmNvbnN0IFNMT1RTID0gW1xuICB7IGlkOiBcImJyZWFrZmFzdFwiLCBuYW1lOiBcIkJyZWFrZmFzdFwiLCBlbW9qaTogXCJcdTI2MTVcIiB9LFxuICB7IGlkOiBcImx1bmNoXCIsIG5hbWU6IFwiTHVuY2hcIiwgZW1vamk6IFwiXHVEODNDXHVERjdEXHVGRTBGXCIgfSxcbiAgeyBpZDogXCJkaW5uZXJcIiwgbmFtZTogXCJEaW5uZXJcIiwgZW1vamk6IFwiXHVEODNDXHVERjE5XCIgfSxcbiAgeyBpZDogXCJzbmFja3NcIiwgbmFtZTogXCJTbmFja3NcIiwgZW1vamk6IFwiXHVEODNDXHVERjRFXCIgfSxcbl07XG5cbi8qKiBSZW5kZXJzIHRoZSBOdXRyaXRpb24gcGFnZSwgbWlycm9yaW5nIHRoZSBGaXRuZXNzIFVYIChmaXhlZCBwbGFucyArIGlubGluZSBlZGl0b3IpLiAqL1xuZXhwb3J0IGNsYXNzIE51dHJpdGlvbk1vZHVsZSB7XG4gIHByaXZhdGUgY3R4OiBQQUNvbnRleHQ7XG4gIHByaXZhdGUgc2VsZWN0ZWRNZWFsOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzZWxlY3RlZERhdGU6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNhbE1vbnRoOiBudW1iZXI7XG4gIHByaXZhdGUgY2FsWWVhcjogbnVtYmVyO1xuICBwcml2YXRlIGFkZEZvcm0gPSB7IG5hbWU6IFwiXCIsIHF0eTogXCIxMDBcIiwgY2FsOiBcIlwiLCBtZWFsOiBcImx1bmNoXCIgfTtcblxuICBjb25zdHJ1Y3RvcihjdHg6IFBBQ29udGV4dCkge1xuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgdGhpcy5jdHggPSBjdHg7XG4gICAgdGhpcy5jYWxNb250aCA9IG5vdy5nZXRNb250aCgpO1xuICAgIHRoaXMuY2FsWWVhciA9IG5vdy5nZXRGdWxsWWVhcigpO1xuICB9XG5cbiAgLyoqIFRoZSA0IGZpeGVkIHNsb3RzLCBoeWRyYXRlZCB3aXRoIGFueSBzYXZlZCBwbGFuIGZpbGUuICovXG4gIHByaXZhdGUgZ2V0TWVhbHMoKTogTWVhbFtdIHtcbiAgICBjb25zdCBzYXZlZCA9IHRoaXMuY3R4LnN0b3JlLmxvYWRNZWFscygpO1xuICAgIHJldHVybiBTTE9UUy5tYXAoKHMpID0+IHtcbiAgICAgIGNvbnN0IG0gPSBzYXZlZC5maW5kKCh4KSA9PiB4LmlkID09PSBzLmlkKTtcbiAgICAgIHJldHVybiBtID8geyAuLi5tLCBuYW1lOiBzLm5hbWUsIGVtb2ppOiBzLmVtb2ppIH0gOiAoeyBpZDogcy5pZCwgbmFtZTogcy5uYW1lLCBlbW9qaTogcy5lbW9qaSwgdG90YWxDYWw6IDAsIGl0ZW1zOiBbXSwgcGF0aDogXCJcIiB9IGFzIE1lYWwpO1xuICAgIH0pO1xuICB9XG5cbiAgcmVuZGVyKHJvb3Q6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgcm9vdC5lbXB0eSgpO1xuICAgIGNvbnN0IG1lYWxzID0gdGhpcy5nZXRNZWFscygpO1xuICAgIGNvbnN0IGxvZ3MgPSB0aGlzLmN0eC5zdG9yZS5sb2FkTWVhbExvZ3MoKTtcbiAgICBjb25zdCB3YXRlciA9IHRoaXMuY3R4LnN0b3JlLmxvYWRXYXRlckxvZygpO1xuICAgIGNvbnN0IHRvZGF5ID0gdG9kYXlMb2NhbCgpO1xuICAgIGNvbnN0IGNhbEJ5RGF5ID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgICBsb2dzLmZvckVhY2goKGwpID0+IGNhbEJ5RGF5LnNldChsLmRhdGUsIChjYWxCeURheS5nZXQobC5kYXRlKSB8fCAwKSArIGwudG90YWxDYWwpKTtcblxuICAgIHRoaXMucmVuZGVySGVhZGVyKHJvb3QsIGNhbEJ5RGF5LCB0b2RheSk7XG4gICAgdGhpcy5yZW5kZXJNZWFsUGxhbnMocm9vdCwgbWVhbHMpO1xuICAgIHRoaXMucmVuZGVyQWRkRm9vZChyb290LCBtZWFscyk7XG4gICAgaWYgKHRoaXMuc2VsZWN0ZWRNZWFsKSB0aGlzLnJlbmRlck1lYWxFZGl0b3Iocm9vdCwgbWVhbHMpO1xuICAgIHRoaXMucmVuZGVyU3RhdHMocm9vdCwgY2FsQnlEYXksIHdhdGVyLCB0b2RheSk7XG5cbiAgICBjb25zdCBjb2xzID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtdHdvLWNvbFwiIH0pO1xuICAgIHRoaXMucmVuZGVyQ2FsZW5kYXIoY29scywgY2FsQnlEYXkpO1xuICAgIHRoaXMucmVuZGVyVHJlbmQoY29scywgY2FsQnlEYXksIHRvZGF5KTtcblxuICAgIGlmICh0aGlzLnNlbGVjdGVkRGF0ZSkgdGhpcy5yZW5kZXJEYXlEZXRhaWwocm9vdCwgbWVhbHMsIGxvZ3MpO1xuICB9XG5cbiAgLy8gLS0tLSBIZWFkZXIgcmluZ3MgKGxhc3QgMyBkYXlzIGNhbG9yaWUgJSkgLS0tLVxuICBwcml2YXRlIHJlbmRlckhlYWRlcihyb290OiBIVE1MRWxlbWVudCwgY2FsQnlEYXk6IE1hcDxzdHJpbmcsIG51bWJlcj4sIHRvZGF5OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBoZWFkID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtaHQtaGVhZGVyXCIgfSk7XG4gICAgY29uc3QgbGVmdCA9IGhlYWQuY3JlYXRlRGl2KCk7XG4gICAgbGVmdC5jcmVhdGVEaXYoeyB0ZXh0OiBcIlx1RDgzRVx1REQ1NyBOdXRyaXRpb25cIiwgY2xzOiBcInBhLWgxXCIgfSk7XG4gICAgbGVmdC5jcmVhdGVEaXYoeyB0ZXh0OiBcIkRhaWx5IGZvb2QgdHJhY2tpbmdcIiwgY2xzOiBcInBhLW11dGVkXCIgfSk7XG5cbiAgICBjb25zdCB0YXJnZXQgPSB0aGlzLmN0eC5jb25maWcuY2Fsb3JpZVRhcmdldCB8fCAyMDAwO1xuICAgIGNvbnN0IHJpbmdzID0gaGVhZC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtaHQtcmluZ3NcIiB9KTtcbiAgICBjb25zdCBkYXlOID0gW1wiU3VuXCIsIFwiTW9uXCIsIFwiVHVlXCIsIFwiV2VkXCIsIFwiVGh1XCIsIFwiRnJpXCIsIFwiU2F0XCJdO1xuICAgIGNvbnN0IGJhc2UgPSBuZXcgRGF0ZSh0b2RheSArIFwiVDAwOjAwOjAwXCIpO1xuICAgIGZvciAobGV0IGkgPSAyOyBpID49IDA7IGktLSkge1xuICAgICAgY29uc3QgZHQgPSBuZXcgRGF0ZShiYXNlKTtcbiAgICAgIGR0LnNldERhdGUoZHQuZ2V0RGF0ZSgpIC0gaSk7XG4gICAgICBjb25zdCBkcyA9IHltZChkdCk7XG4gICAgICBjb25zdCBjYWwgPSBjYWxCeURheS5nZXQoZHMpIHx8IDA7XG4gICAgICBjb25zdCBwY3QgPSB0YXJnZXQgPyBNYXRoLnJvdW5kKChjYWwgLyB0YXJnZXQpICogMTAwKSA6IDA7XG4gICAgICBjb25zdCBjb2xvciA9IHBjdCA+PSA4MCAmJiBwY3QgPD0gMTEwID8gXCIjMTZhMzRhXCIgOiBwY3QgPiAxMTAgPyBcIiNlZjQ0NDRcIiA6IFwiI2Q5NzcwNlwiO1xuICAgICAgY29uc3QgbGFiZWwgPSBpID09PSAwID8gYFRvZGF5IFx1MDBCNyAke2NhbH0gY2FsYCA6IGAke2RheU5bZHQuZ2V0RGF5KCldfSAke2R0LmdldERhdGUoKX0gXHUwMEI3ICR7Y2FsfSBjYWxgO1xuICAgICAgZHJhd1JpbmcocmluZ3MsIHBjdCwgY29sb3IsIGxhYmVsLCA1OCk7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tLSBBZGQgYSBmb29kIChmaXhlZCBiYXIpIFx1MjAxNCB0byBhIHBsYW4gKHJlY3VycmluZykgb3IganVzdCB0b2RheSdzIG1lYWwgLS0tLVxuICBwcml2YXRlIHJlbmRlckFkZEZvb2Qocm9vdDogSFRNTEVsZW1lbnQsIG1lYWxzOiBNZWFsW10pOiB2b2lkIHtcbiAgICBjb25zdCBwYW5lbCA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXBhbmVsIHBhLWFkZGZvb2RcIiB9KTtcbiAgICBjb25zdCBoZWFkID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXNlY3Rpb24taGVhZFwiIH0pO1xuICAgIGhlYWQuY3JlYXRlRWwoXCJoNFwiLCB7IHRleHQ6IFwiXHVEODNEXHVERDBFIEFkZCBhIGZvb2QgXHUyMDE0IHBpY2sgdGhlIG1lYWwsIHRoZW4gYWRkIHRvIHRoZSBwbGFuIG9yIGp1c3QgdG8gdG9kYXlcIiwgY2xzOiBcInBhLXBhbmVsLXRpdGxlXCIgfSk7XG4gICAgY29uc3Qgd2F0ZXIgPSBoZWFkLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdUQ4M0RcdURDQTcgKzI1MG1sXCIsIGNsczogXCJwYS1taW5pLWJ0blwiIH0pO1xuICAgIHdhdGVyLm9uY2xpY2sgPSBhc3luYyAoKSA9PiB7IGF3YWl0IHRoaXMuY3R4LnN0b3JlLmFkZFdhdGVyKHRvZGF5TG9jYWwoKSwgMC4yNSk7IHRoaXMuY3R4LnJlZnJlc2goKTsgdG9hc3QoXCJcdUQ4M0RcdURDQTcgKzI1MG1sXCIpOyB9O1xuXG4gICAgY29uc3Qgcm93ID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWFkZGZvb2Qtcm93XCIgfSk7XG4gICAgY29uc3QgbmFtZUlucHV0ID0gcm93LmNyZWF0ZUVsKFwiaW5wdXRcIiwgeyBjbHM6IFwicGEtYWRkZm9vZC1uYW1lXCIsIHBsYWNlaG9sZGVyOiBcIkZvb2QgbmFtZVx1MjAyNlwiIH0pO1xuICAgIG5hbWVJbnB1dC52YWx1ZSA9IHRoaXMuYWRkRm9ybS5uYW1lO1xuICAgIG5hbWVJbnB1dC5vbmlucHV0ID0gKCkgPT4gKHRoaXMuYWRkRm9ybS5uYW1lID0gbmFtZUlucHV0LnZhbHVlKTtcblxuICAgIGNvbnN0IHF0eSA9IHJvdy5jcmVhdGVFbChcImlucHV0XCIsIHsgY2xzOiBcInBhLWZpdC1pbnB1dFwiIH0pO1xuICAgIHF0eS50eXBlID0gXCJudW1iZXJcIjsgcXR5LnZhbHVlID0gdGhpcy5hZGRGb3JtLnF0eTsgcXR5LnRpdGxlID0gXCJRdHkgKGcpXCI7XG4gICAgcXR5Lm9uaW5wdXQgPSAoKSA9PiAodGhpcy5hZGRGb3JtLnF0eSA9IHF0eS52YWx1ZSk7XG5cbiAgICBjb25zdCBjYWwgPSByb3cuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IGNsczogXCJwYS1maXQtaW5wdXRcIiB9KTtcbiAgICBjYWwudHlwZSA9IFwibnVtYmVyXCI7IGNhbC5wbGFjZWhvbGRlciA9IFwiQ2FsXCI7IGNhbC52YWx1ZSA9IHRoaXMuYWRkRm9ybS5jYWw7XG4gICAgY2FsLm9uaW5wdXQgPSAoKSA9PiAodGhpcy5hZGRGb3JtLmNhbCA9IGNhbC52YWx1ZSk7XG5cbiAgICBjb25zdCBtZWFsU2VsID0gcm93LmNyZWF0ZUVsKFwic2VsZWN0XCIsIHsgY2xzOiBcInBhLXNlbGVjdFwiIH0pO1xuICAgIFNMT1RTLmZvckVhY2goKHMpID0+IHsgY29uc3QgbyA9IG1lYWxTZWwuY3JlYXRlRWwoXCJvcHRpb25cIiwgeyB0ZXh0OiBzLm5hbWUsIHZhbHVlOiBzLmlkIH0pOyBpZiAocy5pZCA9PT0gdGhpcy5hZGRGb3JtLm1lYWwpIG8uc2VsZWN0ZWQgPSB0cnVlOyB9KTtcbiAgICBtZWFsU2VsLm9uY2hhbmdlID0gKCkgPT4gKHRoaXMuYWRkRm9ybS5tZWFsID0gbWVhbFNlbC52YWx1ZSk7XG5cbiAgICBjb25zdCBidWlsZEl0ZW0gPSAoKTogTWVhbEl0ZW0gfCBudWxsID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSB0aGlzLmFkZEZvcm0ubmFtZS50cmltKCk7XG4gICAgICBpZiAoIW5hbWUpIHsgdG9hc3QoXCJFbnRlciBhIGZvb2QgbmFtZS5cIik7IHJldHVybiBudWxsOyB9XG4gICAgICByZXR1cm4geyBuYW1lLCBxdHk6IHBhcnNlRmxvYXQodGhpcy5hZGRGb3JtLnF0eSkgfHwgMCwgdW5pdDogXCJnXCIsIGNhbDogcGFyc2VJbnQodGhpcy5hZGRGb3JtLmNhbCkgfHwgMCB9O1xuICAgIH07XG4gICAgY29uc3QgdGFyZ2V0TWVhbCA9ICgpID0+IG1lYWxzLmZpbmQoKG0pID0+IG0uaWQgPT09IHRoaXMuYWRkRm9ybS5tZWFsKSE7XG5cbiAgICBjb25zdCB0b1RvZGF5ID0gcm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCIrIEFkZCB0byBUb2RheVwiLCBjbHM6IFwicGEtYnRuXCIgfSk7XG4gICAgdG9Ub2RheS5vbmNsaWNrID0gYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgaXRlbSA9IGJ1aWxkSXRlbSgpO1xuICAgICAgaWYgKCFpdGVtKSByZXR1cm47XG4gICAgICBhd2FpdCB0aGlzLmN0eC5zdG9yZS5sb2dNZWFsKHRhcmdldE1lYWwoKSwgW2l0ZW1dKTtcbiAgICAgIHRoaXMuYWRkRm9ybS5uYW1lID0gXCJcIjsgdGhpcy5hZGRGb3JtLmNhbCA9IFwiXCI7XG4gICAgICB0aGlzLnNlbGVjdGVkRGF0ZSA9IHRvZGF5TG9jYWwoKTtcbiAgICAgIHRoaXMuY3R4LnJlZnJlc2goKTtcbiAgICAgIHRvYXN0KGBMb2dnZWQgJHtpdGVtLm5hbWV9IHRvICR7dGFyZ2V0TWVhbCgpLm5hbWV9YCk7XG4gICAgfTtcbiAgICBjb25zdCB0b1BsYW4gPSByb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIisgQWRkIHRvIFBsYW5cIiwgY2xzOiBcInBhLW1pbmktYnRuXCIgfSk7XG4gICAgdG9QbGFuLm9uY2xpY2sgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBpdGVtID0gYnVpbGRJdGVtKCk7XG4gICAgICBpZiAoIWl0ZW0pIHJldHVybjtcbiAgICAgIGNvbnN0IG1lYWwgPSB0YXJnZXRNZWFsKCk7XG4gICAgICBhd2FpdCB0aGlzLmN0eC5zdG9yZS5zYXZlTWVhbCh7IGlkOiBtZWFsLmlkLCBuYW1lOiBtZWFsLm5hbWUsIGVtb2ppOiBtZWFsLmVtb2ppLCBpdGVtczogWy4uLm1lYWwuaXRlbXMsIGl0ZW1dIH0pO1xuICAgICAgdGhpcy5hZGRGb3JtLm5hbWUgPSBcIlwiOyB0aGlzLmFkZEZvcm0uY2FsID0gXCJcIjtcbiAgICAgIHRoaXMuY3R4LnJlZnJlc2goKTtcbiAgICAgIHRvYXN0KGBBZGRlZCAke2l0ZW0ubmFtZX0gdG8gJHttZWFsLm5hbWV9IHBsYW5gKTtcbiAgICB9O1xuICB9XG5cbiAgLy8gLS0tLSBNZWFsIHBsYW4gY2FyZHMgKGZpeGVkIDQsIHdob2xlIGNhcmQgY2xpY2thYmxlKSAtLS0tXG4gIHByaXZhdGUgcmVuZGVyTWVhbFBsYW5zKHJvb3Q6IEhUTUxFbGVtZW50LCBtZWFsczogTWVhbFtdKTogdm9pZCB7XG4gICAgY29uc3QgcGFuZWwgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS1wYW5lbFwiIH0pO1xuICAgIGNvbnN0IGhlYWQgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtc2VjdGlvbi1oZWFkXCIgfSk7XG4gICAgaGVhZC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogXCJcdUQ4M0NcdURGN0RcdUZFMEYgTWVhbCBQbGFuIFx1MjAxNCA0IGZpeGVkIHNsb3RzIFx1MDBCNyB0YXAgYSBjYXJkIHRvIGVkaXRcIiwgY2xzOiBcInBhLXBhbmVsLXRpdGxlXCIgfSk7XG4gICAgY29uc3Qgd2F0ZXIgPSBoZWFkLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdUQ4M0RcdURDQTcgKzI1MG1sXCIsIGNsczogXCJwYS1taW5pLWJ0blwiIH0pO1xuICAgIHdhdGVyLm9uY2xpY2sgPSBhc3luYyAoKSA9PiB7IGF3YWl0IHRoaXMuY3R4LnN0b3JlLmFkZFdhdGVyKHRvZGF5TG9jYWwoKSwgMC4yNSk7IHRoaXMuY3R4LnJlZnJlc2goKTsgdG9hc3QoXCJcdUQ4M0RcdURDQTcgKzI1MG1sXCIpOyB9O1xuXG4gICAgY29uc3QgZ3JpZCA9IHBhbmVsLmNyZWF0ZURpdih7IGNsczogXCJwYS1wbGFuLWdyaWRcIiB9KTtcbiAgICBtZWFscy5mb3JFYWNoKChtKSA9PiB7XG4gICAgICBjb25zdCBjYXJkID0gZ3JpZC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtcGxhbi1jYXJkIHBhLWNsaWNrYWJsZVwiICsgKHRoaXMuc2VsZWN0ZWRNZWFsID09PSBtLmlkID8gXCIgb25cIiA6IFwiXCIpIH0pO1xuICAgICAgY2FyZC5vbmNsaWNrID0gKCkgPT4geyB0aGlzLnNlbGVjdGVkTWVhbCA9IHRoaXMuc2VsZWN0ZWRNZWFsID09PSBtLmlkID8gbnVsbCA6IG0uaWQ7IHRoaXMuc2VsZWN0ZWREYXRlID0gbnVsbDsgdGhpcy5jdHgucmVmcmVzaCgpOyB9O1xuICAgICAgY2FyZC5jcmVhdGVEaXYoeyB0ZXh0OiBgJHttLmVtb2ppIHx8IFwiXCJ9ICR7bS5uYW1lfSAoJHttLnRvdGFsQ2FsfSBjYWwpYC50cmltKCksIGNsczogXCJwYS1wbGFuLXRpdGxlXCIgfSk7XG4gICAgICBjb25zdCBsaXN0RWwgPSBjYXJkLmNyZWF0ZURpdih7IGNsczogXCJwYS1wbGFuLWxpc3RcIiB9KTtcbiAgICAgIGlmICghbS5pdGVtcy5sZW5ndGgpIGxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtbXV0ZWRcIiwgdGV4dDogXCJObyBpdGVtc1wiIH0pO1xuICAgICAgZWxzZSBtLml0ZW1zLmZvckVhY2goKGl0KSA9PiBsaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXBsYW4tZXhcIiwgdGV4dDogYCR7aXQubmFtZX0gXHUyMDE0ICR7aXQucXR5fSAke2l0LnVuaXR9YCB9KSk7XG4gICAgfSk7XG4gIH1cblxuICAvLyAtLS0tIE1lYWwgZWRpdG9yIChiZWxvdyBwbGFucykgLS0tLVxuICBwcml2YXRlIHJlbmRlck1lYWxFZGl0b3Iocm9vdDogSFRNTEVsZW1lbnQsIG1lYWxzOiBNZWFsW10pOiB2b2lkIHtcbiAgICBjb25zdCBtZWFsID0gbWVhbHMuZmluZCgobSkgPT4gbS5pZCA9PT0gdGhpcy5zZWxlY3RlZE1lYWwpO1xuICAgIGlmICghbWVhbCkgcmV0dXJuO1xuICAgIGNvbnN0IHBhbmVsID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtcGFuZWwgcGEtYWN0aXZlXCIgfSk7XG4gICAgY29uc3QgdG9wID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWFjdGl2ZS10b3BcIiB9KTtcbiAgICB0b3AuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IGAke21lYWwuZW1vamkgfHwgXCJcIn0gJHttZWFsLm5hbWV9YC50cmltKCksIGNsczogXCJwYS1wYW5lbC10aXRsZVwiIH0pO1xuICAgIGNvbnN0IHRvdGFsRWwgPSB0b3AuY3JlYXRlU3Bhbih7IGNsczogXCJwYS1tdXRlZFwiIH0pO1xuXG4gICAgY29uc3QgdGFibGUgPSBwYW5lbC5jcmVhdGVFbChcInRhYmxlXCIsIHsgY2xzOiBcInBhLWZpdC10YWJsZVwiIH0pO1xuICAgIGNvbnN0IHRociA9IHRhYmxlLmNyZWF0ZUVsKFwidGhlYWRcIikuY3JlYXRlRWwoXCJ0clwiKTtcbiAgICBbXCJcdTI3MTNcIiwgXCJGb29kXCIsIFwiUXR5XCIsIFwiVW5pdFwiLCBcIkNhbG9yaWVzXCIsIFwiXCJdLmZvckVhY2goKGgpID0+IHRoci5jcmVhdGVFbChcInRoXCIsIHsgdGV4dDogaCB9KSk7XG4gICAgY29uc3QgdGJvZHkgPSB0YWJsZS5jcmVhdGVFbChcInRib2R5XCIpO1xuXG4gICAgY29uc3QgcmVjYWxjID0gKCkgPT4ge1xuICAgICAgbGV0IHN1bSA9IDA7XG4gICAgICB0Ym9keS5xdWVyeVNlbGVjdG9yQWxsKFwidHJcIikuZm9yRWFjaCgodHIpID0+IHtcbiAgICAgICAgY29uc3QgY2hrID0gdHIucXVlcnlTZWxlY3RvcihcImlucHV0LnBhLWl0LWNoZWNrXCIpIGFzIEhUTUxJbnB1dEVsZW1lbnQ7XG4gICAgICAgIGNvbnN0IGNhbEluID0gdHIucXVlcnlTZWxlY3RvcihcImlucHV0LnBhLWl0LWNhbFwiKSBhcyBIVE1MSW5wdXRFbGVtZW50O1xuICAgICAgICBpZiAoY2hrPy5jaGVja2VkKSBzdW0gKz0gcGFyc2VJbnQoY2FsSW4udmFsdWUpIHx8IDA7XG4gICAgICB9KTtcbiAgICAgIHRvdGFsRWwuc2V0VGV4dChgRXN0aW1hdGVkIHRvdGFsOiAke3N1bX0gY2FsYCk7XG4gICAgfTtcblxuICAgIGlmICghbWVhbC5pdGVtcy5sZW5ndGgpIHtcbiAgICAgIHBhbmVsLmNyZWF0ZUVsKFwicFwiLCB7IGNsczogXCJwYS1tdXRlZFwiLCB0ZXh0OiBcIk5vIGl0ZW1zIGluIHRoaXMgcGxhbiB5ZXQuIEFkZCBhIGZvb2QgYmVsb3cuXCIgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIG1lYWwuaXRlbXMuZm9yRWFjaCgoaXQsIGlkeCkgPT4ge1xuICAgICAgICBjb25zdCB0ciA9IHRib2R5LmNyZWF0ZUVsKFwidHJcIik7XG4gICAgICAgIHRyLmRhdGFzZXQuaWR4ID0gU3RyaW5nKGlkeCk7XG4gICAgICAgIGNvbnN0IGNoayA9IHRyLmNyZWF0ZUVsKFwidGRcIikuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IGNsczogXCJwYS1pdC1jaGVja1wiIH0pO1xuICAgICAgICBjaGsudHlwZSA9IFwiY2hlY2tib3hcIjsgY2hrLmNoZWNrZWQgPSB0cnVlOyBjaGsub25jaGFuZ2UgPSByZWNhbGM7XG4gICAgICAgIHRyLmNyZWF0ZUVsKFwidGRcIiwgeyB0ZXh0OiBpdC5uYW1lLCBjbHM6IFwicGEtZml0LW5hbWVcIiB9KTtcbiAgICAgICAgY29uc3QgcXR5SW4gPSB0ci5jcmVhdGVFbChcInRkXCIpLmNyZWF0ZUVsKFwiaW5wdXRcIiwgeyBjbHM6IFwicGEtZml0LWlucHV0IHBhLWl0LXF0eVwiIH0pO1xuICAgICAgICBxdHlJbi50eXBlID0gXCJudW1iZXJcIjsgcXR5SW4udmFsdWUgPSBTdHJpbmcoaXQucXR5KTtcbiAgICAgICAgdHIuY3JlYXRlRWwoXCJ0ZFwiLCB7IHRleHQ6IGl0LnVuaXQsIGNsczogXCJwYS1tdXRlZFwiIH0pO1xuICAgICAgICBjb25zdCBjYWxJbiA9IHRyLmNyZWF0ZUVsKFwidGRcIikuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IGNsczogXCJwYS1maXQtaW5wdXQgcGEtaXQtY2FsXCIgfSk7XG4gICAgICAgIGNhbEluLnR5cGUgPSBcIm51bWJlclwiOyBjYWxJbi52YWx1ZSA9IFN0cmluZyhpdC5jYWwpOyBjYWxJbi5vbmlucHV0ID0gcmVjYWxjO1xuICAgICAgICBjb25zdCBkZWwgPSB0ci5jcmVhdGVFbChcInRkXCIpLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdUQ4M0RcdURERDFcIiwgY2xzOiBcInBhLWljb24tYnRuXCIgfSk7XG4gICAgICAgIGRlbC5vbmNsaWNrID0gKCkgPT4geyB0ci5yZW1vdmUoKTsgcmVjYWxjKCk7IH07XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmVjYWxjKCk7XG5cbiAgICBjb25zdCBhY3Rpb25zID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWFjdGl2ZS1hY3Rpb25zXCIgfSk7XG4gICAgY29uc3QgY29uZmlybSA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjcxMyBDb25maXJtIE1lYWxcIiwgY2xzOiBcInBhLWJ0blwiIH0pO1xuICAgIGNvbmZpcm0ub25jbGljayA9IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGVhdGVuID0gdGhpcy5yZWFkUm93cyh0Ym9keSwgbWVhbCwgdHJ1ZSk7XG4gICAgICBpZiAoIWVhdGVuLmxlbmd0aCkgeyB0b2FzdChcIkNoZWNrIGF0IGxlYXN0IG9uZSBpdGVtLlwiKTsgcmV0dXJuOyB9XG4gICAgICBhd2FpdCB0aGlzLmN0eC5zdG9yZS5sb2dNZWFsKG1lYWwsIGVhdGVuKTtcbiAgICAgIHRoaXMuc2VsZWN0ZWRNZWFsID0gbnVsbDtcbiAgICAgIHRoaXMuc2VsZWN0ZWREYXRlID0gdG9kYXlMb2NhbCgpOyAvLyBzaG93IHRoZSBsb2cgYXQgdGhlIGJvdHRvbVxuICAgICAgdGhpcy5jdHgucmVmcmVzaCgpO1xuICAgICAgdG9hc3QoYFx1MjcxMyAke21lYWwubmFtZX0gY29uZmlybWVkYCk7XG4gICAgfTtcbiAgICBjb25zdCBzYXZlID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiXHVEODNEXHVEQ0JFIFNhdmUgUGxhblwiLCBjbHM6IFwicGEtbWluaS1idG5cIiB9KTtcbiAgICBzYXZlLm9uY2xpY2sgPSBhc3luYyAoKSA9PiB7IGF3YWl0IHRoaXMuY3R4LnN0b3JlLnNhdmVNZWFsKHsgaWQ6IG1lYWwuaWQsIG5hbWU6IG1lYWwubmFtZSwgZW1vamk6IG1lYWwuZW1vamksIGl0ZW1zOiB0aGlzLnJlYWRSb3dzKHRib2R5LCBtZWFsLCBmYWxzZSkgfSk7IHRoaXMuY3R4LnJlZnJlc2goKTsgdG9hc3QoXCJcdUQ4M0RcdURDQkUgUGxhbiBzYXZlZFwiKTsgfTtcbiAgICBjb25zdCBjbG9zZSA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNsb3NlXCIsIGNsczogXCJwYS1taW5pLWJ0blwiIH0pO1xuICAgIGNsb3NlLm9uY2xpY2sgPSAoKSA9PiB7IHRoaXMuc2VsZWN0ZWRNZWFsID0gbnVsbDsgdGhpcy5jdHgucmVmcmVzaCgpOyB9O1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkUm93cyh0Ym9keTogSFRNTEVsZW1lbnQsIG1lYWw6IE1lYWwsIG9ubHlDaGVja2VkOiBib29sZWFuKTogTWVhbEl0ZW1bXSB7XG4gICAgY29uc3QgaXRlbXM6IE1lYWxJdGVtW10gPSBbXTtcbiAgICB0Ym9keS5xdWVyeVNlbGVjdG9yQWxsKFwidHJcIikuZm9yRWFjaCgodHIpID0+IHtcbiAgICAgIGNvbnN0IGNoayA9IHRyLnF1ZXJ5U2VsZWN0b3IoXCJpbnB1dC5wYS1pdC1jaGVja1wiKSBhcyBIVE1MSW5wdXRFbGVtZW50O1xuICAgICAgaWYgKG9ubHlDaGVja2VkICYmICFjaGsuY2hlY2tlZCkgcmV0dXJuO1xuICAgICAgY29uc3QgaWR4ID0gcGFyc2VJbnQoKHRyIGFzIEhUTUxFbGVtZW50KS5kYXRhc2V0LmlkeCB8fCBcIjBcIik7XG4gICAgICBjb25zdCBiYXNlID0gbWVhbC5pdGVtc1tpZHhdIHx8IHsgbmFtZTogXCJJdGVtXCIsIHVuaXQ6IFwiZ1wiIH07XG4gICAgICBpdGVtcy5wdXNoKHtcbiAgICAgICAgbmFtZTogYmFzZS5uYW1lLFxuICAgICAgICB1bml0OiBiYXNlLnVuaXQsXG4gICAgICAgIHF0eTogcGFyc2VGbG9hdCgodHIucXVlcnlTZWxlY3RvcihcImlucHV0LnBhLWl0LXF0eVwiKSBhcyBIVE1MSW5wdXRFbGVtZW50KS52YWx1ZSkgfHwgMCxcbiAgICAgICAgY2FsOiBwYXJzZUludCgodHIucXVlcnlTZWxlY3RvcihcImlucHV0LnBhLWl0LWNhbFwiKSBhcyBIVE1MSW5wdXRFbGVtZW50KS52YWx1ZSkgfHwgMCxcbiAgICAgICAgcHJvdGVpbjogYmFzZS5wcm90ZWluLCBjYXJiczogYmFzZS5jYXJicyxcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIHJldHVybiBpdGVtcztcbiAgfVxuXG4gIC8vIC0tLS0gU3RhdHMgLS0tLVxuICBwcml2YXRlIHJlbmRlclN0YXRzKHJvb3Q6IEhUTUxFbGVtZW50LCBjYWxCeURheTogTWFwPHN0cmluZywgbnVtYmVyPiwgd2F0ZXI6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4sIHRvZGF5OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBjZmcgPSB0aGlzLmN0eC5jb25maWc7XG4gICAgY29uc3QgY29uc3VtZWQgPSBjYWxCeURheS5nZXQodG9kYXkpIHx8IDA7XG4gICAgY29uc3QgcmVtYWluaW5nID0gY2ZnLmNhbG9yaWVUYXJnZXQgLSBjb25zdW1lZDtcbiAgICBjb25zdCB3YXRlclRvZGF5ID0gd2F0ZXJbdG9kYXldIHx8IDA7XG5cbiAgICBjb25zdCByb3cgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS1zdGF0cy1yb3dcIiB9KTtcbiAgICBjb25zdCBzdGF0ID0gKGxhYmVsOiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcsIGNvbG9yPzogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCBjID0gcm93LmNyZWF0ZURpdih7IGNsczogXCJwYS1zdGF0XCIgfSk7XG4gICAgICBjb25zdCB2ID0gYy5jcmVhdGVEaXYoeyB0ZXh0OiB2YWx1ZSwgY2xzOiBcInBhLXN0YXQtdmFsdWVcIiB9KTtcbiAgICAgIGlmIChjb2xvcikgdi5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICAgICAgYy5jcmVhdGVEaXYoeyB0ZXh0OiBsYWJlbCwgY2xzOiBcInBhLXN0YXQtbGFiZWxcIiB9KTtcbiAgICB9O1xuICAgIHN0YXQoXCJcdUQ4M0VcdURENTcgQ0FMT1JJRVMgVE9EQVlcIiwgU3RyaW5nKGNvbnN1bWVkKSk7XG4gICAgc3RhdChcIlx1RDgzQ1x1REZBRiBEQUlMWSBHT0FMXCIsIFN0cmluZyhjZmcuY2Fsb3JpZVRhcmdldCksIFwidmFyKC0tdGV4dC1hY2NlbnQpXCIpO1xuICAgIHN0YXQoXCJcdTI3OTYgUkVNQUlOSU5HXCIsIFN0cmluZyhyZW1haW5pbmcpLCByZW1haW5pbmcgPj0gMCA/IFwiIzE2YTM0YVwiIDogXCIjZWY0NDQ0XCIpO1xuICAgIHN0YXQoYFx1RDgzRFx1RENBNyBXQVRFUiAvJHtjZmcud2F0ZXJUYXJnZXR9TGAsIGAke3dhdGVyVG9kYXkudG9GaXhlZCgxKX1MYCwgXCIjM2I4MmY2XCIpO1xuICB9XG5cbiAgLy8gLS0tLSBDYWxlbmRhciAtLS0tXG4gIHByaXZhdGUgcmVuZGVyQ2FsZW5kYXIocm9vdDogSFRNTEVsZW1lbnQsIGNhbEJ5RGF5OiBNYXA8c3RyaW5nLCBudW1iZXI+KTogdm9pZCB7XG4gICAgY29uc3QgdGFyZ2V0ID0gdGhpcy5jdHguY29uZmlnLmNhbG9yaWVUYXJnZXQgfHwgMjAwMDtcbiAgICBjb25zdCBjYXJkID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtcGFuZWxcIiB9KTtcbiAgICBjYXJkLmNyZWF0ZUVsKFwiaDNcIiwgeyB0ZXh0OiBcIlx1RDgzRFx1RENDNSBNZWFsIENhbGVuZGFyXCIsIGNsczogXCJwYS1wYW5lbC10aXRsZVwiIH0pO1xuICAgIGNvbnN0IGhlYWRlciA9IGNhcmQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWNhbC1oZWFkXCIgfSk7XG4gICAgY29uc3QgcHJldiA9IGhlYWRlci5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiXHUyMTkwXCIsIGNsczogXCJwYS1pY29uLWJ0blwiIH0pO1xuICAgIGhlYWRlci5jcmVhdGVTcGFuKHsgdGV4dDogbmV3IERhdGUodGhpcy5jYWxZZWFyLCB0aGlzLmNhbE1vbnRoLCAxKS50b0xvY2FsZVN0cmluZyhcImRlZmF1bHRcIiwgeyBtb250aDogXCJsb25nXCIsIHllYXI6IFwibnVtZXJpY1wiIH0pLCBjbHM6IFwicGEtY2FsLXRpdGxlXCIgfSk7XG4gICAgY29uc3QgbmV4dCA9IGhlYWRlci5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiXHUyMTkyXCIsIGNsczogXCJwYS1pY29uLWJ0blwiIH0pO1xuICAgIHByZXYub25jbGljayA9ICgpID0+IHsgdGhpcy5jYWxNb250aC0tOyBpZiAodGhpcy5jYWxNb250aCA8IDApIHsgdGhpcy5jYWxNb250aCA9IDExOyB0aGlzLmNhbFllYXItLTsgfSB0aGlzLmN0eC5yZWZyZXNoKCk7IH07XG4gICAgbmV4dC5vbmNsaWNrID0gKCkgPT4geyB0aGlzLmNhbE1vbnRoKys7IGlmICh0aGlzLmNhbE1vbnRoID4gMTEpIHsgdGhpcy5jYWxNb250aCA9IDA7IHRoaXMuY2FsWWVhcisrOyB9IHRoaXMuY3R4LnJlZnJlc2goKTsgfTtcblxuICAgIGNvbnN0IGdyaWQgPSBjYXJkLmNyZWF0ZURpdih7IGNsczogXCJwYS1jYWwtZ3JpZFwiIH0pO1xuICAgIFtcIlN1blwiLCBcIk1vblwiLCBcIlR1ZVwiLCBcIldlZFwiLCBcIlRodVwiLCBcIkZyaVwiLCBcIlNhdFwiXS5mb3JFYWNoKChkKSA9PiBncmlkLmNyZWF0ZURpdih7IHRleHQ6IGQsIGNsczogXCJwYS1jYWwtZG93XCIgfSkpO1xuICAgIGNvbnN0IGZpcnN0RG93ID0gbmV3IERhdGUodGhpcy5jYWxZZWFyLCB0aGlzLmNhbE1vbnRoLCAxKS5nZXREYXkoKTtcbiAgICBjb25zdCBkYXlzSW5Nb250aCA9IG5ldyBEYXRlKHRoaXMuY2FsWWVhciwgdGhpcy5jYWxNb250aCArIDEsIDApLmdldERhdGUoKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGZpcnN0RG93OyBpKyspIGdyaWQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWNhbC1jZWxsIGVtcHR5XCIgfSk7XG4gICAgY29uc3QgdG9kYXkgPSB0b2RheUxvY2FsKCk7XG4gICAgZm9yIChsZXQgZGF5ID0gMTsgZGF5IDw9IGRheXNJbk1vbnRoOyBkYXkrKykge1xuICAgICAgY29uc3QgZHMgPSBgJHt0aGlzLmNhbFllYXJ9LSR7U3RyaW5nKHRoaXMuY2FsTW9udGggKyAxKS5wYWRTdGFydCgyLCBcIjBcIil9LSR7U3RyaW5nKGRheSkucGFkU3RhcnQoMiwgXCIwXCIpfWA7XG4gICAgICBjb25zdCBjZWxsID0gZ3JpZC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtY2FsLWNlbGxcIiB9KTtcbiAgICAgIGNlbGwuY3JlYXRlRGl2KHsgdGV4dDogU3RyaW5nKGRheSksIGNsczogXCJwYS1jYWwtZGF5XCIgfSk7XG4gICAgICBjb25zdCBjYWwgPSBjYWxCeURheS5nZXQoZHMpO1xuICAgICAgaWYgKGNhbCAhPSBudWxsKSB7XG4gICAgICAgIGNvbnN0IHBjdCA9IHRhcmdldCA/IChjYWwgLyB0YXJnZXQpICogMTAwIDogMDtcbiAgICAgICAgY29uc3QgY29sb3IgPSBwY3QgPj0gODAgJiYgcGN0IDw9IDExMCA/IFwiIzE2YTM0YVwiIDogcGN0ID4gMTEwID8gXCIjZWY0NDQ0XCIgOiBcIiNmNTllMGJcIjtcbiAgICAgICAgY2VsbC5zdHlsZS5iYWNrZ3JvdW5kID0gY29sb3I7XG4gICAgICAgIGNlbGwuc3R5bGUuY29sb3IgPSBcIiNmZmZcIjtcbiAgICAgICAgY2VsbC5jcmVhdGVEaXYoeyB0ZXh0OiBTdHJpbmcoY2FsKSwgY2xzOiBcInBhLWNhbC10YWdcIiB9KTtcbiAgICAgICAgY2VsbC5vbmNsaWNrID0gKCkgPT4geyB0aGlzLnNlbGVjdGVkRGF0ZSA9IGRzOyB0aGlzLnNlbGVjdGVkTWVhbCA9IG51bGw7IHRoaXMuY3R4LnJlZnJlc2goKTsgfTtcbiAgICAgIH1cbiAgICAgIGlmIChkcyA9PT0gdG9kYXkpIGNlbGwuYWRkQ2xhc3MoXCJ0b2RheVwiKTtcbiAgICB9XG4gICAgY29uc3QgbGVnZW5kID0gY2FyZC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtY2FsLWxlZ2VuZFwiIH0pO1xuICAgIFtbXCIjZjU5ZTBiXCIsIFwiPDgwJVwiXSwgW1wiIzE2YTM0YVwiLCBcIjgwLTExMCVcIl0sIFtcIiNlZjQ0NDRcIiwgXCI+MTEwJVwiXV0uZm9yRWFjaCgoW2MsIGxdKSA9PiB7XG4gICAgICBjb25zdCBpdGVtID0gbGVnZW5kLmNyZWF0ZURpdih7IGNsczogXCJwYS1sZWdlbmQtaXRlbVwiIH0pO1xuICAgICAgY29uc3QgZG90ID0gaXRlbS5jcmVhdGVTcGFuKHsgY2xzOiBcInBhLWxlZ2VuZC1kb3RcIiB9KTsgZG90LnN0eWxlLmJhY2tncm91bmQgPSBjO1xuICAgICAgaXRlbS5jcmVhdGVTcGFuKHsgdGV4dDogbCB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIC0tLS0gQ2Fsb3JpZXMgbGFzdCA3IGRheXMgLS0tLVxuICBwcml2YXRlIHJlbmRlclRyZW5kKHJvb3Q6IEhUTUxFbGVtZW50LCBjYWxCeURheTogTWFwPHN0cmluZywgbnVtYmVyPiwgdG9kYXk6IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IGNhcmQgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS1wYW5lbFwiIH0pO1xuICAgIGNhcmQuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwiXHVEODNEXHVEQ0M4IENhbG9yaWVzIExhc3QgNyBEYXlzXCIsIGNsczogXCJwYS1wYW5lbC10aXRsZVwiIH0pO1xuICAgIGNvbnN0IGxhYmVsczogc3RyaW5nW10gPSBbXTtcbiAgICBjb25zdCB2YWx1ZXM6IG51bWJlcltdID0gW107XG4gICAgY29uc3QgYmFzZSA9IG5ldyBEYXRlKHRvZGF5ICsgXCJUMDA6MDA6MDBcIik7XG4gICAgZm9yIChsZXQgaSA9IDY7IGkgPj0gMDsgaS0tKSB7XG4gICAgICBjb25zdCBkID0gbmV3IERhdGUoYmFzZSk7IGQuc2V0RGF0ZShkLmdldERhdGUoKSAtIGkpO1xuICAgICAgY29uc3QgZHMgPSB5bWQoZCk7XG4gICAgICBsYWJlbHMucHVzaChkcy5zbGljZSg1KSk7XG4gICAgICB2YWx1ZXMucHVzaChjYWxCeURheS5nZXQoZHMpIHx8IDApO1xuICAgIH1cbiAgICBkcmF3TGluZUNoYXJ0KGNhcmQsIGxhYmVscywgW3sgbmFtZTogXCJDYWxvcmllc1wiLCBjb2xvcjogXCIjZjU5ZTBiXCIsIHZhbHVlcyB9XSwgeyBnb2FsOiB0aGlzLmN0eC5jb25maWcuY2Fsb3JpZVRhcmdldCwgaGVpZ2h0OiAyMjAgfSk7XG4gIH1cblxuICAvLyAtLS0tIFNlbGVjdGVkIGRheSBkZXRhaWwgKGxvZykgLS0tLVxuICBwcml2YXRlIHJlbmRlckRheURldGFpbChyb290OiBIVE1MRWxlbWVudCwgbWVhbHM6IE1lYWxbXSwgbG9nczogTWVhbExvZ1tdKTogdm9pZCB7XG4gICAgY29uc3QgZHMgPSB0aGlzLnNlbGVjdGVkRGF0ZSE7XG4gICAgY29uc3QgZGF5TG9ncyA9IGxvZ3MuZmlsdGVyKChsKSA9PiBsLmRhdGUgPT09IGRzKTtcbiAgICBjb25zdCB0b3RhbCA9IGRheUxvZ3MucmVkdWNlKChzLCBsKSA9PiBzICsgbC50b3RhbENhbCwgMCk7XG4gICAgY29uc3QgcGFuZWwgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS1wYW5lbCBwYS1hY3RpdmVcIiB9KTtcbiAgICBjb25zdCB0b3AgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtYWN0aXZlLXRvcFwiIH0pO1xuICAgIHRvcC5jcmVhdGVFbChcImgzXCIsIHsgdGV4dDogYFx1RDgzQ1x1REY3NCAke2RzfSBcdTIwMTQgJHt0b3RhbH0gY2FsYCwgY2xzOiBcInBhLXBhbmVsLXRpdGxlXCIgfSk7XG4gICAgY29uc3QgY2xvc2UgPSB0b3AuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjcxNVwiLCBjbHM6IFwicGEtaWNvbi1idG5cIiB9KTtcbiAgICBjbG9zZS5vbmNsaWNrID0gKCkgPT4geyB0aGlzLnNlbGVjdGVkRGF0ZSA9IG51bGw7IHRoaXMuY3R4LnJlZnJlc2goKTsgfTtcblxuICAgIGlmICghZGF5TG9ncy5sZW5ndGgpIHsgcGFuZWwuY3JlYXRlRWwoXCJwXCIsIHsgY2xzOiBcInBhLW11dGVkXCIsIHRleHQ6IFwiTm8gbWVhbHMgbG9nZ2VkIHRoaXMgZGF5LlwiIH0pOyByZXR1cm47IH1cbiAgICBkYXlMb2dzLmZvckVhY2goKGwpID0+IHtcbiAgICAgIGNvbnN0IG1lYWwgPSBtZWFscy5maW5kKChtKSA9PiBtLmlkID09PSBsLm1lYWxJZCk7XG4gICAgICBjb25zdCBjYXJkID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWNhcmRcIiB9KTtcbiAgICAgIGNvbnN0IHRyID0gY2FyZC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtY2FyZC10aXRsZS1yb3dcIiB9KTtcbiAgICAgIHRyLmNyZWF0ZUVsKFwic3Ryb25nXCIsIHsgdGV4dDogbWVhbCA/IGAke21lYWwuZW1vamkgfHwgXCJcIn0gJHttZWFsLm5hbWV9YCA6IGwubWVhbElkIHx8IFwiTWVhbFwiIH0pO1xuICAgICAgY29uc3QgZGVsID0gdHIuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjcxNVwiLCBjbHM6IFwicGEtaWNvbi1idG5cIiB9KTtcbiAgICAgIGRlbC5vbmNsaWNrID0gYXN5bmMgKCkgPT4geyBhd2FpdCB0aGlzLmN0eC5zdG9yZS5kZWxldGVNZWFsTG9nKGwpOyB0aGlzLmN0eC5yZWZyZXNoKCk7IH07XG4gICAgICBsLml0ZW1zLmZvckVhY2goKGl0KSA9PiBjYXJkLmNyZWF0ZURpdih7IGNsczogXCJwYS1tdXRlZFwiLCB0ZXh0OiBgJHtpdC5uYW1lfSBcdTIwMTQgJHtpdC5xdHl9JHtpdC51bml0fSAoJHtpdC5jYWx9IGNhbClgIH0pKTtcbiAgICAgIGNhcmQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLW1hY3JvLXRvdGFsXCIsIHRleHQ6IGBUb3RhbDogJHtsLnRvdGFsQ2FsfSBjYWxgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgUEFDb250ZXh0IH0gZnJvbSBcIi4uL2NvbnRleHRcIjtcbmltcG9ydCB7IEJvYXJkLCBTdHVkeUNhcmQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcbmltcG9ydCB7IENvbmZpcm1Nb2RhbCwgRmllbGRTcGVjLCBGb3JtTW9kYWwsIG9wZW5FeHRlcm5hbCwgdG9hc3QgfSBmcm9tIFwiLi4vdWlcIjtcbmltcG9ydCB7IGRyYXdSaW5nIH0gZnJvbSBcIi4uL2NoYXJ0c1wiO1xuXG5jb25zdCBSSU5HX0NPTE9SUyA9IFtcIiNkOTc3MDZcIiwgXCIjN2MzYWVkXCIsIFwiIzE2YTM0YVwiXTtcbmNvbnN0IENPTFVNTl9DT0xPUlMgPSBbXCIjN2MzYWVkXCIsIFwiIzNiODJmNlwiLCBcIiMxNmEzNGFcIiwgXCIjZjU5ZTBiXCIsIFwiI2VmNDQ0NFwiLCBcIiMxMGI5ODFcIl07XG5cbi8qKiBSZW5kZXJzIHRoZSBTdHVkaWVzIHBhZ2U6IGEgS2FuYmFuIC8gTGlzdCBib2FyZCBvdmVyIFN0dWRpZXMve3RvcGljfS8qLm1kLiAqL1xuZXhwb3J0IGNsYXNzIFN0dWRpZXNNb2R1bGUge1xuICBwcml2YXRlIGN0eDogUEFDb250ZXh0O1xuICBwcml2YXRlIGN1cnJlbnRUb3BpYyA9IFwiYWxsXCI7XG4gIHByaXZhdGUgdmlldzogXCJrYW5iYW5cIiB8IFwibGlzdFwiID0gXCJrYW5iYW5cIjtcblxuICBjb25zdHJ1Y3RvcihjdHg6IFBBQ29udGV4dCkgeyB0aGlzLmN0eCA9IGN0eDsgfVxuXG4gIHByaXZhdGUgY2xlYW5MYWJlbChzOiBzdHJpbmcpOiBzdHJpbmcgeyByZXR1cm4gcy5yZXBsYWNlKC9eW15cXHB7TH1cXHB7Tn1dKy91LCBcIlwiKS50cmltKCk7IH1cbiAgcHJpdmF0ZSBjb2xDb2xvcihpOiBudW1iZXIpOiBzdHJpbmcgeyByZXR1cm4gQ09MVU1OX0NPTE9SU1tpICUgQ09MVU1OX0NPTE9SUy5sZW5ndGhdOyB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlVG9waWNzKGNhcmRzOiBTdHVkeUNhcmRbXSk6IEJvYXJkW10ge1xuICAgIGNvbnN0IGJvYXJkcyA9IHRoaXMuY3R4LnN0b3JlLmxvYWRTdHVkeUJvYXJkcygpO1xuICAgIGlmIChib2FyZHMubGVuZ3RoKSByZXR1cm4gYm9hcmRzO1xuICAgIGNvbnN0IHNlZW4gPSBuZXcgTWFwPHN0cmluZywgQm9hcmQ+KCk7XG4gICAgY2FyZHMuZm9yRWFjaCgoYykgPT4ge1xuICAgICAgaWYgKGMudG9waWMgJiYgIXNlZW4uaGFzKGMudG9waWMpKSBzZWVuLnNldChjLnRvcGljLCB7IGlkOiBjLnRvcGljLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvW15hLXowLTldL2csIFwiLVwiKSwgbmFtZTogYy50b3BpYywgZW1vamk6IFwiXHVEODNEXHVEQ0RBXCIgfSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIEFycmF5LmZyb20oc2Vlbi52YWx1ZXMoKSk7XG4gIH1cblxuICByZW5kZXIocm9vdDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICByb290LmVtcHR5KCk7XG4gICAgY29uc3QgY2FyZHMgPSB0aGlzLmN0eC5zdG9yZS5sb2FkU3R1ZHlDYXJkcygpO1xuICAgIGNvbnN0IHRvcGljcyA9IHRoaXMucmVzb2x2ZVRvcGljcyhjYXJkcyk7XG4gICAgY29uc3QgZmlsdGVyZWQgPSBjYXJkcy5maWx0ZXIoKGMpID0+IHRoaXMuY3VycmVudFRvcGljID09PSBcImFsbFwiIHx8IGMudG9waWMgPT09IHRoaXMuY3VycmVudFRvcGljKTtcblxuICAgIHRoaXMucmVuZGVySGVhZGVyKHJvb3QsIGZpbHRlcmVkKTtcbiAgICB0aGlzLnJlbmRlclZpZXdUb2dnbGUocm9vdCk7XG4gICAgdGhpcy5yZW5kZXJUb3BpY1RhYnMocm9vdCwgdG9waWNzKTtcblxuICAgIGlmICh0aGlzLnZpZXcgPT09IFwia2FuYmFuXCIpIHtcbiAgICAgIHRoaXMucmVuZGVyU3RhdHMocm9vdCwgZmlsdGVyZWQpO1xuICAgICAgdGhpcy5yZW5kZXJUb3BpY0Jhcihyb290LCB0b3BpY3MpO1xuICAgICAgdGhpcy5yZW5kZXJLYW5iYW4ocm9vdCwgZmlsdGVyZWQsIHRvcGljcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVuZGVyTGlzdChyb290LCBmaWx0ZXJlZCwgdG9waWNzKTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0tIEhlYWRlcjogdGl0bGUgKyBzdWJ0aXRsZSArIHN0YXR1cyByaW5ncyAtLS0tXG4gIHByaXZhdGUgcmVuZGVySGVhZGVyKHJvb3Q6IEhUTUxFbGVtZW50LCBmaWx0ZXJlZDogU3R1ZHlDYXJkW10pOiB2b2lkIHtcbiAgICBjb25zdCBoZWFkID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtaHQtaGVhZGVyXCIgfSk7XG4gICAgY29uc3QgbGVmdCA9IGhlYWQuY3JlYXRlRGl2KCk7XG4gICAgbGVmdC5jcmVhdGVEaXYoeyB0ZXh0OiBcIlx1RDgzRFx1RENEQSBTdHVkaWVzXCIsIGNsczogXCJwYS1oMVwiIH0pO1xuICAgIGxlZnQuY3JlYXRlRGl2KHsgdGV4dDogXCJLYW5iYW4gYW5kIGxpc3RcIiwgY2xzOiBcInBhLW11dGVkXCIgfSk7XG5cbiAgICBjb25zdCBjb2xzID0gdGhpcy5jdHguY29uZmlnLnN0dWR5Q29sdW1ucztcbiAgICBjb25zdCBuYW1lcyA9IHRoaXMuY3R4LmNvbmZpZy5zdHVkeUNvbHVtbk5hbWVzO1xuICAgIGNvbnN0IGNvbFNldCA9IG5ldyBTZXQoY29scyk7XG4gICAgY29uc3QgZWZmID0gKGM6IFN0dWR5Q2FyZCkgPT4gKGNvbFNldC5oYXMoYy5zdGF0dXMpID8gYy5zdGF0dXMgOiBjb2xzWzBdKTtcbiAgICBjb25zdCB0b3RhbCA9IGZpbHRlcmVkLmxlbmd0aCB8fCAxO1xuXG4gICAgY29uc3QgcmluZ3MgPSBoZWFkLmNyZWF0ZURpdih7IGNsczogXCJwYS1odC1yaW5nc1wiIH0pO1xuICAgIGNvbHMuc2xpY2UoMCwgMykuZm9yRWFjaCgoY29sLCBpKSA9PiB7XG4gICAgICBjb25zdCBjbnQgPSBmaWx0ZXJlZC5maWx0ZXIoKGMpID0+IGVmZihjKSA9PT0gY29sKS5sZW5ndGg7XG4gICAgICBjb25zdCBwY3QgPSBNYXRoLnJvdW5kKChjbnQgLyB0b3RhbCkgKiAxMDApO1xuICAgICAgZHJhd1JpbmcocmluZ3MsIHBjdCwgUklOR19DT0xPUlNbaV0gfHwgXCIjN2MzYWVkXCIsIHRoaXMuY2xlYW5MYWJlbChuYW1lc1tjb2xdIHx8IGNvbCksIDUyKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyVmlld1RvZ2dsZShyb290OiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IGJhciA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXZpZXctdG9nZ2xlXCIgfSk7XG4gICAgY29uc3QgbWsgPSAoaWQ6IFwia2FuYmFuXCIgfCBcImxpc3RcIiwgbGFiZWw6IHN0cmluZykgPT4ge1xuICAgICAgY29uc3QgYiA9IGJhci5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IGxhYmVsLCBjbHM6IFwicGEtdG9nZ2xlLWJ0blwiICsgKHRoaXMudmlldyA9PT0gaWQgPyBcIiBvblwiIDogXCJcIikgfSk7XG4gICAgICBiLm9uY2xpY2sgPSAoKSA9PiB7IHRoaXMudmlldyA9IGlkOyB0aGlzLmN0eC5yZWZyZXNoKCk7IH07XG4gICAgfTtcbiAgICBtayhcImthbmJhblwiLCBcIlx1RDgzRFx1RENDQiBLYW5iYW5cIik7XG4gICAgbWsoXCJsaXN0XCIsIFwiXHVEODNEXHVEQ0MzIExpc3RcIik7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclRvcGljVGFicyhyb290OiBIVE1MRWxlbWVudCwgdG9waWNzOiBCb2FyZFtdKTogdm9pZCB7XG4gICAgY29uc3QgYmFyID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtdGFic1wiIH0pO1xuICAgIGNvbnN0IG1rVGFiID0gKGlkOiBzdHJpbmcsIGxhYmVsOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbnN0IHQgPSBiYXIuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBsYWJlbCwgY2xzOiBcInBhLXRhYlwiICsgKHRoaXMuY3VycmVudFRvcGljID09PSBpZCA/IFwiIG9uXCIgOiBcIlwiKSB9KTtcbiAgICAgIHQub25jbGljayA9ICgpID0+IHsgdGhpcy5jdXJyZW50VG9waWMgPSBpZDsgdGhpcy5jdHgucmVmcmVzaCgpOyB9O1xuICAgIH07XG4gICAgbWtUYWIoXCJhbGxcIiwgXCJcdUQ4M0RcdURDREEgQWxsXCIpO1xuICAgIHRvcGljcy5mb3JFYWNoKChiKSA9PiBta1RhYihiLm5hbWUsIGAke2IuZW1vamkgfHwgXCJcIn0gJHtiLm5hbWV9YC50cmltKCkpKTtcbiAgICBjb25zdCBhZGQgPSBiYXIuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIisgVG9waWNcIiwgY2xzOiBcInBhLXRhYiBwYS10YWItYWRkXCIgfSk7XG4gICAgYWRkLm9uY2xpY2sgPSAoKSA9PiB0aGlzLm9wZW5Ub3BpY01vZGFsKHRvcGljcyk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclN0YXRzKHJvb3Q6IEhUTUxFbGVtZW50LCBmaWx0ZXJlZDogU3R1ZHlDYXJkW10pOiB2b2lkIHtcbiAgICBjb25zdCBjb2xzID0gdGhpcy5jdHguY29uZmlnLnN0dWR5Q29sdW1ucztcbiAgICBjb25zdCBuYW1lcyA9IHRoaXMuY3R4LmNvbmZpZy5zdHVkeUNvbHVtbk5hbWVzO1xuICAgIGNvbnN0IGNvbFNldCA9IG5ldyBTZXQoY29scyk7XG4gICAgY29uc3QgZWZmID0gKGM6IFN0dWR5Q2FyZCkgPT4gKGNvbFNldC5oYXMoYy5zdGF0dXMpID8gYy5zdGF0dXMgOiBjb2xzWzBdKTtcbiAgICBjb25zdCB0b3RhbCA9IGZpbHRlcmVkLmxlbmd0aDtcblxuICAgIGNvbnN0IHJvdyA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXN0YXRzLXJvd1wiIH0pO1xuICAgIGNvbnN0IHN0YXQgPSAobGFiZWw6IHN0cmluZywgdmFsdWU6IHN0cmluZywgY29sb3I/OiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbnN0IGMgPSByb3cuY3JlYXRlRGl2KHsgY2xzOiBcInBhLXN0YXRcIiB9KTtcbiAgICAgIGNvbnN0IHYgPSBjLmNyZWF0ZURpdih7IHRleHQ6IHZhbHVlLCBjbHM6IFwicGEtc3RhdC12YWx1ZVwiIH0pO1xuICAgICAgaWYgKGNvbG9yKSB2LnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBjLmNyZWF0ZURpdih7IHRleHQ6IGxhYmVsLCBjbHM6IFwicGEtc3RhdC1sYWJlbFwiIH0pO1xuICAgIH07XG4gICAgc3RhdChcIlx1RDgzRFx1RENDQiBUT1RBTFwiLCBTdHJpbmcodG90YWwpKTtcbiAgICBjb2xzLnNsaWNlKDAsIDMpLmZvckVhY2goKGNvbCwgaSwgYXJyKSA9PiB7XG4gICAgICBjb25zdCBjbnQgPSBmaWx0ZXJlZC5maWx0ZXIoKGMpID0+IGVmZihjKSA9PT0gY29sKS5sZW5ndGg7XG4gICAgICBjb25zdCBsYWJlbCA9IChuYW1lc1tjb2xdIHx8IGNvbCkudG9VcHBlckNhc2UoKTtcbiAgICAgIGlmIChpID09PSBhcnIubGVuZ3RoIC0gMSkgc3RhdChsYWJlbCwgKHRvdGFsID8gTWF0aC5yb3VuZCgoY250IC8gdG90YWwpICogMTAwKSA6IDApICsgXCIlXCIsIHRoaXMuY29sQ29sb3IoaSkpO1xuICAgICAgZWxzZSBzdGF0KGxhYmVsLCBTdHJpbmcoY250KSwgdGhpcy5jb2xDb2xvcihpKSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclRvcGljQmFyKHJvb3Q6IEhUTUxFbGVtZW50LCB0b3BpY3M6IEJvYXJkW10pOiB2b2lkIHtcbiAgICBjb25zdCBiYXIgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS1ib2FyZC1iYXJcIiB9KTtcbiAgICBjb25zdCB0b3BpYyA9IHRvcGljcy5maW5kKChiKSA9PiBiLm5hbWUgPT09IHRoaXMuY3VycmVudFRvcGljKTtcbiAgICBiYXIuY3JlYXRlRGl2KHsgdGV4dDogdG9waWMgPyBgJHt0b3BpYy5lbW9qaSB8fCBcIlwifSAke3RvcGljLm5hbWV9YC50cmltKCkgOiBcIlx1RDgzRFx1RENEQSBBbGwgdG9waWNzXCIsIGNsczogXCJwYS1ib2FyZC10aXRsZVwiIH0pO1xuICAgIGNvbnN0IGFjdGlvbnMgPSBiYXIuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWJvYXJkLWFjdGlvbnNcIiB9KTtcbiAgICBpZiAodG9waWMpIHtcbiAgICAgIGNvbnN0IHJlbmFtZUJ0biA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjcwRlx1RkUwRiBSZW5hbWVcIiwgY2xzOiBcInBhLW1pbmktYnRuXCIgfSk7XG4gICAgICByZW5hbWVCdG4ub25jbGljayA9ICgpID0+IHRoaXMub3BlblJlbmFtZVRvcGljTW9kYWwodG9waWMsIHRvcGljcyk7XG4gICAgICBjb25zdCBkZWwgPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdUQ4M0RcdURERDEgRGVsZXRlIHRvcGljXCIsIGNsczogXCJwYS1taW5pLWJ0blwiIH0pO1xuICAgICAgZGVsLm9uY2xpY2sgPSAoKSA9PlxuICAgICAgICBuZXcgQ29uZmlybU1vZGFsKHRoaXMuY3R4LmFwcCwgYERlbGV0ZSB0b3BpYyBcIiR7dG9waWMubmFtZX1cIj8gKGNhcmRzIGFyZSBrZXB0KWAsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmN0eC5zdG9yZS5zYXZlU3R1ZHlCb2FyZHModG9waWNzLmZpbHRlcigoYikgPT4gYi5uYW1lICE9PSB0b3BpYy5uYW1lKSk7XG4gICAgICAgICAgdGhpcy5jdXJyZW50VG9waWMgPSBcImFsbFwiO1xuICAgICAgICAgIHRoaXMuY3R4LnJlZnJlc2goKTtcbiAgICAgICAgfSkub3BlbigpO1xuICAgIH1cbiAgICBjb25zdCBhZGRDb2wgPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCIrIENvbHVtblwiLCBjbHM6IFwicGEtbWluaS1idG5cIiB9KTtcbiAgICBhZGRDb2wub25jbGljayA9ICgpID0+IHRoaXMub3BlbkFkZENvbHVtbk1vZGFsKCk7XG4gIH1cblxuICBwcml2YXRlIG9wZW5SZW5hbWVUb3BpY01vZGFsKHRvcGljOiBCb2FyZCwgdG9waWNzOiBCb2FyZFtdKTogdm9pZCB7XG4gICAgY29uc3QgZmllbGRzOiBGaWVsZFNwZWNbXSA9IFtcbiAgICAgIHsga2V5OiBcIm5hbWVcIiwgbGFiZWw6IFwiVG9waWMgbmFtZVwiLCB0eXBlOiBcInRleHRcIiwgdmFsdWU6IHRvcGljLm5hbWUgfSxcbiAgICAgIHsga2V5OiBcImVtb2ppXCIsIGxhYmVsOiBcIkVtb2ppXCIsIHR5cGU6IFwidGV4dFwiLCB2YWx1ZTogdG9waWMuZW1vamkgfHwgXCJcIiB9LFxuICAgIF07XG4gICAgbmV3IEZvcm1Nb2RhbCh0aGlzLmN0eC5hcHAsIFwiUmVuYW1lIHRvcGljXCIsIGZpZWxkcywgYXN5bmMgKHYpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSAodi5uYW1lIHx8IFwiXCIpLnRyaW0oKTtcbiAgICAgIGlmICghbmFtZSkgcmV0dXJuO1xuICAgICAgaWYgKG5hbWUgIT09IHRvcGljLm5hbWUgJiYgdG9waWNzLnNvbWUoKGIpID0+IGIubmFtZSA9PT0gbmFtZSkpIHsgdG9hc3QoYEEgdG9waWMgbmFtZWQgXCIke25hbWV9XCIgYWxyZWFkeSBleGlzdHMuYCk7IHJldHVybjsgfVxuICAgICAgY29uc3QgdXBkYXRlZCA9IHRvcGljcy5tYXAoKGIpID0+IChiLm5hbWUgPT09IHRvcGljLm5hbWUgPyB7IC4uLmIsIG5hbWUsIGVtb2ppOiAodi5lbW9qaSB8fCBcIlwiKS50cmltKCkgfSA6IGIpKTtcbiAgICAgIGF3YWl0IHRoaXMuY3R4LnN0b3JlLnNhdmVTdHVkeUJvYXJkcyh1cGRhdGVkKTtcbiAgICAgIGlmIChuYW1lICE9PSB0b3BpYy5uYW1lKSB7XG4gICAgICAgIGZvciAoY29uc3QgYyBvZiB0aGlzLmN0eC5zdG9yZS5sb2FkU3R1ZHlDYXJkcygpLmZpbHRlcigoYykgPT4gYy50b3BpYyA9PT0gdG9waWMubmFtZSkpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmN0eC5zdG9yZS51cGRhdGVTdHVkeUNhcmQoYywgeyB0b3BpYzogbmFtZSB9KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5jdXJyZW50VG9waWMgPT09IHRvcGljLm5hbWUpIHRoaXMuY3VycmVudFRvcGljID0gbmFtZTtcbiAgICAgIH1cbiAgICAgIHRoaXMuY3R4LnJlZnJlc2goKTtcbiAgICAgIHRvYXN0KFwiVG9waWMgdXBkYXRlZFwiKTtcbiAgICB9LCBcIlNhdmVcIikub3BlbigpO1xuICB9XG5cbiAgLy8gLS0tLSBLYW5iYW4gLS0tLVxuICBwcml2YXRlIHJlbmRlckthbmJhbihyb290OiBIVE1MRWxlbWVudCwgZmlsdGVyZWQ6IFN0dWR5Q2FyZFtdLCB0b3BpY3M6IEJvYXJkW10pOiB2b2lkIHtcbiAgICBjb25zdCBjb2xzID0gdGhpcy5jdHguY29uZmlnLnN0dWR5Q29sdW1ucztcbiAgICBjb25zdCBuYW1lcyA9IHRoaXMuY3R4LmNvbmZpZy5zdHVkeUNvbHVtbk5hbWVzO1xuICAgIGNvbnN0IGNvbFNldCA9IG5ldyBTZXQoY29scyk7XG4gICAgY29uc3QgZWZmID0gKGM6IFN0dWR5Q2FyZCkgPT4gKGNvbFNldC5oYXMoYy5zdGF0dXMpID8gYy5zdGF0dXMgOiBjb2xzWzBdKTtcblxuICAgIGNvbnN0IGJvYXJkID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwicGEta2FuYmFuXCIgfSk7XG4gICAgY29scy5mb3JFYWNoKChjb2wsIGkpID0+IHtcbiAgICAgIGNvbnN0IGNvbG9yID0gdGhpcy5jb2xDb2xvcihpKTtcbiAgICAgIGNvbnN0IGlzTGFzdCA9IGkgPT09IGNvbHMubGVuZ3RoIC0gMTtcbiAgICAgIGNvbnN0IGNvbEVsID0gYm9hcmQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWNvbFwiIH0pO1xuICAgICAgY29sRWwuc3R5bGUuYm9yZGVyQ29sb3IgPSBjb2xvcjtcbiAgICAgIGNvbnN0IGNvbENhcmRzID0gZmlsdGVyZWQuZmlsdGVyKChjKSA9PiBlZmYoYykgPT09IGNvbCk7XG5cbiAgICAgIGNvbnN0IGhlYWQgPSBjb2xFbC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtY29sLWhlYWRcIiB9KTtcbiAgICAgIGNvbnN0IHRpdGxlID0gaGVhZC5jcmVhdGVTcGFuKHsgdGV4dDogbmFtZXNbY29sXSB8fCBjb2wsIGNsczogXCJwYS1jb2wtdGl0bGVcIiB9KTtcbiAgICAgIHRpdGxlLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBjb25zdCB0b29scyA9IGhlYWQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWNvbC10b29sc1wiIH0pO1xuICAgICAgY29uc3QgY291bnQgPSB0b29scy5jcmVhdGVTcGFuKHsgdGV4dDogU3RyaW5nKGNvbENhcmRzLmxlbmd0aCksIGNsczogXCJwYS1jb2wtY291bnRcIiB9KTtcbiAgICAgIGNvdW50LnN0eWxlLmJhY2tncm91bmQgPSBjb2xvcjtcbiAgICAgIGlmIChpID4gMCkgeyBjb25zdCBsID0gdG9vbHMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjVDMFwiLCBjbHM6IFwicGEtaWNvbi1idG5cIiB9KTsgbC5vbmNsaWNrID0gKCkgPT4gdGhpcy5tb3ZlQ29sdW1uKGNvbCwgLTEpOyB9XG4gICAgICBpZiAoaSA8IGNvbHMubGVuZ3RoIC0gMSkgeyBjb25zdCByID0gdG9vbHMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjVCNlwiLCBjbHM6IFwicGEtaWNvbi1idG5cIiB9KTsgci5vbmNsaWNrID0gKCkgPT4gdGhpcy5tb3ZlQ29sdW1uKGNvbCwgMSk7IH1cbiAgICAgIGNvbnN0IGVkaXRDID0gdG9vbHMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjcwRlx1RkUwRlwiLCBjbHM6IFwicGEtaWNvbi1idG5cIiB9KTtcbiAgICAgIGVkaXRDLm9uY2xpY2sgPSAoKSA9PiB0aGlzLm9wZW5SZW5hbWVDb2x1bW5Nb2RhbChjb2wpO1xuICAgICAgY29uc3QgZGVsQyA9IHRvb2xzLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdTI3MTVcIiwgY2xzOiBcInBhLWljb24tYnRuXCIgfSk7XG4gICAgICBkZWxDLm9uY2xpY2sgPSAoKSA9PiB0aGlzLnJlbW92ZUNvbHVtbihjb2wsIGZpbHRlcmVkKTtcblxuICAgICAgY29uc3QgbGlzdCA9IGNvbEVsLmNyZWF0ZURpdih7IGNsczogXCJwYS1jb2wtYm9keVwiIH0pO1xuICAgICAgbGlzdC5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ292ZXJcIiwgKGUpID0+IHsgZS5wcmV2ZW50RGVmYXVsdCgpOyBsaXN0LmFkZENsYXNzKFwicGEtZHJvcFwiKTsgfSk7XG4gICAgICBsaXN0LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnbGVhdmVcIiwgKCkgPT4gbGlzdC5yZW1vdmVDbGFzcyhcInBhLWRyb3BcIikpO1xuICAgICAgbGlzdC5hZGRFdmVudExpc3RlbmVyKFwiZHJvcFwiLCBhc3luYyAoZSkgPT4ge1xuICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGxpc3QucmVtb3ZlQ2xhc3MoXCJwYS1kcm9wXCIpO1xuICAgICAgICBjb25zdCBwYXRoID0gZS5kYXRhVHJhbnNmZXI/LmdldERhdGEoXCJ0ZXh0L3BsYWluXCIpO1xuICAgICAgICBjb25zdCBjYXJkID0gZmlsdGVyZWQuZmluZCgoYykgPT4gYy5wYXRoID09PSBwYXRoKTtcbiAgICAgICAgaWYgKGNhcmQgJiYgY2FyZC5zdGF0dXMgIT09IGNvbCkgeyBhd2FpdCB0aGlzLmN0eC5zdG9yZS51cGRhdGVTdHVkeUNhcmRTdGF0dXMoY2FyZCwgY29sKTsgdGhpcy5jdHgucmVmcmVzaCgpOyB9XG4gICAgICB9KTtcblxuICAgICAgY29sQ2FyZHMuc2xpY2UoMCwgaXNMYXN0ICYmIGNvbENhcmRzLmxlbmd0aCA+IDcgPyA3IDogY29sQ2FyZHMubGVuZ3RoKVxuICAgICAgICAuZm9yRWFjaCgoYykgPT4gdGhpcy5yZW5kZXJDYXJkKGxpc3QsIGMsIGNvbHMsIGVmZihjKSwgaXNMYXN0LCB0b3BpY3MpKTtcbiAgICAgIGlmIChpc0xhc3QgJiYgY29sQ2FyZHMubGVuZ3RoID4gNykge1xuICAgICAgICBjb25zdCBkZXQgPSBsaXN0LmNyZWF0ZUVsKFwiZGV0YWlsc1wiLCB7IGNsczogXCJwYS1jb21wbGV0ZWQgcGEta2FuYmFuLW1vcmVcIiB9KTtcbiAgICAgICAgZGV0LmNyZWF0ZUVsKFwic3VtbWFyeVwiLCB7IHRleHQ6IGBTaG93ICR7Y29sQ2FyZHMubGVuZ3RoIC0gN30gbW9yZWAgfSk7XG4gICAgICAgIGNvbENhcmRzLnNsaWNlKDcpLmZvckVhY2goKGMpID0+IHRoaXMucmVuZGVyQ2FyZChkZXQsIGMsIGNvbHMsIGVmZihjKSwgaXNMYXN0LCB0b3BpY3MpKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWRkQnRuID0gY29sRWwuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIisgQWRkIGNhcmRcIiwgY2xzOiBcInBhLWFkZC1jYXJkXCIgfSk7XG4gICAgICBhZGRCdG4ub25jbGljayA9ICgpID0+IHRoaXMub3BlbkNhcmRNb2RhbChudWxsLCBjb2wsIHRvcGljcyk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckNhcmQobGlzdDogSFRNTEVsZW1lbnQsIGM6IFN0dWR5Q2FyZCwgY29sczogc3RyaW5nW10sIGN1cnJlbnQ6IHN0cmluZywgaXNEb25lQ29sOiBib29sZWFuLCB0b3BpY3M6IEJvYXJkW10pOiB2b2lkIHtcbiAgICBjb25zdCBjYXJkID0gbGlzdC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtY2FyZCBwYS1zdHVkeVwiICsgKGlzRG9uZUNvbCA/IFwiIGRvbmVcIiA6IFwiXCIpIH0pO1xuICAgIGNhcmQuc2V0QXR0cihcImRyYWdnYWJsZVwiLCBcInRydWVcIik7XG4gICAgY2FyZC5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ3N0YXJ0XCIsIChlKSA9PiB7IGUuZGF0YVRyYW5zZmVyPy5zZXREYXRhKFwidGV4dC9wbGFpblwiLCBjLnBhdGgpOyBjYXJkLmFkZENsYXNzKFwicGEtZHJhZ2dpbmdcIik7IH0pO1xuICAgIGNhcmQuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdlbmRcIiwgKCkgPT4gY2FyZC5yZW1vdmVDbGFzcyhcInBhLWRyYWdnaW5nXCIpKTtcblxuICAgIGNvbnN0IGJhZGdlID0gKGMuc3VidG9waWMgfHwgYy50b3BpYyB8fCBcIlwiKS50b1VwcGVyQ2FzZSgpO1xuICAgIGNvbnN0IHRvcFJvdyA9IGNhcmQuY3JlYXRlRGl2KHsgY2xzOiBcInBhLWNhcmQtdG9wXCIgfSk7XG4gICAgaWYgKGJhZGdlKSB0b3BSb3cuY3JlYXRlRGl2KHsgdGV4dDogYmFkZ2UsIGNsczogXCJwYS1jYXJkLWNhdFwiIH0pO1xuICAgIGNvbnN0IGRlbCA9IHRvcFJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiXHUyNzE1XCIsIGNsczogXCJwYS1pY29uLWJ0biBwYS1jYXJkLXhcIiB9KTtcbiAgICBkZWwub25jbGljayA9ICgpID0+IG5ldyBDb25maXJtTW9kYWwodGhpcy5jdHguYXBwLCBgRGVsZXRlIHN0dWR5IGNhcmQgXCIke2MudGl0bGV9XCI/YCwgYXN5bmMgKCkgPT4geyBhd2FpdCB0aGlzLmN0eC5zdG9yZS5kZWxldGVTdHVkeUNhcmQoYyk7IHRoaXMuY3R4LnJlZnJlc2goKTsgfSkub3BlbigpO1xuXG4gICAgY2FyZC5jcmVhdGVFbChcImRpdlwiLCB7IHRleHQ6IGMudGl0bGUsIGNsczogXCJwYS1jYXJkLXRpdGxlXCIgfSk7XG4gICAgaWYgKGMuZGF0ZSkgY2FyZC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtbXV0ZWQgcGEtY2FyZC1tZXRhXCIsIHRleHQ6IGMuZGF0ZSB9KTtcblxuICAgIGNvbnN0IGFjdGlvbnMgPSBjYXJkLmNyZWF0ZURpdih7IGNsczogXCJwYS1jYXJkLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBpZHggPSBjb2xzLmluZGV4T2YoY3VycmVudCk7XG4gICAgaWYgKGlkeCA+IDApIHsgY29uc3QgbGVmdCA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjE5MFwiLCBjbHM6IFwicGEtaWNvbi1idG5cIiB9KTsgbGVmdC5vbmNsaWNrID0gYXN5bmMgKCkgPT4geyBhd2FpdCB0aGlzLmN0eC5zdG9yZS51cGRhdGVTdHVkeUNhcmRTdGF0dXMoYywgY29sc1tpZHggLSAxXSk7IHRoaXMuY3R4LnJlZnJlc2goKTsgfTsgfVxuICAgIGlmIChpZHggPCBjb2xzLmxlbmd0aCAtIDEpIHsgY29uc3QgcmlnaHQgPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdTIxOTJcIiwgY2xzOiBcInBhLWljb24tYnRuXCIgfSk7IHJpZ2h0Lm9uY2xpY2sgPSBhc3luYyAoKSA9PiB7IGF3YWl0IHRoaXMuY3R4LnN0b3JlLnVwZGF0ZVN0dWR5Q2FyZFN0YXR1cyhjLCBjb2xzW2lkeCArIDFdKTsgdGhpcy5jdHgucmVmcmVzaCgpOyB9OyB9XG4gICAgaWYgKGMudXJsKSB7IGNvbnN0IGxpbmsgPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJcdUQ4M0RcdUREMTdcIiwgY2xzOiBcInBhLWljb24tYnRuXCIgfSk7IGxpbmsub25jbGljayA9ICgpID0+IG9wZW5FeHRlcm5hbChjLnVybCEpOyB9XG4gICAgY29uc3QgZWRpdCA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjcwRlx1RkUwRlwiLCBjbHM6IFwicGEtaWNvbi1idG5cIiB9KTtcbiAgICBlZGl0Lm9uY2xpY2sgPSAoKSA9PiB0aGlzLm9wZW5DYXJkTW9kYWwoYywgYy5zdGF0dXMsIHRvcGljcyk7XG4gICAgY29uc3Qgb3BlbiA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIlx1MjE5N1wiLCBjbHM6IFwicGEtaWNvbi1idG5cIiB9KTtcbiAgICBvcGVuLm9uY2xpY2sgPSAoKSA9PiB0aGlzLmN0eC5hcHAud29ya3NwYWNlLm9wZW5MaW5rVGV4dChjLnBhdGgsIFwiXCIsIHRydWUpO1xuICB9XG5cbiAgLy8gLS0tLSBMaXN0IHZpZXcgLS0tLVxuICBwcml2YXRlIHJlbmRlckxpc3Qocm9vdDogSFRNTEVsZW1lbnQsIGZpbHRlcmVkOiBTdHVkeUNhcmRbXSwgdG9waWNzOiBCb2FyZFtdKTogdm9pZCB7XG4gICAgY29uc3QgY29scyA9IHRoaXMuY3R4LmNvbmZpZy5zdHVkeUNvbHVtbnM7XG4gICAgY29uc3QgZmlyc3RDb2wgPSBjb2xzWzBdO1xuICAgIGNvbnN0IGxhc3RDb2wgPSBjb2xzW2NvbHMubGVuZ3RoIC0gMV07XG4gICAgY29uc3QgY29sU2V0ID0gbmV3IFNldChjb2xzKTtcbiAgICBjb25zdCBlZmYgPSAoYzogU3R1ZHlDYXJkKSA9PiAoY29sU2V0LmhhcyhjLnN0YXR1cykgPyBjLnN0YXR1cyA6IGNvbHNbMF0pO1xuICAgIGNvbnN0IGlzRG9uZSA9IChjOiBTdHVkeUNhcmQpID0+IGVmZihjKSA9PT0gbGFzdENvbDtcblxuICAgIHJvb3QuY3JlYXRlRGl2KHsgdGV4dDogXCJcdUQ4M0RcdURDREQgTGlzdCBvZiBTdHVkaWVzXCIsIGNsczogXCJwYS1oMlwiIH0pO1xuICAgIGlmICghZmlsdGVyZWQubGVuZ3RoKSB7IHJvb3QuY3JlYXRlRWwoXCJwXCIsIHsgY2xzOiBcInBhLW11dGVkXCIsIHRleHQ6IFwiTm8gc3R1ZHkgY2FyZHMuXCIgfSk7IHJldHVybjsgfVxuXG4gICAgY29uc3QgZ3JvdXBzID0gbmV3IE1hcDxzdHJpbmcsIFN0dWR5Q2FyZFtdPigpO1xuICAgIGZpbHRlcmVkLmZvckVhY2goKGMpID0+IHsgY29uc3QgayA9IGMudG9waWMgfHwgXCJObyB0b3BpY1wiOyBpZiAoIWdyb3Vwcy5oYXMoaykpIGdyb3Vwcy5zZXQoaywgW10pOyBncm91cHMuZ2V0KGspIS5wdXNoKGMpOyB9KTtcblxuICAgIGNvbnN0IHdyYXAgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJwYS1saXN0LWNhcmRzXCIgfSk7XG4gICAgZ3JvdXBzLmZvckVhY2goKGNhcmRzLCB0b3BpY05hbWUpID0+IHtcbiAgICAgIGNvbnN0IGNhcmQgPSB3cmFwLmNyZWF0ZURpdih7IGNsczogXCJwYS1saXN0LWNhcmRcIiB9KTtcbiAgICAgIGNhcmQuY3JlYXRlRGl2KHsgdGV4dDogdG9waWNOYW1lLCBjbHM6IFwicGEtbGlzdC1jYXJkLXRpdGxlXCIgfSk7XG4gICAgICBjb25zdCBhZGQgPSBjYXJkLmNyZWF0ZURpdih7IGNsczogXCJwYS1saXN0LWFkZFwiLCB0ZXh0OiBcIlx1MjcwRlx1RkUwRiBBZGQgYSBjYXJkXCIgfSk7XG4gICAgICBhZGQub25jbGljayA9ICgpID0+IHRoaXMub3BlbkNhcmRNb2RhbChudWxsLCBmaXJzdENvbCwgdG9waWNzLCB0b3BpY05hbWUgPT09IFwiTm8gdG9waWNcIiA/IFwiXCIgOiB0b3BpY05hbWUpO1xuXG4gICAgICBjb25zdCBvcGVuID0gY2FyZHMuZmlsdGVyKChjKSA9PiAhaXNEb25lKGMpKTtcbiAgICAgIGNvbnN0IGRvbmUgPSBjYXJkcy5maWx0ZXIoKGMpID0+IGlzRG9uZShjKSk7XG4gICAgICBvcGVuLmZvckVhY2goKGMpID0+IHRoaXMucmVuZGVyTGlzdEl0ZW0oY2FyZCwgYywgZmFsc2UsIGxhc3RDb2wsIGZpcnN0Q29sKSk7XG4gICAgICBpZiAoZG9uZS5sZW5ndGgpIHtcbiAgICAgICAgY29uc3QgZGV0ID0gY2FyZC5jcmVhdGVFbChcImRldGFpbHNcIiwgeyBjbHM6IFwicGEtY29tcGxldGVkXCIgfSk7XG4gICAgICAgIGRldC5jcmVhdGVFbChcInN1bW1hcnlcIiwgeyB0ZXh0OiBgQ29tcGxldGVkICgke2RvbmUubGVuZ3RofSlgIH0pO1xuICAgICAgICBkb25lLmZvckVhY2goKGMpID0+IHRoaXMucmVuZGVyTGlzdEl0ZW0oZGV0LCBjLCB0cnVlLCBsYXN0Q29sLCBmaXJzdENvbCkpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJMaXN0SXRlbShwYXJlbnQ6IEhUTUxFbGVtZW50LCBjOiBTdHVkeUNhcmQsIGRvbmU6IGJvb2xlYW4sIGxhc3RDb2w6IHN0cmluZywgZmlyc3RDb2w6IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IHJvdyA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwicGEtbGlzdC1pdGVtXCIgKyAoZG9uZSA/IFwiIGRvbmVcIiA6IFwiXCIpIH0pO1xuICAgIGNvbnN0IGNpcmNsZSA9IHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcInBhLWxpc3QtY2lyY2xlXCIgKyAoZG9uZSA/IFwiIG9uXCIgOiBcIlwiKSwgdGV4dDogZG9uZSA/IFwiXHUyNUNGXCIgOiBcIlx1MjVDQlwiIH0pO1xuICAgIGNpcmNsZS5vbmNsaWNrID0gYXN5bmMgKCkgPT4geyBhd2FpdCB0aGlzLmN0eC5zdG9yZS51cGRhdGVTdHVkeUNhcmRTdGF0dXMoYywgZG9uZSA/IGZpcnN0Q29sIDogbGFzdENvbCk7IHRoaXMuY3R4LnJlZnJlc2goKTsgfTtcbiAgICBjb25zdCBtYWluID0gcm93LmNyZWF0ZURpdih7IGNsczogXCJwYS1saXN0LWl0ZW0tbWFpblwiIH0pO1xuICAgIGNvbnN0IHRpdGxlID0gbWFpbi5jcmVhdGVEaXYoeyB0ZXh0OiBjLnRpdGxlLCBjbHM6IFwicGEtbGlzdC1pdGVtLXRpdGxlXCIgfSk7XG4gICAgdGl0bGUub25jbGljayA9ICgpID0+IChjLnVybCA/IG9wZW5FeHRlcm5hbChjLnVybCkgOiB0aGlzLmN0eC5hcHAud29ya3NwYWNlLm9wZW5MaW5rVGV4dChjLnBhdGgsIFwiXCIsIHRydWUpKTtcbiAgICBpZiAoYy5zdWJ0b3BpYykgbWFpbi5jcmVhdGVEaXYoeyB0ZXh0OiBjLnN1YnRvcGljLCBjbHM6IFwicGEtbXV0ZWQgcGEtbGlzdC1pdGVtLXN1YlwiIH0pO1xuICB9XG5cbiAgLy8gLS0tLSBNb2RhbHMgJiBjb2x1bW4gbWFuYWdlbWVudCAtLS0tXG4gIHByaXZhdGUgb3BlblRvcGljTW9kYWwodG9waWNzOiBCb2FyZFtdKTogdm9pZCB7XG4gICAgY29uc3QgZmllbGRzOiBGaWVsZFNwZWNbXSA9IFtcbiAgICAgIHsga2V5OiBcIm5hbWVcIiwgbGFiZWw6IFwiVG9waWMgbmFtZVwiLCB0eXBlOiBcInRleHRcIiwgcGxhY2Vob2xkZXI6IFwiRGV2T3BzICYgU1JFXCIgfSxcbiAgICAgIHsga2V5OiBcImVtb2ppXCIsIGxhYmVsOiBcIkVtb2ppXCIsIHR5cGU6IFwidGV4dFwiLCB2YWx1ZTogXCJcdUQ4M0RcdURDREFcIiB9LFxuICAgIF07XG4gICAgbmV3IEZvcm1Nb2RhbCh0aGlzLmN0eC5hcHAsIFwiTmV3IHN0dWR5IHRvcGljXCIsIGZpZWxkcywgYXN5bmMgKHYpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSAodi5uYW1lIHx8IFwiXCIpLnRyaW0oKTtcbiAgICAgIGlmICghbmFtZSkgcmV0dXJuO1xuICAgICAgaWYgKHRvcGljcy5zb21lKChiKSA9PiBiLm5hbWUgPT09IG5hbWUpKSB7IHRoaXMuY3VycmVudFRvcGljID0gbmFtZTsgdGhpcy5jdHgucmVmcmVzaCgpOyByZXR1cm47IH1cbiAgICAgIHRvcGljcy5wdXNoKHsgaWQ6IG5hbWUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9bXmEtejAtOV0vZywgXCItXCIpLCBuYW1lLCBlbW9qaTogKHYuZW1vamkgfHwgXCJcdUQ4M0RcdURDREFcIikudHJpbSgpIH0pO1xuICAgICAgYXdhaXQgdGhpcy5jdHguc3RvcmUuc2F2ZVN0dWR5Qm9hcmRzKHRvcGljcyk7XG4gICAgICB0aGlzLmN1cnJlbnRUb3BpYyA9IG5hbWU7XG4gICAgICB0aGlzLmN0eC5yZWZyZXNoKCk7XG4gICAgICB0b2FzdChcIlRvcGljIGNyZWF0ZWRcIik7XG4gICAgfSkub3BlbigpO1xuICB9XG5cbiAgcHJpdmF0ZSBvcGVuQ2FyZE1vZGFsKGNhcmQ6IFN0dWR5Q2FyZCB8IG51bGwsIGRlZmF1bHRTdGF0dXM6IHN0cmluZywgdG9waWNzOiBCb2FyZFtdLCBkZWZhdWx0VG9waWM/OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCB0b3BpY09wdGlvbnMgPSB0b3BpY3MubWFwKChiKSA9PiAoeyB2YWx1ZTogYi5uYW1lLCBsYWJlbDogYi5uYW1lIH0pKTtcbiAgICBpZiAoIXRvcGljT3B0aW9ucy5sZW5ndGgpIHRvcGljT3B0aW9ucy5wdXNoKHsgdmFsdWU6IFwiR2VuZXJhbFwiLCBsYWJlbDogXCJHZW5lcmFsXCIgfSk7XG4gICAgY29uc3QgY29sT3B0aW9ucyA9IHRoaXMuY3R4LmNvbmZpZy5zdHVkeUNvbHVtbnMubWFwKChjKSA9PiAoeyB2YWx1ZTogYywgbGFiZWw6IHRoaXMuY3R4LmNvbmZpZy5zdHVkeUNvbHVtbk5hbWVzW2NdIHx8IGMgfSkpO1xuICAgIGNvbnN0IHByZXNldCA9IGNhcmQ/LnRvcGljIHx8IGRlZmF1bHRUb3BpYyB8fCAodGhpcy5jdXJyZW50VG9waWMgIT09IFwiYWxsXCIgPyB0aGlzLmN1cnJlbnRUb3BpYyA6IHRvcGljT3B0aW9uc1swXS52YWx1ZSk7XG4gICAgY29uc3QgZmllbGRzOiBGaWVsZFNwZWNbXSA9IFtcbiAgICAgIHsga2V5OiBcInRpdGxlXCIsIGxhYmVsOiBcIlRpdGxlXCIsIHR5cGU6IFwidGV4dFwiLCB2YWx1ZTogY2FyZD8udGl0bGUgfHwgXCJcIiB9LFxuICAgICAgeyBrZXk6IFwidG9waWNcIiwgbGFiZWw6IFwiVG9waWNcIiwgdHlwZTogXCJkcm9wZG93blwiLCBvcHRpb25zOiB0b3BpY09wdGlvbnMsIHZhbHVlOiBwcmVzZXQgfSxcbiAgICAgIHsga2V5OiBcInN1YnRvcGljXCIsIGxhYmVsOiBcIlN1YnRvcGljXCIsIHR5cGU6IFwidGV4dFwiLCB2YWx1ZTogY2FyZD8uc3VidG9waWMgfHwgXCJcIiB9LFxuICAgICAgeyBrZXk6IFwic3RhdHVzXCIsIGxhYmVsOiBcIkNvbHVtblwiLCB0eXBlOiBcImRyb3Bkb3duXCIsIG9wdGlvbnM6IGNvbE9wdGlvbnMsIHZhbHVlOiBjYXJkPy5zdGF0dXMgfHwgZGVmYXVsdFN0YXR1cyB9LFxuICAgICAgeyBrZXk6IFwidXJsXCIsIGxhYmVsOiBcIlVSTFwiLCB0eXBlOiBcInRleHRcIiwgdmFsdWU6IGNhcmQ/LnVybCB8fCBcIlwiLCBwbGFjZWhvbGRlcjogXCJodHRwczovLy4uLlwiIH0sXG4gICAgXTtcbiAgICBuZXcgRm9ybU1vZGFsKHRoaXMuY3R4LmFwcCwgY2FyZCA/IFwiRWRpdCBzdHVkeSBjYXJkXCIgOiBcIk5ldyBzdHVkeSBjYXJkXCIsIGZpZWxkcywgYXN5bmMgKHYpID0+IHtcbiAgICAgIGlmICghKHYudGl0bGUgfHwgXCJcIikudHJpbSgpKSByZXR1cm47XG4gICAgICBjb25zdCBkYXRhID0geyB0aXRsZTogdi50aXRsZS50cmltKCksIHRvcGljOiB2LnRvcGljLCBzdWJ0b3BpYzogdi5zdWJ0b3BpYywgc3RhdHVzOiB2LnN0YXR1cywgdXJsOiB2LnVybCB9O1xuICAgICAgaWYgKGNhcmQpIHtcbiAgICAgICAgY29uc3Qgb2sgPSBhd2FpdCB0aGlzLmN0eC5zdG9yZS51cGRhdGVTdHVkeUNhcmQoY2FyZCwgZGF0YSk7XG4gICAgICAgIGlmICghb2spIHsgdG9hc3QoYEEgc3R1ZHkgY2FyZCBuYW1lZCBcIiR7ZGF0YS50aXRsZX1cIiBhbHJlYWR5IGV4aXN0cyBpbiAke2RhdGEudG9waWN9LmApOyByZXR1cm47IH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY3R4LnN0b3JlLmNyZWF0ZVN0dWR5Q2FyZChkYXRhKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuY3R4LnJlZnJlc2goKTtcbiAgICB9LCBjYXJkID8gXCJTYXZlXCIgOiBcIkNyZWF0ZVwiKS5vcGVuKCk7XG4gIH1cblxuICBwcml2YXRlIG9wZW5BZGRDb2x1bW5Nb2RhbCgpOiB2b2lkIHtcbiAgICBjb25zdCBjZmcgPSB0aGlzLmN0eC5jb25maWc7XG4gICAgaWYgKGNmZy5zdHVkeUNvbHVtbnMubGVuZ3RoID49IDUpIHsgdG9hc3QoXCJNYXhpbXVtIG9mIDUgY29sdW1ucy5cIik7IHJldHVybjsgfVxuICAgIG5ldyBGb3JtTW9kYWwodGhpcy5jdHguYXBwLCBcIk5ldyBjb2x1bW5cIiwgW3sga2V5OiBcIm5hbWVcIiwgbGFiZWw6IFwiQ29sdW1uIG5hbWVcIiwgdHlwZTogXCJ0ZXh0XCIsIHBsYWNlaG9sZGVyOiBcIlJldmlld2luZywgUGF1c2VkXCIgfV0sIGFzeW5jICh2KSA9PiB7XG4gICAgICBjb25zdCBuYW1lID0gKHYubmFtZSB8fCBcIlwiKS50cmltKCk7XG4gICAgICBpZiAoIW5hbWUpIHJldHVybjtcbiAgICAgIGlmIChjZmcuc3R1ZHlDb2x1bW5zLmxlbmd0aCA+PSA1KSB7IHRvYXN0KFwiTWF4aW11bSBvZiA1IGNvbHVtbnMuXCIpOyByZXR1cm47IH1cbiAgICAgIGNvbnN0IGlkID0gbmFtZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL1teYS16MC05XS9nLCBcIi1cIik7XG4gICAgICBpZiAoY2ZnLnN0dWR5Q29sdW1ucy5pbmNsdWRlcyhpZCkpIHJldHVybjtcbiAgICAgIGNmZy5zdHVkeUNvbHVtbnMucHVzaChpZCk7XG4gICAgICBjZmcuc3R1ZHlDb2x1bW5OYW1lc1tpZF0gPSBuYW1lO1xuICAgICAgYXdhaXQgdGhpcy5jdHguc3RvcmUuc2F2ZUNvbmZpZyhjZmcpO1xuICAgICAgdGhpcy5jdHgucmVmcmVzaCgpO1xuICAgIH0sIFwiQWRkXCIpLm9wZW4oKTtcbiAgfVxuXG4gIHByaXZhdGUgb3BlblJlbmFtZUNvbHVtbk1vZGFsKGNvbDogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgY2ZnID0gdGhpcy5jdHguY29uZmlnO1xuICAgIG5ldyBGb3JtTW9kYWwodGhpcy5jdHguYXBwLCBcIlJlbmFtZSBjb2x1bW5cIiwgW3sga2V5OiBcIm5hbWVcIiwgbGFiZWw6IFwiTmV3IG5hbWVcIiwgdHlwZTogXCJ0ZXh0XCIsIHZhbHVlOiBjZmcuc3R1ZHlDb2x1bW5OYW1lc1tjb2xdIHx8IGNvbCB9XSwgYXN5bmMgKHYpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSAodi5uYW1lIHx8IFwiXCIpLnRyaW0oKTtcbiAgICAgIGlmICghbmFtZSkgcmV0dXJuO1xuICAgICAgY2ZnLnN0dWR5Q29sdW1uTmFtZXNbY29sXSA9IG5hbWU7XG4gICAgICBhd2FpdCB0aGlzLmN0eC5zdG9yZS5zYXZlQ29uZmlnKGNmZyk7XG4gICAgICB0aGlzLmN0eC5yZWZyZXNoKCk7XG4gICAgfSwgXCJTYXZlXCIpLm9wZW4oKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbW92ZUNvbHVtbihjb2w6IHN0cmluZywgZGlyOiAtMSB8IDEpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjZmcgPSB0aGlzLmN0eC5jb25maWc7XG4gICAgY29uc3QgaSA9IGNmZy5zdHVkeUNvbHVtbnMuaW5kZXhPZihjb2wpO1xuICAgIGNvbnN0IGogPSBpICsgZGlyO1xuICAgIGlmIChpIDwgMCB8fCBqIDwgMCB8fCBqID49IGNmZy5zdHVkeUNvbHVtbnMubGVuZ3RoKSByZXR1cm47XG4gICAgW2NmZy5zdHVkeUNvbHVtbnNbaV0sIGNmZy5zdHVkeUNvbHVtbnNbal1dID0gW2NmZy5zdHVkeUNvbHVtbnNbal0sIGNmZy5zdHVkeUNvbHVtbnNbaV1dO1xuICAgIGF3YWl0IHRoaXMuY3R4LnN0b3JlLnNhdmVDb25maWcoY2ZnKTtcbiAgICB0aGlzLmN0eC5yZWZyZXNoKCk7XG4gIH1cblxuICBwcml2YXRlIHJlbW92ZUNvbHVtbihjb2w6IHN0cmluZywgY2FyZHM6IFN0dWR5Q2FyZFtdKTogdm9pZCB7XG4gICAgY29uc3QgY2ZnID0gdGhpcy5jdHguY29uZmlnO1xuICAgIGlmIChjZmcuc3R1ZHlDb2x1bW5zLmxlbmd0aCA8PSAxKSB7IHRvYXN0KFwiWW91IG11c3Qga2VlcCBhdCBsZWFzdCBvbmUgY29sdW1uLlwiKTsgcmV0dXJuOyB9XG4gICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmN0eC5hcHAsIGBEZWxldGUgY29sdW1uIFwiJHt0aGlzLmNsZWFuTGFiZWwoY2ZnLnN0dWR5Q29sdW1uTmFtZXNbY29sXSB8fCBjb2wpfVwiPyBDYXJkcyBtb3ZlIHRvIHRoZSBmaXJzdCBjb2x1bW4uYCwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcmVtYWluaW5nID0gY2ZnLnN0dWR5Q29sdW1ucy5maWx0ZXIoKGMpID0+IGMgIT09IGNvbCk7XG4gICAgICBjb25zdCBmYWxsYmFjayA9IHJlbWFpbmluZ1swXTtcbiAgICAgIGZvciAoY29uc3QgYyBvZiBjYXJkcy5maWx0ZXIoKGMpID0+IGMuc3RhdHVzID09PSBjb2wpKSBhd2FpdCB0aGlzLmN0eC5zdG9yZS51cGRhdGVTdHVkeUNhcmRTdGF0dXMoYywgZmFsbGJhY2spO1xuICAgICAgY2ZnLnN0dWR5Q29sdW1ucyA9IHJlbWFpbmluZztcbiAgICAgIGRlbGV0ZSBjZmcuc3R1ZHlDb2x1bW5OYW1lc1tjb2xdO1xuICAgICAgYXdhaXQgdGhpcy5jdHguc3RvcmUuc2F2ZUNvbmZpZyhjZmcpO1xuICAgICAgdGhpcy5jdHgucmVmcmVzaCgpO1xuICAgIH0pLm9wZW4oKTtcbiAgfVxufVxuIiwgImltcG9ydCB7IEl0ZW1WaWV3LCBXb3Jrc3BhY2VMZWFmIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBQQUdFUywgUEFIb3N0IH0gZnJvbSBcIi4vdmlld1wiO1xuXG5leHBvcnQgY29uc3QgVklFV19UWVBFX1BBX05BViA9IFwicGVyc29uYWwtYXNzaXN0YW50LW5hdlwiO1xuXG4vKiogTGVmdC1zaWRlYmFyIG5hdmlnYXRpb24gcGFuZWwgdGhhdCBkcml2ZXMgdGhlIG1haW4gY29udGVudCB2aWV3LiAqL1xuZXhwb3J0IGNsYXNzIFBBTmF2VmlldyBleHRlbmRzIEl0ZW1WaWV3IHtcbiAgcHJpdmF0ZSBob3N0OiBQQUhvc3Q7XG5cbiAgY29uc3RydWN0b3IobGVhZjogV29ya3NwYWNlTGVhZiwgaG9zdDogUEFIb3N0KSB7XG4gICAgc3VwZXIobGVhZik7XG4gICAgdGhpcy5ob3N0ID0gaG9zdDtcbiAgfVxuXG4gIGdldFZpZXdUeXBlKCk6IHN0cmluZyB7IHJldHVybiBWSUVXX1RZUEVfUEFfTkFWOyB9XG4gIGdldERpc3BsYXlUZXh0KCk6IHN0cmluZyB7IHJldHVybiBcIlBlcnNvbmFsIEFzc2lzdGFudFwiOyB9XG4gIGdldEljb24oKTogc3RyaW5nIHsgcmV0dXJuIFwidGFyZ2V0XCI7IH1cblxuICBhc3luYyBvbk9wZW4oKTogUHJvbWlzZTx2b2lkPiB7IHRoaXMucmVuZGVyKCk7IH1cbiAgYXN5bmMgb25DbG9zZSgpOiBQcm9taXNlPHZvaWQ+IHt9XG5cbiAgcmVuZGVyKCk6IHZvaWQge1xuICAgIGNvbnN0IHJvb3QgPSB0aGlzLmNvbnRlbnRFbDtcbiAgICByb290LmVtcHR5KCk7XG4gICAgcm9vdC5hZGRDbGFzcyhcInBhLXJvb3RcIiwgXCJwYS1uYXYtcm9vdFwiKTtcbiAgICByb290LmNyZWF0ZURpdih7IHRleHQ6IFwiXHVEODNDXHVERkFGIFBlcnNvbmFsIEFzc2lzdGFudFwiLCBjbHM6IFwicGEtbG9nb1wiIH0pO1xuICAgIFBBR0VTLmZvckVhY2goKHApID0+IHtcbiAgICAgIGNvbnN0IGJ0biA9IHJvb3QuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgICB0ZXh0OiBwLmxhYmVsLFxuICAgICAgICBjbHM6IFwicGEtbmF2XCIgKyAocC5pZCA9PT0gdGhpcy5ob3N0LmN1cnJlbnRQYWdlID8gXCIgYWN0aXZlXCIgOiBcIlwiKSxcbiAgICAgIH0pO1xuICAgICAgYnRuLm9uY2xpY2sgPSAoKSA9PiB0aGlzLmhvc3Qub3BlblBhZ2UocC5pZCk7XG4gICAgfSk7XG4gIH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsSUFBQUEsbUJBQXNFOzs7QUNBdEUsc0JBQW1EOzs7QUMySTVDLElBQU0sdUJBQXVCLENBQUMsUUFBUSxlQUFlLE1BQU07QUFDM0QsSUFBTSw0QkFBb0Q7QUFBQSxFQUMvRCxNQUFNO0FBQUEsRUFDTixlQUFlO0FBQUEsRUFDZixNQUFNO0FBQUEsRUFDTixXQUFXO0FBQ2I7QUFDTyxJQUFNLHdCQUF3QixDQUFDLFdBQVcsZUFBZSxNQUFNO0FBQy9ELElBQU0sNkJBQXFEO0FBQUEsRUFDaEUsU0FBUztBQUFBLEVBQ1QsZUFBZTtBQUFBLEVBQ2YsTUFBTTtBQUNSO0FBQ08sSUFBTSxpQkFBMEI7QUFBQSxFQUNyQyxFQUFFLElBQUksS0FBSyxNQUFNLHlCQUFzQjtBQUFBLEVBQ3ZDLEVBQUUsSUFBSSxLQUFLLE1BQU0sbUJBQWdCO0FBQUEsRUFDakMsRUFBRSxJQUFJLEtBQUssTUFBTSxTQUFTO0FBQUEsRUFDMUIsRUFBRSxJQUFJLEtBQUssTUFBTSxjQUFjO0FBQ2pDO0FBWU8sU0FBUyxnQkFBMEI7QUFDeEMsU0FBTztBQUFBLElBQ0wsZUFBZTtBQUFBLElBQ2YsZUFBZTtBQUFBLElBQ2YsYUFBYTtBQUFBLElBQ2IsYUFBYTtBQUFBLElBQ2IsYUFBYSxxQkFBcUIsTUFBTTtBQUFBLElBQ3hDLGlCQUFpQixFQUFFLEdBQUcsMEJBQTBCO0FBQUEsSUFDaEQsY0FBYyxzQkFBc0IsTUFBTTtBQUFBLElBQzFDLGtCQUFrQixFQUFFLEdBQUcsMkJBQTJCO0FBQUEsSUFDbEQsYUFBYSxDQUFDO0FBQUEsSUFDZCxjQUFjLENBQUM7QUFBQSxJQUNmLFlBQVksQ0FBQztBQUFBLEVBQ2Y7QUFDRjs7O0FDckxPLFNBQVMsSUFBSSxHQUFpQjtBQUNuQyxTQUNFLEVBQUUsWUFBWSxJQUNkLE1BQ0Es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ekMsVUFBTSxLQUFLLFNBQVMsS0FBSyxXQUFXO0FBQUEsRUFDdEM7QUFBQTtBQUFBLEVBR0EsTUFBTSxTQUFTLElBQTJCO0FBM0M1QztBQTRDSSxTQUFLLGNBQWM7QUFDbkIsVUFBTSxFQUFFLFVBQVUsSUFBSSxLQUFLO0FBQzNCLFFBQUksUUFBNkIsZUFBVSxnQkFBZ0IsWUFBWSxFQUFFLENBQUMsTUFBekMsWUFBOEM7QUFDL0UsUUFBSSxDQUFDLE1BQU07QUFDVCxhQUFPLFVBQVUsUUFBUSxLQUFLO0FBQzlCLFlBQU0sS0FBSyxhQUFhLEVBQUUsTUFBTSxjQUFjLFFBQVEsS0FBSyxDQUFDO0FBQUEsSUFDOUQ7QUFDQSxRQUFJLEtBQUssZ0JBQWdCO0FBQVEsV0FBSyxLQUFLLFFBQVEsRUFBRTtBQUNyRCxjQUFVLFdBQVcsSUFBSTtBQUN6QixjQUFVLGdCQUFnQixnQkFBZ0IsRUFBRSxRQUFRLENBQUMsTUFBTTtBQUN6RCxVQUFJLEVBQUUsZ0JBQWdCO0FBQVcsVUFBRSxLQUFLLE9BQU87QUFBQSxJQUNqRCxDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsV0FBaUI7QUFBQSxFQUFDO0FBQUEsRUFFbEIsTUFBTSxlQUE4QjtBQUNsQyxnQkFBWSxLQUFLLFNBQVMsUUFBUTtBQUNsQyxVQUFNLEtBQUssU0FBUyxLQUFLLFFBQVE7QUFBQSxFQUNuQztBQUNGO0FBRUEsSUFBTSxlQUFOLGNBQTJCLGtDQUFpQjtBQUFBLEVBRTFDLFlBQVksS0FBVSxRQUFpQztBQUNyRCxVQUFNLEtBQUssTUFBTTtBQUNqQixTQUFLLFNBQVM7QUFBQSxFQUNoQjtBQUFBLEVBQ0EsVUFBZ0I7QUFDZCxVQUFNLEVBQUUsWUFBWSxJQUFJO0FBQ3hCLGdCQUFZLE1BQU07QUFDbEIsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsa0JBQWtCLEVBQzFCLFFBQVEsbUZBQW1GLEVBQzNGO0FBQUEsTUFBUSxDQUFDLE1BQ1IsRUFBRSxTQUFTLEtBQUssT0FBTyxTQUFTLFFBQVEsRUFBRSxTQUFTLE9BQU8sTUFBTTtBQUM5RCxhQUFLLE9BQU8sU0FBUyxXQUFXLEVBQUUsS0FBSztBQUN2QyxjQUFNLEtBQUssT0FBTyxhQUFhO0FBQUEsTUFDakMsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNKO0FBQ0Y7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJsb2ciLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiIsICJ0IiwgIlJJTkdfQ09MT1JTIiwgIkNPTFVNTl9DT0xPUlMiLCAiYyIsICJpbXBvcnRfb2JzaWRpYW4iXQp9Cg==
