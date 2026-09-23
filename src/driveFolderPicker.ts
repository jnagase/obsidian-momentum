import { App, Modal, Notice, Setting } from "obsidian";
import { listFiles, createFolder, isFolder, DriveFile } from "./googledrive";

/** What the picker returns: the chosen Drive folder's id + a human display name. */
export interface DriveFolderChoice {
  /** Drive folder id, or "" for My Drive root (kept empty so the engine's `id || "root"` holds). */
  id: string;
  name: string;
}

/**
 * A native (in-plugin) Google Drive folder picker — no Google Picker widget, which is awkward in
 * Electron and needs extra API keys. It navigates the Drive folder tree with the same Drive API
 * the sync uses, lets the user create a subfolder, and returns the chosen folder. Isolated from
 * Tasks: it only reads/creates folders with the Drive token.
 */
export class DriveFolderPicker extends Modal {
  private token: string;
  private onChoose: (choice: DriveFolderChoice) => void | Promise<void>;
  /** Navigation stack from root; last item is the current folder. */
  private stack: { id: string; name: string }[] = [{ id: "root", name: "My Drive" }];
  private crumbEl!: HTMLElement;
  private listEl!: HTMLElement;

  constructor(app: App, token: string, onChoose: (choice: DriveFolderChoice) => void | Promise<void>) {
    super(app);
    this.token = token;
    this.onChoose = onChoose;
  }

  private cur(): { id: string; name: string } { return this.stack[this.stack.length - 1]; }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pa-drive-picker");
    contentEl.createEl("h3", { text: "Choose a Google Drive folder" });
    this.crumbEl = contentEl.createDiv({ cls: "pa-drive-picker-crumb" });
    this.listEl = contentEl.createDiv({ cls: "pa-drive-picker-list" });

    // New-subfolder creator for the current folder.
    const create = new Setting(contentEl).setName("New subfolder here");
    let newName = "";
    create.addText((t) => t.setPlaceholder("Folder name").onChange((v) => { newName = v.trim(); }));
    create.addButton((b) =>
      b.setButtonText("Create").onClick(async () => {
        if (!newName) { new Notice("Type a folder name first."); return; }
        try {
          const parent = this.cur().id;
          const folder = await createFolder(this.token, newName, parent === "root" ? undefined : parent);
          new Notice(`Created "${folder.name}".`);
          this.stack.push({ id: folder.id, name: folder.name }); // descend into the new folder
          await this.load();
        } catch (e) { new Notice(`Create failed: ${e instanceof Error ? e.message : String(e)}`); }
      }),
    );

    // Footer: use the current folder, or cancel.
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b.setButtonText("Use this folder").setCta().onClick(() => {
          const c = this.cur();
          void this.onChoose(c.id === "root" ? { id: "", name: "My Drive" } : { id: c.id, name: c.name });
          this.close();
        }),
      );

    void this.load();
  }

  /** Load the current folder's subfolders and re-render breadcrumb + list. */
  private async load(): Promise<void> {
    this.renderCrumb();
    this.listEl.empty();
    this.listEl.createEl("p", { cls: "pa-drive-picker-muted", text: "Loading…" });
    let folders: DriveFile[];
    try {
      folders = (await listFiles(this.token, { folderId: this.cur().id })).filter(isFolder);
    } catch (e) {
      this.listEl.empty();
      this.listEl.createEl("p", { text: `Error: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    folders.sort((a, b) => a.name.localeCompare(b.name));
    this.listEl.empty();
    if (this.stack.length > 1) {
      const up = this.listEl.createEl("button", { cls: "pa-drive-picker-item", text: "⬆ Up" });
      up.onclick = () => { this.stack.pop(); void this.load(); };
    }
    if (folders.length === 0) {
      this.listEl.createEl("p", { cls: "pa-drive-picker-muted", text: "(No subfolders)" });
    }
    for (const f of folders) {
      const item = this.listEl.createEl("button", { cls: "pa-drive-picker-item", text: `📁 ${f.name}` });
      item.onclick = () => { this.stack.push({ id: f.id, name: f.name }); void this.load(); };
    }
  }

  private renderCrumb(): void {
    this.crumbEl.empty();
    this.stack.forEach((node, i) => {
      if (i > 0) this.crumbEl.createSpan({ text: " / " });
      const a = this.crumbEl.createEl("a", { text: node.name, href: "#" });
      a.onclick = (e) => { e.preventDefault(); this.stack = this.stack.slice(0, i + 1); void this.load(); };
    });
  }

  onClose(): void { this.contentEl.empty(); }
}
