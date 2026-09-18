import { ItemView, WorkspaceLeaf, TFile, TFolder, setIcon, Notice } from "obsidian";
import { drawDonut, drawTreemap, drawLineChart, drawRing } from "./charts";
import { DrivePanel, DriveViewConfig } from "./driveBrowser";

export const VIEW_TYPE_QUICK = "momentum-quick-access";

/** Config for the File Manager tab: pin persistence + the embedded Drive panel's config. */
export interface QuickAccessConfig {
  getPins: () => string[];
  setPins: (paths: string[]) => Promise<void>;
  drive: DriveViewConfig;
}

/** Palette shared across the dashboard visualizations. */
const PALETTE = ["#7c3aed", "#3b82f6", "#16a34a", "#f59e0b", "#ef4444", "#0ea5e9", "#e11d48", "#10b981"];

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function relTime(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** Top-level folder a path belongs to ("" → vault root). */
function topFolder(path: string): string {
  const i = path.indexOf("/");
  return i < 0 ? "/ (root)" : path.slice(0, i);
}

/**
 * A full file-manager dashboard for the vault, inspired by WinDirStat + Hope UI:
 *   - Storage ring by file type (how the vault's bytes split across types)
 *   - Treemap by top-level folder (what occupies the most space) — WinDirStat style
 *   - "Your Folders" cards with item counts
 *   - Activity chart: files modified per month over the last year
 *   - Recently modified list + Pinned + Recents
 * All drawn with the project's own chart helpers (drawDonut/drawTreemap/drawLineChart/drawRing).
 */
export class FileManagerView extends ItemView {
  private cfg: QuickAccessConfig;
  private bodyEl: HTMLElement | null = null;
  private drivePanel: DrivePanel | null = null;

  constructor(leaf: WorkspaceLeaf, cfg: QuickAccessConfig) {
    super(leaf);
    this.cfg = cfg;
  }

  getViewType(): string { return VIEW_TYPE_QUICK; }
  getDisplayText(): string { return "File Manager"; }
  getIcon(): string { return "folder-open"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("pa-quick-root");
    root.createEl("h3", { text: "🗂️ File Manager" });
    this.bodyEl = root.createDiv();
    this.render();
    this.registerEvent(this.app.workspace.on("file-open", () => this.render()));
  }

  private render(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    const files = this.app.vault.getFiles();

    // ---- aggregate once ----
    const byType = new Map<string, { count: number; size: number }>();
    const byFolder = new Map<string, { count: number; size: number }>();
    const monthly = new Map<string, number>();
    let totalSize = 0;
    for (const f of files) {
      const ext = (f.extension || "?").toLowerCase();
      const size = f.stat.size ?? 0;
      totalSize += size;
      const t = byType.get(ext) ?? { count: 0, size: 0 }; t.count++; t.size += size; byType.set(ext, t);
      const fol = topFolder(f.path);
      const g = byFolder.get(fol) ?? { count: 0, size: 0 }; g.count++; g.size += size; byFolder.set(fol, g);
      const d = new Date(f.stat.mtime);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthly.set(key, (monthly.get(key) ?? 0) + 1);
    }

    this.renderTopRow(files.length, totalSize, byType);
    this.renderTreemap(byFolder);
    this.renderFolderCards(byFolder);
    this.renderActivity(monthly);
    // Recently modified · Pinned · Recently opened — side by side in a 3-column row.
    const cols = this.bodyEl.createDiv({ cls: "pa-fm-3col" });
    this.renderRecent(files, cols.createDiv({ cls: "pa-panel" }));
    this.renderPinned(cols.createDiv({ cls: "pa-panel" }));
    this.renderRecents(cols.createDiv({ cls: "pa-panel" }));
    this.renderDriveSection();
  }

  /** Google Drive as a collapsible section inside File Manager (embeds the DrivePanel). */
  private renderDriveSection(): void {
    const sec = this.bodyEl!.createEl("details", { cls: "pa-panel pa-fm-drive" });
    sec.open = false;
    const summary = sec.createEl("summary", { cls: "pa-panel-title pa-fm-drive-summary" });
    summary.createSpan({ text: "☁️ Google Drive" });
    const panelHost = sec.createDiv();
    // Mount the Drive panel lazily on first expand, so an unconnected Drive doesn't hit the
    // network until the user opens the section.
    let mounted = false;
    sec.ontoggle = () => {
      if (sec.open && !mounted) {
        mounted = true;
        this.drivePanel = new DrivePanel(this.app, panelHost, this.cfg.drive);
        void this.drivePanel.mount();
      }
    };
  }

  // ---- top row: storage ring + type donut + headline counters ------------------------
  private renderTopRow(fileCount: number, totalSize: number, byType: Map<string, { count: number; size: number }>): void {
    const sec = this.bodyEl!.createDiv({ cls: "pa-panel" });
    sec.createEl("div", { cls: "pa-panel-title", text: "Storage overview" });
    const row = sec.createDiv({ cls: "pa-quick-toprow" });

    // Ring: not a real disk quota (local vault), so show file count in the ring center with a
    // full ring — the headline is the total size next to it.
    const ringWrap = row.createDiv();
    drawRing(ringWrap, 100, PALETTE[1], humanSize(totalSize), 96);

    // Donut of bytes by type (top 7 + "other").
    const types = [...byType.entries()].sort((a, b) => b[1].size - a[1].size);
    const top = types.slice(0, 7);
    const otherSize = types.slice(7).reduce((s, [, v]) => s + v.size, 0);
    const segments = top.map(([ext, v], i) => ({ label: ext, value: v.size, color: PALETTE[i % PALETTE.length] }));
    if (otherSize > 0) segments.push({ label: "other", value: otherSize, color: "#9ca3af" });
    const donutWrap = row.createDiv();
    drawDonut(donutWrap, segments, 120, humanSize, () => `${fileCount}`);

    const counters = row.createDiv({ cls: "pa-quick-counters" });
    const stat = (label: string, value: string) => {
      const c = counters.createDiv({ cls: "pa-stat" });
      c.createDiv({ cls: "pa-stat-value", text: value });
      c.createDiv({ cls: "pa-stat-label", text: label });
    };
    stat("Files", String(fileCount));
    stat("Total size", humanSize(totalSize));
    stat("File types", String(byType.size));
    stat("Notes", String(this.app.vault.getMarkdownFiles().length));
  }

  // ---- treemap by top-level folder (WinDirStat style) --------------------------------
  private renderTreemap(byFolder: Map<string, { count: number; size: number }>): void {
    const sec = this.bodyEl!.createDiv({ cls: "pa-panel" });
    sec.createEl("div", { cls: "pa-panel-title", text: "Space by folder" });
    const tiles = [...byFolder.entries()]
      .sort((a, b) => b[1].size - a[1].size)
      .map(([folder, v], i) => ({
        label: `${folder} · ${humanSize(v.size)}`,
        value: v.size,
        color: PALETTE[i % PALETTE.length],
        onClick: () => this.openFolder(folder),
      }));
    drawTreemap(sec, tiles, 240);
  }

  // ---- "Your Folders" cards ----------------------------------------------------------
  private renderFolderCards(byFolder: Map<string, { count: number; size: number }>): void {
    const sec = this.bodyEl!.createDiv({ cls: "pa-panel" });
    sec.createEl("div", { cls: "pa-panel-title", text: "Your folders" });
    const grid = sec.createDiv({ cls: "pa-quick-grid" });
    const folders = [...byFolder.entries()].sort((a, b) => b[1].count - a[1].count);
    for (const [folder, v] of folders) {
      const card = grid.createDiv({ cls: "pa-quick-card pa-clickable" });
      const iconEl = card.createDiv({ cls: "pa-quick-card-icon" });
      setIcon(iconEl, "folder");
      card.createDiv({ cls: "pa-quick-card-name", text: folder });
      card.createDiv({ cls: "pa-stat-label", text: `${v.count} items · ${humanSize(v.size)}` });
      card.onclick = () => this.openFolder(folder);
    }
  }

  // ---- activity chart: files modified per month (last 12) ----------------------------
  private renderActivity(monthly: Map<string, number>): void {
    const sec = this.bodyEl!.createDiv({ cls: "pa-panel" });
    sec.createEl("div", { cls: "pa-panel-title", text: "Activity — files modified per month" });
    const labels: string[] = [];
    const values: Array<number | null> = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      labels.push(d.toLocaleString(undefined, { month: "short" }));
      values.push(monthly.get(key) ?? 0);
    }
    drawLineChart(sec, labels, [{ name: "Modified", color: PALETTE[1], values }], { height: 200 });
  }

  // ---- recently modified -------------------------------------------------------------
  private renderRecent(files: TFile[], sec: HTMLElement): void {
    sec.createEl("div", { cls: "pa-panel-title", text: "Recently modified" });
    const recent = files.slice().sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 8);
    const list = sec.createDiv({ cls: "pa-quick-list" });
    for (const f of recent) {
      const row = list.createDiv({ cls: "pa-quick-listrow" });
      const name = row.createEl("a", { cls: "pa-quick-listname", text: f.name, href: "#" });
      name.onclick = (e) => { e.preventDefault(); void this.app.workspace.getLeaf(false).openFile(f); };
      row.createSpan({ cls: "pa-quick-listmeta", text: `${humanSize(f.stat.size ?? 0)} · ${relTime(f.stat.mtime)}` });
    }
  }

  private renderPinned(sec: HTMLElement): void {
    sec.createEl("div", { cls: "pa-panel-title", text: "📌 Pinned" });
    const pins = this.cfg.getPins();
    if (pins.length === 0) {
      sec.createEl("p", { cls: "pa-drive-muted", text: "Nothing pinned yet. Open a file and click 📌 in the recents list." });
      return;
    }
    const grid = sec.createDiv({ cls: "pa-quick-grid" });
    for (const path of pins) {
      const file = this.app.vault.getAbstractFileByPath(path);
      const card = grid.createDiv({ cls: "pa-quick-card" });
      const stale = !(file instanceof TFile);
      const iconEl = card.createDiv({ cls: "pa-quick-card-icon" });
      setIcon(iconEl, stale ? "alert-triangle" : "file-text");
      card.createDiv({ cls: "pa-quick-card-name", text: path.split("/").pop() ?? path });
      if (stale) { card.addClass("stale"); card.title = "File not found (moved/deleted). Click to unpin."; card.onclick = () => void this.togglePin(path); }
      else card.onclick = () => void this.app.workspace.getLeaf(false).openFile(file as TFile);
      const unpin = card.createEl("button", { cls: "pa-quick-unpin", text: "×" });
      unpin.title = "Unpin (doesn't delete the file)";
      unpin.onclick = (e) => { e.stopPropagation(); void this.togglePin(path); };
    }
  }

  private renderRecents(sec: HTMLElement): void {
    sec.createEl("div", { cls: "pa-panel-title", text: "🕘 Recently opened" });
    const recents = this.app.workspace.getLastOpenFiles().slice(0, 12);
    if (recents.length === 0) { sec.createEl("p", { cls: "pa-drive-muted", text: "No recent files." }); return; }
    const pins = new Set(this.cfg.getPins());
    const list = sec.createDiv({ cls: "pa-quick-list" });
    for (const path of recents) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      const row = list.createDiv({ cls: "pa-quick-listrow" });
      const name = row.createEl("a", { cls: "pa-quick-listname", text: file.basename, href: "#" });
      name.onclick = (e) => { e.preventDefault(); void this.app.workspace.getLeaf(false).openFile(file); };
      row.createSpan({ cls: "pa-quick-listmeta", text: relTime(file.stat.mtime) });
      const pin = row.createEl("button", { cls: "pa-quick-pin", text: pins.has(path) ? "📌" : "📍" });
      pin.title = pins.has(path) ? "Unpin" : "Pin";
      pin.onclick = () => void this.togglePin(path);
    }
  }

  /** Reveal a folder in Obsidian's native file explorer (expands + highlights it). */
  private openFolder(folder: string): void {
    if (folder.startsWith("/")) return; // vault root — nothing to reveal
    const f = this.app.vault.getAbstractFileByPath(folder);
    if (!(f instanceof TFolder)) return;

    // Preferred: the built-in File Explorer's revealInFolder — expands the tree to this folder
    // and highlights it, without opening any file. internalPlugins is not in the public typings.
    const internal = (this.app as unknown as {
      internalPlugins?: { getPluginById?: (id: string) => { instance?: { revealInFolder?: (f: TFolder) => void } } | undefined };
    }).internalPlugins;
    const instance = internal?.getPluginById?.("file-explorer")?.instance;
    if (instance?.revealInFolder) {
      const leaves = this.app.workspace.getLeavesOfType("file-explorer");
      if (leaves.length) void this.app.workspace.revealLeaf(leaves[0]);
      instance.revealInFolder(f);
      return;
    }
    // Fallback: at least surface the folder name so the click isn't silently dead.
    new Notice(`Folder: ${folder} (${f.children.length} items)`);
  }

  private async togglePin(path: string): Promise<void> {
    const pins = this.cfg.getPins().slice();
    const i = pins.indexOf(path);
    if (i >= 0) pins.splice(i, 1); else pins.push(path);
    await this.cfg.setPins(pins);
    this.render();
  }
}
