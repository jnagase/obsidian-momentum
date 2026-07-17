import { ItemView, WorkspaceLeaf } from "obsidian";
import { PADataStore } from "./data";
import { AIConfig, ChatMessage, aiChat } from "./ai";
import { AIAction, parseActions, runAIActions, describeAction } from "./aiactions";
import { todayLocal } from "./util";

export const VIEW_TYPE_MOMENTUM_AI = "momentum-ai-view";

/** Provided by the plugin so the AI panel can read settings + vault data. */
export interface AIHost {
  getAIConfig(): AIConfig;
  store: PADataStore;
}

const SYSTEM_PROMPT =
  "You are the assistant inside Momentum Life, an Obsidian life dashboard for habits, tasks, fitness, " +
  "nutrition, studies and personal finances. Use the CONTEXT block (a snapshot of the user's own data) to " +
  "give concise, practical answers and suggestions.\n\n" +
  "When the user asks you to CHANGE their data (create/complete/delete a task, add a transaction or a " +
  "recurring cost), reply with a short sentence of what you'll do, then a single fenced code block ```json " +
  'containing {"actions":[ ... ]}. The app shows the user a confirmation before anything is applied — never ' +
  "assume it already happened. For plain questions, answer in prose with NO json block.\n\n" +
  "Supported actions (use exact field names, and only values that exist in CONTEXT):\n" +
  '  {"action":"create_task","title":"...","board":"<board or empty>","status":"<column>","priority":"low|medium|high","due":"YYYY-MM-DD"}\n' +
  '  {"action":"set_task_status","title":"<existing task title>","board":"<optional>","status":"<column>"}\n' +
  '  {"action":"delete_task","title":"<existing task title>","board":"<optional>"}\n' +
  '  {"action":"add_transaction","type":"expense|income","amount":123.45,"category":"<category>","note":"...","date":"YYYY-MM-DD"}\n' +
  '  {"action":"add_recurring","type":"expense|income","amount":123.45,"category":"<category>","note":"...","freq":"monthly|weekly","day":1,"weekday":0}\n' +
  "Never invent data that is not in the context.";

/** Right-sidebar chat panel that talks to Gemini about the user's Momentum data. */
export class MomentumAIView extends ItemView {
  private host: AIHost;
  private messages: ChatMessage[] = [];
  private busy = false;
  private pending: AIAction[] | null = null;
  private listEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;

  constructor(leaf: WorkspaceLeaf, host: AIHost) {
    super(leaf);
    this.host = host;
  }

  getViewType(): string { return VIEW_TYPE_MOMENTUM_AI; }
  getDisplayText(): string { return "Momentum AI"; }
  getIcon(): string { return "bot"; }

  async onOpen(): Promise<void> { this.render(); }
  async onClose(): Promise<void> {}

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("pa-root", "pa-ai-root");

    const header = root.createDiv({ cls: "pa-ai-header" });
    header.createDiv({ text: "🤖 Momentum AI", cls: "pa-ai-title" });
    const clear = header.createEl("button", { text: "Clear", cls: "pa-mini-btn" });
    clear.onclick = () => { this.messages = []; this.pending = null; this.render(); };

    this.listEl = root.createDiv({ cls: "pa-ai-messages" });
    if (!this.messages.length) {
      this.listEl.createDiv({ cls: "pa-muted pa-ai-empty", text: "Ask me about your habits, tasks, fitness, nutrition or finances. I read a snapshot of your Momentum data." });
    } else {
      this.messages.forEach((m) => this.renderMessage(m));
    }

    if (this.pending?.length) this.renderPending(root);

    const inputRow = root.createDiv({ cls: "pa-ai-input-row" });
    this.inputEl = inputRow.createEl("textarea", { cls: "pa-ai-input" });
    this.inputEl.placeholder = "Ask about your data…";
    this.inputEl.rows = 2;
    this.inputEl.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void this.send(); }
    };
    const sendBtn = inputRow.createEl("button", { text: this.busy ? "…" : "Send", cls: "pa-btn pa-ai-send" });
    sendBtn.disabled = this.busy;
    sendBtn.onclick = () => { void this.send(); };
  }

  private renderMessage(m: ChatMessage): void {
    if (!this.listEl) return;
    const msg = this.listEl.createDiv({ cls: "pa-ai-msg pa-ai-" + m.role });
    msg.createDiv({ text: m.role === "user" ? "You" : "Momentum AI", cls: "pa-ai-msg-role" });
    msg.createDiv({ text: m.text, cls: "pa-ai-msg-body" });
  }

  private renderPending(root: HTMLElement): void {
    if (!this.pending) return;
    const box = root.createDiv({ cls: "pa-ai-actions" });
    box.createDiv({ cls: "pa-ai-actions-title", text: "Proposed changes" });
    this.pending.forEach((a) => box.createDiv({ cls: "pa-ai-action", text: describeAction(a) }));
    const row = box.createDiv({ cls: "pa-ai-actions-row" });
    const apply = row.createEl("button", { text: this.busy ? "…" : "Apply", cls: "pa-btn" });
    apply.disabled = this.busy;
    apply.onclick = () => { void this.applyPending(); };
    const cancel = row.createEl("button", { text: "Cancel", cls: "pa-mini-btn" });
    cancel.onclick = () => { this.pending = null; this.render(); };
  }

  private async applyPending(): Promise<void> {
    if (this.busy || !this.pending?.length) return;
    this.busy = true;
    this.render();
    try {
      const results = await runAIActions(this.host.store, this.pending);
      this.messages.push({ role: "assistant", text: results.join("\n") });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      this.messages.push({ role: "assistant", text: `Error applying changes: ${err}` });
    } finally {
      this.pending = null;
      this.busy = false;
      this.render();
      if (this.listEl) this.listEl.scrollTop = this.listEl.scrollHeight;
    }
  }

  private async send(): Promise<void> {
    if (this.busy) return;
    const text = (this.inputEl?.value || "").trim();
    if (!text) return;
    const cfg = this.host.getAIConfig();
    if (!cfg.apiKey) {
      this.messages.push({ role: "assistant", text: "No API key set. Add your provider and key in Settings → Momentum Life → AI assistant." });
      this.render();
      return;
    }

    this.messages.push({ role: "user", text });
    this.busy = true;
    this.render();
    if (this.listEl) this.listEl.scrollTop = this.listEl.scrollHeight;

    try {
      const context = await this.buildContext();
      const system = `${SYSTEM_PROMPT}\n\nCONTEXT:\n${context}`;
      const reply = await aiChat(cfg, system, this.messages);
      const { text: replyText, actions } = parseActions(reply);
      this.messages.push({ role: "assistant", text: replyText || (actions ? "Here's what I can do:" : reply) });
      this.pending = actions;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      this.messages.push({ role: "assistant", text: `Error: ${err}` });
    } finally {
      this.busy = false;
      this.render();
      if (this.listEl) this.listEl.scrollTop = this.listEl.scrollHeight;
    }
  }

  /** Build a compact snapshot of the user's Momentum data to ground the model. */
  private async buildContext(): Promise<string> {
    const store = this.host.store;
    const today = todayLocal();
    const month = today.slice(0, 7);
    const cfg = await store.loadConfig();

    const tasks = store.loadTasks();
    const open = tasks.filter((t) => t.status !== "done");
    const habits = store.loadHabits();
    const workouts = store.loadWorkouts();
    const logs = store.loadMealLogs();
    const txs = store.loadTransactions();

    const calToday = logs.filter((l) => l.date === today).reduce((a, l) => a + l.totalCal, 0);
    const income = txs.filter((t) => t.type === "income" && t.date.startsWith(month)).reduce((a, t) => a + t.amount, 0);
    const expense = txs.filter((t) => t.type === "expense" && t.date.startsWith(month)).reduce((a, t) => a + t.amount, 0);
    const cur = cfg.currency || "$";

    const lines: string[] = [`Today: ${today}`];
    lines.push(`Open tasks: ${open.length}`);
    open.slice(0, 25).forEach((t) => lines.push(`  - ${t.title} [${t.kanbanName || "No board"} / ${t.status}]`));
    if (habits.length) lines.push(`Habits tracked: ${habits.map((h) => h.name).join(", ")}`);
    lines.push(`Workouts logged: ${workouts.length}${workouts.length ? ` (last ${workouts[workouts.length - 1].date})` : ""}`);
    lines.push(`Calories today: ${calToday} / target ${cfg.calorieTarget}`);
    lines.push(`Finance this month: income ${cur}${income.toFixed(2)}, expenses ${cur}${expense.toFixed(2)}, balance ${cur}${(income - expense).toFixed(2)}`);

    const boards = store.loadBoards().map((b) => b.name);
    lines.push(`Task boards: ${boards.length ? boards.join(", ") : "(none)"}`);
    lines.push(`Task columns (valid status values): ${cfg.taskColumns.join(", ")}`);
    lines.push(`Expense categories: ${cfg.expenseCategories.join(", ")}`);
    lines.push(`Income categories: ${cfg.incomeCategories.join(", ")}`);
    return lines.join("\n");
  }
}
