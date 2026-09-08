/**
 * Generates a self-contained Obsidian vault full of FICTITIOUS Momentum Life data, for
 * documentation screenshots.
 *
 * Why this exists: the README/community-page screenshots must not contain real personal
 * data (client names, salaries, personal habits). Rather than retouching images, this
 * rebuilds an equivalent vault from scratch with invented-but-coherent data, so every
 * release can be re-shot identically.
 *
 * Frontmatter is emitted exactly the way `PADataStore.buildDoc` does (strings and objects
 * via JSON.stringify, numbers/booleans raw), so Obsidian's metadata cache parses these
 * notes the same as plugin-written ones. Uses `node:fs` only — no shell execution.
 *
 * Usage:  node tools/make-demo-vault.mjs [targetVaultDir]
 * Default target: ~/Documents/momentum-demo
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const VAULT = process.argv[2] || join(homedir(), "Documents", "momentum-demo");
const ROOT = join(VAULT, "Momentum Life");
const REPO = join(dirname(new URL(import.meta.url).pathname), "..");

/** "Today" for the generated data. Kept in one place so every module lines up. */
const TODAY = "2026-09-06";

// ---------------------------------------------------------------- helpers

/** Serialize frontmatter the same way PADataStore.buildDoc does. */
function doc(meta, body) {
  const lines = ["---"];
  for (const k of Object.keys(meta)) {
    const v = meta[k];
    if (v == null) continue;
    if (typeof v === "number" || typeof v === "boolean") lines.push(`${k}: ${String(v)}`);
    else lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push("---", "", body || "");
  return lines.join("\n");
}

function write(relPath, contents) {
  const full = join(ROOT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents, "utf8");
}

/** Filesystem-safe note name (mirrors the plugin's safeName). */
function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim();
}

/** Shift a YYYY-MM-DD date by `days`. */
function shift(ds, days) {
  const d = new Date(ds + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const iso = (ds) => `${ds}T09:00:00.000Z`;

let seq = 1700000000000;
const nextId = () => String(seq++);

// ---------------------------------------------------------------- config

write("Config/settings.md", doc({
  type: "config",
  calorie_target: 2200,
  protein_target: 140,
  carbs_target: 240,
  water_target: 2.5,
  task_columns: ["backlog", "in progress", "done"],
  task_column_names: { backlog: "📌 BACKLOG", "in progress": "🔄 IN PROGRESS", done: "✅ DONE", "on-hold": "On-hold" },
  study_columns: ["backlog", "in progress", "done"],
  study_column_names: { backlog: "📌 BACKLOG", "in progress": "🔄 IN PROGRESS", done: "✅ DONE" },
  study_topics: [],
  custom_splits: [{ id: "Z", name: "Cardio" }],
  split_names: {},
  currency: "$",
  monthly_budget: 4200,
  starting_balance: 12000,
  expense_categories: ["Housing", "Food", "Transport", "Health", "Leisure", "Bills", "Shopping", "Other"],
  income_categories: ["Salary", "Bonus", "Investments", "Gift", "Other"],
  custom_pages: [],
  board_order: ["My Tasks", "Work", "Side Projects", "Home", "Learning"],
}, "# Momentum Life config\n"));

// ---------------------------------------------------------------- tasks
// Boards are folders. Spread across columns so the Kanban, the donuts, the
// "completed (7d)" bars and the "completion by board" bars all have something to show.

const tasks = [
  // ---- My Tasks
  { board: "My Tasks", title: "Renew passport", status: "backlog", priority: "high", group: "Admin", due: shift(TODAY, 21) },
  { board: "My Tasks", title: "Book dentist appointment", status: "backlog", priority: "medium", group: "Health" },
  { board: "My Tasks", title: "Reply to insurance email", status: "in progress", priority: "high", group: "Admin", due: shift(TODAY, -2) },
  { board: "My Tasks", title: "Plan weekend hike", status: "backlog", priority: "low", group: "Leisure" },
  { board: "My Tasks", title: "Order new running shoes", status: "done", priority: "low", group: "Shopping", done: shift(TODAY, -1) },
  { board: "My Tasks", title: "Cancel unused subscription", status: "done", priority: "medium", group: "Admin", done: shift(TODAY, -4) },

  // ---- Work
  { board: "Work", title: "Draft Q4 platform proposal", status: "in progress", priority: "high", group: "Planning", due: TODAY },
  { board: "Work", title: "Review API migration plan", status: "in progress", priority: "high", group: "Architecture", due: shift(TODAY, -1) },
  { board: "Work", title: "Prepare sprint demo script", status: "backlog", priority: "medium", group: "Planning", due: shift(TODAY, 3) },
  { board: "Work", title: "Write onboarding guide for new hires", status: "backlog", priority: "medium", group: "Docs" },
  { board: "Work", title: "Audit staging environment costs", status: "backlog", priority: "low", group: "Ops" },
  { board: "Work", title: "Schedule 1:1s for next month", status: "backlog", priority: "low", group: "Team" },
  { board: "Work", title: "Refactor the reporting service", status: "in progress", priority: "medium", group: "Engineering" },
  { board: "Work", title: "Ship the search relevance fix", status: "done", priority: "high", group: "Engineering", done: TODAY },
  { board: "Work", title: "Close out the quarterly review doc", status: "done", priority: "high", group: "Planning", done: shift(TODAY, -1) },
  { board: "Work", title: "Update the incident runbook", status: "done", priority: "medium", group: "Ops", done: shift(TODAY, -2) },
  { board: "Work", title: "Migrate the build pipeline to v3", status: "done", priority: "medium", group: "Ops", done: shift(TODAY, -3) },
  { board: "Work", title: "Document the caching strategy", status: "done", priority: "low", group: "Docs", done: shift(TODAY, -5) },
  { board: "Work", title: "Retire the legacy export job", status: "done", priority: "low", group: "Engineering", done: shift(TODAY, -6) },

  // ---- Side Projects
  { board: "Side Projects", title: "Sketch the landing page layout", status: "in progress", priority: "medium", group: "Design", due: shift(TODAY, 1) },
  { board: "Side Projects", title: "Set up the newsletter template", status: "backlog", priority: "low", group: "Marketing" },
  { board: "Side Projects", title: "Record a two-minute demo video", status: "backlog", priority: "medium", group: "Marketing" },
  { board: "Side Projects", title: "Publish the release notes", status: "done", priority: "medium", group: "Release", done: shift(TODAY, -2) },
  { board: "Side Projects", title: "Add dark mode to the docs site", status: "done", priority: "low", group: "Design", done: shift(TODAY, -6) },

  // ---- Home
  { board: "Home", title: "Fix the leaking kitchen tap", status: "backlog", priority: "high", group: "Repairs", due: shift(TODAY, -3) },
  { board: "Home", title: "Deep clean the garage", status: "backlog", priority: "low", group: "Chores" },
  { board: "Home", title: "Repot the balcony plants", status: "backlog", priority: "low", group: "Garden" },
  { board: "Home", title: "Compare internet plans", status: "in progress", priority: "medium", group: "Bills" },
  { board: "Home", title: "Replace the hallway light bulbs", status: "done", priority: "low", group: "Repairs", done: shift(TODAY, -4) },

  // ---- Learning
  { board: "Learning", title: "Finish the distributed systems course", status: "in progress", priority: "medium", group: "Course", due: shift(TODAY, 10) },
  { board: "Learning", title: "Practice Spanish for 20 minutes", status: "backlog", priority: "medium", group: "Language", due: TODAY },
  { board: "Learning", title: "Read two chapters of the design book", status: "backlog", priority: "low", group: "Reading" },
  { board: "Learning", title: "Take notes on the caching talk", status: "done", priority: "low", group: "Course", done: shift(TODAY, -5) },
];

const boards = ["My Tasks", "Work", "Side Projects", "Home", "Learning"];
// Ensure every board folder exists even if it had no tasks.
boards.forEach((b) => mkdirSync(join(ROOT, "Tasks", b), { recursive: true }));

const orderPerBoard = {};
tasks.forEach((t) => {
  orderPerBoard[t.board] = (orderPerBoard[t.board] || 0) + 1;
  const created = t.done ? shift(t.done, -9) : shift(TODAY, -12);
  const meta = {
    task_id: nextId(),
    type: "task",
    title: t.title,
    status: t.status,
    priority: t.priority,
    category: "work",
    group: t.group || "",
    kanban_name: t.board,
    due: t.due || "",
    order: orderPerBoard[t.board],
    created: iso(created),
    // `modified` is what the "tasks completed (7d)" chart reads for done tasks.
    modified: iso(t.done || shift(TODAY, -8)),
  };
  write(`Tasks/${t.board}/${safeName(t.title)}.md`, doc(meta, `# ${t.title}\n`));
});

// ---------------------------------------------------------------- habits
// Logs are seeded so the monthly dots, the weekly bars and the rolling line all
// have visible data for the first week of September 2026.

function habitLog(days) {
  const log = {};
  days.forEach((d) => { log[shift(TODAY, -d)] = true; });
  return log;
}

const habits = [
  { name: "Read 20 pages", emoji: "📖", type: "do", days: [0, 1, 2, 4, 5] },
  { name: "Meditate", emoji: "🧘", type: "do", days: [0, 2, 3, 5] },
  { name: "Take vitamins", emoji: "💊", type: "do", days: [0, 1, 3, 4, 6] },
  { name: "No late-night snacking", emoji: "🚫", type: "quit", days: [4] },
];

habits.forEach((h) => {
  const log = habitLog(h.days);
  const relapses = Object.keys(log).sort();
  write(`Habits/${safeName(h.name)}.md`, doc({
    id: "h" + nextId(),
    type: "habit",
    habit_type: h.type,
    name: h.name,
    emoji: h.emoji,
    log,
    created: shift(TODAY, -60),
    // For a "quit" habit the log marks relapses, so lastReset is the most recent one.
    lastReset: h.type === "quit" ? (relapses[relapses.length - 1] || shift(TODAY, -60)) : shift(TODAY, -60),
    modified: iso(TODAY),
  }, `# ${h.name}\n`));
});

// ---------------------------------------------------------------- fitness

write("Fitness/splits.md", doc({
  type: "splits-config",
  splits: [
    { id: "A", name: "Push (chest/shoulders/triceps)" },
    { id: "B", name: "Pull (back/biceps)" },
    { id: "C", name: "Legs" },
    { id: "D", name: "Core" },
    { id: "Z", name: "Cardio" },
  ],
}, "# Workout splits\n"));

const exercises = [
  { name: "Bench Press", split: "A", equipment: "barbell", muscle: "Chest", sets: "4x10", weight: 60 },
  { name: "Shoulder Press", split: "A", equipment: "machine", muscle: "Shoulders", sets: "3x10", weight: 30 },
  { name: "Lateral Raise", split: "A", equipment: "dumbbell", muscle: "Shoulders", sets: "4x15", weight: 10 },
  { name: "Triceps Rope", split: "A", equipment: "cable", muscle: "Triceps", sets: "3x12", weight: 25 },
  { name: "Lat Pulldown", split: "B", equipment: "cable", muscle: "Back", sets: "4x10", weight: 50 },
  { name: "Seated Row", split: "B", equipment: "machine", muscle: "Back", sets: "4x12", weight: 45 },
  { name: "Biceps Curl", split: "B", equipment: "dumbbell", muscle: "Biceps", sets: "3x12", weight: 14 },
  { name: "Leg Press", split: "C", equipment: "machine", muscle: "Quads", sets: "4x12", weight: 90 },
  { name: "Leg Extension", split: "C", equipment: "machine", muscle: "Quads", sets: "4x12", weight: 40 },
  { name: "Leg Curl", split: "C", equipment: "machine", muscle: "Hamstrings", sets: "4x12", weight: 35 },
  { name: "Calf Raise", split: "C", equipment: "machine", muscle: "Calves", sets: "4x15", weight: 55 },
  { name: "Plank", split: "D", equipment: "bodyweight", muscle: "Core", sets: "3x45s", weight: 0 },
  { name: "Dead Bug", split: "D", equipment: "bodyweight", muscle: "Core", sets: "3x12", weight: 0 },
  { name: "Bird Dog", split: "D", equipment: "bodyweight", muscle: "Core", sets: "3x12", weight: 0 },
  { name: "Treadmill Run", split: "Z", equipment: "machine", muscle: "Cardio", kind: "cardio", targetDistance: 5, targetDuration: 30 },
  { name: "Stationary Bike", split: "Z", equipment: "machine", muscle: "Cardio", kind: "cardio", targetDistance: 12, targetDuration: 40 },
];

exercises.forEach((e) => {
  const meta = {
    type: "exercise",
    name: e.name,
    split: e.split,
    equipment: e.equipment,
    muscle: e.muscle,
    kind: e.kind || "strength",
    sets: e.sets || "",
    weight: e.weight || 0,
    howto: "",
  };
  if (e.targetDistance) meta.target_distance = e.targetDistance;
  if (e.targetDuration) meta.target_duration = e.targetDuration;
  write(`Fitness/Exercises/${safeName(e.name)}.md`, doc(meta, `# ${e.name}\n`));
});

const splitLabel = {
  A: "Push (chest-shoulders-triceps)", B: "Pull (back-biceps)", C: "Legs", D: "Core", Z: "Cardio",
};

/** Progressive weights over time, so the weight-progress chart trends upward. */
function strengthEntries(split, weekIndex) {
  const bump = weekIndex * 2.5;
  return exercises
    .filter((e) => e.split === split && (e.kind || "strength") === "strength")
    .map((e) => ({ exercise: e.name, weight: Math.round((e.weight + bump) * 10) / 10, sets: e.sets, kind: "strength" }));
}

// 8 weeks of history: Push / Pull / Legs / Cardio each week.
const workouts = [];
for (let week = 7; week >= 0; week--) {
  const weekIndex = 7 - week;
  const monday = shift(TODAY, -(week * 7 + 5));
  workouts.push({ date: monday, split: "A", duration: 52, entries: strengthEntries("A", weekIndex), kind: "strength" });
  workouts.push({ date: shift(monday, 1), split: "B", duration: 48, entries: strengthEntries("B", weekIndex), kind: "strength" });
  workouts.push({ date: shift(monday, 2), split: "C", duration: 55, entries: strengthEntries("C", weekIndex), kind: "strength" });
  workouts.push({
    date: shift(monday, 4), split: "Z", duration: 32, kind: "cardio",
    entries: [{ exercise: "Treadmill Run", weight: 0, sets: "", kind: "cardio", distance: 5 + weekIndex * 0.2, duration: 32 }],
  });
}
// Drop anything that would land in the future.
workouts.filter((w) => w.date <= TODAY).forEach((w) => {
  write(`Fitness/Workouts/${safeName(splitLabel[w.split])}-${w.duration}min-${w.date}.md`, doc({
    id: nextId(),
    type: "workout-log",
    date: w.date,
    split: w.split,
    duration: w.duration,
    kind: w.kind,
    exercises: w.entries,
    modified: iso(w.date),
  }, `# ${splitLabel[w.split]} — ${w.duration} min\n`));
});

// ---------------------------------------------------------------- nutrition

const mealPlans = [
  { id: "breakfast", name: "Breakfast", emoji: "☕", items: [
    { name: "Oats", qty: 60, unit: "g", cal: 233, protein: 8.5, carbs: 40 },
    { name: "Banana", qty: 120, unit: "g", cal: 107, protein: 1.3, carbs: 27 },
    { name: "Whey protein", qty: 30, unit: "g", cal: 120, protein: 24, carbs: 2 },
  ] },
  { id: "lunch", name: "Lunch", emoji: "🍽️", items: [
    { name: "Grilled chicken breast", qty: 200, unit: "g", cal: 330, protein: 62, carbs: 0 },
    { name: "Brown rice", qty: 150, unit: "g", cal: 195, protein: 4.5, carbs: 41 },
    { name: "Mixed salad", qty: 120, unit: "g", cal: 45, protein: 2, carbs: 7 },
  ] },
  { id: "dinner", name: "Dinner", emoji: "🌙", items: [
    { name: "Baked salmon", qty: 180, unit: "g", cal: 374, protein: 40, carbs: 0 },
    { name: "Sweet potato", qty: 200, unit: "g", cal: 172, protein: 3.2, carbs: 40 },
  ] },
  { id: "snacks", name: "Snacks", emoji: "🍎", items: [
    { name: "Greek yogurt", qty: 170, unit: "g", cal: 100, protein: 17, carbs: 6 },
    { name: "Almonds", qty: 30, unit: "g", cal: 174, protein: 6.4, carbs: 6 },
  ] },
];

const sum = (items, k) => Math.round(items.reduce((a, i) => a + (i[k] || 0), 0) * 10) / 10;

mealPlans.forEach((m) => {
  write(`Nutrition/Plan/${m.id}.md`, doc({
    type: "meal-plan",
    id: m.id,
    name: m.name,
    emoji: m.emoji,
    total_cal: Math.round(sum(m.items, "cal")),
    items: m.items,
  }, `# ${m.emoji} ${m.name}\n`));
});

// Log the plan for the last 10 days (skipping a couple of meals so the calorie
// calendar shows a realistic mix of on-target and under-target days).
const skip = new Set(["dinner@3", "snacks@5", "lunch@7"]);
for (let back = 9; back >= 0; back--) {
  const date = shift(TODAY, -back);
  mealPlans.forEach((m) => {
    if (skip.has(`${m.id}@${back}`)) return;
    if (back === 0 && m.id === "dinner") return; // today's dinner not logged yet
    const cal = Math.round(sum(m.items, "cal"));
    write(`Nutrition/Logs/${safeName(m.name)}-${cal}cal-${date}.md`, doc({
      id: nextId(),
      type: "meal-log",
      date,
      meal: m.id,
      meal_name: m.name,
      calories: cal,
      protein: sum(m.items, "protein"),
      carbs: sum(m.items, "carbs"),
      items: m.items,
      modified: iso(date),
    }, `# ${m.name} — ${cal} cal\n`));
  });
}

const water = {};
for (let back = 9; back >= 0; back--) {
  water[shift(TODAY, -back)] = back === 0 ? 1.5 : [2.5, 2.75, 2.0, 2.5, 1.75, 2.5, 2.25, 2.5, 3.0, 2.25][back];
}
write("Nutrition/water.md", doc({ type: "water-log", log: water, modified: iso(TODAY) }, "# Water log\n"));

// ---------------------------------------------------------------- studies

const studyTopics = [
  { id: "system-design", name: "System Design", emoji: "🏗️" },
  { id: "spanish", name: "Spanish", emoji: "🇪🇸" },
  { id: "data-eng", name: "Data Engineering", emoji: "🗄️" },
  { id: "reading", name: "Reading", emoji: "📚" },
];

write("Studies/boards.md", doc({ type: "study-boards-config", boards: studyTopics },
  "# Study topics\n\n" + studyTopics.map((t) => `- ${t.emoji} ${t.name}`).join("\n") + "\n"));

const studyCards = [
  { topic: "System Design", title: "Consistent hashing", subtopic: "Scalability", status: "done", date: shift(TODAY, -12) },
  { topic: "System Design", title: "Consensus with Raft", subtopic: "Distributed systems", status: "in progress", date: shift(TODAY, -4) },
  { topic: "System Design", title: "Designing a rate limiter", subtopic: "Patterns", status: "in progress", date: shift(TODAY, -2) },
  { topic: "System Design", title: "Event sourcing basics", subtopic: "Patterns", status: "backlog" },
  { topic: "System Design", title: "Caching strategies", subtopic: "Performance", status: "backlog" },
  { topic: "Spanish", title: "Subjunctive mood drills", subtopic: "Grammar", status: "in progress", date: shift(TODAY, -1) },
  { topic: "Spanish", title: "Past tenses review", subtopic: "Grammar", status: "done", date: shift(TODAY, -9) },
  { topic: "Spanish", title: "Ordering food role-play", subtopic: "Conversation", status: "backlog" },
  { topic: "Data Engineering", title: "Columnar formats: Parquet vs ORC", subtopic: "Storage", status: "done", date: shift(TODAY, -15) },
  { topic: "Data Engineering", title: "Streaming windows explained", subtopic: "Streaming", status: "backlog" },
  { topic: "Data Engineering", title: "Idempotent pipeline design", subtopic: "Pipelines", status: "backlog" },
  { topic: "Reading", title: "Designing Data-Intensive Applications — ch. 5", subtopic: "Chapters", status: "in progress", date: shift(TODAY, -3) },
  { topic: "Reading", title: "The Pragmatic Programmer — ch. 2", subtopic: "Chapters", status: "done", date: shift(TODAY, -20) },
];

const studyOrder = {};
studyCards.forEach((c) => {
  studyOrder[c.topic] = (studyOrder[c.topic] || 0) + 1;
  write(`Studies/${c.topic}/${safeName(c.title)}.md`, doc({
    id: nextId(),
    type: "study",
    title: c.title,
    topic: c.topic,
    subtopic: c.subtopic || "",
    status: c.status,
    url: "",
    date: c.date || "",
    order: studyOrder[c.topic],
    created: iso(shift(TODAY, -30)),
    modified: iso(c.date || shift(TODAY, -30)),
  }, `# ${c.title}\n`));
});

// ---------------------------------------------------------------- finance
// Four months of history (Jun–Sep 2026) so the net-worth lines and the 6-month
// balance bars have shape, including one month that closes negative.

const salary = 7400;
const monthlyExpenses = [
  { category: "Housing", note: "Rent", amount: 1850, day: 5 },
  { category: "Bills", note: "Electricity", amount: 96, day: 12 },
  { category: "Bills", note: "Internet", amount: 65, day: 15 },
  { category: "Bills", note: "Mobile plan", amount: 42, day: 15 },
  { category: "Health", note: "Health insurance", amount: 310, day: 8 },
  { category: "Health", note: "Gym membership", amount: 55, day: 5 },
  { category: "Transport", note: "Fuel", amount: 180, day: 10 },
  { category: "Food", note: "Groceries", amount: 640, day: 7 },
  { category: "Leisure", note: "Streaming bundle", amount: 38, day: 20 },
];

const financeMonths = [
  { key: "2026-06", extra: [{ category: "Shopping", note: "Standing desk", amount: 720, day: 18, type: "expense" }] },
  { key: "2026-07", extra: [{ category: "Bonus", note: "Mid-year bonus", amount: 2600, day: 22, type: "income" }] },
  // August goes negative on purpose: a big one-off expense, so the balance chart
  // has a bar below the zero line.
  { key: "2026-08", extra: [
    { category: "Housing", note: "Bathroom repair", amount: 4300, day: 14, type: "expense" },
    { category: "Leisure", note: "Summer trip", amount: 2150, day: 3, type: "expense" },
  ] },
  { key: "2026-09", extra: [], upTo: 6 },
];

financeMonths.forEach((m) => {
  const tx = [];
  tx.push({ category: "Salary", note: "Monthly salary", amount: salary, day: 5, type: "income" });
  monthlyExpenses.forEach((e) => tx.push({ ...e, type: "expense" }));
  m.extra.forEach((e) => tx.push(e));

  tx.forEach((t) => {
    if (m.upTo && t.day > m.upTo) return; // current month: only what already happened
    const date = `${m.key}-${String(t.day).padStart(2, "0")}`;
    const amount = t.amount.toFixed(2);
    write(`Finance/Transactions/${safeName(t.category)}-${safeName(t.note)}-${amount}-${date}.md`, doc({
      id: nextId(),
      type: "transaction",
      tx_type: t.type,
      date,
      amount: t.amount,
      category: t.category,
      note: t.note,
      modified: iso(date),
    }, `# ${t.category} — ${t.note}\n`));
  });
});

write("Finance/recurring.md", doc({
  type: "recurring-config",
  items: [
    { id: "r1", type: "income", category: "Salary", amount: salary, note: "Monthly salary", freq: "monthly", day: 5 },
    { id: "r2", type: "expense", category: "Housing", amount: 1850, note: "Rent", freq: "monthly", day: 5 },
    { id: "r3", type: "expense", category: "Health", amount: 310, note: "Health insurance", freq: "monthly", day: 8 },
    { id: "r4", type: "expense", category: "Bills", amount: 65, note: "Internet", freq: "monthly", day: 15 },
    { id: "r5", type: "expense", category: "Leisure", amount: 38, note: "Streaming bundle", freq: "monthly", day: 20 },
    { id: "r6", type: "expense", category: "Food", amount: 160, note: "Weekly groceries", freq: "weekly", weekday: 6 },
    { id: "r7", type: "expense", category: "Transport", amount: 45, note: "Commute", freq: "weekly", weekday: 1 },
  ],
}, "# Recurring costs\n"));

/** Monthly contributions on the 6th, from `from` through Sep 2026. */
function contributions(from, amount) {
  const log = {};
  const [y0, m0] = from.split("-").map(Number);
  for (let i = 0; i < 24; i++) {
    const d = new Date(y0, m0 - 1 + i, 6);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-06`;
    if (key > TODAY) break;
    log[key] = amount;
  }
  return log;
}

write("Finance/savings.md", doc({
  type: "savings-config",
  buckets: [
    { id: "emergency-fund", name: "Emergency fund", kind: "reserve", goal: 24000, log: contributions("2025-04", 550) },
    { id: "s-investments", name: "Investments", kind: "custom", goal: 60000, log: contributions("2025-07", 700) },
    { id: "s-travel", name: "Travel", kind: "custom", goal: 5000, log: contributions("2026-01", 220) },
  ],
}, "# Savings buckets\n"));

// ---------------------------------------------------------------- notes

write("Notes/Ideas for the next release.md", doc({
  type: "note", title: "Ideas for the next release", color: "yellow", date: TODAY,
}, "# Ideas for the next release\n\n- Weekly review template\n- Export a month as CSV\n"));

write("Notes/Grocery list.md", doc({
  type: "note", title: "Grocery list", color: "green", date: TODAY,
}, "# Grocery list\n\n- Oats\n- Greek yogurt\n- Salmon\n"));

// ---------------------------------------------------------------- obsidian config + plugin

const OB = join(VAULT, ".obsidian");
mkdirSync(OB, { recursive: true });
writeFileSync(join(OB, "app.json"), JSON.stringify({ promptDelete: false }, null, 2));
writeFileSync(join(OB, "appearance.json"), JSON.stringify({ accentColor: "", theme: "obsidian" }, null, 2));
writeFileSync(join(OB, "core-plugins.json"), JSON.stringify(["file-explorer", "global-search", "switcher", "graph", "command-palette"], null, 2));
writeFileSync(join(OB, "community-plugins.json"), JSON.stringify(["momentum-life"], null, 2));

const PLUGIN_DIR = join(OB, "plugins", "momentum-life");
mkdirSync(PLUGIN_DIR, { recursive: true });
let copied = 0;
for (const f of ["main.js", "manifest.json", "styles.css"]) {
  const src = join(REPO, f);
  if (existsSync(src)) { copyFileSync(src, join(PLUGIN_DIR, f)); copied++; }
}

// Point the plugin at the data root and land on Cockpit Life.
writeFileSync(join(PLUGIN_DIR, "data.json"), JSON.stringify({
  dataRoot: "Momentum Life",
  currentPage: "cockpit",
  googleTasksEnabled: false,
}, null, 2));

console.log(`Demo vault written to: ${VAULT}`);
console.log(`Plugin files copied:   ${copied}/3 (build first if this is not 3)`);
