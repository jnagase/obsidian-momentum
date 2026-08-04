import { App } from "obsidian";
import { ConfirmModal, MenuAction, showActionMenu } from "./ui";

export interface CardActionOpts {
  app: App;
  title: string;
  isDone: boolean;
  onDone: () => void;
  onDelete: () => void;
  extraMenuItems?: MenuAction[];
}

/** Render the top-right action strip (✓ done, 🗑 delete, ⋮ menu) on any card. */
export function renderCardActions(card: HTMLElement, opts: CardActionOpts): void {
  const acts = card.createDiv({ cls: "pa-card-top-actions" });

  // In the done column the card is already complete, so the button reopens it (moves it
  // back) instead of offering a meaningless "mark done". Elsewhere it marks the task done.
  const doneBtn = acts.createEl("button", {
    text: opts.isDone ? "↩" : "✓",
    cls: "pa-icon-btn pa-card-done",
  });
  doneBtn.setAttr("aria-label", opts.isDone ? "Reopen" : "Mark done");
  doneBtn.onclick = (e) => {
    e.stopPropagation();
    opts.onDone();
  };

  const delBtn = acts.createEl("button", {
    text: "🗑",
    cls: "pa-icon-btn pa-card-delete",
  });
  delBtn.setAttr("aria-label", "Delete");
  delBtn.onclick = (e) => {
    e.stopPropagation();
    new ConfirmModal(opts.app, `Delete "${opts.title}"?`, opts.onDelete).open();
  };

  const menuBtn = acts.createEl("button", {
    text: "⋮",
    cls: "pa-icon-btn pa-card-menu",
  });
  menuBtn.onclick = (e) => {
    e.stopPropagation();
    showActionMenu(e, opts.extraMenuItems ?? []);
  };
}
