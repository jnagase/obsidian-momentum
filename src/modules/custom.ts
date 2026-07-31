import { PAContext } from "../context";
import { CustomPage } from "../types";

/**
 * Renders a user-defined "custom page": a section that lists the markdown notes
 * under a chosen vault folder (e.g. a "Books" tab over the `Books/` folder).
 * Read-only: each note is a card that opens the note on click.
 */
export class CustomModule {
  private ctx: PAContext;
  constructor(ctx: PAContext) { this.ctx = ctx; }

  render(root: HTMLElement, page: CustomPage): void {
    root.empty();

    const head = root.createDiv({ cls: "pa-ht-header" });
    const left = head.createDiv();
    left.createDiv({ text: `${page.emoji || "📄"} ${page.label}`, cls: "pa-h1" });
    left.createDiv({ text: page.folder, cls: "pa-muted" });

    const folder = (page.folder || "").trim();
    if (!folder) { root.createEl("p", { cls: "pa-muted", text: "This section has no folder set." }); return; }

    const notes = this.ctx.store.loadFolderNotes(folder);
    left.createDiv({ text: `${notes.length} note${notes.length === 1 ? "" : "s"}`, cls: "pa-muted" });

    if (!notes.length) {
      root.createEl("p", { cls: "pa-muted", text: `No notes found under "${folder}".` });
      return;
    }

    const grid = root.createDiv({ cls: "pa-list-cards" });
    for (const n of notes) {
      const card = grid.createDiv({ cls: "pa-card pa-task" });
      card.createDiv({ text: n.title, cls: "pa-card-title" });
      card.onclick = () => this.ctx.app.workspace.openLinkText(n.path, "", true);
    }
  }
}
