import { App, Modal } from "obsidian";

export interface ChangeSection { title: string; items: string[]; }
export interface ChangeEntry { version: string; sections: ChangeSection[]; }

/** Release notes shown in the "What's new" dialog, newest first. */
export const CHANGELOG: ChangeEntry[] = [
  {
    version: "0.1.9",
    sections: [
      {
        title: "Fixed",
        items: [
          "Duplicated dashboard entries in the sidebar are now removed automatically on startup (they could pile up when the workspace synced between desktop and mobile).",
        ],
      },
      {
        title: "New",
        items: [
          "This dialog. After every update you'll see a short summary of what changed since you last opened the plugin.",
        ],
      },
    ],
  },
  {
    version: "0.1.8",
    sections: [
      {
        title: "New",
        items: [
          "Personal Finances module: ledger with monthly income, expenses and balance, a category donut, a 6-month trend, and an add bar with a date field.",
          "Recurring costs organized as a month made of collapsible weeks; apply a single week or the whole month at once, with starter templates to begin.",
          "Currency selector in settings that updates the whole dashboard live.",
          "AI assistant side panel with multiple providers (Gemini, Claude, Grok, OpenAI-compatible) plus an optional desktop-only local command.",
          "The AI can propose changes to your data (create/complete/delete a task, add a transaction or a recurring cost) and always asks you to confirm before applying.",
          "Two-way sync between task boards and Markdown checkbox lists, so other plugins can read and edit the same tasks.",
        ],
      },
      {
        title: "Improved",
        items: [
          "Fitness and Nutrition calendars are fully clickable to log on past dates, with a per-day delete and clearer selected-day states.",
        ],
      },
      {
        title: "Fixed",
        items: [
          "Entries logged close together could overwrite each other; currency changes now apply to existing data; meal-plan edits no longer land in the wrong meal; task board labels no longer vanish when navigating.",
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
