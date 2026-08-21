import { App, Modal } from "obsidian";

export interface ChangeSection { title: string; items: string[]; }
export interface ChangeEntry { version: string; sections: ChangeSection[]; }

/** Release notes shown in the "What's new" dialog, newest first. */
export const CHANGELOG: ChangeEntry[] = [
  {
    version: "0.6.1",
    sections: [
      {
        title: "New — Fitness cardio support",
        items: [
          "Exercises can now be marked as strength or cardio. Cardio exercises track distance and duration instead of weight and sets, with pace (min/km) computed automatically.",
          "A new cardio progress chart sits next to the weight progress chart, plotting distance over time per split.",
          "The monthly fitness summary now shows total distance for months with cardio activity.",
          "Existing exercises and workouts keep working exactly as before — nothing to migrate.",
        ],
      },
      {
        title: "New — Finance net worth trends",
        items: [
          "A new net worth card on the Finance page shows your accumulated balance since you started tracking, with an optional starting balance for money you already had.",
          "Two small yearly donuts show how past years closed and how the current year is going so far.",
          "Line charts across the app now show the exact value when you hover a point.",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Confirming a meal for a past day in Nutrition no longer logs it to today by mistake.",
          "You can now delete a single meal log or a single workout for a day, instead of clearing the whole day.",
          "Habits can be marked, unmarked, or have a relapse toggled on any past day, not just today — tap any day on the heatmap.",
        ],
      },
      {
        title: "Support the project",
        items: [
          "If Momentum Life has been useful, consider [buying me a coffee](https://buymeacoffee.com/jnagase) — it helps keep this plugin free and actively maintained. No pressure, just genuinely appreciated 🙏",
        ],
      },
    ],
  },
  {
    version: "0.6.0",
    sections: [
      {
        title: "Improved — Google tasks (beta)",
        items: [
          "Your Google connection keeps working exactly as before: this release moves the sign-in service to its own address, and **nothing is required from you** — no reconnecting, no settings to change.",
          "Disconnecting now really disconnects: it asks Google to revoke the app's access instead of only forgetting the token locally, so no stale authorisation is left behind in your Google account. Your task notes are always kept.",
          "Clearer errors when Google refuses: an expired session now says so and tells you to reconnect, instead of a generic failure.",
        ],
      },
      {
        title: "New — privacy policy",
        items: [
          "Momentum Life now has a published privacy policy describing exactly what the Google tasks sync touches: your tasks stay in your vault, and the sign-in service never sees their content. Linked from the README.",
        ],
      },
    ],
  },
  {
    version: "0.5.9",
    sections: [
      {
        title: "New — find and arrange your tasks",
        items: [
          "Search tasks from the Tasks & Lists header: type a couple of words (title, board, group or due date) and the card is opened on its board and briefly highlighted, so you can see exactly where it lives.",
          "Reorder your board tabs by dragging them. \"My Tasks\" stays pinned first; the order is remembered in your settings note. Keyboard users can use \"Move board left/right\" in the board menu.",
          "\"Sync now\" button for Google tasks (beta) right in the header. If sync isn't set up yet, it shows a short walkthrough instead of doing nothing.",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Tasks created by hand no longer get stuck as \"Untitled\": the note's filename is now the task title, and titles are realigned automatically — including renames that arrive from another device.",
          "Adding a card with an empty title now tells you a title is required instead of silently closing.",
          "Cards could get stuck in their column when a note's properties were malformed (duplicate keys, or a value containing \": \"). Those are repaired automatically now.",
        ],
      },
      {
        title: "Improved — safer Google tasks sync (beta)",
        items: [
          "A task is never deleted from Google just because its note momentarily fails to load (for example a file still syncing between devices) — the sync now double-checks the files first.",
          "Duplicates created by syncing on two devices at once are reconciled automatically: one task and one note survive, chosen the same way on every device.",
          "The sync log now records what was deleted or archived and why.",
        ],
      },
    ],
  },
  {
    version: "0.5.1",
    sections: [
      {
        title: "New — Google Tasks sync (BETA)",
        items: [
          "Two-way sync between your boards and Google Tasks. ⚠️ This feature is BETA — expect rough edges and please keep a backup of your vault. Enable it under Settings → Google tasks (beta).",
          "Sign-in works the same on desktop and mobile and no credentials are shipped in the plugin (auth goes through a hosted broker).",
          "Destructive changes are guarded: if an unusual number of tasks vanish at once, the sync asks you before deleting anything on either side.",
        ],
      },
      {
        title: "Changed — boards are folders",
        items: [
          "Each board is now a folder under Tasks/, so you can create a task by hand just by dropping a note into Tasks/<Board>/. The default board is \"My Tasks\" (paired with Google's default list). Your existing tasks are migrated automatically, backlink-safe.",
          "Marking a task done sends it to the top of the Done column; in the Done column the button reopens the task.",
        ],
      },
    ],
  },
  {
    version: "0.3.0",
    sections: [
      {
        title: "New — readable notes & monthly hubs",
        items: [
          "Finance transactions, Nutrition logs and Fitness workouts now save with human-readable filenames (for example Groceries-Market-84.20-2026-06-30, Lunch-620cal-2026-06-30, PushDay-45min-2026-06-30) so your file list and Graph View stay legible.",
          "Each module gets a monthly hub note (Finance / Nutrition / Fitness 2026-06 June) summarizing the month and linking that month's items, so the Graph View clusters your notes by module and month.",
          "New command \"Momentum: migrate notes to readable names\" renames your existing notes to the new scheme in one pass. It's backlink-aware, keeps any lines you added by hand, and is safe to run more than once. Tip: back up or commit your vault first; removed hub notes go to Obsidian's trash so you can recover them.",
        ],
      },
    ],
  },
  {
    version: "0.2.10",
    sections: [
      {
        title: "Fixed",
        items: [
          "Adding a card from a quadrant in the Eisenhower matrix now creates the task in that quadrant, instead of always landing in Eliminate.",
        ],
      },
    ],
  },
  {
    version: "0.2.9",
    sections: [
      {
        title: "Fixed",
        items: [
          "The Eisenhower quadrant grid now matches the scatter chart's axes: urgent on the right, important on top (Do first top-right, Schedule top-left, Delegate bottom-right, Eliminate bottom-left).",
        ],
      },
    ],
  },
  {
    version: "0.2.8",
    sections: [
      {
        title: "Improved",
        items: [
          "Data files now read as plain markdown. Recurring tasks, recurring costs, boards and workout splits show a human-readable list in the note body, so you can read them without the plugin. The plugin still keeps the exact data in the note properties.",
        ],
      },
    ],
  },
  {
    version: "0.2.6",
    sections: [
      {
        title: "New",
        items: [
          "Weekly recurring tasks can now repeat every 1, 2, 3 or 4 weeks. For longer cycles, use the monthly option.",
        ],
      },
    ],
  },
  {
    version: "0.2.5",
    sections: [
      {
        title: "New",
        items: [
          "Recurring tasks: open the 🔁 Recurring panel in the Tasks tab to set up tasks that repeat daily, weekly or monthly. They're created automatically on schedule while the app is open.",
          "Optional desktop notifications (Settings → Task notifications) for new recurring tasks and tasks due today. Desktop only, and only while the app is running.",
        ],
      },
      {
        title: "Improved",
        items: [
          "Matrix cards now have the same quick actions as the Kanban cards: a done button plus a menu to open, edit or delete the task.",
        ],
      },
    ],
  },
  {
    version: "0.2.4",
    sections: [
      {
        title: "New",
        items: [
          "The Eisenhower view now includes a scatter chart: each open task is a dot placed by urgency (x) and importance (y), on top of the four quadrants. Click a dot to open the task.",
        ],
      },
    ],
  },
  {
    version: "0.2.3",
    sections: [
      {
        title: "New",
        items: [
          "Tasks now have an Eisenhower matrix view (📋 Kanban / 📃 List / 🎯 Matrix). It sorts your open tasks into four quadrants by urgency and importance; drag a task between quadrants to set it, or pick a quadrant when editing a task.",
        ],
      },
    ],
  },
  {
    version: "0.1.9",
    sections: [
      {
        title: "Fixed",
        items: [
          "Duplicated dashboard panels in the sidebar are now removed automatically on startup. They could pile up when the workspace synced between desktop and mobile; the plugin now keeps a single panel of each type.",
        ],
      },
      {
        title: "New",
        items: [
          "This dialog. After every update you'll see a short summary of what changed since the last version you opened.",
        ],
      },
    ],
  },
  {
    version: "0.1.8",
    sections: [
      {
        title: "New — personal finances",
        items: [
          "A full finances module with a ledger and monthly stats: income, expenses and balance.",
          "A category donut (with currency values and a compact center label such as R$8.4k or R$1.2M) and a 6-month trend chart.",
          "An add-transaction bar with a date field, month navigation, and a settings gear.",
          "Recurring costs organized as a month made of weeks (week 1: days 1–7 … week 4: 22–end). Weeks are collapsible and collapsed by default, each showing an income, expense and net summary.",
          "Apply a single week or the whole month of recurring items at once, plus starter templates on the empty state to get going fast.",
          "A currency selector in the main plugin settings that updates the whole dashboard live.",
        ],
      },
      {
        title: "New — AI assistant",
        items: [
          "A right-sidebar chat panel (ribbon icon plus an \"open AI assistant\" command) that reads a snapshot of your data to give grounded answers.",
          "Multiple providers: Google Gemini, Anthropic Claude, xAI Grok, and any OpenAI-compatible endpoint, with an optional desktop-only local command.",
          "Settings show only the fields each provider needs, and API mode and local mode are mutually exclusive.",
          "The assistant can propose changes to your data (create, complete or delete a task, add a transaction, or add a recurring cost) and always shows a confirmation before anything is applied.",
        ],
      },
      {
        title: "New — tasks as Markdown lists",
        items: [
          "Each board mirrors to a Markdown checkbox list, so other plugins (for example Hearth) can read and edit the same tasks.",
          "Board changes update the list and editing the list updates the board, guarded so there is no sync loop.",
        ],
      },
      {
        title: "Improved",
        items: [
          "Fitness and Nutrition calendars are fully clickable, so you can log workouts and meals on past dates directly.",
          "A per-day delete in the day-detail header for both Fitness and Nutrition.",
          "Clearer calendar states (today, selected and hover) so the selected day is never ambiguous.",
          "The data folder now defaults to the plugin name; existing installs keep their previous folder automatically.",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Entries logged close together could overwrite each other; each file now gets a unique name.",
          "Currency changes now apply to data you already entered instead of showing raw numbers.",
          "Meal-plan edits no longer land in the wrong meal (for example dinner edits showing up in lunch).",
          "Task board labels no longer disappear when navigating between boards, kanban and lists.",
        ],
      },
    ],
  },
];

/** Compare two dotted version strings; returns 1, -1 or 0. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** A simple "what changed" dialog, styled after common plugin update notices. */
export class WhatsNewModal extends Modal {
  private appName: string;
  private entries: ChangeEntry[];

  constructor(app: App, appName: string, entries: ChangeEntry[]) {
    super(app);
    this.appName = appName;
    this.entries = entries;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("pa-whatsnew");
    contentEl.createEl("h2", { text: `What's new in ${this.appName}` });
    contentEl.createDiv({ cls: "pa-whatsnew-intro pa-muted", text: "Thanks for updating. Here's what changed since you last checked." });

    this.entries.forEach((e) => {
      contentEl.createEl("h3", { cls: "pa-whatsnew-version", text: e.version });
      e.sections.forEach((sec) => {
        contentEl.createDiv({ cls: "pa-whatsnew-section", text: sec.title });
        const ul = contentEl.createEl("ul", { cls: "pa-whatsnew-list" });
        sec.items.forEach((it) => ul.createEl("li", {}, (li) => this.renderItemText(li, it)));
      });
    });
  }

  /** Renders one changelog item's text, turning `[label](url)` into a real clickable link
   *  and `**bold**` into a real <strong> — a minimal inline-markdown subset, since these
   *  items are plain strings rendered outside Obsidian's Markdown renderer. */
  private renderItemText(li: HTMLElement, text: string): void {
    const pattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|\*\*([^*]+)\*\*/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match.index > lastIndex) li.appendText(text.slice(lastIndex, match.index));
      if (match[1] != null) {
        const a = li.createEl("a", { text: match[1], href: match[2] });
        a.setAttr("target", "_blank");
        a.setAttr("rel", "noopener");
      } else if (match[3] != null) {
        li.createEl("strong", { text: match[3] });
      }
      lastIndex = pattern.lastIndex;
    }
    if (lastIndex < text.length) li.appendText(text.slice(lastIndex));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
