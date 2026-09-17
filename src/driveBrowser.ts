import { ItemView, WorkspaceLeaf, Notice, normalizePath, TFile, TFolder } from "obsidian";
import {
  DriveFile,
  listFiles,
  downloadFile,
  exportFile,
  updateTextFile,
  createTextFile,
  isFolder,
  isGoogleNative,
  EXPORT_MIME,
} from "./googledrive";

export const VIEW_TYPE_DRIVE = "momentum-drive-browser";

/** Returns a fresh Google access_token, or null when the account isn't connected. */
export type TokenProvider = () => Promise<string | null>;

/** Config the view reads from the plugin settings. */
export interface DriveViewConfig {
  getToken: TokenProvider;
  /** Local vault folder mirrored against the Drive folder. */
  mirrorDir: () => string;
  /** Drive folder id to sync (empty/undefined = My Drive root). */
  driveFolderId: () => string | undefined;
}

const EDITABLE_EXT = new Set(["md", "txt", "csv", "json", "canvas", "css", "js", "ts", "yaml", "yml"]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Per-file reconciliation status shown in the middle column. */
type RowStatus = "only_drive" | "only_local" | "same" | "diff" | "native";

interface Row {
  name: string;
  drive?: DriveFile;
  localPath?: string;
  status: RowStatus;
}

/**
 * Two-column Google Drive browser rendered INSIDE Obsidian (no iframe — Google blocks that with
 * X-Frame-Options). Left column: files in the chosen Drive folder. Right column: files in the
 * vault mirror folder. The middle shows each file's state (only on one side, in sync, or
 * differing) with manual download/upload actions. A small header dashboard shows vault metrics.
 *
 * This is the manual, visible half of Drive sync. The automatic bidirectional engine
 * (baseline + 3-way merge, spec blocks 4-8) plugs into the same status model later.
 */
export class DriveBrowserView extends ItemView {
  private cfg: DriveViewConfig;
  private bodyEl: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, cfg: DriveViewConfig) {
    super(leaf);
    this.cfg = cfg;
  }

  getViewType(): string { return VIEW_TYPE_DRIVE; }
  getDisplayText(): string { return "Google Drive"; }
  getIcon(): string { return "hard-drive"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("pa-root", "pa-drive-root");

    const header = root.createDiv({ cls: "pa-drive-header" });
    header.createEl("h3", { text: "Google Drive ⇄ Vault" });
    const refresh = header.createEl("button", { text: "↻ Refresh" });
    refresh.onclick = () => void this.render();

    this.statsEl = root.createDiv({ cls: "pa-drive-stats" });
    this.bodyEl = root.createDiv({ cls: "pa-drive-cols" });
    await this.render();
  }

  private renderStats(driveCount: number, localCount: number, inSync: number, diff: number): void {
    if (!this.statsEl) return;
    this.statsEl.empty();
    const vaultNotes = this.app.vault.getMarkdownFiles().length;
    const allFiles = this.app.vault.getFiles().length;
    const chip = (label: string, value: string | number) => {
      const c = this.statsEl!.createDiv({ cls: "pa-drive-chip" });
      c.createSpan({ cls: "pa-drive-chip-v", text: String(value) });
      c.createSpan({ cls: "pa-drive-chip-l", text: label });
    };
    chip("Notas no vault", vaultNotes);
    chip("Arquivos no vault", allFiles);
    chip("No Drive (pasta)", driveCount);
    chip("Na pasta espelho", localCount);
    chip("Em sync", inSync);
    chip("Divergentes/só-um-lado", diff);
  }

  private async render(): Promise<void> {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    const token = await this.cfg.getToken();

    if (!token) {
      this.bodyEl.createEl("p", {
        text: "Não conectado ao Google. Ative o Google Drive e conecte a conta nas configurações do Momentum.",
      });
      this.renderStats(0, 0, 0, 0);
      return;
    }

    // Left side: Drive folder listing.
    let driveFiles: DriveFile[] = [];
    try {
      driveFiles = await listFiles(token, { folderId: this.cfg.driveFolderId() || undefined });
    } catch (e) {
      this.bodyEl.createEl("p", { text: `Erro ao listar o Drive: ${e instanceof Error ? e.message : String(e)}` });
      this.renderStats(0, 0, 0, 0);
      return;
    }
    driveFiles = driveFiles.filter((f) => !isFolder(f)); // files only, first cut (no recursion yet)

    // Right side: vault mirror folder listing.
    const mirror = normalizePath(this.cfg.mirrorDir());
    const localFiles = this.listLocalMirror(mirror);

    // Build the reconciliation rows by name.
    const byName = new Map<string, Row>();
    for (const d of driveFiles) {
      byName.set(d.name, { name: d.name, drive: d, status: isGoogleNative(d) ? "native" : "only_drive" });
    }
    for (const lp of localFiles) {
      const name = lp.split("/").pop()!;
      const existing = byName.get(name);
      if (existing) {
        existing.localPath = lp;
        existing.status = existing.status === "native" ? "native" : "same"; // size/hash compare comes with the engine
      } else {
        byName.set(name, { name, localPath: lp, status: "only_local" });
      }
    }

    const rows = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    const inSync = rows.filter((r) => r.status === "same").length;
    const oneSide = rows.filter((r) => r.status === "only_drive" || r.status === "only_local" || r.status === "diff").length;
    this.renderStats(driveFiles.length, localFiles.length, inSync, oneSide);

    // Header row.
    const head = this.bodyEl.createDiv({ cls: "pa-drive-row pa-drive-head" });
    head.createDiv({ cls: "pa-drive-cell", text: "Google Drive" });
    head.createDiv({ cls: "pa-drive-cell pa-drive-mid", text: "Estado" });
    head.createDiv({ cls: "pa-drive-cell", text: `Vault / ${mirror}` });

    if (rows.length === 0) {
      this.bodyEl.createEl("p", { text: "(nenhum arquivo dos dois lados)" });
      return;
    }

    for (const r of rows) {
      const row = this.bodyEl.createDiv({ cls: "pa-drive-row" });

      // Left: Drive side.
      const left = row.createDiv({ cls: "pa-drive-cell" });
      if (r.drive) {
        const exp = r.status === "native" ? EXPORT_MIME[r.drive.mimeType] : undefined;
        const label = r.status === "native"
          ? `📄 ${r.name}${exp ? ` (export → .${exp.ext})` : " (não exportável)"}`
          : `📄 ${r.name}`;
        const a = left.createEl("a", { text: label, href: "#" });
        a.onclick = (e) => { e.preventDefault(); void this.openFromDrive(token, r.drive!); };
      } else {
        left.createSpan({ cls: "pa-drive-muted", text: "—" });
      }

      // Middle: status + action.
      const mid = row.createDiv({ cls: "pa-drive-cell pa-drive-mid" });
      mid.createSpan({ text: this.statusLabel(r.status) });
      if (r.status === "only_drive") {
        const b = mid.createEl("button", { text: "↓ baixar" });
        b.onclick = () => void this.openFromDrive(token, r.drive!);
      } else if (r.status === "only_local") {
        const b = mid.createEl("button", { text: "↑ subir" });
        b.onclick = () => void this.uploadLocal(token, r.localPath!);
      }

      // Right: vault side.
      const right = row.createDiv({ cls: "pa-drive-cell" });
      if (r.localPath) {
        const a = right.createEl("a", { text: `📄 ${r.name}`, href: "#" });
        a.onclick = (e) => { e.preventDefault(); void this.openInEditor(r.localPath!); };
      } else {
        right.createSpan({ cls: "pa-drive-muted", text: "—" });
      }
    }
  }

  private statusLabel(s: RowStatus): string {
    switch (s) {
      case "same": return "✓ ";
      case "only_drive": return "☁︎ só no Drive ";
      case "only_local": return "💾 só local ";
      case "diff": return "⚠︎ diferente ";
      case "native": return "G doc (leitura) ";
    }
  }

  /** List markdown/text files directly under the vault mirror folder. */
  private listLocalMirror(dir: string): string[] {
    const folder = this.app.vault.getAbstractFileByPath(dir);
    if (!(folder instanceof TFolder)) return [];
    const out: string[] = [];
    for (const child of folder.children) {
      if (child instanceof TFile) out.push(child.path);
    }
    return out;
  }

  private async openFromDrive(token: string, f: DriveFile): Promise<void> {
    try {
      if (isGoogleNative(f)) {
        const exp = EXPORT_MIME[f.mimeType];
        if (!exp) { new Notice("Tipo Google não exportável."); return; }
        const text = await exportFile(token, f.id, exp.mime);
        const path = await this.writeMirror(`${f.name}.${exp.ext}`, text, undefined);
        await this.openInEditor(path);
        new Notice(`Exportado (leitura): ${f.name} → .${exp.ext}. Re-subir NÃO atualiza o original.`);
      } else {
        const buf = await downloadFile(token, f.id);
        const text = new TextDecoder().decode(buf);
        const path = await this.writeMirror(f.name, text, f.id);
        await this.openInEditor(path);
        new Notice(`Aberto ${f.name}. Edite e use "Save to Drive" para re-subir.`);
      }
      await this.render();
    } catch (e) {
      new Notice(`Falha: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Upload a local mirror file to Drive as a new file in the synced folder. */
  private async uploadLocal(token: string, localPath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(localPath);
    if (!(file instanceof TFile)) return;
    try {
      const content = await this.app.vault.read(file);
      await createTextFile(token, file.name, content, this.cfg.driveFolderId() || undefined);
      new Notice(`Enviado para o Drive: ${file.name}`);
      await this.render();
    } catch (e) {
      new Notice(`Falha ao subir: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async writeMirror(name: string, content: string, driveId: string | undefined): Promise<string> {
    const dir = normalizePath(this.cfg.mirrorDir());
    if (!this.app.vault.getAbstractFileByPath(dir)) {
      await this.app.vault.createFolder(dir).catch(() => {});
    }
    const path = normalizePath(`${dir}/${name}`);
    const body = driveId && (name.endsWith(".md") || name.endsWith(".txt"))
      ? `---\ndrive_id: ${driveId}\n---\n${content}`
      : content;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modify(existing, body);
    else await this.app.vault.create(path, body);
    return path;
  }

  private async openInEditor(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
  }

  /** Re-upload the active mirror note back to its Drive file (from its drive_id frontmatter). */
  async saveActiveToDrive(): Promise<void> {
    const token = await this.cfg.getToken();
    if (!token) { new Notice("Não conectado ao Google."); return; }
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) { new Notice("Nenhum arquivo ativo."); return; }
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
