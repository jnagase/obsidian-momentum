// Journaling engine — pure (no Obsidian imports) so it stays testable and side-effect free.
// Templates describe the prompt structure; renderTemplateBody() turns a template into the
// Markdown body of a new daily entry. Entries are normal notes, so images use native embeds
// and the user edits them in Obsidian — the engine only produces the starting scaffold.

export type JournalBlockKind = "list" | "text" | "affirmation";

export interface JournalBlock {
  /** Section heading shown in the entry (rendered as an H3). */
  heading: string;
  kind: JournalBlockKind;
  /** Optional helper text shown under the heading as a quote. */
  prompt?: string;
  /** Groups blocks under a "Morning" / "Evening" H2 when set. */
  timeOfDay?: "am" | "pm";
}

export interface JournalTemplate {
  id: string;
  name: string;
  emoji: string;
  description: string;
  blocks: JournalBlock[];
}

/** Built-in templates shipped with the plugin. Custom templates (Phase 4) extend this at runtime. */
export const BUILTIN_TEMPLATES: JournalTemplate[] = [
  {
    id: "five-minute",
    name: "5-minute journal",
    emoji: "🌅",
    description: "A short morning + evening loop. Same prompts every day, built for consistency.",
    blocks: [
      { heading: "I'm grateful for", kind: "list", prompt: "Three things, big or small.", timeOfDay: "am" },
      { heading: "Daily affirmation", kind: "affirmation", prompt: "I am…", timeOfDay: "am" },
      { heading: "What would make today great", kind: "list", prompt: "Up to three intentions.", timeOfDay: "am" },
      { heading: "Highlights of the day", kind: "list", prompt: "Wins, however small.", timeOfDay: "pm" },
      { heading: "What could have been better", kind: "text", prompt: "One honest note, no judgement.", timeOfDay: "pm" },
    ],
  },
  {
    id: "gratitude",
    name: "Gratitude",
    emoji: "🙏",
    description: "Notice the good. Three things, then one that goes a level deeper.",
    blocks: [
      { heading: "Grateful for", kind: "list", prompt: "Three things you're thankful for today." },
      { heading: "Why it matters", kind: "text", prompt: "Pick one and say why it mattered." },
    ],
  },
  {
    id: "free",
    name: "Free writing",
    emoji: "✍️",
    description: "A blank page. Write whatever is on your mind.",
    blocks: [
      { heading: "Today", kind: "text", prompt: "Write freely — no rules." },
    ],
  },
];

/** Time-of-day group label for the H2 header. */
const TOD_LABEL: Record<"am" | "pm", string> = { am: "Morning", pm: "Evening" };

/** A blank writing area for a block: an open list item for lists, blank lines otherwise. */
function blockPlaceholder(kind: JournalBlockKind): string {
  return kind === "list" ? "- \n- \n- \n" : "\n";
}

/**
 * Render a template into the Markdown body of a new entry, for the given date.
 * Deterministic and pure. Blocks with a `timeOfDay` are grouped under a Morning/Evening H2;
 * ungrouped blocks are rendered flat. Prompts become quote helpers under each H3.
 */
export function renderTemplateBody(t: JournalTemplate, date: string): string {
  let body = `# ${t.emoji} ${date} · ${t.name}\n\n`;
  let currentTod: "am" | "pm" | undefined;
  for (const b of t.blocks) {
    if (b.timeOfDay && b.timeOfDay !== currentTod) {
      currentTod = b.timeOfDay;
      body += `## ${TOD_LABEL[b.timeOfDay]}\n\n`;
    }
    body += `### ${b.heading}\n`;
    if (b.prompt) body += `> ${b.prompt}\n`;
    body += "\n" + blockPlaceholder(b.kind) + "\n";
  }
  return body.trimEnd() + "\n";
}

/** Look up a template by id across built-ins (and, later, custom ones passed in). */
export function findTemplate(id: string, extra: JournalTemplate[] = []): JournalTemplate | undefined {
  return [...BUILTIN_TEMPLATES, ...extra].find((t) => t.id === id);
}

/** A saved daily entry, derived from its note's frontmatter (filename is presentation only). */
export interface JournalEntry {
  date: string;   // YYYY-MM-DD
  path: string;   // vault path to the note
  template: string;
  /** Quick check-in answers keyed by question (mood/energy/connection/stress → option value). */
  checkin: Record<string, string>;
}

// ---- Quick check-in (mood + a few dimensions asked before writing) ----------------------

export interface CheckinOption {
  value: string;   // stored value + tag suffix, e.g. "great"
  label: string;   // human label
  emoji: string;
  color: string;   // chip / calendar tint color (green = good … red = bad)
}
export interface CheckinQuestion {
  key: string;     // frontmatter key + tag prefix, e.g. "mood"
  name: string;    // shown in the modal / table header
  options: CheckinOption[];
}

const RED = "#ef4444", ORANGE = "#f59e0b", YELLOW = "#eab308", LIME = "#84cc16", GREEN = "#16a34a";

/** The quick-check-in questions asked before writing. Scales so they colour + tabulate cleanly. */
export const CHECKIN_QUESTIONS: CheckinQuestion[] = [
  {
    key: "mood", name: "Mood",
    options: [
      { value: "awful", label: "Awful", emoji: "😞", color: RED },
      { value: "low", label: "Low", emoji: "😕", color: ORANGE },
      { value: "ok", label: "Ok", emoji: "😐", color: YELLOW },
      { value: "good", label: "Good", emoji: "🙂", color: LIME },
      { value: "great", label: "Great", emoji: "😄", color: GREEN },
    ],
  },
  {
    key: "energy", name: "Energy",
    options: [
      { value: "low", label: "Low", emoji: "🪫", color: RED },
      { value: "medium", label: "Medium", emoji: "😐", color: YELLOW },
      { value: "high", label: "High", emoji: "⚡", color: GREEN },
    ],
  },
  {
    key: "connection", name: "Connection",
    options: [
      { value: "distant", label: "Distant", emoji: "😔", color: RED },
      { value: "ok", label: "Ok", emoji: "😐", color: YELLOW },
      { value: "close", label: "Close", emoji: "🙂", color: LIME },
      { value: "very-close", label: "Very connected", emoji: "🥰", color: GREEN },
    ],
  },
  {
    // Inverted scale: calm is good (green), stressed is bad (red).
    key: "stress", name: "Stress",
    options: [
      { value: "calm", label: "Calm", emoji: "😌", color: GREEN },
      { value: "neutral", label: "Neutral", emoji: "😐", color: YELLOW },
      { value: "tense", label: "Tense", emoji: "😟", color: ORANGE },
      { value: "stressed", label: "Stressed", emoji: "😣", color: RED },
    ],
  },
];

/** Look up the option (emoji/label/color) for a given question key + stored value. */
export function checkinOption(key: string, value: string): CheckinOption | undefined {
  return CHECKIN_QUESTIONS.find((q) => q.key === key)?.options.find((o) => o.value === value);
}

/** Build the tag list for a set of check-in answers, e.g. { mood: "great" } → ["mood/great"]. */
export function checkinTags(answers: Record<string, string>): string[] {
  return Object.entries(answers)
    .filter(([, v]) => !!v)
    .map(([k, v]) => `${k}/${v}`);
}
