import { App, Modal, Notice, TFile } from "obsidian";
import { PAContext } from "../context";
import { ConfirmModal } from "../ui";
import {
  BUILTIN_TEMPLATES, JournalTemplate, JournalEntry, renderTemplateBody, findTemplate,
  CHECKIN_QUESTIONS, checkinOption,
} from "../journal";
import { todayLocal } from "../util";

/**
 * Journaling page (MVP+). A dashboard, not a custom editor: starting an entry asks a quick
 * check-in (mood/energy/connection/stress → frontmatter + tags), scaffolds the template, and
 * opens it as a normal Obsidian note. A month calendar (tinted by mood) lets you journal today
 * or back-fill a past day; the history table shows each day's check-in as colour chips.
 */
export class JournalModule {
  private ctx: PAContext;
  private calYear: number;
  private calMonth: number;      // 0-11
  private selectedDate: string;  // YYYY-MM-DD

  constructor(ctx: PAContext) {
    this.ctx = ctx;
    const now = new Date();
    this.calYear = now.getFullYear();
    this.calMonth = now.getMonth();
    this.selectedDate = todayLocal();
  }

  render(root: HTMLElement): void {
    const today = todayLocal();
    const entries = this.ctx.store.loadJournalEntries();
    const entryDates = this.ctx.store.journalEntryDates();
    // date → mood colour, for tinting the calendar.
    const moodByDate = new Map<string, string>();
    for (const e of entries) {
      const opt = checkinOption("mood", e.checkin.mood ?? "");
      if (opt) moodByDate.set(e.date, opt.color);
    }

    root.createEl("h2", { text: "📓 Journal", cls: "pa-h1" });
    root.createEl("p", {
      cls: "pa-muted",
      text: "A daily journal guided by templates. Entries are plain notes in your vault — write, add images and format them like any other note.",
    });

    this.renderSelectedDay(root, today);
    this.renderCalendar(root, entryDates, moodByDate, today);
    this.renderHistoryTable(root, entries);
  }

  // ---- Selected day: open + template picker (always available) --------------------------
  private renderSelectedDay(root: HTMLElement, today: string): void {
    const date = this.selectedDate;
    const file = this.ctx.store.getJournalEntryFile(date);
    const panel = root.createDiv({ cls: "pa-panel" });
    panel.createDiv({ cls: "pa-panel-title", text: date === today ? "Today" : this.prettyDate(date) });

    if (file) {
      const fm = this.ctx.store.frontmatter(file);
      const tmpl = findTemplate(typeof fm.template === "string" ? fm.template : "");
      const row = panel.createDiv({ cls: "pa-journal-today" });
      row.createSpan({ cls: "pa-muted", text: tmpl ? `Entry started — ${tmpl.emoji} ${tmpl.name}.` : "Entry started." });
      const open = row.createEl("button", { cls: "pa-btn", text: "Open entry" });
      open.onclick = () => this.openFile(file);
      panel.createDiv({ cls: "pa-muted pa-journal-hint", text: "Start another entry for this day:" });
    } else {
      panel.createDiv({ cls: "pa-muted pa-journal-hint", text: `Start ${date === today ? "today" : "this day"} with a template:` });
    }

    const grid = panel.createDiv({ cls: "pa-journal-templates" });
    for (const t of BUILTIN_TEMPLATES) {
      const card = grid.createDiv({ cls: "pa-journal-tmpl" });
      card.setAttr("role", "button");
      card.setAttr("tabindex", "0");
      card.createSpan({ cls: "pa-journal-tmpl-emoji", text: t.emoji });
      card.createDiv({ cls: "pa-journal-tmpl-name", text: t.name });
      card.createDiv({ cls: "pa-journal-tmpl-desc", text: t.description });
      const go = () => void this.chooseTemplate(date, t);
      card.onclick = go;
      card.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
    }
  }

  /**
   * Apply a template to the selected day. Always creates a NEW entry: it asks the quick
   * check-in, scaffolds the template, and opens the note. A day can hold many entries —
   * the second and later ones get a numbered filename, so an existing entry is never
   * overwritten and nothing the user wrote is lost.
   */
  private chooseTemplate(date: string, template: JournalTemplate): void {
    new JournalCheckinModal(this.ctx.app, async (answers) => {
      try {
        const file = await this.ctx.store.createJournalEntry(date, template.id, renderTemplateBody(template, date), answers);
        this.openFile(file);
        this.ctx.refresh();
      } catch (e) { new Notice(`Couldn't start the entry: ${e instanceof Error ? e.message : String(e)}`); }
    }).open();
  }

  // ---- Month calendar (tinted by mood) --------------------------------------------------
  private renderCalendar(root: HTMLElement, entryDates: Set<string>, moodByDate: Map<string, string>, today: string): void {
    const card = root.createDiv({ cls: "pa-panel" });
    const head = card.createDiv({ cls: "pa-cal-head" });
    head.createSpan({
      cls: "pa-cal-title",
      text: new Date(this.calYear, this.calMonth, 1).toLocaleString("default", { month: "long", year: "numeric" }),
    });
    const nav = head.createDiv({ cls: "pa-journal-cal-nav" });
    const prev = nav.createEl("button", { text: "←", cls: "pa-icon-btn" });
    const todayBtn = nav.createEl("button", { text: "Today", cls: "pa-icon-btn" });
    const next = nav.createEl("button", { text: "→", cls: "pa-icon-btn" });
    prev.onclick = () => { this.calMonth--; if (this.calMonth < 0) { this.calMonth = 11; this.calYear--; } this.ctx.refresh(); };
    next.onclick = () => { this.calMonth++; if (this.calMonth > 11) { this.calMonth = 0; this.calYear++; } this.ctx.refresh(); };
    todayBtn.onclick = () => {
      const now = new Date();
      this.calYear = now.getFullYear(); this.calMonth = now.getMonth(); this.selectedDate = todayLocal();
      this.ctx.refresh();
    };

    const dow = card.createDiv({ cls: "pa-cal-dow-row" });
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d) => dow.createDiv({ text: d, cls: "pa-cal-dow" }));

    const days = card.createDiv({ cls: "pa-cal-grid pa-cal-days" });
    const firstDow = new Date(this.calYear, this.calMonth, 1).getDay();
    const daysInMonth = new Date(this.calYear, this.calMonth + 1, 0).getDate();
    for (let i = 0; i < firstDow; i++) days.createDiv({ cls: "pa-cal-cell empty" });
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${this.calYear}-${String(this.calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const cell = days.createDiv({ cls: "pa-cal-cell" });
      cell.createDiv({ text: String(day), cls: "pa-cal-day" });
      const mood = moodByDate.get(ds);
      if (mood) cell.setCssStyles({ backgroundColor: mood, color: "#fff" }); // tint by mood
      else if (entryDates.has(ds)) cell.createDiv({ cls: "pa-cal-dot" });     // entry without a mood
      if (ds > today) {
        cell.addClass("pa-cal-future");
      } else {
        cell.addClass("pa-clickable");
        cell.onclick = () => { this.selectedDate = ds; this.ctx.refresh(); };
      }
      if (ds === today) cell.addClass("today");
      if (ds === this.selectedDate) cell.addClass("selected");
    }
  }

  // ---- History table (check-in colour chips per day) ------------------------------------
  private renderHistoryTable(root: HTMLElement, entries: JournalEntry[]): void {
    const panel = root.createDiv({ cls: "pa-panel" });
    panel.createDiv({ cls: "pa-panel-title", text: "Recent entries" });
    if (entries.length === 0) {
      panel.createDiv({ cls: "pa-muted", text: "No entries yet — pick a day and a template above." });
      return;
    }

    const table = panel.createDiv({ cls: "pa-journal-table" });
    const head = table.createDiv({ cls: "pa-journal-trow pa-journal-thead" });
    head.createSpan({ cls: "pa-journal-tc-date", text: "Date" });
    for (const q of CHECKIN_QUESTIONS) head.createSpan({ cls: "pa-journal-tc", text: q.name });
    head.createSpan({ cls: "pa-journal-tc pa-journal-tc-tmpl", text: "Template" });
    head.createSpan({ cls: "pa-journal-tc pa-journal-tc-act" });

    for (const e of entries.slice(0, 14)) {
      const row = table.createDiv({ cls: "pa-journal-trow" });
      const link = row.createEl("a", { cls: "pa-journal-tc-date", text: e.date, href: "#" });
      link.onclick = (ev) => {
        ev.preventDefault();
        const f = this.ctx.app.vault.getAbstractFileByPath(e.path);
        if (f instanceof TFile) this.openFile(f);
      };
      for (const q of CHECKIN_QUESTIONS) {
        const cell = row.createSpan({ cls: "pa-journal-tc" });
        const opt = checkinOption(q.key, e.checkin[q.key] ?? "");
        if (opt) {
          const chip = cell.createSpan({ cls: "pa-journal-chip", text: opt.emoji });
          chip.setCssStyles({ backgroundColor: opt.color });
          chip.setAttr("title", `${q.name}: ${opt.label}`);
        } else {
          cell.createSpan({ cls: "pa-muted", text: "–" });
        }
      }
      // Imported entries have no template → show them as Free writing (their actual nature).
      const tmpl = findTemplate(e.template) ?? findTemplate("free");
      const tc = row.createSpan({ cls: "pa-journal-tc pa-journal-tc-tmpl" });
      if (tmpl) tc.setText(`${tmpl.emoji} ${tmpl.name}`);
      else tc.createSpan({ cls: "pa-muted", text: "–" });

      const act = row.createSpan({ cls: "pa-journal-tc pa-journal-tc-act" });
      const del = act.createEl("button", { text: "🗑", cls: "pa-icon-btn" });
      del.setAttr("aria-label", `Delete journal entry for ${e.date}`);
      del.onclick = (ev) => {
        ev.stopPropagation();
        new ConfirmModal(this.ctx.app, `Delete the journal entry for ${e.date}? It's moved to your system trash.`, async () => {
          await this.ctx.store.deleteJournalEntry(e.path);
          this.ctx.refresh();
        }).open();
      };
    }
  }

  // ---- helpers --------------------------------------------------------------------------
  private openFile(file: TFile): void {
    void this.ctx.app.workspace.getLeaf(false).openFile(file);
  }

  private prettyDate(ds: string): string {
    const d = new Date(ds + "T00:00:00");
    return d.toLocaleDateString("default", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
}

/**
 * Quick check-in modal shown before a new entry. One row of options per question; the chosen
 * values are returned to the caller (which stores them as frontmatter + tags). "Skip" returns
 * whatever was picked so far (possibly nothing) — the check-in is always optional.
 */
class JournalCheckinModal extends Modal {
  private answers: Record<string, string> = {};
  private onSubmit: (answers: Record<string, string>) => void | Promise<void>;

  constructor(app: App, onSubmit: (answers: Record<string, string>) => void | Promise<void>) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("pa-checkin-modal");
    contentEl.createEl("h3", { text: "Quick check-in" });
    contentEl.createEl("p", { cls: "pa-muted", text: "How are you today? (Optional — tap what fits)" });

    for (const q of CHECKIN_QUESTIONS) {
      const block = contentEl.createDiv({ cls: "pa-checkin-q" });
      block.createDiv({ cls: "pa-checkin-q-name", text: q.name });
      const opts = block.createDiv({ cls: "pa-checkin-opts" });
      for (const o of q.options) {
        const btn = opts.createDiv({ cls: "pa-checkin-opt" });
        btn.setAttr("role", "button");
        btn.setAttr("tabindex", "0");
        btn.createDiv({ cls: "pa-checkin-opt-emoji", text: o.emoji });
        btn.createDiv({ cls: "pa-checkin-opt-label", text: o.label });
        const pick = () => {
          this.answers[q.key] = o.value;
          opts.findAll(".pa-checkin-opt").forEach((el) => el.removeClass("selected"));
          btn.addClass("selected");
          btn.setCssStyles({ borderColor: o.color });
        };
        btn.onclick = pick;
        btn.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } };
      }
    }

    const actions = contentEl.createDiv({ cls: "pa-checkin-actions" });
    const skip = actions.createEl("button", { text: "Skip" });
    skip.onclick = () => { this.close(); void this.onSubmit({}); };
    const start = actions.createEl("button", { cls: "mod-cta", text: "Start writing" });
    start.onclick = () => { this.close(); void this.onSubmit(this.answers); };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
