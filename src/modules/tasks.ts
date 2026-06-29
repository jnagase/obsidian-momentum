import { PAContext } from "../context";
import { Board, Task } from "../types";
import { ConfirmModal, FieldSpec, FormModal, showActionMenu, toast } from "../ui";
import { drawRing } from "../charts";

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const RING_COLORS = ["#d97706", "#7c3aed", "#16a34a"];
const COLUMN_COLORS = ["#7c3aed", "#3b82f6", "#16a34a", "#f59e0b", "#ef4444", "#10b981"];

/** Renders the "Tasks & Notes" page: a Kanban / List board over Tasks/*.md. */
export class TasksModule {
  private ctx: PAContext;
  private currentBoard = "all";
  private view: "kanban" | "list" = "kanban";

  constructor(ctx: PAContext) { this.ctx = ctx; }

  private cleanLabel(s: string): string {
    return s.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  }
  private colColor(index: number): string {
    return COLUMN_COLORS[index % COLUMN_COLORS.length];
  }

  /** The fixed "done" column id (the completion column). */
  private doneCol(): string {
    const cols = this.ctx.config.taskColumns;
    return cols.includes("done") ? "done" : cols[cols.length - 1];
  }

  render(root: HTMLElement): void {
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
  private renderHeader(root: HTMLElement, filtered: Task[]): void {
    const head = root.createDiv({ cls: "pa-ht-header" });
    const left = head.createDiv();
    left.createDiv({ text: "✅ Tasks & Lists", cls: "pa-h1" });
    left.createDiv({ text: "Kanban and list", cls: "pa-muted" });

    const cols = this.ctx.config.taskColumns;
    const names = this.ctx.config.taskColumnNames;
    const colSet = new Set(cols);
    const eff = (t: Task) => (colSet.has(t.status) ? t.status : cols[0]);
    const total = filtered.length || 1;

    const rings = head.createDiv({ cls: "pa-ht-rings" });
    cols.slice(0, 3).forEach((col, i) => {
      const cnt = filtered.filter((t) => eff(t) === col).length;
      const pct = Math.round((cnt / total) * 100);
      drawRing(rings, pct, RING_COLORS[i] || "#7c3aed", this.cleanLabel(names[col] || col), 52);
    });
  }

  // ---- View toggle ----
  private renderViewToggle(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "pa-view-toggle" });
    const mk = (id: "kanban" | "list", label: string) => {
      const b = bar.createEl("button", { text: label, cls: "pa-toggle-btn" + (this.view === id ? " on" : "") });
      b.onclick = () => { this.view = id; this.ctx.refresh(); };
    };
    mk("kanban", "📋 Kanban");
    mk("list", "📃 List");
  }

  // ---- Board tabs ----
  private renderBoardTabs(root: HTMLElement, boards: Board[]): void {
    const bar = root.createDiv({ cls: "pa-tabs" });
    const mkTab = (id: string, label: string) => {
      const t = bar.createEl("button", { text: label, cls: "pa-tab" + (this.currentBoard === id ? " on" : "") });
      t.onclick = () => { this.currentBoard = id; this.ctx.refresh(); };
    };
    mkTab("all", "📋 All");
    boards.forEach((b) => mkTab(b.name, `${b.emoji || ""} ${b.name}`.trim()));
    const add = bar.createEl("button", { text: "+ board", cls: "pa-tab pa-tab-add" });
    add.onclick = () => this.openBoardModal(boards);
  }

  // ---- Stats row ----
  private renderStats(root: HTMLElement, filtered: Task[]): void {
    const cols = this.ctx.config.taskColumns;
    const names = this.ctx.config.taskColumnNames;
    const colSet = new Set(cols);
    const eff = (t: Task) => (colSet.has(t.status) ? t.status : cols[0]);
    const total = filtered.length;

    const row = root.createDiv({ cls: "pa-stats-row" });
    const stat = (label: string, value: string, color?: string) => {
      const c = row.createDiv({ cls: "pa-stat" });
      const v = c.createDiv({ text: value, cls: "pa-stat-value" });
      if (color) v.style.color = color;
      c.createDiv({ text: label, cls: "pa-stat-label" });
    };
    stat("📋 TOTAL", String(total));
    const doneId = this.doneCol();
    // Non-done columns as counts, then the fixed done column as % completed.
    cols.filter((c) => c !== doneId).slice(0, 2).forEach((col, i) => {
      const cnt = filtered.filter((t) => eff(t) === col).length;
      stat((names[col] || col).toUpperCase(), String(cnt), this.colColor(cols.indexOf(col)));
    });
    const doneCnt = filtered.filter((t) => eff(t) === doneId).length;
    stat((names[doneId] || doneId).toUpperCase(), (total ? Math.round((doneCnt / total) * 100) : 0) + "%", "#16a34a");
  }

  // ---- Board bar (name + delete board + add column) ----
  private renderBoardBar(root: HTMLElement, boards: Board[]): void {
    const bar = root.createDiv({ cls: "pa-board-bar" });
    const board = boards.find((b) => b.name === this.currentBoard);
    bar.createDiv({ text: board ? `${board.emoji || ""} ${board.name}`.trim() : "📋 All boards", cls: "pa-board-title" });

    const actions = bar.createDiv({ cls: "pa-board-actions" });
    const addCol = actions.createEl("button", { text: "+ column", cls: "pa-mini-btn" });
    addCol.onclick = () => this.openAddColumnModal();
    if (board) {
      const kebab = actions.createEl("button", { text: "⋮", cls: "pa-icon-btn" });
      kebab.onclick = (e) => showActionMenu(e, [
        { title: "Rename board", icon: "pencil", onClick: () => this.openRenameBoardModal(board, boards) },
        { title: "Delete board", icon: "trash", warning: true, onClick: () =>
          new ConfirmModal(this.ctx.app, `Delete board "${board.name}"? (tasks are kept, just untagged from this board view)`, async () => {
            await this.ctx.store.saveBoards(boards.filter((b) => b.name !== board.name));
            this.currentBoard = "all";
            this.ctx.refresh();
          }).open() },
      ]);
    }
  }

  private openRenameBoardModal(board: Board, boards: Board[]): void {
    const fields: FieldSpec[] = [
      { key: "name", label: "Board name", type: "text", value: board.name },
      { key: "emoji", label: "Emoji", type: "emoji", value: board.emoji || "" },
    ];
    new FormModal(this.ctx.app, "Rename board", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name) return;
      if (name !== board.name && boards.some((b) => b.name === name)) { toast(`A board named "${name}" already exists.`); return; }
      const updated = boards.map((b) => (b.name === board.name ? { ...b, name, emoji: (v.emoji || "").trim() } : b));
      await this.ctx.store.saveBoards(updated);
      if (name !== board.name) {
        for (const t of this.ctx.store.loadTasks().filter((t) => t.kanbanName === board.name)) {
          await this.ctx.store.updateTask(t, { kanbanName: name });
        }
        if (this.currentBoard === board.name) this.currentBoard = name;
      }
      this.ctx.refresh();
      toast("Board updated");
    }, "Save").open();
  }

  // ---- Kanban ----
  private renderKanban(root: HTMLElement, filtered: Task[], boards: Board[]): void {
    const cols = this.ctx.config.taskColumns;
    const names = this.ctx.config.taskColumnNames;
    const colSet = new Set(cols);
    const eff = (t: Task) => (colSet.has(t.status) ? t.status : cols[0]);
    const doneId = this.doneCol();

    const board = root.createDiv({ cls: "pa-kanban" });
    cols.forEach((col, i) => {
      const color = this.colColor(i);
      const isDone = col === doneId;
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
        const mvL = tools.createEl("button", { text: "◀", cls: "pa-icon-btn" });
        mvL.onclick = () => this.moveColumn(col, -1);
      }
      if (i < cols.length - 1) {
        const mvR = tools.createEl("button", { text: "▶", cls: "pa-icon-btn" });
        mvR.onclick = () => this.moveColumn(col, 1);
      }
      if (!isDone) {
        const menuBtn = tools.createEl("button", { text: "⋮", cls: "pa-icon-btn" });
        menuBtn.onclick = (e) => showActionMenu(e, [
          { title: "Rename column", icon: "pencil", onClick: () => this.openRenameColumnModal(col) },
          { title: "Delete column", icon: "trash", warning: true, onClick: () => this.removeColumn(col, filtered) },
        ]);
      }

      const list = colEl.createDiv({ cls: "pa-col-body" });
      const persistDrop = async (e: DragEvent) => {
        e.preventDefault();
        list.removeClass("pa-drop");
        const path = e.dataTransfer?.getData("text/plain");
        if (!path) return;
        const dragged = filtered.find((t) => t.path === path);
        if (!dragged) return;
        const ordered = colTasks.filter((t) => t.path !== path);
        const afterEl = this.getDragAfterElement(list, e.clientY);
        const afterPath = afterEl?.dataset.path ?? null;
        let idx = afterPath ? ordered.findIndex((t) => t.path === afterPath) : ordered.length;
        if (idx < 0) idx = ordered.length;
        ordered.splice(idx, 0, dragged);
        for (let k = 0; k < ordered.length; k++) {
          const t = ordered[k];
          const changes: Partial<Task> = {};
          if (t.path === path && eff(t) !== col) changes.status = col;
          if (t.order !== k) changes.order = k;
          if (Object.keys(changes).length) await this.ctx.store.updateTask(t, changes);
        }
        this.ctx.refresh();
      };
      list.addEventListener("dragover", (e) => { e.preventDefault(); list.addClass("pa-drop"); });
      list.addEventListener("dragleave", () => list.removeClass("pa-drop"));
      list.addEventListener("drop", (e) => { void persistDrop(e); });

      const ord = (t: Task) => (t.order ?? 1e9);
      colTasks.sort((a, b) => ord(a) - ord(b) || (a.created || "").localeCompare(b.created || ""));

      colTasks.slice(0, isDone && colTasks.length > 7 ? 7 : colTasks.length)
        .forEach((t) => this.renderCard(list, t, isDone));

      if (isDone && colTasks.length > 7) {
        const det = list.createEl("details", { cls: "pa-completed pa-kanban-more" });
        det.createEl("summary", { text: `Show ${colTasks.length - 7} more` });
        colTasks.slice(7).forEach((t) => this.renderCard(det, t, isDone));
      }

      const addBtn = colEl.createEl("button", { text: "+ add card", cls: "pa-add-card" });
      addBtn.onclick = () => this.openTaskModal(null, col, boards);
    });
  }

  private getDragAfterElement(container: HTMLElement, y: number): HTMLElement | null {
    const els = Array.from(container.querySelectorAll<HTMLElement>(".pa-task:not(.pa-dragging)"));
    let closest: HTMLElement | null = null;
    let closestOffset = -Infinity;
    for (const el of els) {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closestOffset) { closestOffset = offset; closest = el; }
    }
    return closest;
  }

  private renderCard(list: HTMLElement, t: Task, isDoneCol: boolean): void {
    const card = list.createDiv({ cls: "pa-card pa-task prio-" + (t.priority || "medium") + (isDoneCol ? " done" : "") });
    card.dataset.path = t.path;
    card.setAttr("draggable", "true");
    card.addEventListener("dragstart", (e) => { e.dataTransfer?.setData("text/plain", t.path); card.addClass("pa-dragging"); });
    card.addEventListener("dragend", () => card.removeClass("pa-dragging"));
    card.onclick = () => this.ctx.app.workspace.openLinkText(t.path, "", true);

    const topRow = card.createDiv({ cls: "pa-card-top" });
    const badgeText = (t.group || t.cat || t.kanbanName || "").toUpperCase();
    topRow.createDiv({ text: badgeText, cls: "pa-card-cat" });
    const acts = topRow.createDiv({ cls: "pa-card-top-actions" });
    const menuBtn = acts.createEl("button", { text: "⋮", cls: "pa-icon-btn pa-card-menu" });
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      showActionMenu(e, [
        { title: "Open note", icon: "file-text", onClick: () => { void this.ctx.app.workspace.openLinkText(t.path, "", true); } },
        { title: "Edit", icon: "pencil", onClick: () => this.openTaskModal(t, t.status, this.ctx.store.loadBoards()) },
        { title: "Delete", icon: "trash", warning: true, onClick: () => new ConfirmModal(this.ctx.app, `Delete task "${t.title}"?`, async () => { await this.ctx.store.deleteTask(t); this.ctx.refresh(); }).open() },
      ]);
    };

    card.createEl("div", { text: t.title, cls: "pa-card-title" });
    const dateStr = (t.created || "").substring(0, 10);
    card.createDiv({ cls: "pa-muted pa-card-meta", text: [t.priority, dateStr].filter(Boolean).join(" · ") });

    const preview = card.createDiv({ cls: "pa-card-preview" });
    void this.ctx.store.readBody(t.path).then((body) => {
      const lines = body.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3);
      if (lines.length) preview.setText(lines.join("\n"));
      else preview.remove();
    });
  }

  // ---- List view (single list per board, with collapsed Completed) ----
  private renderList(root: HTMLElement, filtered: Task[]): void {
    const cols = this.ctx.config.taskColumns;
    const firstCol = cols[0];
    const doneId = this.doneCol();
    const colSet = new Set(cols);
    const eff = (t: Task) => (colSet.has(t.status) ? t.status : cols[0]);
    const isDone = (t: Task) => eff(t) === doneId;
    const boards = this.ctx.store.loadBoards();

    root.createDiv({ text: "📝 List de Tasks", cls: "pa-h2" });
    if (!filtered.length) { root.createEl("p", { cls: "pa-muted", text: "No tasks." }); return; }

    const groups = new Map<string, Task[]>();
    filtered.forEach((t) => { const k = t.kanbanName || "No board"; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(t); });

    const wrap = root.createDiv({ cls: "pa-list-cards" });
    groups.forEach((tasks, boardName) => {
      const card = wrap.createDiv({ cls: "pa-list-card" });
      card.createDiv({ text: boardName, cls: "pa-list-card-title" });
      const add = card.createDiv({ cls: "pa-list-add", text: "✏️ Add a task" });
      add.onclick = () => this.openTaskModal(null, firstCol, boards, boardName === "No board" ? "" : boardName);

      const open = tasks.filter((t) => !isDone(t));
      const done = tasks.filter((t) => isDone(t));
      open.forEach((t) => this.renderListItem(card, t, false, doneId, firstCol));

      if (done.length) {
        const det = card.createEl("details", { cls: "pa-completed" });
        det.createEl("summary", { text: `Completed (${done.length})` });
        done.forEach((t) => this.renderListItem(det, t, true, doneId, firstCol));
      }
    });
  }

  private renderListItem(parent: HTMLElement, t: Task, done: boolean, doneCol: string, firstCol: string): void {
    const row = parent.createDiv({ cls: "pa-list-item" + (done ? " done" : "") });
    const circle = row.createSpan({ cls: "pa-list-circle" + (done ? " on" : ""), text: done ? "●" : "○" });
    circle.onclick = async () => { await this.ctx.store.updateTask(t, { status: done ? firstCol : doneCol }); this.ctx.refresh(); };
    const main = row.createDiv({ cls: "pa-list-item-main" });
    const title = main.createDiv({ text: t.title, cls: "pa-list-item-title" });
    title.onclick = () => this.ctx.app.workspace.openLinkText(t.path, "", true);
    if (t.group) main.createDiv({ text: t.group, cls: "pa-muted pa-list-item-sub" });
  }

  // ---- Modals & column management ----
  private openBoardModal(boards: Board[]): void {
    const fields: FieldSpec[] = [
      { key: "name", label: "Board name", type: "text" },
      { key: "emoji", label: "Emoji", type: "emoji", placeholder: "📋" },
    ];
    new FormModal(this.ctx.app, "New board", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name) return;
      if (boards.some((b) => b.name === name)) { this.currentBoard = name; this.ctx.refresh(); return; }
      boards.push({ id: name.toLowerCase().replace(/\s+/g, "-"), name, emoji: (v.emoji || "").trim() });
      await this.ctx.store.saveBoards(boards);
      this.currentBoard = name;
      this.ctx.refresh();
      toast("Board created");
    }).open();
  }

  private openTaskModal(task: Task | null, defaultStatus: string, boards: Board[], defaultBoard?: string): void {
    const boardOptions = [{ value: "", label: "— none —" }].concat(boards.map((b) => ({ value: b.name, label: b.name })));
    const colOptions = this.ctx.config.taskColumns.map((c) => ({ value: c, label: this.ctx.config.taskColumnNames[c] || c }));
    const presetBoard = task?.kanbanName || defaultBoard || (this.currentBoard !== "all" ? this.currentBoard : "");
    const fields: FieldSpec[] = [
      { key: "title", label: "Title", type: "text", value: task?.title || "" },
      { key: "status", label: "Column", type: "dropdown", options: colOptions, value: task?.status || defaultStatus },
      { key: "priority", label: "Priority", type: "dropdown", options: PRIORITIES, value: task?.priority || "medium" },
      { key: "kanbanName", label: "Board", type: "dropdown", options: boardOptions, value: presetBoard },
      { key: "group", label: "Group / tag", type: "text", value: task?.group || "" },
      { key: "due", label: "Due date", type: "text", value: task?.due || "", placeholder: "YYYY-MM-DD" },
    ];
    new FormModal(this.ctx.app, task ? "Edit task" : "New task", fields, async (v) => {
      if (!(v.title || "").trim()) return;
      const data = { title: v.title.trim(), status: v.status, priority: v.priority, kanbanName: v.kanbanName, group: v.group, due: v.due };
      if (task) await this.ctx.store.updateTask(task, data);
      else await this.ctx.store.createTask(data);
      this.ctx.refresh();
    }, task ? "Save" : "Create").open();
  }

  private splitEmoji(name: string): { emoji: string; text: string } {
    const m = name.match(/^([^\p{L}\p{N}]+)\s*(.*)$/u);
    return m ? { emoji: m[1].trim(), text: m[2] } : { emoji: "", text: name };
  }

  private openAddColumnModal(): void {
    const cfg = this.ctx.config;
    if (cfg.taskColumns.length >= 5) { toast("Maximum of 5 columns."); return; }
    const fields: FieldSpec[] = [
      { key: "name", label: "Column name", type: "text", placeholder: "Review, Blocked" },
      { key: "emoji", label: "Emoji", type: "emoji", value: "" },
    ];
    new FormModal(this.ctx.app, "New column", fields, async (v) => {
      const text = (v.name || "").trim();
      if (!text) return;
      if (cfg.taskColumns.length >= 5) { toast("Maximum of 5 columns."); return; }
      const id = text.toLowerCase().replace(/[^a-z0-9]/g, "-");
      if (cfg.taskColumns.includes(id)) return;
      cfg.taskColumns.push(id);
      cfg.taskColumnNames[id] = `${(v.emoji || "").trim()} ${text}`.trim();
      await this.ctx.store.saveConfig(cfg);
      this.ctx.refresh();
    }, "Add").open();
  }

  private async moveColumn(col: string, dir: -1 | 1): Promise<void> {
    const cfg = this.ctx.config;
    const i = cfg.taskColumns.indexOf(col);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cfg.taskColumns.length) return;
    [cfg.taskColumns[i], cfg.taskColumns[j]] = [cfg.taskColumns[j], cfg.taskColumns[i]];
    await this.ctx.store.saveConfig(cfg);
    this.ctx.refresh();
  }

  private openRenameColumnModal(col: string): void {
    const cfg = this.ctx.config;
    if (col === this.doneCol()) { toast("The Done column can't be renamed."); return; }
    const { emoji, text } = this.splitEmoji(cfg.taskColumnNames[col] || col);
    const fields: FieldSpec[] = [
      { key: "name", label: "New name", type: "text", value: text },
      { key: "emoji", label: "Emoji", type: "emoji", value: emoji },
    ];
    new FormModal(this.ctx.app, "Rename column", fields, async (v) => {
      const t = (v.name || "").trim();
      if (!t) return;
      cfg.taskColumnNames[col] = `${(v.emoji || "").trim()} ${t}`.trim();
      await this.ctx.store.saveConfig(cfg);
      this.ctx.refresh();
    }, "Save").open();
  }

  private removeColumn(col: string, tasks: Task[]): void {
    const cfg = this.ctx.config;
    if (col === this.doneCol()) { toast("The Done column can't be removed."); return; }
    if (cfg.taskColumns.length <= 1) { toast("You must keep at least one column."); return; }
    new ConfirmModal(this.ctx.app, `Delete column "${this.cleanLabel(cfg.taskColumnNames[col] || col)}"? Tasks move to the first column.`, async () => {
      const remaining = cfg.taskColumns.filter((c) => c !== col);
      const fallback = remaining[0];
      for (const t of tasks.filter((t) => t.status === col)) await this.ctx.store.updateTask(t, { status: fallback });
      cfg.taskColumns = remaining;
      delete cfg.taskColumnNames[col];
      await this.ctx.store.saveConfig(cfg);
      this.ctx.refresh();
    }).open();
  }
}
