#!/usr/bin/env node
// Momentum Life MCP server — exposes every module of the Obsidian vault
// (Tasks/Boards, Finance, Nutrition, Fitness, Studies, Habits, Notes, Config)
// as MCP tools over stdio. Reads/writes the same .md files as the plugin.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MomentumStore } from "./store.mjs";

// ---- args / env ----
function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const VAULT = arg("--vault") || process.env.MOMENTUM_VAULT;
const DATA_ROOT = arg("--data-root") || process.env.MOMENTUM_DATA_ROOT || "Momentum Life";
if (!VAULT) {
  process.stderr.write("momentum-mcp: missing --vault <path> (or MOMENTUM_VAULT env).\n");
  process.exit(1);
}
const store = new MomentumStore(VAULT, DATA_ROOT);

// ---- schema helpers ----
const S = {
  str: (description) => ({ type: "string", description }),
  num: (description) => ({ type: "number", description }),
  obj: (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false }),
  arr: (items, description) => ({ type: "array", items, description }),
};
const NONE = S.obj({});

// ---- tool definitions: name -> { description, inputSchema, handler } ----
const tools = {
  // ---------- Config ----------
  get_config: { description: "Get the vault configuration (currency, targets, task/study columns, categories, splits).", inputSchema: NONE, handler: () => store.loadConfig() },
  update_config: {
    description: "Update config fields (only the provided ones): currency, calorieTarget, proteinTarget, carbsTarget, waterTarget, monthlyBudget.",
    inputSchema: S.obj({ currency: S.str(), calorieTarget: S.num(), proteinTarget: S.num(), carbsTarget: S.num(), waterTarget: S.num(), monthlyBudget: S.num() }),
    handler: async (a) => { const cfg = await store.loadConfig(); for (const k of ["currency","calorieTarget","proteinTarget","carbsTarget","waterTarget","monthlyBudget"]) if (a[k] !== undefined) cfg[k] = a[k]; await store.saveConfig(cfg); return { ok: true }; },
  },

  // ---------- Boards ----------
  list_boards: { description: "List the task boards.", inputSchema: NONE, handler: () => store.loadBoards() },
  create_board: { description: "Create a task board (a folder under Tasks/).", inputSchema: S.obj({ name: S.str("Board name"), emoji: S.str("Optional emoji (ignored — boards are folders)") }, ["name"]), handler: async (a) => { const ok = await store.createBoard(a.name); return { ok }; } },

  // ---------- Tasks ----------
  list_tasks: { description: "List tasks, optionally filtered by board and/or status/column.", inputSchema: S.obj({ board: S.str("Board name filter"), status: S.str("Column/status filter") }), handler: async (a) => { let t = await store.loadTasks(); if (a.board) t = t.filter((x) => x.kanbanName === a.board); if (a.status) t = t.filter((x) => x.status === a.status); return t.map(({ path, ...rest }) => ({ ...rest })); } },
  create_task: { description: "Create a task. If 'board' isn't a registered board it is created automatically. Invalid 'status' falls back to the first column.", inputSchema: S.obj({ title: S.str(), board: S.str(), status: S.str("Column key, e.g. backlog / in progress / done"), priority: S.str("low | medium | high"), group: S.str("Group/tag label"), due: S.str("YYYY-MM-DD"), eisenhower: S.str("q1..q4") }, ["title"]), handler: (a) => store.createTask(a) },
  update_task: { description: "Update a task by id, path, or exact title.", inputSchema: S.obj({ id: S.str("Task id, path, or exact title"), title: S.str(), status: S.str(), priority: S.str(), board: S.str(), group: S.str(), due: S.str(), eisenhower: S.str() }, ["id"]), handler: (a) => { const { id, ...changes } = a; return store.updateTask(id, changes); } },
  complete_task: { description: "Mark a task done.", inputSchema: S.obj({ id: S.str("Task id, path, or exact title") }, ["id"]), handler: (a) => store.completeTask(a.id) },
  delete_task: { description: "Delete a task.", inputSchema: S.obj({ id: S.str("Task id, path, or exact title") }, ["id"]), handler: (a) => store.deleteTask(a.id) },
  list_recurring_tasks: { description: "List recurring task templates.", inputSchema: NONE, handler: () => store.loadRecurringTasks() },

  // ---------- Finance ----------
  list_transactions: { description: "List finance transactions, optionally by month (YYYY-MM) and/or type (income|expense).", inputSchema: S.obj({ month: S.str("YYYY-MM"), type: S.str("income | expense") }), handler: async (a) => { let t = await store.loadTransactions(); if (a.month) t = t.filter((x) => x.date.startsWith(a.month)); if (a.type) t = t.filter((x) => x.type === a.type); return t.map(({ path, ...rest }) => rest); } },
  add_transaction: { description: "Add a finance transaction (creates a readable note + updates the month hub).", inputSchema: S.obj({ type: S.str("income | expense"), amount: S.num(), category: S.str(), note: S.str(), date: S.str("YYYY-MM-DD (defaults today)") }, ["type", "amount", "category"]), handler: (a) => store.addTransaction(a) },
  delete_transaction: { description: "Delete a transaction by id or path.", inputSchema: S.obj({ id: S.str() }, ["id"]), handler: (a) => store.deleteTransaction(a.id) },
  finance_month_summary: { description: "Income/expenses/balance for a month (YYYY-MM).", inputSchema: S.obj({ month: S.str("YYYY-MM") }, ["month"]), handler: (a) => store.monthSummary(a.month) },
  list_recurring_costs: { description: "List recurring finance items.", inputSchema: NONE, handler: () => store.loadRecurring() },
  add_recurring_cost: { description: "Add a recurring finance item.", inputSchema: S.obj({ type: S.str("income | expense"), amount: S.num(), category: S.str(), note: S.str(), freq: S.str("monthly | weekly"), day: S.num("Day of month 1-28 (monthly)"), weekday: S.num("0=Sun..6=Sat (weekly)") }, ["type", "amount", "category"]), handler: (a) => store.addRecurring(a) },

  // ---------- Nutrition ----------
  list_meals: { description: "List meal-plan definitions.", inputSchema: NONE, handler: async () => (await store.loadMeals()).map(({ path, ...r }) => r) },
  list_meal_logs: { description: "List meal logs, optionally by month (YYYY-MM).", inputSchema: S.obj({ month: S.str("YYYY-MM") }), handler: async (a) => { let l = await store.loadMealLogs(); if (a.month) l = l.filter((x) => x.date.startsWith(a.month)); return l.map(({ path, ...r }) => r); } },
  log_meal: { description: "Log a meal (creates a readable log + updates the Nutrition month hub). items: [{name, qty, unit, cal, protein, carbs}].", inputSchema: S.obj({ mealName: S.str(), date: S.str("YYYY-MM-DD"), items: S.arr(S.obj({ name: S.str(), qty: S.num(), unit: S.str(), cal: S.num(), protein: S.num(), carbs: S.num() }, ["name"])) }, ["mealName"]), handler: (a) => store.logMeal(a) },
  delete_meal_log: { description: "Delete a meal log by id or path.", inputSchema: S.obj({ id: S.str() }, ["id"]), handler: (a) => store.deleteMealLog(a.id) },
  get_water: { description: "Get the water log (date -> liters).", inputSchema: NONE, handler: () => store.loadWater() },
  add_water: { description: "Add (or subtract) liters of water for a date.", inputSchema: S.obj({ date: S.str("YYYY-MM-DD (defaults today)"), liters: S.num("Delta in liters (can be negative)") }, ["liters"]), handler: (a) => store.addWater(a.date, a.liters) },

  // ---------- Fitness ----------
  list_splits: { description: "List workout splits.", inputSchema: NONE, handler: () => store.loadSplits() },
  list_exercises: { description: "List exercises.", inputSchema: NONE, handler: async () => (await store.loadExercises()).map(({ path, ...r }) => r) },
  list_workouts: { description: "List logged workouts, optionally by month (YYYY-MM).", inputSchema: S.obj({ month: S.str("YYYY-MM") }), handler: async (a) => { let w = await store.loadWorkouts(); if (a.month) w = w.filter((x) => x.date.startsWith(a.month)); return w.map(({ path, ...r }) => r); } },
  log_workout: { description: "Log a workout (creates a readable session + updates the Fitness month hub). exercises: [{exercise, weight, sets, feel}].", inputSchema: S.obj({ split: S.str("Split id or name"), duration: S.num("Minutes"), date: S.str("YYYY-MM-DD"), exercises: S.arr(S.obj({ exercise: S.str(), weight: S.num(), sets: S.str(), feel: S.str() }, ["exercise"])) }, ["split", "duration"]), handler: (a) => store.logWorkout(a) },
  delete_workout: { description: "Delete a workout by id or path.", inputSchema: S.obj({ id: S.str() }, ["id"]), handler: (a) => store.deleteWorkout(a.id) },

  // ---------- Habits ----------
  list_habits: { description: "List habits with their logs.", inputSchema: NONE, handler: async () => (await store.loadHabits()).map(({ path, ...r }) => r) },
  create_habit: { description: "Create a habit.", inputSchema: S.obj({ name: S.str(), emoji: S.str(), habitType: S.str("do | quit") }, ["name"]), handler: (a) => store.saveHabit(a) },
  toggle_habit: { description: "Toggle a habit's completion for a date (defaults today).", inputSchema: S.obj({ habit: S.str("Habit name or id"), date: S.str("YYYY-MM-DD") }, ["habit"]), handler: (a) => store.toggleHabit(a.habit, a.date) },

  // ---------- Studies ----------
  list_study_cards: { description: "List study cards, optionally by topic and/or status.", inputSchema: S.obj({ topic: S.str(), status: S.str() }), handler: async (a) => { let c = await store.loadStudyCards(); if (a.topic) c = c.filter((x) => x.topic === a.topic); if (a.status) c = c.filter((x) => x.status === a.status); return c.map(({ path, ...r }) => r); } },
  create_study_card: { description: "Create a study card under a topic.", inputSchema: S.obj({ title: S.str(), topic: S.str(), subtopic: S.str(), status: S.str(), url: S.str() }, ["title", "topic"]), handler: (a) => store.createStudyCard(a) },

  // ---------- Notes ----------
  list_notes: { description: "List quick notes.", inputSchema: NONE, handler: async () => (await store.loadNotes()).map(({ path, ...r }) => r) },
  create_note: { description: "Create a quick note.", inputSchema: S.obj({ title: S.str(), content: S.str(), color: S.str("yellow|green|blue|pink|purple|orange|white"), board: S.str() }, ["title"]), handler: (a) => store.saveNote(a) },
};

// ---- MCP wiring ----
const server = new Server({ name: "momentum-life", version: "0.3.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const t = tools[req.params.name];
  if (!t) return { isError: true, content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }] };
  try {
    const result = await t.handler(req.params.arguments || {});
    return { content: [{ type: "text", text: JSON.stringify(result ?? { ok: true }, null, 2) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`momentum-mcp: connected. vault="${VAULT}" dataRoot="${DATA_ROOT}"\n`);
