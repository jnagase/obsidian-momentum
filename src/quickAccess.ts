import { ItemView, WorkspaceLeaf, TFile, TFolder, setIcon, Notice, normalizePath } from "obsidian";
import { drawDonut, drawTreemap, drawLineChart, drawRing, drawClockProgress } from "./charts";
import { DriveViewConfig } from "./driveBrowser";
import { DriveSyncSummary, DriveIssueCategory, walkRemoteTree } from "./driveSync";

/** Enriched per-file status after an on-demand "Check Drive" (adds drive-only / diverged / remote). */
type CheckStatus = "synced" | "local" | "pending" | "diverged" | "remote" | "drive";
interface CheckedFile { path: string; cstatus: CheckStatus; mtime: number; at?: string }

export const VIEW_TYPE_QUICK = "momentum-quick-access";

/** Config for the File Manager tab: pin persistence, plus an OPTIONAL Google Drive (beta)
 *  section. When `driveEnabled()` is false (the default), the File Manager is a purely local
 *  vault dashboard and no Drive code runs — the Drive parts are gated, not baked in. */
export interface QuickAccessConfig {
  getPins: () => string[];
  setPins: (paths: string[]) => Promise<void>;
  drive?: DriveViewConfig;
  driveEnabled?: () => boolean;
  /** Open the full standalone Drive browser view. */
  openDriveBrowser?: () => void;
  /** Instant Drive status (last-sync summary + compliance counts + per-file table). No network. */
  driveStatus?: () => { last?: DriveSyncSummary; tracked: number; inScope: number; logPath: string; files: { path: string; status: "synced" | "local"; at?: string; mtime: number }[] };
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
  /** The "Your folders" card for the Drive mirror folder — target for the sync clock overlay. */
  private mirrorCardEl: HTMLElement | null = null;
  private driveSyncing = false;
  /** Live "Syncing… X/Y" line in the Drive card, updated from the sync's onProgress callback. */
  private driveLiveEl: HTMLElement | null = null;
  /** Result of the last on-demand "Check Drive" walk (enriched statuses incl. drive-only/diverged). */
  private driveCheck: { files: CheckedFile[]; at: number } | null = null;
  private driveChecking = false;

  constructor(leaf: WorkspaceLeaf, cfg: QuickAccessConfig) {
    super(leaf);
    this.cfg = cfg;
  }

  getViewType(): string { return VIEW_TYPE_QUICK; }
  getDisplayText(): string { return "File manager (beta)"; }
  getIcon(): string { return "folder-open"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("pa-quick-root");
    const h = root.createEl("h3", { text: "🗂️ file manager " });
    h.createSpan({ cls: "pa-beta-tag", text: "beta" });
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

  /** OPTIONAL Google Drive (beta) section — only when Drive is enabled AND its config is
   *  present. With Drive off (the default) this is a no-op, so the File Manager stays local. */
  private renderDriveSection(): void {
    if (!this.cfg.drive || !this.cfg.driveEnabled?.()) return;
    const drive = this.cfg.drive;
    const sec = this.bodyEl!.createDiv({ cls: "pa-panel pa-fm-drive" });

    const head = sec.createDiv({ cls: "pa-fm-drive-head" });
    head.createSpan({ cls: "pa-panel-title", text: "☁️ google drive " });
    head.createSpan({ cls: "pa-beta-tag", text: "beta" });
    const actions = head.createDiv({ cls: "pa-fm-drive-actions" });
    if (drive.syncNow) {
      const btn = actions.createEl("button", { cls: "pa-fm-drive-sync", text: "🔄 Sync now" });
      btn.onclick = () => void this.runDriveSyncFromFileManager(btn);
    }
    const check = actions.createEl("button", { cls: "pa-fm-drive-open", text: this.driveChecking ? "Checking…" : "↯ Check drive" });
    check.disabled = this.driveChecking;
    check.onclick = () => void this.checkDrive(check);
    // Persistent status + per-file table (instant, no network) — driven by the last sync + baselines.
    // The old live browser (which zeroed out between syncs) was removed.
    this.renderDriveStatus(sec.createDiv({ cls: "pa-drive-status" }));
  }

  /** On-demand: walk the Drive folder and enrich the table with drive-only / diverged / remote
   *  statuses, WITHOUT zeroing the persistent card. Compares remote modifiedTime vs the baseline
   *  and local mtime vs the last sync — no downloads. */
  private async checkDrive(btn: HTMLButtonElement): Promise<void> {
    if (this.driveChecking || !this.cfg.drive) return;
    const status = this.cfg.driveStatus?.();
    if (!status) return;
    this.driveChecking = true;
    btn.disabled = true;
    btn.setText("Checking…");
    try {
      const token = await this.cfg.drive.getToken();
      if (!token) { new Notice("Connect Google Drive first."); return; }
      const tree = await walkRemoteTree(token, this.cfg.drive.driveFolderId() || "root");
      const localByPath = new Map(status.files.map((f) => [f.path, f]));
      const merged: CheckedFile[] = [];
      for (const f of status.files) {
        const rf = tree.files.get(f.path);
        if (!rf) { merged.push({ path: f.path, cstatus: "local", mtime: f.mtime, at: f.at }); continue; }
        const remoteChanged = f.at ? rf.modifiedTime !== f.at : true;
        const localChanged = f.at ? f.mtime > Date.parse(f.at) : true;
        let cstatus: CheckStatus;
        if (f.status === "local") cstatus = "diverged"; // exists both sides but never synced
        else if (localChanged && remoteChanged) cstatus = "diverged";
        else if (remoteChanged) cstatus = "remote";
        else if (localChanged) cstatus = "pending";
        else cstatus = "synced";
        merged.push({ path: f.path, cstatus, mtime: f.mtime, at: f.at });
      }
      for (const [path, rf] of tree.files) {
        if (!localByPath.has(path)) merged.push({ path, cstatus: "drive", mtime: 0, at: rf.modifiedTime });
      }
      this.driveCheck = { files: merged, at: Date.now() };
      new Notice("Drive check complete.");
      this.render();
    } catch (e) {
      new Notice(`Drive check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.driveChecking = false;
    }
  }

  /** Open a synced file by its Drive-relative path (resolves through the mirror-folder base). */
  private openDriveFile(relPath: string): void {
    const base = this.cfg.drive?.mirrorDir() === "" ? "" : normalizePath(this.cfg.drive?.mirrorDir() ?? "");
    const full = normalizePath(base ? `${base}/${relPath}` : relPath);
    const f = this.app.vault.getAbstractFileByPath(full);
    if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
  }

  /** Instant Drive status card: last sync, honest %, clickable category pills (with per-file
   *  drill-down), a live "Syncing…" line, and a persistent per-file table — no network. */
  private renderDriveStatus(el: HTMLElement): void {
    const info = this.cfg.driveStatus?.();
    if (!info) return;
    const { last, inScope, files, logPath } = info;

    const scope = last?.scope ?? (this.cfg.drive?.mirrorDir() === "" ? "whole vault" : (this.cfg.drive?.mirrorDir() || "Drive"));

    // Authoritative per-category counts (NOT the capped issues list). The issues list only
    // supplies the file NAMES shown when a pill is expanded.
    const held = last?.blocked ?? 0;
    const errs = last?.errorCount ?? 0;
    const skip = last?.skippedBinary ?? 0;
    const conf = last?.conflicted ?? 0;
    const del = (last?.deletedLocal ?? 0) + (last?.deletedRemote ?? 0);
    const attention = held + errs + skip + conf;         // files not fully in sync
    const synced = Math.max(0, inScope - attention);
    const pct = inScope ? Math.round((synced / inScope) * 100) : 0;

    // Header: when + an HONEST % (drops below 100 whenever anything needs attention).
    const hdr = el.createDiv({ cls: "pa-drive-status-row" });
    hdr.createSpan({ cls: "pa-drive-status-when", text: last ? `Last sync ${relTime(Date.parse(last.time))}` : "Not synced yet" });
    hdr.createSpan({ cls: "pa-drive-status-pct", text: `${pct}% in sync` });

    // Live progress line (point 1) — filled while a sync runs (updated from onProgress), else empty.
    this.driveLiveEl = el.createDiv({ cls: `pa-drive-live${this.driveSyncing ? " on" : ""}` });
    if (this.driveSyncing) this.driveLiveEl.setText("Syncing…");

    // Multi-colour stacked bar (point 3): synced + held + errors + skipped + conflicts.
    const segs: Array<[number, string]> = [
      [synced, "#14b8a6"], [held, "#a855f7"], [errs, "#e11d48"], [skip, "#0ea5e9"], [conf, "#f59e0b"],
    ];
    const denom = Math.max(1, synced + attention);
    const bar = el.createDiv({ cls: "pa-drive-bar pa-drive-bar-stacked" });
    for (const [n, color] of segs) {
      if (n <= 0) continue;
      const s = bar.createDiv({ cls: "pa-drive-bar-seg" });
      s.style.width = `${(n / denom) * 100}%`;
      s.style.background = color;
    }
    el.createDiv({ cls: "pa-drive-muted", text: `${synced} of ${inScope} files in sync · scope: ${scope}` });

    if (last) {
      // Clickable category pills. The "attention" ones (with a category) expand a per-file list.
      const pills = el.createDiv({ cls: "pa-drive-pills" });
      const detail = el.createDiv({ cls: "pa-drive-catfiles" });
      let openCat: DriveIssueCategory | null = null;
      const pillByCat: Partial<Record<DriveIssueCategory, HTMLElement>> = {};

      const renderCat = (cat: DriveIssueCategory, label: string): void => {
        detail.empty();
        const rows = (last.issues || []).filter((i) => i.category === cat);
        detail.createDiv({
          cls: "pa-drive-catfiles-head",
          text: rows.length ? `${label}: ${rows.length} file${rows.length === 1 ? "" : "s"}` : `${label}: no per-file detail recorded`,
        });
        for (const it of rows) {
          const r = detail.createDiv({ cls: "pa-drive-catfile" });
          const a = r.createEl("a", { cls: "pa-drive-catfile-path", text: it.path, href: "#" });
          a.onclick = (e) => { e.preventDefault(); this.openDriveFile(it.path); };
          r.createSpan({ cls: "pa-drive-catfile-reason", text: it.reason });
        }
        if (last.issuesTotal > last.issues.length) {
          detail.createDiv({ cls: "pa-drive-muted", text: "(list capped — see full sync log for the rest.)" });
        }
      };

      const pill = (glyph: string, count: number, label: string, color: string, cat?: DriveIssueCategory) => {
        const p = pills.createSpan({ cls: `pa-drive-pill${count > 0 ? " hot" : ""}${cat && count > 0 ? " pa-clickable" : ""}` });
        if (count > 0) p.style.setProperty("--pill", color);
        p.createSpan({ cls: "pa-drive-pill-n", text: `${glyph} ${count}` });
        p.createSpan({ cls: "pa-drive-pill-l", text: label });
        if (cat) {
          pillByCat[cat] = p;
          if (count > 0) {
            p.onclick = () => {
              if (openCat === cat) { openCat = null; detail.empty(); p.removeClass("active"); return; }
              for (const el2 of Object.values(pillByCat)) el2?.removeClass("active");
              openCat = cat; p.addClass("active"); renderCat(cat, label);
            };
          }
        }
      };
      pill("↑", last.pushed, "pushed", "#3b82f6");
      pill("↓", last.pulled, "pulled", "#16a34a");
      pill("⇄", last.merged, "merged", "#7c3aed");
      pill("⚠", conf, "conflicts", "#f59e0b", "conflict");
      pill("🗑", del, "deleted", "#ef4444", "deleted");
      pill("⛔", held, "held", "#a855f7", "held");
      pill("⊘", skip, "skipped", "#0ea5e9", "skipped");
      pill("✕", errs, "errors", "#e11d48", "error");

      const logLine = el.createDiv({ cls: "pa-drive-muted pa-drive-loglink" });
      const link = logLine.createEl("a", { text: "Open full sync log ↗", href: "#" });
      link.onclick = (e) => {
        e.preventDefault();
        const f = this.app.vault.getAbstractFileByPath(logPath);
        if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f);
        else new Notice("No sync log yet.");
      };
    }

    // ---- Per-file table (persistent; enriched by "Check drive" when available) ----
    const STMETA: Record<CheckStatus, { label: string; cls: string }> = {
      synced:   { label: "✓ Synced",      cls: "is-synced" },
      pending:  { label: "● Pending",     cls: "is-pending" },
      diverged: { label: "⚠ Diverged",    cls: "is-diverged" },
      remote:   { label: "↓ Drive newer", cls: "is-remote" },
      local:    { label: "💾 Local only",  cls: "is-local" },
      drive:    { label: "☁ Drive only",   cls: "is-drive" },
    };
    // Fresh check (drive-only/diverged/…) if available; else baseline-derived (synced/local + pending).
    const rows0: CheckedFile[] = this.driveCheck
      ? this.driveCheck.files
      : files.map((f) => {
          const pending = f.status === "synced" && !!f.at && f.mtime > Date.parse(f.at);
          const cstatus: CheckStatus = f.status === "local" ? "local" : pending ? "pending" : "synced";
          return { path: f.path, cstatus, mtime: f.mtime, at: f.at };
        });

    const wrap = el.createDiv({ cls: "pa-drive-table-wrap" });
    wrap.createDiv({
      cls: "pa-drive-muted",
      text: this.driveCheck
        ? `Checked Drive ${relTime(this.driveCheck.at)} — live status (drive-only & diverged included).`
        : "Showing last-sync status. Use \"Check drive\" for drive-only / diverged.",
    });
    const controls = wrap.createDiv({ cls: "pa-drive-table-controls" });
    const search = controls.createEl("input", { cls: "pa-drive-search", type: "text", placeholder: "Search files…" });
    let filter: "all" | CheckStatus = "all";
    let query = "";
    const chipRow = controls.createDiv({ cls: "pa-drive-filterchips" });
    const chips: Record<string, HTMLElement> = {};
    const count = (s: CheckStatus) => rows0.filter((r) => r.cstatus === s).length;
    const mkChip = (key: "all" | CheckStatus, label: string) => {
      const c = chipRow.createEl("button", { cls: "pa-drive-filterchip", text: label });
      c.onclick = () => { filter = key; for (const k in chips) chips[k].toggleClass("active", k === key); renderRows(); };
      chips[key] = c;
    };
    mkChip("all", `All (${rows0.length})`);
    for (const s of ["synced", "pending", "diverged", "remote", "local", "drive"] as CheckStatus[]) {
      const n = count(s);
      if (n > 0) mkChip(s, `${STMETA[s].label} (${n})`);
    }
    chips.all.addClass("active");

    const listEl = wrap.createDiv({ cls: "pa-drive-table" });
    const base = this.cfg.drive?.mirrorDir() === "" ? "" : normalizePath(this.cfg.drive?.mirrorDir() ?? "");
    const CAP = 400;
    const renderRows = (): void => {
      listEl.empty();
      let rows = rows0;
      if (filter !== "all") rows = rows.filter((r) => r.cstatus === filter);
      if (query) rows = rows.filter((r) => r.path.toLowerCase().includes(query));
      const head = listEl.createDiv({ cls: "pa-drive-trow pa-drive-thead" });
      head.createSpan({ cls: "pa-drive-tname", text: "File" });
      head.createSpan({ cls: "pa-drive-tstatus", text: "Status" });
      head.createSpan({ cls: "pa-drive-twhen", text: "Modified" });
      head.createSpan({ cls: "pa-drive-twhen", text: "Synced" });
      if (rows.length === 0) { listEl.createDiv({ cls: "pa-drive-muted", text: "(none)" }); return; }
      for (const f of rows.slice(0, CAP)) {
        const r = listEl.createDiv({ cls: "pa-drive-trow" });
        if (f.cstatus === "pending" || f.cstatus === "diverged") r.addClass("pa-drive-pending-row");
        const name = r.createEl("a", { cls: "pa-drive-tname", text: f.path, href: "#" });
        name.onclick = (e) => {
          e.preventDefault();
          const full = normalizePath(base ? `${base}/${f.path}` : f.path);
          const file = this.app.vault.getAbstractFileByPath(full);
          if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
        };
        const meta = STMETA[f.cstatus];
        r.createSpan({ cls: `pa-drive-tstatus ${meta.cls}`, text: meta.label });
        r.createSpan({ cls: "pa-drive-twhen", text: f.mtime ? relTime(f.mtime) : "—" });
        r.createSpan({ cls: "pa-drive-twhen", text: f.at ? relTime(Date.parse(f.at)) : "—" });
      }
      if (rows.length > CAP) listEl.createDiv({ cls: "pa-drive-muted", text: `… and ${rows.length - CAP} more (use search to narrow).` });
    };
    search.oninput = () => { query = search.value.toLowerCase(); renderRows(); };
    renderRows();
  }

  /** Trigger a Drive sync from the File Manager, showing a clockwise-filling clock on the mirror
   *  folder card (or beside the button) as it progresses. */
  private async runDriveSyncFromFileManager(btn: HTMLButtonElement): Promise<void> {
    if (this.driveSyncing || !this.cfg.drive?.syncNow) return;
    this.driveSyncing = true;
    btn.disabled = true;
    btn.addClass("is-syncing");

    // Prefer overlaying the clock on the mirror folder card; fall back to beside the button.
    const host = this.mirrorCardEl
      ? this.mirrorCardEl.createDiv({ cls: "pa-clock-overlay" })
      : btn.parentElement!.createSpan({ cls: "pa-clock-inline" });
    const clock = drawClockProgress(host, this.mirrorCardEl ? 48 : 22);
    // Live text in the status card (point 1), updated as the sync progresses.
    if (this.driveLiveEl) { this.driveLiveEl.addClass("on"); this.driveLiveEl.setText("Syncing…"); }

    try {
      await this.cfg.drive.syncNow((p) => {
        clock.update(p.total ? p.done / p.total : 1);
        if (this.driveLiveEl) {
          const pc = p.total ? Math.round((p.done / p.total) * 100) : 0;
          this.driveLiveEl.setText(p.total ? `Syncing… ${p.done}/${p.total} (${pc}%)` : "Syncing…");
        }
      });
      clock.update(1);
      if (this.driveLiveEl) this.driveLiveEl.setText("Sync complete ✓");
    } finally {
      this.driveSyncing = false;
      // A short beat so a fast sync still flashes a full clock, then refresh the dashboard.
      window.setTimeout(() => { host.remove(); this.render(); }, 350);
    }
  }

  // ---- top row: storage ring + type donut + headline counters ------------------------
  private renderTopRow(fileCount: number, totalSize: number, byType: Map<string, { count: number; size: number }>): void {
    const sec = this.bodyEl!.createDiv({ cls: "pa-panel" });
    sec.createDiv({ cls: "pa-panel-title", text: "Storage overview" });
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
    sec.createDiv({ cls: "pa-panel-title", text: "Space by folder" });
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
    sec.createDiv({ cls: "pa-panel-title", text: "Your folders" });
    const grid = sec.createDiv({ cls: "pa-quick-grid" });
    const folders = [...byFolder.entries()].sort((a, b) => b[1].count - a[1].count);
    const mirror = this.cfg.driveEnabled?.() ? normalizePath(this.cfg.drive?.mirrorDir() ?? "") : "";
    this.mirrorCardEl = null;
    for (const [folder, v] of folders) {
      const card = grid.createDiv({ cls: "pa-quick-card pa-clickable" });
      const iconEl = card.createDiv({ cls: "pa-quick-card-icon" });
      setIcon(iconEl, "folder");
      card.createDiv({ cls: "pa-quick-card-name", text: folder });
      card.createDiv({ cls: "pa-stat-label", text: `${v.count} items · ${humanSize(v.size)}` });
      card.onclick = () => this.openFolder(folder);
      if (mirror && normalizePath(folder) === mirror) this.mirrorCardEl = card;
    }
  }

  // ---- activity chart: files modified per month (last 12) ----------------------------
  private renderActivity(monthly: Map<string, number>): void {
    const sec = this.bodyEl!.createDiv({ cls: "pa-panel" });
    sec.createDiv({ cls: "pa-panel-title", text: "Activity — files modified per month" });
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
    sec.createDiv({ cls: "pa-panel-title", text: "Recently modified" });
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
    sec.createDiv({ cls: "pa-panel-title", text: "📌 Pinned" });
    const pins = this.cfg.getPins();
    if (pins.length === 0) {
      sec.createEl("p", { cls: "pa-quick-muted", text: "Nothing pinned yet. Open a file and click 📌 in the recents list." });
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
      else card.onclick = () => { if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file); };
      const unpin = card.createEl("button", { cls: "pa-quick-unpin", text: "×" });
      unpin.title = "Unpin (doesn't delete the file)";
      unpin.onclick = (e) => { e.stopPropagation(); void this.togglePin(path); };
    }
  }

  private renderRecents(sec: HTMLElement): void {
    sec.createDiv({ cls: "pa-panel-title", text: "🕘 Recently opened" });
    const recents = this.app.workspace.getLastOpenFiles().slice(0, 12);
    if (recents.length === 0) { sec.createEl("p", { cls: "pa-quick-muted", text: "No recent files." }); return; }
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
