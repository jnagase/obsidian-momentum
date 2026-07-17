import { PADataStore } from "./data";
import { RecurringItem } from "./types";

/** A single action proposed by the AI (parsed from a fenced ```json block). */
export interface AIAction {
  action: string;
  [key: string]: unknown;
}

/** Extract a JSON actions block from an assistant reply, if present. */
export function parseActions(reply: string): { text: string; actions: AIAction[] | null } {
  const m = reply.match(/```json\s*([\s\S]*?)```/i);
  if (!m) return { text: reply, actions: null };
  try {
    const parsed = JSON.parse(m[1].trim()) as unknown;
    const arr = Array.isArray(parsed) ? parsed : (parsed as { actions?: unknown }).actions;
    if (Array.isArray(arr) && arr.length) {
      return { text: reply.replace(m[0], "").trim(), actions: arr as AIAction[] };
    }
  } catch { /* not valid JSON — treat as plain text */ }
  return { text: reply, actions: null };
}

const s = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
};
const n = (v: unknown): number => (typeof v === "number" ? v : parseFloat(typeof v === "string" ? v : "") || 0);

/** Human-readable one-liner for a proposed action (for the confirmation list). */
export function describeAction(a: AIAction): string {
  switch (a.action) {
    case "create_task": return `Create task “${s(a.title)}”${a.board ? ` in ${s(a.board)}` : ""}${a.status ? ` (${s(a.status)})` : ""}`;
    case "set_task_status": return `Set task “${s(a.title)}” → ${s(a.status)}`;
    case "delete_task": return `Delete task “${s(a.title)}”`;
    case "add_transaction": return `Add ${s(a.type) || "expense"} ${n(a.amount)} · ${s(a.category) || "Other"}${a.note ? ` (${s(a.note)})` : ""}${a.date ? ` on ${s(a.date)}` : ""}`;
    case "add_recurring": return `Add recurring ${s(a.type) || "expense"} ${n(a.amount)} · ${s(a.category) || "Other"} (${s(a.freq) || "monthly"})`;
    default: return `Unknown action: ${s(a.action)}`;
  }
}

/** Execute confirmed actions against the vault; returns a per-action result summary. */
export async function runAIActions(store: PADataStore, actions: AIAction[]): Promise<string[]> {
  const out: string[] = [];
  for (const a of actions) {
    try {
      switch (a.action) {
        case "create_task": {
          const title = s(a.title).trim();
          if (!title) { out.push("Skipped a task with no title"); break; }
          await store.createTask({
            title,
            status: a.status ? s(a.status) : undefined,
            priority: a.priority ? s(a.priority) : undefined,
            kanbanName: a.board ? s(a.board) : "",
            group: a.group ? s(a.group) : "",
            due: a.due ? s(a.due) : undefined,
          });
          out.push(`✓ Created task “${title}”`);
          break;
        }
        case "set_task_status": {
          const title = s(a.title).trim();
          const status = s(a.status).trim();
          const board = a.board ? s(a.board) : undefined;
          const t = store.loadTasks().find((x) => x.title === title && (!board || (x.kanbanName || "") === board));
          if (!t) { out.push(`✗ Task not found: “${title}”`); break; }
          await store.updateTask(t, { status });
          out.push(`✓ “${title}” → ${status}`);
          break;
        }
        case "delete_task": {
          const title = s(a.title).trim();
          const board = a.board ? s(a.board) : undefined;
          const t = store.loadTasks().find((x) => x.title === title && (!board || (x.kanbanName || "") === board));
          if (!t) { out.push(`✗ Task not found: “${title}”`); break; }
          await store.deleteTask(t);
          out.push(`✓ Deleted task “${title}”`);
          break;
        }
        case "add_transaction": {
          const type = a.type === "income" ? "income" : "expense";
          const amount = n(a.amount);
          if (amount <= 0) { out.push("✗ Transaction amount must be greater than zero"); break; }
          await store.addTransaction(
            { type, amount, category: s(a.category) || "Other", note: a.note ? s(a.note) : "" },
            a.date ? s(a.date) : undefined
          );
          out.push(`✓ Added ${type} ${amount} (${s(a.category) || "Other"})`);
          break;
        }
        case "add_recurring": {
          const type = a.type === "income" ? "income" : "expense";
          const amount = n(a.amount);
          if (amount <= 0) { out.push("✗ Recurring amount must be greater than zero"); break; }
          const item: RecurringItem = {
            id: "r" + Date.now() + Math.floor(Math.random() * 1000),
            type,
            amount,
            category: s(a.category) || "Other",
            note: a.note ? s(a.note) : "",
            freq: a.freq === "weekly" ? "weekly" : "monthly",
            day: a.day != null ? n(a.day) : undefined,
            weekday: a.weekday != null ? n(a.weekday) : undefined,
          };
          await store.saveRecurring([...store.loadRecurring(), item]);
          out.push(`✓ Added recurring ${type} ${amount} (${item.category}, ${item.freq})`);
          break;
        }
        default:
          out.push(`✗ Unknown action: ${s(a.action)}`);
      }
    } catch (e) {
      out.push(`✗ Error on ${s(a.action)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
