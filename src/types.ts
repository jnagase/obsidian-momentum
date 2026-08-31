// Domain model for the Personal Assistant plugin.
// Mirrors the markdown schema used by the sibling web app so both read/write
// the exact same `Personal Assistant/*.md` files.

export interface Board {
  id: string;
  name: string;
  emoji?: string;
}

/**
 * A user-defined nav section. Two flavors:
 *  - command: clicking it runs an Obsidian command (opens another plugin/view in a tab).
 *  - folder (legacy): lists the notes under a vault folder inside the Momentum view.
 */
export interface CustomPage {
  id: string;       // stable slug used as the page id
  label: string;    // shown in the nav
  emoji?: string;
  ribbon?: string;  // ribbon item id to trigger (opens a plugin exactly like its left-bar icon). Preferred.
  command?: string; // legacy: command id to execute (opens a plugin/view).
  folder?: string;  // legacy: vault-relative folder whose notes are listed (e.g. "Books")
}

export interface Task {
  id: string; // task_id (uuid) or filename fallback
  title: string;
  status: string; // matches a task column key, e.g. "backlog" | "in progress" | "done"
  priority: string; // "low" | "medium" | "high"
  cat?: string;
  group?: string;
  kanbanId?: string;
  kanbanName?: string; // board name
  due?: string;
  scheduled?: string;
  duration?: number;
  isAllDay?: boolean;
  created?: string;
  modified?: string;
  order?: number;
  eisenhower?: string; // manual Eisenhower quadrant: "q1" | "q2" | "q3" | "q4" (empty = auto)
  googleId?: string;   // Google Tasks item id — the stable sync key (empty = local-only)
  googleList?: string; // Google Tasks list id the item currently lives in
  path: string; // vault path of the source file
  body?: string;
}

export interface Note {
  id: string; // filename basename
  title: string;
  content: string;
  color: string; // yellow | green | blue | ...
  board?: string;
  date?: string;
  path: string;
}

export interface Habit {
  id: string;
  name: string;
  emoji: string;
  habitType: string; // "do" | "quit"
  log: Record<string, boolean>;
  created?: string;
  lastReset?: string;
  modified?: string;
  path?: string; // present when stored as an individual file
}

export type ExerciseKind = "strength" | "cardio";
export type WorkoutKind = "strength" | "cardio" | "mixed" | "empty";

export interface Exercise {
  name: string;
  split: string;
  type: string; // equipment type / machine | free ...
  muscle: string;
  sets: string; // e.g. "3x10" — strength only
  weight: number; // strength only
  howto: string;
  path?: string;
  kind: ExerciseKind; // "strength" | "cardio" — always present after load (defaulted to "strength")
  targetDistance?: number; // km — cardio only
  targetDuration?: number; // minutes — cardio only
}

export interface WorkoutExercise {
  exercise: string;
  weight: number; // strength only
  sets: string; // strength only
  feel?: string;
  oldWeight?: number;
  kind?: ExerciseKind; // copied from Exercise.kind at log time; absent (legacy) treated as "strength"
  distance?: number; // km — cardio only
  duration?: number; // minutes — cardio only (entry-level, distinct from Workout.duration)
}

export interface Workout {
  id: string;
  date: string; // YYYY-MM-DD
  split: string;
  duration: number; // minutes (whole session)
  exercises: WorkoutExercise[];
  path: string;
  kind: WorkoutKind; // derived from the exercises' kinds; always present after load
}

export interface Split {
  id: string;
  name: string;
}

export interface StudyCard {
  id: string;
  title: string;
  topic: string;
  subtopic?: string;
  status: string;
  url?: string;
  date?: string;
  modified?: string;
  order?: number;
  path: string;
}

export interface MealItem {
  name: string;
  qty: number;
  unit: string;
  cal: number;
  protein?: number;
  carbs?: number;
}

export interface Meal {
  id: string;
  name: string;
  emoji?: string;
  totalCal: number;
  items: MealItem[];
  path: string;
}

export interface MealLog {
  id: string;
  date: string;
  mealId: string;
  totalCal: number;
  totalProtein: number;
  totalCarbs: number;
  items: MealItem[];
  path: string;
}

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  type: string; // "income" | "expense"
  amount: number;
  category: string;
  note?: string;
  path: string;
}

/** A named savings "piggy bank" with an append-only, date-keyed log of contributions
 *  (and withdrawals, as negative entries). Balance is always derived (sum of `log`),
 *  never stored separately, so it can never drift out of sync with the log. The
 *  "Emergency fund" bucket (kind "reserve") is fixed: always present, never deletable,
 *  never renamable — every other bucket (kind "custom") is fully user-managed. */
export interface SavingsBucket {
  id: string;
  name: string;
  kind: "reserve" | "custom";
  /** Optional target balance the user set explicitly. When unset on the "reserve"
   *  bucket, the UI shows a suggested goal (6× recent average monthly income) computed
   *  on the fly instead — this field only holds a value once the user overrides it. */
  goal?: number;
  /** date (YYYY-MM-DD) -> signed delta amount for that day. Multiple contributions on
   *  the same date accumulate into one entry (see addSavingsContribution). */
  log: Record<string, number>;
}

/** Fixed id of the always-present, never-deletable Emergency fund bucket. */
export const EMERGENCY_FUND_ID = "emergency-fund";

/** A recurring income/expense template the user can apply to a month in one click. */
export interface RecurringItem {
  id: string;
  type: string; // "income" | "expense"
  category: string;
  amount: number;
  note?: string;
  freq: string; // "monthly" | "weekly"
  day?: number; // monthly: day of month (1-28) to date the applied transaction
  weekday?: number; // weekly: 0=Sun .. 6=Sat
}

export interface PAConfig {
  calorieTarget: number;
  proteinTarget: number;
  carbsTarget: number;
  waterTarget: number;
  taskColumns: string[];
  taskColumnNames: Record<string, string>;
  studyColumns: string[];
  studyColumnNames: Record<string, string>;
  studyTopics: Board[];
  customSplits: Split[];
  splitNames: Record<string, string>;
  currency: string;
  monthlyBudget: number;
  /** Balance before the earliest tracked transaction, so the running balance reflects
   *  money the user already had (or owed) when they started using the app. Defaults to 0. */
  startingBalance: number;
  expenseCategories: string[];
  incomeCategories: string[];
  customPages: CustomPage[];
  /** User-chosen board order (names). Boards missing here fall back to alphabetical. */
  boardOrder: string[];
}

export const DEFAULT_EXPENSE_CATEGORIES = ["Housing", "Food", "Transport", "Health", "Leisure", "Bills", "Shopping", "Other"];
export const DEFAULT_INCOME_CATEGORIES = ["Salary", "Bonus", "Investments", "Gift", "Other"];

export const DEFAULT_TASK_COLUMNS = ["backlog", "in progress", "done"];
export const DEFAULT_TASK_COLUMN_NAMES: Record<string, string> = {
  backlog: "📌 BACKLOG",
  "in progress": "🔄 IN PROGRESS",
  done: "✅ DONE",
  "on-hold": "On-hold",
};
export const DEFAULT_STUDY_COLUMNS = ["backlog", "in progress", "done"];
export const DEFAULT_STUDY_COLUMN_NAMES: Record<string, string> = {
  backlog: "📌 BACKLOG",
  "in progress": "🔄 IN PROGRESS",
  done: "✅ DONE",
};
export const DEFAULT_SPLITS: Split[] = [
  { id: "A", name: "Peito/Ombro/Tríceps" },
  { id: "B", name: "Costas/Bíceps" },
  { id: "C", name: "Pernas" },
  { id: "D", name: "Core/Lombar" },
];

export const NOTE_COLORS: Record<string, string> = {
  yellow: "#fff9c4",
  green: "#c8e6c9",
  blue: "#bbdefb",
  pink: "#f8bbd0",
  purple: "#e1bee7",
  orange: "#ffe0b2",
  white: "#ffffff",
};

export function defaultConfig(): PAConfig {
  return {
    calorieTarget: 2000,
    proteinTarget: 120,
    carbsTarget: 200,
    waterTarget: 2.5,
    taskColumns: DEFAULT_TASK_COLUMNS.slice(),
    taskColumnNames: { ...DEFAULT_TASK_COLUMN_NAMES },
    studyColumns: DEFAULT_STUDY_COLUMNS.slice(),
    studyColumnNames: { ...DEFAULT_STUDY_COLUMN_NAMES },
    studyTopics: [],
    customSplits: [],
    splitNames: {},
    currency: "$",
    monthlyBudget: 0,
    startingBalance: 0,
    expenseCategories: DEFAULT_EXPENSE_CATEGORIES.slice(),
    incomeCategories: DEFAULT_INCOME_CATEGORIES.slice(),
    customPages: [],
    boardOrder: [],
  };
}
