import { App, ItemView, WorkspaceLeaf, Notice, normalizePath, TFile, TFolder } from "obsidian";
import { drawDonut } from "./charts";
import {
  DriveFile,
  downloadFile,
  exportFile,
  updateTextFile,
  createTextFile,
  isGoogleNative,
  EXPORT_MIME,
} from "./googledrive";
import { walkRemoteTree } from "./driveSync";

export const VIEW_TYPE_DRIVE = "momentum-drive-browser";

export type TokenProvider = () => Promise<string | null>;

export interface DriveViewConfig {
  getToken: TokenProvider;
  mirrorDir: () => string;
  driveFolderId: () => string | undefined;
  /** Plugin data root to exclude in whole-vault mode (mirrors the engine's exclusion). */
  dataRoot?: () => string;
  /** Run a full bidirectional Drive sync now, reporting progress for a UI indicator. */
  syncNow?: (onProgress?: (p: { done: number; total: number }) => void) => Promise<void>;
}

type RowStatus = "only_drive" | "only_local" | "same" | "diff" | "native";

const STATUS_META: Record<RowStatus, { label: string; icon: string; color: string }> = {
  same:       { label: "In sync",     icon: "✓", color: "#16a34a" },
  only_drive: { label: "Drive only",  icon: "☁", color: "#3b82f6" },
  only_local: { label: "Local only",  icon: "💾", color: "#0ea5e9" },
  diff:       { label: "Diverged",    icon: "⚠", color: "#f59e0b" },
  native:     { label: "Google doc",  icon: "G", color: "#9ca3af" },
};

interface Row { name: string; drive?: DriveFile; localPath?: string; status: RowStatus; size: number; modified: string; }
type SortField = "name" | "size" | "modified" | "status";

/**
 * The Google Drive ⇄ Vault panel controller. Renders the whole two-column browser (status
 * donut + counters, search/filter chips, sortable list) into ANY container element, so it can
 * be a standalone tab (DriveBrowserView) OR a section inside the File Manager tab.
 * No iframe — Google blocks embedding the Drive UI (X-Frame-Options).
 */
export class DrivePanel {
  private app: App;
  private container: HTMLElement;
  private cfg: DriveViewConfig;
  private dashEl!: HTMLElement;
  private controlsEl!: HTMLElement;
  private bodyEl!: HTMLElement;

  private rows: Row[] = [];
  private search = "";
  private activeFilters = new Set<RowStatus>();
  private onlyDiverging = false;
  private sortField: SortField = "name";
  private sortDir: 1 | -1 = 1;
  private lastToken: string | null = null;

  /** When embedded inside the File Manager, the host provides the title + refresh, so the panel
   *  skips its own header to avoid a duplicate "Google Drive ⇄ vault" heading. */
  private embedded: boolean;

  constructor(app: App, container: HTMLElement, cfg: DriveViewConfig, opts: { embedded?: boolean } = {}) {
    this.app = app;
    this.container = container;
    this.cfg = cfg;
    this.embedded = !!opts.embedded;
  }

  /** Build the panel scaffold in the container and do the first load. */
  async mount(): Promise<void> {
    this.container.empty();
    if (!this.embedded) {
      const header = this.container.createDiv({ cls: "pa-section-head pa-drive-header" });
      header.createEl("h3", { text: "Google Drive ⇄ vault" });
      const refresh = header.createEl("button", { cls: "pa-mini-btn", text: "↻ refresh" });
      refresh.onclick = () => void this.reload();
    }
    this.dashEl = this.container.createDiv({ cls: "pa-drive-dash" });
    this.controlsEl = this.container.createDiv({ cls: "pa-panel pa-drive-controls" });
    this.bodyEl = this.container.createDiv({ cls: "pa-panel pa-drive-cols" });
    if (this.embedded) {
      // The File Manager re-renders on every file-open, so DON'T auto-walk here (it would rescan
      // the whole Drive each time). Paint the dashboard from local data and wait for Refresh.
      this.renderDashboard();
      this.renderControls();
      this.bodyEl.empty();
      this.bodyEl.createEl("p", { cls: "pa-drive-muted", text: "Click refresh to load the synced file list." });
    } else {
      await this.reload();
    }
  }

  /** Public refresh — re-scan Drive + vault (used by the File Manager's embedded refresh button). */
  async refresh(): Promise<void> { await this.reload(); }

  private async reload(): Promise<void> {
    const token = await this.cfg.getToken();
    this.lastToken = token;
    if (!token) { this.rows = []; this.render(); return; }
    // The recursive walk (one listing per folder) can take a while on a big tree, so paint the
    // dashboard + a loading note immediately instead of leaving empty panels.
    this.renderDashboard();
    this.renderControls();
    this.bodyEl.empty();
    this.bodyEl.createEl("p", { cls: "pa-drive-muted", text: "Loading drive… (scanning folders, this can take a moment on large folders)" });
    // Recursive, path-based view — mirrors the sync engine so the counts reflect subfolders and
    // whole-vault mode (the old flat top-level listing showed 0 in those cases).
    let tree: { files: Map<string, DriveFile> };
    try {
      tree = await walkRemoteTree(token, this.cfg.driveFolderId() || "root");
    } catch (e) {
      this.rows = [];
      this.render(`Error listing Drive: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const localByPath = this.listLocalMirror();
    const byPath = new Map<string, Row>();
    for (const [rel, d] of tree.files) {
      byPath.set(rel, {
        name: rel, drive: d,
        status: isGoogleNative(d) ? "native" : "only_drive",
        size: d.size ? parseInt(d.size, 10) : 0,
        modified: d.modifiedTime ?? "",
      });
    }
    for (const [rel, lp] of localByPath) {
      const ex = byPath.get(rel);
      if (ex) { ex.localPath = lp; if (ex.status !== "native") ex.status = "same"; }
      else byPath.set(rel, { name: rel, localPath: lp, status: "only_local", size: 0, modified: "" });
    }
    this.rows = [...byPath.values()];
    this.render();
  }

  private render(errorMsg?: string): void {
    this.renderDashboard();
    this.renderControls();
    this.renderBody(errorMsg);
  }

  private renderDashboard(): void {
    this.dashEl.empty();
    this.dashEl.addClass("pa-panel");
    const counts = this.statusCounts();
    const inner = this.dashEl.createDiv({ cls: "pa-drive-dash-inner" });
    const donutWrap = inner.createDiv({ cls: "pa-drive-donut" });
    drawDonut(
      donutWrap,
      (Object.keys(STATUS_META) as RowStatus[]).map((s) => ({ label: STATUS_META[s].label, value: counts[s], color: STATUS_META[s].color })),
      130, undefined, () => String(this.rows.length),
    );
    const chips = inner.createDiv({ cls: "pa-stats-row pa-drive-counters" });
    const counter = (label: string, value: number | string, color?: string) => {
      const c = chips.createDiv({ cls: "pa-stat" });
      const v = c.createSpan({ cls: "pa-stat-value", text: String(value) });
      if (color) v.style.color = color;
      c.createDiv({ cls: "pa-stat-label", text: label });
    };
    counter("Vault notes", this.app.vault.getMarkdownFiles().length);
    counter("Vault files", this.app.vault.getFiles().length);
    (Object.keys(STATUS_META) as RowStatus[]).forEach((s) => counter(STATUS_META[s].label, counts[s], STATUS_META[s].color));
  }

  private statusCounts(): Record<RowStatus, number> {
    const c: Record<RowStatus, number> = { same: 0, only_drive: 0, only_local: 0, diff: 0, native: 0 };
    for (const r of this.rows) c[r.status]++;
    return c;
  }

  private renderControls(): void {
    this.controlsEl.empty();
    const searchInput = this.controlsEl.createEl("input", { cls: "pa-drive-search", type: "text", placeholder: "Search…" });
    searchInput.value = this.search;
    searchInput.oninput = () => { this.search = searchInput.value.toLowerCase(); this.renderBody(); };
    const chipRow = this.controlsEl.createDiv({ cls: "pa-drive-filterchips" });
    (Object.keys(STATUS_META) as RowStatus[]).forEach((s) => {
      const meta = STATUS_META[s];
      const chip = chipRow.createEl("button", { cls: "pa-drive-filterchip", text: `${meta.icon} ${meta.label}` });
      chip.style.borderColor = meta.color;
      if (this.activeFilters.has(s)) { chip.addClass("active"); chip.style.background = meta.color; }
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

  private renderBody(errorMsg?: string): void {
    this.bodyEl.empty();
    if (!this.lastToken) {
      this.bodyEl.createEl("p", { text: "Not connected to Google. Enable Google Drive and connect your account in momentum settings." });
      return;
    }
    if (errorMsg) { this.bodyEl.createEl("p", { text: errorMsg }); return; }
    const head = this.bodyEl.createDiv({ cls: "pa-drive-row pa-drive-head" });
    head.createDiv({ cls: "pa-drive-cell", text: "Google Drive" });
    this.sortHeader(head.createDiv({ cls: "pa-drive-cell pa-drive-mid" }), "Status", "status");
    head.createDiv({ cls: "pa-drive-cell", text: this.cfg.mirrorDir() === "" ? "Vault (whole)" : `Vault / ${normalizePath(this.cfg.mirrorDir())}` });
    const rows = this.visibleRows();
    if (rows.length === 0) { this.bodyEl.createEl("p", { text: "(Nothing matches the filter)" }); return; }
    for (const r of rows) {
      const meta = STATUS_META[r.status];
      const row = this.bodyEl.createDiv({ cls: "pa-drive-row" });
      const left = row.createDiv({ cls: "pa-drive-cell" });
      if (r.drive) {
        const exp = r.status === "native" ? EXPORT_MIME[r.drive.mimeType] : undefined;
        const label = r.status === "native" ? `📄 ${r.name}${exp ? ` (→ .${exp.ext})` : ""}` : `📄 ${r.name}`;
        const a = left.createEl("a", { text: label, href: "#" });
        a.onclick = (e) => { e.preventDefault(); void this.openFromDrive(this.lastToken!, r.drive!, r.name); };
      } else left.createSpan({ cls: "pa-drive-muted", text: "—" });
      const mid = row.createDiv({ cls: "pa-drive-cell pa-drive-mid" });
      const badge = mid.createSpan({ text: `${meta.icon} ${meta.label}` });
      badge.style.color = meta.color;
      if (r.status === "only_drive" || r.status === "native") {
        const b = mid.createEl("button", { cls: "pa-mini-btn", text: "↓" }); b.title = "Download";
        b.onclick = () => void this.openFromDrive(this.lastToken!, r.drive!, r.name);
      } else if (r.status === "only_local") {
        const b = mid.createEl("button", { cls: "pa-mini-btn", text: "↑" }); b.title = "Upload";
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

  /** Recursive local listing keyed by relative path — matches the engine's VaultFS scope
   *  (a subfolder, or the whole vault minus the plugin's data root). */
  private listLocalMirror(): Map<string, string> {
    const raw = this.cfg.mirrorDir();
    const base = raw === "" ? "" : normalizePath(raw);
    const dataRoot = normalizePath(this.cfg.dataRoot?.() ?? "");
    const out = new Map<string, string>();
    for (const f of this.app.vault.getFiles()) {
      if (base) {
        if (f.path === base || f.path.startsWith(`${base}/`)) out.set(f.path.slice(base.length + 1), f.path);
      } else {
        if (dataRoot && (f.path === dataRoot || f.path.startsWith(`${dataRoot}/`))) continue;
        out.set(f.path, f.path);
      }
    }
    return out;
  }

  private async openFromDrive(token: string, f: DriveFile, rel: string): Promise<void> {
    try {
      if (isGoogleNative(f)) {
        const exp = EXPORT_MIME[f.mimeType];
        if (!exp) { new Notice("This Google file type can't be exported."); return; }
        const text = await exportFile(token, f.id, exp.mime);
        const path = await this.writeMirror(`${rel}.${exp.ext}`, text, undefined);
        await this.openInEditor(path);
        new Notice(`Exported (read-only): ${f.name} → .${exp.ext}.`);
      } else {
        const text = new TextDecoder().decode(await downloadFile(token, f.id));
        const path = await this.writeMirror(rel, text, f.id);
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

  private async writeMirror(rel: string, content: string, driveId: string | undefined): Promise<string> {
    const raw = this.cfg.mirrorDir();
    const base = raw === "" ? "" : normalizePath(raw);
    const full = normalizePath(base ? `${base}/${rel}` : rel);
    const slash = full.lastIndexOf("/");
    if (slash >= 0) {
      const parts = full.slice(0, slash).split("/");
      let cur = "";
      for (const seg of parts) {
        cur = cur ? `${cur}/${seg}` : seg;
        if (!(this.app.vault.getAbstractFileByPath(cur) instanceof TFolder)) await this.app.vault.createFolder(cur).catch(() => {});
      }
    }
    const body = driveId && (full.endsWith(".md") || full.endsWith(".txt")) ? `---\ndrive_id: ${driveId}\n---\n${content}` : content;
    const existing = this.app.vault.getAbstractFileByPath(full);
    if (existing instanceof TFile) await this.app.vault.modify(existing, body);
    else await this.app.vault.create(full, body);
    return full;
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
    if (!m) { new Notice("This file has no drive_ID — it didn't come from drive."); return; }
    const [, driveId, content] = m;
    try { await updateTextFile(token, driveId, content); new Notice("Saved to Google Drive."); }
    catch (e) { new Notice(`Save failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
}

/**
 * Thin ItemView shell kept for the standalone command / any leaf still typed to it. Delegates
 * all rendering to a DrivePanel. The File Manager tab embeds its own DrivePanel as a section.
 */
export class DriveBrowserView extends ItemView {
  private cfg: DriveViewConfig;
  private panel: DrivePanel | null = null;

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
    this.panel = new DrivePanel(this.app, root, this.cfg);
    await this.panel.mount();
  }

  saveActiveToDrive(): Promise<void> {
    return this.panel ? this.panel.saveActiveToDrive() : Promise.resolve();
  }
}
