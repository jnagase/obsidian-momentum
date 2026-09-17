import { ItemView, WorkspaceLeaf, Notice, normalizePath } from "obsidian";
import {
  DriveFile,
  listFiles,
  downloadFile,
  exportFile,
  updateTextFile,
  isFolder,
  isGoogleNative,
  EXPORT_MIME,
} from "./googledrive";

export const VIEW_TYPE_DRIVE = "momentum-drive-browser";

/** Returns a fresh Google access_token, or null when the account isn't connected. */
export type TokenProvider = () => Promise<string | null>;

/** Text file extensions the browser will open in-place for editing. */
const EDITABLE_EXT = new Set(["md", "txt", "csv", "json", "canvas", "css", "js", "ts", "yaml", "yml"]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/**
 * Native Google Drive browser rendered INSIDE Obsidian. It deliberately does NOT embed
 * drive.google.com in an iframe (Google sends X-Frame-Options: SAMEORIGIN, which the Electron
 * shell refuses). Instead it draws its own UI over the Drive REST API:
 *   - navigate folders (files.list by parent)
 *   - open a text/markdown file → downloads it into the vault and opens it for editing
 *   - Save back to Drive → re-uploads the vault copy (files.update)
 *   - Google-native docs (Docs/Sheets/Slides) → exported one-way (Doc→Markdown, Sheet→CSV)
 */
export class DriveBrowserView extends ItemView {
  private getToken: TokenProvider;
  /** Folder navigation stack: [{id,name}], root first. `undefined` id = My Drive root. */
  private stack: { id: string | undefined; name: string }[] = [{ id: undefined, name: "My Drive" }];
  private listEl: HTMLElement | null = null;
  private crumbEl: HTMLElement | null = null;
  /** Local folder inside the vault where opened Drive files are mirrored for editing. */
  private mirrorDir = "Drive";

  constructor(leaf: WorkspaceLeaf, getToken: TokenProvider) {
    super(leaf);
    this.getToken = getToken;
  }

  getViewType(): string { return VIEW_TYPE_DRIVE; }
  getDisplayText(): string { return "Google Drive"; }
  getIcon(): string { return "hard-drive"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("pa-root", "pa-drive-root");
    const header = root.createDiv({ cls: "pa-drive-header" });
    header.createEl("h3", { text: "Google Drive" });
    const refresh = header.createEl("button", { text: "↻ Refresh" });
    refresh.onclick = () => void this.render();
    this.crumbEl = root.createDiv({ cls: "pa-drive-crumbs" });
    this.listEl = root.createDiv({ cls: "pa-drive-list" });
    await this.render();
  }

  private async render(): Promise<void> {
    if (!this.listEl || !this.crumbEl) return;
    const token = await this.getToken();
    this.crumbEl.empty();
    this.listEl.empty();

    if (!token) {
      this.listEl.createEl("p", {
        text: "Not connected to Google. Enable Google integration and connect your account in Momentum settings.",
      });
      return;
    }

    // Breadcrumbs — click a crumb to pop back to that folder.
    this.stack.forEach((entry, i) => {
      if (i > 0) this.crumbEl!.createSpan({ text: " / " });
      const a = this.crumbEl!.createEl("a", { text: entry.name, href: "#" });
      a.onclick = (e) => {
        e.preventDefault();
        this.stack = this.stack.slice(0, i + 1);
        void this.render();
      };
    });

    const current = this.stack[this.stack.length - 1];
    let files: DriveFile[];
    try {
      files = await listFiles(token, { folderId: current.id });
    } catch (e) {
      this.listEl.createEl("p", { text: `Error listing Drive: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }

    // Folders first, then files, each alphabetical.
    files.sort((a, b) => {
      const fa = isFolder(a) ? 0 : 1;
      const fb = isFolder(b) ? 0 : 1;
      return fa !== fb ? fa - fb : a.name.localeCompare(b.name);
    });

    if (files.length === 0) {
      this.listEl.createEl("p", { text: "(empty folder)" });
      return;
    }

    for (const f of files) {
      const row = this.listEl.createDiv({ cls: "pa-drive-row" });
      if (isFolder(f)) {
        const a = row.createEl("a", { text: `📁 ${f.name}`, href: "#" });
        a.onclick = (e) => {
          e.preventDefault();
          this.stack.push({ id: f.id, name: f.name });
          void this.render();
        };
      } else if (isGoogleNative(f)) {
        const exp = EXPORT_MIME[f.mimeType];
        const label = exp ? `📄 ${f.name}  (export → .${exp.ext})` : `📄 ${f.name}  (não exportável)`;
        const a = row.createEl("a", { text: label, href: "#" });
        a.onclick = (e) => {
          e.preventDefault();
          void this.openNative(token, f);
        };
      } else {
        const editable = EDITABLE_EXT.has(extOf(f.name));
        const a = row.createEl("a", { text: `📄 ${f.name}${editable ? "" : "  (binário)"}`, href: "#" });
        a.onclick = (e) => {
          e.preventDefault();
          if (editable) void this.openText(token, f);
          else new Notice("Arquivo binário: abra pelo Drive. A edição in-place é só para texto.");
        };
      }
    }
  }

  /** Download a text file into the vault mirror folder and open it for editing. */
  private async openText(token: string, f: DriveFile): Promise<void> {
    try {
      const buf = await downloadFile(token, f.id);
      const text = new TextDecoder().decode(buf);
      const path = await this.writeMirror(f.name, text, f.id);
      await this.openInEditor(path);
      new Notice(`Aberto ${f.name}. Edite e use "Save to Drive" para re-subir.`);
    } catch (e) {
      new Notice(`Falha ao abrir: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Export a Google-native doc (one-way) into the vault mirror folder for reading. */
  private async openNative(token: string, f: DriveFile): Promise<void> {
    const exp = EXPORT_MIME[f.mimeType];
    if (!exp) {
      new Notice("Este tipo de arquivo Google não pode ser exportado.");
      return;
    }
    try {
      const text = await exportFile(token, f.id, exp.mime);
      // Native export is one-way — do NOT tag it with the Drive id, so it can't be re-uploaded
      // over the native original by mistake.
      const path = await this.writeMirror(`${f.name}.${exp.ext}`, text, undefined);
      await this.openInEditor(path);
      new Notice(`Exportado (somente leitura): ${f.name} → .${exp.ext}. Re-subir NÃO atualiza o original.`);
    } catch (e) {
      new Notice(`Falha ao exportar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Write content to the vault mirror folder. When `driveId` is set, records it in the note
   * frontmatter so "Save to Drive" knows which file to update.
   */
  private async writeMirror(name: string, content: string, driveId: string | undefined): Promise<string> {
    const dir = normalizePath(this.mirrorDir);
    if (!this.app.vault.getAbstractFileByPath(dir)) {
      await this.app.vault.createFolder(dir).catch(() => {});
    }
    const path = normalizePath(`${dir}/${name}`);
    const body = driveId && (name.endsWith(".md") || name.endsWith(".txt"))
      ? `---\ndrive_id: ${driveId}\n---\n${content}`
      : content;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      // @ts-expect-error TFile is the concrete type here.
      await this.app.vault.modify(existing, body);
    } else {
      await this.app.vault.create(path, body);
    }
    return path;
  }

  private async openInEditor(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) return;
    const leaf = this.app.workspace.getLeaf(true);
    // @ts-expect-error openFile accepts a TFile.
    await leaf.openFile(file);
  }

  /**
   * Re-upload the currently active mirror note back to its Drive file (from its drive_id
   * frontmatter). Exposed so main.ts can wire it to a command / button.
   */
  async saveActiveToDrive(): Promise<void> {
    const token = await this.getToken();
    if (!token) { new Notice("Não conectado ao Google."); return; }
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice("Nenhum arquivo ativo."); return; }
    const raw = await this.app.vault.read(file);
    const m = raw.match(/^---\ndrive_id:\s*(\S+)\n---\n([\s\S]*)$/);
    if (!m) { new Notice("Este arquivo não tem drive_id — não veio do Drive."); return; }
    const [, driveId, content] = m;
    try {
      await updateTextFile(token, driveId, content);
      new Notice("Salvo no Google Drive.");
    } catch (e) {
      new Notice(`Falha ao salvar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
