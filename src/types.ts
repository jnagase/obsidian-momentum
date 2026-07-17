// Domain model for the Personal Assistant plugin.
// Mirrors the markdown schema used by the sibling web app so both read/write
// the exact same `Personal Assistant/*.md` files.

export interface Board {
  id: string;
  name: string;
  emoji?: string;
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

export interface Exercise {
  name: string;
  split: string;
  type: string; // equipment type / machine | free ...
  muscle: string;
  sets: string; // e.g. "3x10"
  weight: number;
  howto: string;
  path?: string;
}

export interface WorkoutExercise {
  exercise: string;
  weight: number;
  sets: string;
  feel?: string;
  oldWeight?: number;
}

export interface Workout {
  id: string;
  date: string; // YYYY-MM-DD
  split: string;
  duration: number; // minutes
  exercises: WorkoutExercise[];
  path: string;
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
  expenseCategories: string[];
  incomeCategories: string[];
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
    expenseCategories: DEFAULT_EXPENSE_CATEGORIES.slice(),
    incomeCategories: DEFAULT_INCOME_CATEGORIES.slice(),
  };
}
