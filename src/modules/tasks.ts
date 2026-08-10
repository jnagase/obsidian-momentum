import { PAContext } from "../context";
import { Board, Task } from "../types";
import { ConfirmModal, FieldSpec, FormModal, showActionMenu, toast, appendSidebarBtn, SearchModal, StepsModal, MenuAction } from "../ui";
import { drawRing, drawScatter, ScatterPoint } from "../charts";
import { renderCardChips } from "../cardchips";
import { renderCardActions } from "../cardrender";

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

// Grid order matches the scatter chart's axes (urgent → right, important → top):
// top-left = Schedule, top-right = Do first, bottom-left = Eliminate, bottom-right = Delegate.
const QUADRANTS = [
  { id: "q2", title: "Schedule", sub: "Important, not urgent" },
  { id: "q1", title: "Do first", sub: "Urgent & important" },
  { id: "q4", title: "Eliminate", sub: "Not urgent or important" },
  { id: "q3", title: "Delegate", sub: "Urgent, not important" },
];

const EISENHOWER_OPTS = [
  { value: "", label: "Auto (by priority & due)" },
  { value: "q1", label: "Do first (urgent & important)" },
  { value: "q2", label: "Schedule (important, not urgent)" },
  { value: "q3", label: "Delegate (urgent, not important)" },
  { value: "q4", label: "Eliminate (neither)" },
];

const RING_COLORS = ["#d97706", "#7c3aed", "#16a34a"];
const COLUMN_COLORS = ["#7c3aed", "#3b82f6", "#16a34a", "#f59e0b", "#ef4444", "#10b981"];

/** How many cards a Kanban column shows before the "load more" button. */
const PAGE_SIZE = 7;

/** Renders the "Tasks & Notes" page: a Kanban / List board over Tasks/*.md. */
export class TasksModule {
  private ctx: PAContext;
  private currentBoard = "all";
  private view: "kanban" | "list" | "matrix" = "kanban";
  private colLimits: Record<string, number> = {};
  /** Root of the last render, so search can scroll to and flash a card after re-rendering. */
  private rootEl: HTMLElement | null = null;
  /** Path of a task to reveal (scroll + flash) on the next render, set by search. */
  private revealPath: string | null = null;

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

  /** Where a done card returns to when reopened: the column right before "done" (in progress). */
  private reopenCol(): string {
    const cols = this.ctx.config.taskColumns;
    const i = cols.indexOf(this.doneCol());
    return cols[Math.max(0, i - 1)];
  }

  /**
   * Board display order: "My Tasks" is always pinned first, then whatever order the user
   * arranged (config `boardOrder`), then any remaining board alphabetically. Boards are
   * folders, so a board created outside the plugin simply appears at the end.
   */
  private orderBoards(raw: Board[]): Board[] {
    const pinnedFirst = (() => {
      const i = raw.findIndex((b) => b.name === "My Tasks");
      return i > 0 ? [raw[i], ...raw.filter((_, k) => k !== i)] : raw.slice();
    })();
    const custom = this.ctx.config.boardOrder || [];
    if (!custom.length) return pinnedFirst;
    const rank = new Map(custom.map((name, i) => [name, i]));
    const rest = pinnedFirst.filter((b) => b.name !== "My Tasks");
    rest.sort((a, b) => {
      const ra = rank.has(a.name) ? (rank.get(a.name) as number) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.name) ? (rank.get(b.name) as number) : Number.MAX_SAFE_INTEGER;
      return ra - rb || a.name.localeCompare(b.name);
    });
    const my = pinnedFirst.find((b) => b.name === "My Tasks");
    return my ? [my, ...rest] : rest;
  }

  /** Persist a new board order after moving `name` by `dir` (-1 left, +1 right). */
  private async moveBoard(name: string, dir: -1 | 1, boards: Board[]): Promise<void> {
    if (name === "My Tasks") { toast("My tasks stays first."); return; }
    const movable = boards.filter((b) => b.name !== "My Tasks").map((b) => b.name);
    const i = movable.indexOf(name);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= movable.length) return;
    [movable[i], movable[j]] = [movable[j], movable[i]];
    const cfg = await this.ctx.store.loadConfig();
    cfg.boardOrder = movable;
    await this.ctx.store.saveConfig(cfg);
    await this.ctx.reloadConfig();
    this.ctx.refresh();
  }

  /**
   * Search every task and jump to the chosen one: switch to its board in Kanban, make sure
   * its column is expanded far enough to include it, then scroll to the card and flash it
   * (the "here it is" cue, like Android's highlight-on-navigate).
   */
  private openSearch(): void {
    const cols = this.ctx.config.taskColumns;
    const colSet = new Set(cols);
    const names = this.ctx.config.taskColumnNames;
    const tasks = this.ctx.store.loadTasks();
    if (!tasks.length) { toast("No tasks to search yet."); return; }
    const items = tasks.map((t) => {
      const col = colSet.has(t.status) ? t.status : cols[0];
      const board = t.kanbanName || "My Tasks";
      return {
        value: t,
        haystack: [t.title, board, t.group, t.due, this.cleanLabel(names[col] || col)].filter(Boolean).join(" "),
        title: t.title,
        subtitle: `${board} · ${this.cleanLabel(names[col] || col)}${t.due ? " · due " + t.due : ""}`,
      };
    });
    new SearchModal(this.ctx.app, "Search tasks by title, board or group…", items, (t: Task) => {
      const col = colSet.has(t.status) ? t.status : cols[0];
      const board = t.kanbanName || "My Tasks";
      this.view = "kanban";
      this.currentBoard = board;
      // The column paginates at PAGE_SIZE, so raise its limit enough for the card to exist.
      const siblings = this.ctx.store.loadTasks()
        .filter((x) => (x.kanbanName || "My Tasks") === board && (colSet.has(x.status) ? x.status : cols[0]) === col);
      this.colLimits[board + "|" + col] = Math.max(siblings.length, PAGE_SIZE);
      this.revealPath = t.path;
      this.ctx.refresh();
    }).open();
  }

  /** Walkthrough shown when "sync now" is pressed before Google Tasks is connected. */
  private openGoogleSetup(): void {
    new StepsModal(this.ctx.app, {
      title: "Connect Google tasks (beta)",
      intro: "Sync isn't set up yet. It takes about a minute:",
      steps: [
        "Open the Momentum life settings (button below).",
        "Scroll to \"Google tasks\" and turn on \"Enable Google tasks sync\".",
        "Click \"Connect Google account\" — your browser opens Google's consent screen.",
        "Approve access, then let the browser send you back to Obsidian.",
        "The settings should now read \"Connected as …\". Optionally pick an auto-sync interval.",
      ],
      note: "Each board pairs with a Google tasks list of the same name, and \"My Tasks\" pairs with your default Google list. Sync also runs on startup once connected.",
      primary: { label: "Open settings", onClick: () => this.ctx.openPluginSettings?.() },
    }).open();
  }

  /** Scroll the pending card into view and flash it, then clear the pending reveal. */
  private revealPendingCard(): void {
    const path = this.revealPath;
    const root = this.rootEl;
    this.revealPath = null;
    if (!path || !root) return;
    window.setTimeout(() => {
      const card = root.querySelector<HTMLElement>(`.pa-task[data-path="${CSS.escape(path)}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.addClass("pa-flash");
      window.setTimeout(() => card.removeClass("pa-flash"), 1800);
    }, 60);
  }

  render(root: HTMLElement): void {
    root.empty();
    this.rootEl = root;
    const boards = this.orderBoards(this.ctx.store.loadBoards());
    const tasks = this.ctx.store.loadTasks();
    // Keep the standard-Markdown checkbox mirrors (Tasks/Lists/*.md) in sync with the board.
    void this.ctx.store.syncTaskLists();
    const filtered = tasks.filter((t) => this.currentBoard === "all" || t.kanbanName === this.currentBoard);

    this.renderHeader(root, filtered);
    this.renderViewToggle(root);
    this.renderBoardTabs(root, boards);

    if (this.view === "kanban") {
      this.renderStats(root, filtered);
      this.renderBoardBar(root, boards);
      this.renderKanban(root, filtered, boards);
    } else if (this.view === "matrix") {
      this.renderMatrix(root, filtered, boards);
    } else {
      this.renderList(root, filtered);
    }

    // A search pick asked to jump to a card: do it now that the DOM exists.
    this.revealPendingCard();
  }

  // ---- Header: title + subtitle + status rings ----
  private renderHeader(root: HTMLElement, filtered: Task[], compact = false): void {
    const head = root.createDiv({ cls: "pa-ht-header" });
    const left = head.createDiv();
    left.createDiv({ text: "✅ Tasks & Lists", cls: "pa-h1" });
    left.createDiv({ text: compact ? "Summary" : "Kanban and list", cls: "pa-muted" });
    if (!compact) {
      // All three header actions share one row: the sidebar link (secondary) then the two
      // real buttons.
      const tools = left.createDiv({ cls: "pa-ht-tools" });
      if (this.ctx.openSidePanel) appendSidebarBtn(tools, this.ctx.openSidePanel);
      const find = tools.createEl("button", { text: "🔍 Search tasks", cls: "pa-mini-btn" });
      find.onclick = () => this.openSearch();
      if (this.ctx.syncGoogleTasks) {
        const sync = tools.createEl("button", { text: "🔄 Sync now", cls: "pa-mini-btn" });
        sync.createSpan({ text: " (beta)", cls: "pa-beta-tag" });
        sync.onclick = () => {
          // Not connected yet → explain how to set it up instead of doing nothing.
          if (this.ctx.googleTasksReady && !this.ctx.googleTasksReady()) { this.openGoogleSetup(); return; }
          this.ctx.syncGoogleTasks?.();
          toast("Google tasks sync started.");
        };
      }
    }

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
    const mk = (id: "kanban" | "list" | "matrix", label: string) => {
      const b = bar.createEl("button", { text: label, cls: "pa-toggle-btn" + (this.view === id ? " on" : "") });
      b.onclick = () => { this.view = id; this.ctx.refresh(); };
    };
    mk("kanban", "📋 Kanban");
    mk("list", "📃 List");
    mk("matrix", "🎯 Matrix");
  }

  // ---- Board tabs ----
  private renderBoardTabs(root: HTMLElement, boards: Board[]): void {
    const bar = root.createDiv({ cls: "pa-tabs" });
    const mkTab = (id: string, label: string): HTMLElement => {
      const t = bar.createEl("button", { text: label, cls: "pa-tab" + (this.currentBoard === id ? " on" : "") });
      t.onclick = () => { this.currentBoard = id; this.ctx.refresh(); };
      return t;
    };
    mkTab("all", "📋 All");
    // Board tabs are reordered by DRAGGING them. "My Tasks" stays pinned first (it pairs with
    // Google's default list), so it is neither draggable nor a drop slot.
    boards.forEach((b) => {
      const t = mkTab(b.name, `${b.emoji || ""} ${b.name}`.trim());
      if (b.name === "My Tasks") return;
      t.dataset.board = b.name;
      t.setAttr("draggable", "true");
      t.setAttr("title", "Drag to reorder");
      t.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData("text/plain", b.name);
        t.addClass("pa-dragging");
      });
      t.addEventListener("dragend", () => t.removeClass("pa-dragging"));
    });
    const add = bar.createEl("button", { text: "+ board", cls: "pa-tab pa-tab-add" });
    add.onclick = () => this.openBoardModal(boards);

    bar.addEventListener("dragover", (e) => { e.preventDefault(); bar.addClass("pa-drop"); });
    bar.addEventListener("dragleave", () => bar.removeClass("pa-drop"));
    bar.addEventListener("drop", (e) => {
      e.preventDefault();
      bar.removeClass("pa-drop");
      const name = e.dataTransfer?.getData("text/plain");
      if (!name) return;
      void this.dropBoard(bar, name, e.clientX, boards);
    });
  }

  /** Persist the tab order after dropping `name` at horizontal position `x`. */
  private async dropBoard(bar: HTMLElement, name: string, x: number, boards: Board[]): Promise<void> {
    const order = boards.filter((b) => b.name !== "My Tasks").map((b) => b.name);
    if (!order.includes(name)) return; // dropped something that isn't a movable board
    const afterEl = this.getDropTargetTab(bar, x, name);
    const rest = order.filter((n) => n !== name);
    const afterName = afterEl?.dataset.board ?? null;
    let idx = afterName ? rest.indexOf(afterName) : rest.length;
    if (idx < 0) idx = rest.length;
    rest.splice(idx, 0, name);
    if (rest.join("\u0000") === order.join("\u0000")) return; // nothing moved
    const cfg = await this.ctx.store.loadConfig();
    cfg.boardOrder = rest;
    await this.ctx.store.saveConfig(cfg);
    await this.ctx.reloadConfig();
    this.ctx.refresh();
  }

  /** The tab the dragged board should be inserted BEFORE, based on the cursor's X. */
  private getDropTargetTab(bar: HTMLElement, x: number, dragging: string): HTMLElement | null {
    const tabs = Array.from(bar.querySelectorAll<HTMLElement>(".pa-tab[data-board]"))
      .filter((el) => el.dataset.board !== dragging);
    for (const el of tabs) {
      const box = el.getBoundingClientRect();
      if (x < box.left + box.width / 2) return el;
    }
    return null;
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
      // Tabs are reordered by dragging; these entries are the keyboard-accessible equivalent.
      const movable = boards.filter((b) => b.name !== "My Tasks");
      const mIdx = movable.findIndex((b) => b.name === board.name);
      const moveItems: MenuAction[] = board.name === "My Tasks" ? [] : [
        ...(mIdx > 0 ? [{ title: "Move board left", icon: "arrow-left", onClick: () => { void this.moveBoard(board.name, -1, boards); } }] : []),
        ...(mIdx >= 0 && mIdx < movable.length - 1 ? [{ title: "Move board right", icon: "arrow-right", onClick: () => { void this.moveBoard(board.name, 1, boards); } }] : []),
      ];
      kebab.onclick = (e) => showActionMenu(e, [
        ...moveItems,
        { title: "Rename board", icon: "pencil", onClick: () => this.openRenameBoardModal(board, boards) },
        { title: "Delete board", icon: "trash", warning: true, onClick: () =>
          new ConfirmModal(this.ctx.app, `Delete board "${board.name}"? (its tasks move to My Tasks)`, async () => {
            await this.ctx.store.deleteBoard(board.name);
            this.currentBoard = "all";
            this.ctx.refresh();
          }).open() },
      ]);
    }
  }

  private openRenameBoardModal(board: Board, boards: Board[]): void {
    const fields: FieldSpec[] = [
      { key: "name", label: "Board name", type: "text", value: board.name },
    ];
    new FormModal(this.ctx.app, "Rename board", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name || name === board.name) return;
      if (boards.some((b) => b.name === name)) { toast(`A board named "${name}" already exists.`); return; }
      // Renaming a board = renaming its folder; every task inside re-homes automatically.
      await this.ctx.store.renameBoard(board.name, name);
      if (this.currentBoard === board.name) this.currentBoard = name;
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

      // New cards (adopted orphans or plugin-created) have no explicit `order`.
      // Surface them at the TOP of their column, newest created first. Cards that
      // were manually ordered via drag keep their persisted position below.
      const ord = (t: Task) => (t.order ?? -1);
      colTasks.sort((a, b) => ord(a) - ord(b) || (b.created || "").localeCompare(a.created || ""));

      // Show at most `limit` cards (7 by default); "load more" reveals 7 more each click.
      const key = this.currentBoard + "|" + col;
      const limit = this.colLimits[key] ?? PAGE_SIZE;
      colTasks.slice(0, limit).forEach((t) => this.renderCard(list, t, isDone));

      if (colTasks.length > limit) {
        const remaining = colTasks.length - limit;
        const next = Math.min(PAGE_SIZE, remaining);
        const more = list.createEl("button", { cls: "pa-load-more", text: `▾ Load ${next} more (${remaining} left)` });
        more.onclick = (e) => { e.stopPropagation(); this.colLimits[key] = limit + PAGE_SIZE; this.ctx.refresh(); };
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
    const doneId = this.doneCol();

    const card = list.createDiv({ cls: "pa-card pa-task prio-" + (t.priority || "medium") + (isDoneCol ? " done" : "") });
    card.dataset.path = t.path;
    card.setAttr("draggable", "true");
    card.addEventListener("dragstart", (e) => { e.dataTransfer?.setData("text/plain", t.path); card.addClass("pa-dragging"); });
    card.addEventListener("dragend", () => card.removeClass("pa-dragging"));
    card.onclick = () => this.ctx.app.workspace.openLinkText(t.path, "", true);

    const topRow = card.createDiv({ cls: "pa-card-top" });
    const badgeText = (t.group || t.cat || t.kanbanName || "").toUpperCase();
    if (badgeText) topRow.createDiv({ text: badgeText, cls: "pa-card-cat" });
    renderCardActions(topRow, {
      app: this.ctx.app,
      title: t.title,
      isDone: isDoneCol,
      onDone: () => {
        void (async () => {
          if (isDoneCol) await this.ctx.store.updateTask(t, { status: this.reopenCol() });
          else await this.ctx.store.completeTaskAtTop(t, doneId);
          this.ctx.refresh();
        })();
      },
      onDelete: () => {
        void (async () => { await this.ctx.store.deleteTask(t); this.ctx.refresh(); })();
      },
      extraMenuItems: [
        { title: "Open note", icon: "file-text", onClick: () => { void this.ctx.app.workspace.openLinkText(t.path, "", true); } },
        { title: "Edit", icon: "pencil", onClick: () => this.openTaskModal(t, t.status, this.ctx.store.loadBoards()) },
        { title: "Delete", icon: "trash", warning: true, onClick: () => new ConfirmModal(this.ctx.app, `Delete task "${t.title}"?`, async () => { await this.ctx.store.deleteTask(t); this.ctx.refresh(); }).open() },
      ],
    });

    card.createDiv({ text: t.title, cls: "pa-card-title" });
    renderCardChips(card, { priority: t.priority, due: t.due, created: t.created });
  }

  // ---- Eisenhower matrix ----
  /** Derive a quadrant from priority (importance) and due date (urgency) when none is set. */
  private derivedQuadrant(t: Task): string {
    const important = t.priority === "high";
    let urgent = false;
    if (t.due) {
      const due = new Date(t.due + "T00:00:00");
      if (!isNaN(due.getTime())) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        urgent = (due.getTime() - today.getTime()) / 86400000 <= 2; // due within 2 days or overdue
      }
    }
    if (important && urgent) return "q1";
    if (important) return "q2";
    if (urgent) return "q3";
    return "q4";
  }

  private quadrantOf(t: Task): string {
    const q = t.eisenhower || "";
    return QUADRANTS.some((x) => x.id === q) ? q : this.derivedQuadrant(t);
  }

  /** Small deterministic offset (±0.06) from the task path, so dots don't stack exactly. */
  private hashJitter(s: string): number {
    let h = 0;
    for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) % 1000;
    return (h / 1000 - 0.5) * 0.12;
  }

  /** Continuous urgency (x) and importance (y) in 0..1 for the scatter chart. */
  private taskScores(t: Task): { u: number; i: number } {
    const impMap: Record<string, number> = { high: 0.8, medium: 0.5, low: 0.22 };
    let imp = impMap[t.priority] ?? 0.5;
    let urg = 0.2;
    if (t.due) {
      const due = new Date(t.due + "T00:00:00");
      if (!isNaN(due.getTime())) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const days = (due.getTime() - today.getTime()) / 86400000;
        urg = days <= 0 ? 0.92 : days <= 2 ? 0.8 : days <= 7 ? 0.6 : days <= 30 ? 0.42 : 0.28;
      }
    }
    // Keep the dot in the quadrant the user pinned it to, if any.
    const q = t.eisenhower || "";
    if (q === "q1") { urg = Math.max(urg, 0.6); imp = Math.max(imp, 0.6); }
    else if (q === "q2") { urg = Math.min(urg, 0.4); imp = Math.max(imp, 0.6); }
    else if (q === "q3") { urg = Math.max(urg, 0.6); imp = Math.min(imp, 0.4); }
    else if (q === "q4") { urg = Math.min(urg, 0.4); imp = Math.min(imp, 0.4); }
    const j = this.hashJitter(t.path);
    return { u: Math.max(0.04, Math.min(0.96, urg + j)), i: Math.max(0.04, Math.min(0.96, imp - j)) };
  }

  private renderMatrixChart(root: HTMLElement, open: Task[]): void {
    if (!open.length) { root.createEl("p", { cls: "pa-muted", text: "No open tasks to plot." }); return; }
    const prioColor: Record<string, string> = { high: "#ef4444", medium: "#f59e0b", low: "#9ca3af" };
    const points: ScatterPoint[] = open.map((t) => {
      const { u, i } = this.taskScores(t);
      return { x: u, y: i, color: prioColor[t.priority] || "#9ca3af", title: t.title, onClick: () => { void this.ctx.app.workspace.openLinkText(t.path, "", true); } };
    });
    drawScatter(root, points, { xLabel: "Urgency →", yLabel: "Importance →" });
  }

  private renderMatrix(root: HTMLElement, filtered: Task[], boards: Board[]): void {
    const cols = this.ctx.config.taskColumns;
    const doneId = this.doneCol();
    const colSet = new Set(cols);
    const eff = (t: Task) => (colSet.has(t.status) ? t.status : cols[0]);
    const open = filtered.filter((t) => eff(t) !== doneId);

    root.createDiv({ text: "🎯 Eisenhower matrix", cls: "pa-h2" });

    this.renderMatrixChart(root, open);

    root.createDiv({ cls: "pa-muted pa-matrix-hint", text: "Drag a task between quadrants to set its urgency and importance." });

    const grid = root.createDiv({ cls: "pa-matrix" });
    QUADRANTS.forEach((q) => {
      const qtasks = open.filter((t) => this.quadrantOf(t) === q.id);
      const cell = grid.createDiv({ cls: "pa-matrix-cell pa-" + q.id });

      const head = cell.createDiv({ cls: "pa-matrix-head" });
      head.createDiv({ text: q.title, cls: "pa-matrix-title" });
      head.createSpan({ text: String(qtasks.length), cls: "pa-matrix-count" });
      head.createDiv({ text: q.sub, cls: "pa-matrix-sub pa-muted" });

      const body = cell.createDiv({ cls: "pa-matrix-body" });
      body.addEventListener("dragover", (e) => { e.preventDefault(); body.addClass("pa-drop"); });
      body.addEventListener("dragleave", () => body.removeClass("pa-drop"));
      body.addEventListener("drop", (e) => {
        e.preventDefault();
        body.removeClass("pa-drop");
        const path = e.dataTransfer?.getData("text/plain");
        if (!path) return;
        const t = open.find((x) => x.path === path);
        if (!t || this.quadrantOf(t) === q.id) return;
        void (async () => { await this.ctx.store.updateTask(t, { eisenhower: q.id }); this.ctx.refresh(); })();
      });

      qtasks.forEach((t) => this.renderMatrixCard(body, t));

      const addBtn = cell.createEl("button", { text: "+ add card", cls: "pa-add-card" });
      addBtn.onclick = () => this.openTaskModal(null, cols[0], boards, undefined, q.id);
    });
  }

  private renderMatrixCard(body: HTMLElement, t: Task): void {
    const doneId = this.doneCol();

    const card = body.createDiv({ cls: "pa-card pa-task pa-matrix-card prio-" + (t.priority || "medium") });
    card.dataset.path = t.path;
    card.setAttr("draggable", "true");
    card.addEventListener("dragstart", (e) => { e.dataTransfer?.setData("text/plain", t.path); card.addClass("pa-dragging"); });
    card.addEventListener("dragend", () => card.removeClass("pa-dragging"));
    card.onclick = () => this.ctx.app.workspace.openLinkText(t.path, "", true);

    const topRow = card.createDiv({ cls: "pa-card-top" });
    const badgeText = (t.group || t.cat || t.kanbanName || "").toUpperCase();
    if (badgeText) topRow.createDiv({ text: badgeText, cls: "pa-card-cat" });
    renderCardActions(topRow, {
      app: this.ctx.app,
      title: t.title,
      isDone: false,
      onDone: () => {
        void (async () => { await this.ctx.store.completeTaskAtTop(t, doneId); this.ctx.refresh(); })();
      },
      onDelete: () => {
        void (async () => { await this.ctx.store.deleteTask(t); this.ctx.refresh(); })();
      },
      extraMenuItems: [
        { title: "Open note", icon: "file-text", onClick: () => { void this.ctx.app.workspace.openLinkText(t.path, "", true); } },
        { title: "Edit", icon: "pencil", onClick: () => this.openTaskModal(t, t.status, this.ctx.store.loadBoards()) },
        { title: "Mark done", icon: "check", onClick: () => { void (async () => { await this.ctx.store.completeTaskAtTop(t, doneId); this.ctx.refresh(); })(); } },
        { title: "Delete", icon: "trash", warning: true, onClick: () => new ConfirmModal(this.ctx.app, `Delete task "${t.title}"?`, async () => { await this.ctx.store.deleteTask(t); this.ctx.refresh(); }).open() },
      ],
    });

    card.createDiv({ text: t.title, cls: "pa-card-title" });
    renderCardChips(card, { priority: t.priority, due: t.due, created: t.created });
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
    circle.onclick = async () => {
      if (done) await this.ctx.store.updateTask(t, { status: firstCol });
      else await this.ctx.store.completeTaskAtTop(t, doneCol);
      this.ctx.refresh();
    };
    const main = row.createDiv({ cls: "pa-list-item-main" });
    const title = main.createDiv({ text: t.title, cls: "pa-list-item-title" });
    title.onclick = () => this.ctx.app.workspace.openLinkText(t.path, "", true);
    if (t.group) main.createDiv({ text: t.group, cls: "pa-muted pa-list-item-sub" });
  }

  // ---- Modals & column management ----
  private openBoardModal(boards: Board[]): void {
    const fields: FieldSpec[] = [
      { key: "name", label: "Board name", type: "text" },
    ];
    new FormModal(this.ctx.app, "New board", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name) return;
      if (boards.some((b) => b.name === name)) { this.currentBoard = name; this.ctx.refresh(); return; }
      // Creating a board = creating its folder under Tasks/.
      const ok = await this.ctx.store.createBoard(name);
      if (!ok) { toast("Invalid board name."); return; }
      this.currentBoard = name;
      this.ctx.refresh();
      toast("Board created");
    }).open();
  }

  private openTaskModal(task: Task | null, defaultStatus: string, boards: Board[], defaultBoard?: string, defaultQuadrant?: string): void {
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
      { key: "eisenhower", label: "Eisenhower quadrant", type: "dropdown", options: EISENHOWER_OPTS, value: task?.eisenhower || defaultQuadrant || "" },
    ];
    new FormModal(this.ctx.app, task ? "Edit task" : "New task", fields, async (v) => {
      // Never fail silently: an empty title used to close the modal with no card and no
      // explanation, which looked like the "add card" button was broken.
      if (!(v.title || "").trim()) { toast("A task needs a title."); return; }
      const data = { title: v.title.trim(), status: v.status, priority: v.priority, kanbanName: v.kanbanName, group: v.group, due: v.due, eisenhower: v.eisenhower };
      if (task) {
        await this.ctx.store.updateTask(task, data);
      } else {
        // Wait for the metadata cache to index the new note before re-rendering, so the
        // card appears directly in its column instead of flashing in backlog first.
        const path = await this.ctx.store.createTask(data);
        await this.ctx.store.awaitFrontmatter(path);
      }
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
