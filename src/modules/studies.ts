import { PAContext } from "../context";
import { Board, StudyCard } from "../types";
import { ConfirmModal, FieldSpec, FormModal, MenuAction, openExternal, showActionMenu, toast } from "../ui";
import { drawRing } from "../charts";

const RING_COLORS = ["#d97706", "#7c3aed", "#16a34a"];
const COLUMN_COLORS = ["#7c3aed", "#3b82f6", "#16a34a", "#f59e0b", "#ef4444", "#10b981"];

/** Renders the Studies page: a Kanban / List board over Studies/{topic}/*.md. */
export class StudiesModule {
  private ctx: PAContext;
  private currentTopic = "all";
  private view: "kanban" | "list" = "kanban";

  constructor(ctx: PAContext) { this.ctx = ctx; }

  private cleanLabel(s: string): string { return s.replace(/^[^\p{L}\p{N}]+/u, "").trim(); }
  private colColor(i: number): string { return COLUMN_COLORS[i % COLUMN_COLORS.length]; }

  /** The fixed "done" column id (completion column). */
  private doneCol(): string {
    const cols = this.ctx.config.studyColumns;
    return cols.includes("done") ? "done" : cols[cols.length - 1];
  }

  private resolveTopics(cards: StudyCard[]): Board[] {
    const boards = this.ctx.store.loadStudyBoards();
    if (boards.length) return boards;
    const seen = new Map<string, Board>();
    cards.forEach((c) => {
      if (c.topic && !seen.has(c.topic)) seen.set(c.topic, { id: c.topic.toLowerCase().replace(/[^a-z0-9]/g, "-"), name: c.topic, emoji: "📚" });
    });
    return Array.from(seen.values());
  }

  render(root: HTMLElement): void {
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
  private renderHeader(root: HTMLElement, filtered: StudyCard[]): void {
    const head = root.createDiv({ cls: "pa-ht-header" });
    const left = head.createDiv();
    left.createDiv({ text: "📚 Studies", cls: "pa-h1" });
    left.createDiv({ text: "Kanban and list", cls: "pa-muted" });

    const cols = this.ctx.config.studyColumns;
    const names = this.ctx.config.studyColumnNames;
    const colSet = new Set(cols);
    const eff = (c: StudyCard) => (colSet.has(c.status) ? c.status : cols[0]);
    const total = filtered.length || 1;

    const rings = head.createDiv({ cls: "pa-ht-rings" });
    cols.slice(0, 3).forEach((col, i) => {
      const cnt = filtered.filter((c) => eff(c) === col).length;
      const pct = Math.round((cnt / total) * 100);
      drawRing(rings, pct, RING_COLORS[i] || "#7c3aed", this.cleanLabel(names[col] || col), 52);
    });
  }

  private renderViewToggle(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "pa-view-toggle" });
    const mk = (id: "kanban" | "list", label: string) => {
      const b = bar.createEl("button", { text: label, cls: "pa-toggle-btn" + (this.view === id ? " on" : "") });
      b.onclick = () => { this.view = id; this.ctx.refresh(); };
    };
    mk("kanban", "📋 Kanban");
    mk("list", "📃 List");
  }

  private renderTopicTabs(root: HTMLElement, topics: Board[]): void {
    const bar = root.createDiv({ cls: "pa-tabs" });
    const mkTab = (id: string, label: string) => {
      const t = bar.createEl("button", { text: label, cls: "pa-tab" + (this.currentTopic === id ? " on" : "") });
      t.onclick = () => { this.currentTopic = id; this.ctx.refresh(); };
    };
    mkTab("all", "📚 All");
    topics.forEach((b) => mkTab(b.name, `${b.emoji || ""} ${b.name}`.trim()));
    const add = bar.createEl("button", { text: "+ Topic", cls: "pa-tab pa-tab-add" });
    add.onclick = () => this.openTopicModal(topics);
  }

  private renderStats(root: HTMLElement, filtered: StudyCard[]): void {
    const cols = this.ctx.config.studyColumns;
    const names = this.ctx.config.studyColumnNames;
    const colSet = new Set(cols);
    const eff = (c: StudyCard) => (colSet.has(c.status) ? c.status : cols[0]);
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
    cols.filter((c) => c !== doneId).slice(0, 2).forEach((col) => {
      const cnt = filtered.filter((c) => eff(c) === col).length;
      stat((names[col] || col).toUpperCase(), String(cnt), this.colColor(cols.indexOf(col)));
    });
    const doneCnt = filtered.filter((c) => eff(c) === doneId).length;
    stat((names[doneId] || doneId).toUpperCase(), (total ? Math.round((doneCnt / total) * 100) : 0) + "%", "#16a34a");
  }

  private renderTopicBar(root: HTMLElement, topics: Board[]): void {
    const bar = root.createDiv({ cls: "pa-board-bar" });
    const topic = topics.find((b) => b.name === this.currentTopic);
    bar.createDiv({ text: topic ? `${topic.emoji || ""} ${topic.name}`.trim() : "📚 All topics", cls: "pa-board-title" });
    const actions = bar.createDiv({ cls: "pa-board-actions" });
    const addCol = actions.createEl("button", { text: "+ Column", cls: "pa-mini-btn" });
    addCol.onclick = () => this.openAddColumnModal();
    if (topic) {
      const kebab = actions.createEl("button", { text: "⋮", cls: "pa-icon-btn" });
      kebab.onclick = (e) => showActionMenu(e, [
        { title: "Rename topic", icon: "pencil", onClick: () => this.openRenameTopicModal(topic, topics) },
        { title: "Delete topic", icon: "trash", warning: true, onClick: () =>
          new ConfirmModal(this.ctx.app, `Delete topic "${topic.name}"? (cards are kept)`, async () => {
            await this.ctx.store.saveStudyBoards(topics.filter((b) => b.name !== topic.name));
            this.currentTopic = "all";
            this.ctx.refresh();
          }).open() },
      ]);
    }
  }

  private openRenameTopicModal(topic: Board, topics: Board[]): void {
    const fields: FieldSpec[] = [
      { key: "name", label: "Topic name", type: "text", value: topic.name },
      { key: "emoji", label: "Emoji", type: "emoji", value: topic.emoji || "" },
    ];
    new FormModal(this.ctx.app, "Rename topic", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name) return;
      if (name !== topic.name && topics.some((b) => b.name === name)) { toast(`A topic named "${name}" already exists.`); return; }
      const updated = topics.map((b) => (b.name === topic.name ? { ...b, name, emoji: (v.emoji || "").trim() } : b));
      await this.ctx.store.saveStudyBoards(updated);
      if (name !== topic.name) {
        for (const c of this.ctx.store.loadStudyCards().filter((c) => c.topic === topic.name)) {
          await this.ctx.store.updateStudyCard(c, { topic: name });
        }
        if (this.currentTopic === topic.name) this.currentTopic = name;
      }
      this.ctx.refresh();
      toast("Topic updated");
    }, "Save").open();
  }

  // ---- Kanban ----
  private renderKanban(root: HTMLElement, filtered: StudyCard[], topics: Board[]): void {
    const cols = this.ctx.config.studyColumns;
    const names = this.ctx.config.studyColumnNames;
    const colSet = new Set(cols);
    const eff = (c: StudyCard) => (colSet.has(c.status) ? c.status : cols[0]);
    const doneId = this.doneCol();

    const board = root.createDiv({ cls: "pa-kanban" });
    cols.forEach((col, i) => {
      const color = this.colColor(i);
      const isDone = col === doneId;
      const colEl = board.createDiv({ cls: "pa-col" });
      colEl.style.borderColor = color;
      const colCards = filtered.filter((c) => eff(c) === col);

      const head = colEl.createDiv({ cls: "pa-col-head" });
      const title = head.createSpan({ text: names[col] || col, cls: "pa-col-title" });
      title.style.color = color;
      const tools = head.createDiv({ cls: "pa-col-tools" });
      const count = tools.createSpan({ text: String(colCards.length), cls: "pa-col-count" });
      count.style.background = color;
      if (i > 0) { const l = tools.createEl("button", { text: "◀", cls: "pa-icon-btn" }); l.onclick = () => this.moveColumn(col, -1); }
      if (i < cols.length - 1) { const r = tools.createEl("button", { text: "▶", cls: "pa-icon-btn" }); r.onclick = () => this.moveColumn(col, 1); }
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
        const dragged = filtered.find((c) => c.path === path);
        if (!dragged) return;
        const ordered = colCards.filter((c) => c.path !== path);
        const afterEl = this.getDragAfterElement(list, e.clientY);
        const afterPath = afterEl?.dataset.path ?? null;
        let idx = afterPath ? ordered.findIndex((c) => c.path === afterPath) : ordered.length;
        if (idx < 0) idx = ordered.length;
        ordered.splice(idx, 0, dragged);
        for (let k = 0; k < ordered.length; k++) {
          const c = ordered[k];
          const changes: { status?: string; order?: number } = {};
          if (c.path === path && eff(c) !== col) changes.status = col;
          if (c.order !== k) changes.order = k;
          if (Object.keys(changes).length) await this.ctx.store.patchStudyCardMeta(c, changes);
        }
        this.ctx.refresh();
      };
      list.addEventListener("dragover", (e) => { e.preventDefault(); list.addClass("pa-drop"); });
      list.addEventListener("dragleave", () => list.removeClass("pa-drop"));
      list.addEventListener("drop", persistDrop);

      const ord = (c: StudyCard) => (c.order ?? 1e9);
      colCards.sort((a, b) => ord(a) - ord(b) || (a.date || "").localeCompare(b.date || ""));

      colCards.slice(0, isDone && colCards.length > 7 ? 7 : colCards.length)
        .forEach((c) => this.renderCard(list, c, isDone, topics));
      if (isDone && colCards.length > 7) {
        const det = list.createEl("details", { cls: "pa-completed pa-kanban-more" });
        det.createEl("summary", { text: `Show ${colCards.length - 7} more` });
        colCards.slice(7).forEach((c) => this.renderCard(det, c, isDone, topics));
      }

      const addBtn = colEl.createEl("button", { text: "+ Add card", cls: "pa-add-card" });
      addBtn.onclick = () => this.openCardModal(null, col, topics);
    });
  }

  private getDragAfterElement(container: HTMLElement, y: number): HTMLElement | null {
    const els = Array.from(container.querySelectorAll(".pa-study:not(.pa-dragging)")) as HTMLElement[];
    let closest: HTMLElement | null = null;
    let closestOffset = -Infinity;
    for (const el of els) {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closestOffset) { closestOffset = offset; closest = el; }
    }
    return closest;
  }

  private renderCard(list: HTMLElement, c: StudyCard, isDoneCol: boolean, topics: Board[]): void {
    const card = list.createDiv({ cls: "pa-card pa-study" + (isDoneCol ? " done" : "") });
    card.dataset.path = c.path;
    card.setAttr("draggable", "true");
    card.addEventListener("dragstart", (e) => { e.dataTransfer?.setData("text/plain", c.path); card.addClass("pa-dragging"); });
    card.addEventListener("dragend", () => card.removeClass("pa-dragging"));
    card.onclick = () => this.ctx.app.workspace.openLinkText(c.path, "", true);

    const topRow = card.createDiv({ cls: "pa-card-top" });
    const badge = (c.subtopic || c.topic || "").toUpperCase();
    topRow.createDiv({ text: badge, cls: "pa-card-cat" });
    const acts = topRow.createDiv({ cls: "pa-card-top-actions" });
    const menuBtn = acts.createEl("button", { text: "⋮", cls: "pa-icon-btn pa-card-menu" });
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      const items: MenuAction[] = [
        { title: "Open note", icon: "file-text", onClick: () => this.ctx.app.workspace.openLinkText(c.path, "", true) },
      ];
      if (c.url) items.push({ title: "Open URL", icon: "link", onClick: () => openExternal(c.url!) });
      items.push({ title: "Edit", icon: "pencil", onClick: () => this.openCardModal(c, c.status, topics) });
      items.push({ title: "Delete", icon: "trash", warning: true, onClick: () => new ConfirmModal(this.ctx.app, `Delete study card "${c.title}"?`, async () => { await this.ctx.store.deleteStudyCard(c); this.ctx.refresh(); }).open() });
      showActionMenu(e, items);
    };

    card.createEl("div", { text: c.title, cls: "pa-card-title" });
    if (c.date) card.createDiv({ cls: "pa-muted pa-card-meta", text: c.date });

    const preview = card.createDiv({ cls: "pa-card-preview" });
    this.ctx.store.readBody(c.path).then((body) => {
      const lines = body.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3);
      if (lines.length) preview.setText(lines.join("\n"));
      else preview.remove();
    });
  }

  // ---- List view ----
  private renderList(root: HTMLElement, filtered: StudyCard[], topics: Board[]): void {
    const cols = this.ctx.config.studyColumns;
    const firstCol = cols[0];
    const doneId = this.doneCol();
    const colSet = new Set(cols);
    const eff = (c: StudyCard) => (colSet.has(c.status) ? c.status : cols[0]);
    const isDone = (c: StudyCard) => eff(c) === doneId;

    root.createDiv({ text: "📝 List of Studies", cls: "pa-h2" });
    if (!filtered.length) { root.createEl("p", { cls: "pa-muted", text: "No study cards." }); return; }

    const groups = new Map<string, StudyCard[]>();
    filtered.forEach((c) => { const k = c.topic || "No topic"; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(c); });

    const wrap = root.createDiv({ cls: "pa-list-cards" });
    groups.forEach((cards, topicName) => {
      const card = wrap.createDiv({ cls: "pa-list-card" });
      card.createDiv({ text: topicName, cls: "pa-list-card-title" });
      const add = card.createDiv({ cls: "pa-list-add", text: "✏️ Add a card" });
      add.onclick = () => this.openCardModal(null, firstCol, topics, topicName === "No topic" ? "" : topicName);

      const open = cards.filter((c) => !isDone(c));
      const done = cards.filter((c) => isDone(c));
      open.forEach((c) => this.renderListItem(card, c, false, doneId, firstCol));
      if (done.length) {
        const det = card.createEl("details", { cls: "pa-completed" });
        det.createEl("summary", { text: `Completed (${done.length})` });
        done.forEach((c) => this.renderListItem(det, c, true, doneId, firstCol));
      }
    });
  }

  private renderListItem(parent: HTMLElement, c: StudyCard, done: boolean, doneCol: string, firstCol: string): void {
    const row = parent.createDiv({ cls: "pa-list-item" + (done ? " done" : "") });
    const circle = row.createSpan({ cls: "pa-list-circle" + (done ? " on" : ""), text: done ? "●" : "○" });
    circle.onclick = async () => { await this.ctx.store.updateStudyCardStatus(c, done ? firstCol : doneCol); this.ctx.refresh(); };
    const main = row.createDiv({ cls: "pa-list-item-main" });
    const title = main.createDiv({ text: c.title, cls: "pa-list-item-title" });
    title.onclick = () => (c.url ? openExternal(c.url) : this.ctx.app.workspace.openLinkText(c.path, "", true));
    if (c.subtopic) main.createDiv({ text: c.subtopic, cls: "pa-muted pa-list-item-sub" });
  }

  // ---- Modals & column management ----
  private openTopicModal(topics: Board[]): void {
    const fields: FieldSpec[] = [
      { key: "name", label: "Topic name", type: "text", placeholder: "DevOps & SRE" },
      { key: "emoji", label: "Emoji", type: "emoji", value: "📚" },
    ];
    new FormModal(this.ctx.app, "New study topic", fields, async (v) => {
      const name = (v.name || "").trim();
      if (!name) return;
      if (topics.some((b) => b.name === name)) { this.currentTopic = name; this.ctx.refresh(); return; }
      topics.push({ id: name.toLowerCase().replace(/[^a-z0-9]/g, "-"), name, emoji: (v.emoji || "📚").trim() });
      await this.ctx.store.saveStudyBoards(topics);
      this.currentTopic = name;
      this.ctx.refresh();
      toast("Topic created");
    }).open();
  }

  private openCardModal(card: StudyCard | null, defaultStatus: string, topics: Board[], defaultTopic?: string): void {
    const topicOptions = topics.map((b) => ({ value: b.name, label: b.name }));
    if (!topicOptions.length) topicOptions.push({ value: "General", label: "General" });
    const colOptions = this.ctx.config.studyColumns.map((c) => ({ value: c, label: this.ctx.config.studyColumnNames[c] || c }));
    const preset = card?.topic || defaultTopic || (this.currentTopic !== "all" ? this.currentTopic : topicOptions[0].value);
    const fields: FieldSpec[] = [
      { key: "title", label: "Title", type: "text", value: card?.title || "" },
      { key: "topic", label: "Topic", type: "dropdown", options: topicOptions, value: preset },
      { key: "subtopic", label: "Subtopic", type: "text", value: card?.subtopic || "" },
      { key: "status", label: "Column", type: "dropdown", options: colOptions, value: card?.status || defaultStatus },
      { key: "url", label: "URL", type: "text", value: card?.url || "", placeholder: "https://..." },
    ];
    new FormModal(this.ctx.app, card ? "Edit study card" : "New study card", fields, async (v) => {
      if (!(v.title || "").trim()) return;
      const data = { title: v.title.trim(), topic: v.topic, subtopic: v.subtopic, status: v.status, url: v.url };
      if (card) {
        const ok = await this.ctx.store.updateStudyCard(card, data);
        if (!ok) { toast(`A study card named "${data.title}" already exists in ${data.topic}.`); return; }
      } else {
        await this.ctx.store.createStudyCard(data);
      }
      this.ctx.refresh();
    }, card ? "Save" : "Create").open();
  }

  private splitEmoji(name: string): { emoji: string; text: string } {
    const m = name.match(/^([^\p{L}\p{N}]+)\s*(.*)$/u);
    return m ? { emoji: m[1].trim(), text: m[2] } : { emoji: "", text: name };
  }

  private openAddColumnModal(): void {
    const cfg = this.ctx.config;
    if (cfg.studyColumns.length >= 5) { toast("Maximum of 5 columns."); return; }
    const fields: FieldSpec[] = [
      { key: "name", label: "Column name", type: "text", placeholder: "Reviewing, Paused" },
      { key: "emoji", label: "Emoji", type: "emoji", value: "" },
    ];
    new FormModal(this.ctx.app, "New column", fields, async (v) => {
      const text = (v.name || "").trim();
      if (!text) return;
      if (cfg.studyColumns.length >= 5) { toast("Maximum of 5 columns."); return; }
      const id = text.toLowerCase().replace(/[^a-z0-9]/g, "-");
      if (cfg.studyColumns.includes(id)) return;
      cfg.studyColumns.push(id);
      cfg.studyColumnNames[id] = `${(v.emoji || "").trim()} ${text}`.trim();
      await this.ctx.store.saveConfig(cfg);
      this.ctx.refresh();
    }, "Add").open();
  }

  private openRenameColumnModal(col: string): void {
    const cfg = this.ctx.config;
    if (col === this.doneCol()) { toast("The Done column can't be renamed."); return; }
    const { emoji, text } = this.splitEmoji(cfg.studyColumnNames[col] || col);
    const fields: FieldSpec[] = [
      { key: "name", label: "New name", type: "text", value: text },
      { key: "emoji", label: "Emoji", type: "emoji", value: emoji },
    ];
    new FormModal(this.ctx.app, "Rename column", fields, async (v) => {
      const t = (v.name || "").trim();
      if (!t) return;
      cfg.studyColumnNames[col] = `${(v.emoji || "").trim()} ${t}`.trim();
      await this.ctx.store.saveConfig(cfg);
      this.ctx.refresh();
    }, "Save").open();
  }

  private async moveColumn(col: string, dir: -1 | 1): Promise<void> {
    const cfg = this.ctx.config;
    const i = cfg.studyColumns.indexOf(col);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cfg.studyColumns.length) return;
    [cfg.studyColumns[i], cfg.studyColumns[j]] = [cfg.studyColumns[j], cfg.studyColumns[i]];
    await this.ctx.store.saveConfig(cfg);
    this.ctx.refresh();
  }

  private removeColumn(col: string, cards: StudyCard[]): void {
    const cfg = this.ctx.config;
    if (col === this.doneCol()) { toast("The Done column can't be removed."); return; }
    if (cfg.studyColumns.length <= 1) { toast("You must keep at least one column."); return; }
    new ConfirmModal(this.ctx.app, `Delete column "${this.cleanLabel(cfg.studyColumnNames[col] || col)}"? Cards move to the first column.`, async () => {
      const remaining = cfg.studyColumns.filter((c) => c !== col);
      const fallback = remaining[0];
      for (const c of cards.filter((c) => c.status === col)) await this.ctx.store.updateStudyCardStatus(c, fallback);
      cfg.studyColumns = remaining;
      delete cfg.studyColumnNames[col];
      await this.ctx.store.saveConfig(cfg);
      this.ctx.refresh();
    }).open();
  }
}
