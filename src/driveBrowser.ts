import { ItemView, WorkspaceLeaf, Notice, normalizePath, TFile, TFolder } from "obsidian";
import { drawDonut } from "./charts";
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

export type TokenProvider = () => Promise<string | null>;

export interface DriveViewConfig {
  getToken: TokenProvider;
  mirrorDir: () => string;
  driveFolderId: () => string | undefined;
}

const EDITABLE_EXT = new Set(["md", "txt", "csv", "json", "canvas", "css", "js", "ts", "yaml", "yml"]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Per-file reconciliation status (see UX research: green=ok, blue=cloud, amber=conflict, gray=ignored). */
type RowStatus = "only_drive" | "only_local" | "same" | "diff" | "native";

/** Convergent status color language from Dropbox/OneDrive/Nextcloud research. */
const STATUS_META: Record<RowStatus, { label: string; icon: string; color: string }> = {
  same:       { label: "In sync",     icon: "✓", color: "#16a34a" }, // green
  only_drive: { label: "Drive only",  icon: "☁", color: "#3b82f6" }, // blue (cloud)
  only_local: { label: "Local only",  icon: "💾", color: "#0ea5e9" }, // cyan
  diff:       { label: "Diverged",    icon: "⚠", color: "#f59e0b" }, // amber (conflict)
  native:     { label: "Google doc",  icon: "G", color: "#9ca3af" }, // gray (read-only export)
};

interface Row {
  name: string;
  drive?: DriveFile;
  localPath?: string;
  status: RowStatus;
  size: number;
  modified: string;
}

type SortField = "name" | "size" | "modified" | "status";

/**
 * Two-column Google Drive browser inside Obsidian, with a status dashboard (donut + counters),
 * filter chips, search, a "show only diverging" toggle, and sortable columns. Grounded in
 * dual-pane file-manager + sync-app UX research. No iframe (Google blocks it).
 */
export class DriveBrowserView extends ItemView {
  private cfg: DriveViewConfig;
  private dashEl: HTMLElement | null = null;
  private controlsEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;

  private rows: Row[] = [];
  private search = "";
  private activeFilters = new Set<RowStatus>();
  private onlyDiverging = false;
  private sortField: SortField = "name";
  private sortDir: 1 | -1 = 1;
  private lastToken: string | null = null;

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
    root.addClass("pa-drive-root");

    const header = root.createDiv({ cls: "pa-section-head pa-drive-header" });
    header.createEl("h3", { text: "Google Drive ⇄ Vault" });
    const refresh = header.createEl("button", { cls: "pa-mini-btn", text: "↻ Refresh" });
    refresh.onclick = () => void this.reload();

    this.dashEl = root.createDiv({ cls: "pa-drive-dash" });
    this.controlsEl = root.createDiv({ cls: "pa-panel pa-drive-controls" });
    this.bodyEl = root.createDiv({ cls: "pa-panel pa-drive-cols" });
    await this.reload();
  }

  /** Fetch both sides and rebuild the row model, then render. */
  private async reload(): Promise<void> {
    const token = await this.cfg.getToken();
    this.lastToken = token;
    if (!token) { this.rows = []; this.render(); return; }

    let driveFiles: DriveFile[] = [];
    try {
      driveFiles = (await listFiles(token, { folderId: this.cfg.driveFolderId() || undefined })).filter((f) => !isFolder(f));
    } catch (e) {
      this.rows = [];
      this.render(`Error listing Drive: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const mirror = normalizePath(this.cfg.mirrorDir());
    const localFiles = this.listLocalMirror(mirror);
    const localByName = new Map(localFiles.map((p) => [p.split("/").pop()!, p]));

    const byName = new Map<string, Row>();
    for (const d of driveFiles) {
      byName.set(d.name, {
        name: d.name, drive: d,
        status: isGoogleNative(d) ? "native" : "only_drive",
        size: d.size ? parseInt(d.size, 10) : 0,
        modified: d.modifiedTime ?? "",
      });
    }
    for (const [name, lp] of localByName) {
      const ex = byName.get(name);
      if (ex) { ex.localPath = lp; if (ex.status !== "native") ex.status = "same"; }
      else byName.set(name, { name, localPath: lp, status: "only_local", size: 0, modified: "" });
    }
    this.rows = [...byName.values()];
    this.render();
  }

  private render(errorMsg?: string): void {
    this.renderDashboard();
    this.renderControls();
    this.renderBody(errorMsg);
  }

  // ---- dashboard: donut by status + counters ------------------------------------------
  private renderDashboard(): void {
    if (!this.dashEl) return;
    this.dashEl.empty();
    this.dashEl.addClass("pa-panel");
    const counts = this.statusCounts();

    const inner = this.dashEl.createDiv({ cls: "pa-drive-dash-inner" });
    const donutWrap = inner.createDiv({ cls: "pa-drive-donut" });
    drawDonut(
      donutWrap,
      (Object.keys(STATUS_META) as RowStatus[]).map((s) => ({
        label: STATUS_META[s].label, value: counts[s], color: STATUS_META[s].color,
      })),
      130,
      undefined,
      () => String(this.rows.length),
    );

    const chips = inner.createDiv({ cls: "pa-stats-row pa-drive-counters" });
    const vaultNotes = this.app.vault.getMarkdownFiles().length;
    const allFiles = this.app.vault.getFiles().length;
    const counter = (label: string, value: number | string, color?: string) => {
      const c = chips.createDiv({ cls: "pa-stat" });
      const v = c.createSpan({ cls: "pa-stat-value", text: String(value) });
      if (color) v.style.color = color;
      c.createDiv({ cls: "pa-stat-label", text: label });
    };
    counter("Vault notes", vaultNotes);
    counter("Vault files", allFiles);
    (Object.keys(STATUS_META) as RowStatus[]).forEach((s) =>
      counter(STATUS_META[s].label, counts[s], STATUS_META[s].color),
    );
  }

  private statusCounts(): Record<RowStatus, number> {
    const c: Record<RowStatus, number> = { same: 0, only_drive: 0, only_local: 0, diff: 0, native: 0 };
    for (const r of this.rows) c[r.status]++;
    return c;
  }

  // ---- controls: search + status filter chips + only-diverging toggle -----------------
  private renderControls(): void {
    if (!this.controlsEl) return;
    this.controlsEl.empty();

    const searchInput = this.controlsEl.createEl("input", { cls: "pa-drive-search", type: "text", placeholder: "Search…" });
    searchInput.value = this.search;
    searchInput.oninput = () => { this.search = searchInput.value.toLowerCase(); this.renderBody(); };

    const chipRow = this.controlsEl.createDiv({ cls: "pa-drive-filterchips" });
    (Object.keys(STATUS_META) as RowStatus[]).forEach((s) => {
      const meta = STATUS_META[s];
      const chip = chipRow.createEl("button", { cls: "pa-drive-filterchip", text: `${meta.icon} ${meta.label}` });
      chip.style.borderColor = meta.color;
      if (this.activeFilters.has(s)) { chip.addClass("active"); chip.style.background = meta.color; chip.style.color = "#fff"; }
      chip.onclick = () => {
        if (this.activeFilters.has(s)) this.activeFilters.delete(s); else this.activeFilters.add(s);
        this.renderControls(); this.renderBody();
      };
    });

    const toggle = this.controlsEl.createEl("label", { cls: "pa-drive-toggle" });
    const cb = toggle.createEl("input", { type: "checkbox" });
    cb.checked = this.onlyDiverging;
    cb.onchange = () => { this.onlyDiverging = cb.checked; this.renderBody(); };
    toggle.createSpan({ text: " Only diverging" });
  }

  // ---- body: sortable two-column list -------------------------------------------------
  private renderBody(errorMsg?: string): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();

    if (!this.lastToken) {
      this.bodyEl.createEl("p", { text: "Not connected to Google. Enable Google Drive and connect your account in Momentum settings." });
      return;
    }
    if (errorMsg) { this.bodyEl.createEl("p", { text: errorMsg }); return; }

    const head = this.bodyEl.createDiv({ cls: "pa-drive-row pa-drive-head" });
    head.createDiv({ cls: "pa-drive-cell", text: "Google Drive" });
    this.sortHeader(head.createDiv({ cls: "pa-drive-cell pa-drive-mid" }), "Status", "status");
    head.createDiv({ cls: "pa-drive-cell", text: `Vault / ${normalizePath(this.cfg.mirrorDir())}` });

    const rows = this.visibleRows();
    if (rows.length === 0) { this.bodyEl.createEl("p", { text: "(nothing matches the filter)" }); return; }

    for (const r of rows) {
      const meta = STATUS_META[r.status];
      const row = this.bodyEl.createDiv({ cls: "pa-drive-row" });

      const left = row.createDiv({ cls: "pa-drive-cell" });
      if (r.drive) {
        const exp = r.status === "native" ? EXPORT_MIME[r.drive.mimeType] : undefined;
        const label = r.status === "native" ? `📄 ${r.name}${exp ? ` (→ .${exp.ext})` : ""}` : `📄 ${r.name}`;
        const a = left.createEl("a", { text: label, href: "#" });
        a.onclick = (e) => { e.preventDefault(); void this.openFromDrive(this.lastToken!, r.drive!); };
      } else left.createSpan({ cls: "pa-drive-muted", text: "—" });

      const mid = row.createDiv({ cls: "pa-drive-cell pa-drive-mid" });
      const badge = mid.createSpan({ text: `${meta.icon} ${meta.label}` });
      badge.style.color = meta.color;
      if (r.status === "only_drive" || r.status === "native") {
        const b = mid.createEl("button", { cls: "pa-mini-btn", text: "↓" }); b.title = "download";
        b.onclick = () => void this.openFromDrive(this.lastToken!, r.drive!);
      } else if (r.status === "only_local") {
        const b = mid.createEl("button", { cls: "pa-mini-btn", text: "↑" }); b.title = "upload";
        b.onclick = () => void this.uploadLocal(this.lastToken!, r.localPath!);
      }

      const right = row.createDiv({ cls: "pa-drive-cell" });
      if (r.localPath) {
        const a = right.createEl("a", { text: `📄 ${r.name}`, href: "#" });
        a.onclick = (e) => { e.preventDefault(); void this.openInEditor(r.localPath!); };
      } else right.createSpan({ cls: "pa-drive-muted", text: "—" });
    }
  }

  private sortHeader(el: HTMLElement, label: string, field: SortField): void {
    const glyph = this.sortField === field ? (this.sortDir === 1 ? " ▲" : " ▼") : "";
    const a = el.createEl("a", { text: label + glyph, href: "#" });
    a.onclick = (e) => {
      e.preventDefault();
      if (this.sortField === field) this.sortDir = this.sortDir === 1 ? -1 : 1;
      else { this.sortField = field; this.sortDir = 1; }
      this.renderBody();
    };
  }

  private visibleRows(): Row[] {
    let rows = this.rows.slice();
    if (this.search) rows = rows.filter((r) => r.name.toLowerCase().includes(this.search));
    if (this.activeFilters.size) rows = rows.filter((r) => this.activeFilters.has(r.status));
    if (this.onlyDiverging) rows = rows.filter((r) => r.status !== "same");
    const dir = this.sortDir;
    rows.sort((a, b) => {
      switch (this.sortField) {
        case "size": return (a.size - b.size) * dir;
        case "modified": return a.modified.localeCompare(b.modified) * dir;
        case "status": return a.status.localeCompare(b.status) * dir;
        default: return a.name.localeCompare(b.name) * dir;
      }
    });
    return rows;
  }

  // ---- file operations (unchanged behavior) -------------------------------------------
  private listLocalMirror(dir: string): string[] {
    const folder = this.app.vault.getAbstractFileByPath(dir);
    if (!(folder instanceof TFolder)) return [];
    return folder.children.filter((c): c is TFile => c instanceof TFile).map((f) => f.path);
  }

  private async openFromDrive(token: string, f: DriveFile): Promise<void> {
    try {
      if (isGoogleNative(f)) {
        const exp = EXPORT_MIME[f.mimeType];
        if (!exp) { new Notice("This Google file type can't be exported."); return; }
        const text = await exportFile(token, f.id, exp.mime);
        const path = await this.writeMirror(`${f.name}.${exp.ext}`, text, undefined);
        await this.openInEditor(path);
        new Notice(`Exported (read-only): ${f.name} → .${exp.ext}.`);
      } else {
        const text = new TextDecoder().decode(await downloadFile(token, f.id));
        const path = await this.writeMirror(f.name, text, f.id);
        await this.openInEditor(path);
        new Notice(`Opened ${f.name}.`);
      }
      await this.reload();
    } catch (e) { new Notice(`Failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  private async uploadLocal(token: string, localPath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(localPath);
    if (!(file instanceof TFile)) return;
    try {
      const content = await this.app.vault.read(file);
      await createTextFile(token, file.name, content, this.cfg.driveFolderId() || undefined);
      new Notice(`Uploaded to Drive: ${file.name}`);
      await this.reload();
    } catch (e) { new Notice(`Upload failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  private async writeMirror(name: string, content: string, driveId: string | undefined): Promise<string> {
    const dir = normalizePath(this.cfg.mirrorDir());
    if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir).catch(() => {});
    const path = normalizePath(`${dir}/${name}`);
    const body = driveId && (name.endsWith(".md") || name.endsWith(".txt")) ? `---\ndrive_id: ${driveId}\n---\n${content}` : content;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modify(existing, body);
    else await this.app.vault.create(path, body);
    return path;
  }

  private async openInEditor(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  async saveActiveToDrive(): Promise<void> {
    const token = await this.cfg.getToken();
    if (!token) { new Notice("Not connected to Google."); return; }
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) { new Notice("No active file."); return; }
    const raw = await this.app.vault.read(file);
    const m = raw.match(/^---\ndrive_id:\s*(\S+)\n---\n([\s\S]*)$/);
    if (!m) { new Notice("This file has no drive_id — it didn't come from Drive."); return; }
    const [, driveId, content] = m;
    try { await updateTextFile(token, driveId, content); new Notice("Saved to Google Drive."); }
    catch (e) { new Notice(`Save failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
}
