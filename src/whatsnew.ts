import { App, Modal } from "obsidian";

export interface ChangeSection { title: string; items: string[]; }
export interface ChangeEntry { version: string; sections: ChangeSection[]; }

/** Release notes shown in the "What's new" dialog, newest first. */
export const CHANGELOG: ChangeEntry[] = [
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
        sec.items.forEach((it) => ul.createEl("li", { text: it }));
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
