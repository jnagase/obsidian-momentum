import { Plugin, WorkspaceLeaf, PluginSettingTab, App, Setting, TFolder, TFile, Notice, normalizePath } from "obsidian";
import { PADataStore, setDataRoot, planBoardDeletions } from "./data";
import { PAView, VIEW_TYPE_PA, PAHost, PALocation } from "./view";
import { PANavView, VIEW_TYPE_PA_NAV } from "./nav";
import { PASideView, VIEW_TYPE_PA_SIDE, momentumNoteType } from "./side";
import { WhatsNewModal, CHANGELOG, cmpVersion } from "./whatsnew";
import { CustomPage } from "./types";
import { FormModal, ConfirmModal, ChoiceModal, FieldSpec } from "./ui";
import {
  GoogleToken, authorizeGoogle, completeGoogleAuth, GOOGLE_PROTOCOL_ACTION,
  GoogleAuthExpiredError, revokeGoogleToken, redactSecrets, isUserCapError,
} from "./googletasks";
import { GTSyncService } from "./gtSync";
import { FileManagerView, VIEW_TYPE_QUICK } from "./quickAccess";
import { DriveBrowserView, VIEW_TYPE_DRIVE, DriveViewConfig } from "./driveBrowser";
import { runDriveSync, DriveBaselineStore, VaultFS, DriveConflictStrategy, DEFAULT_CONFLICT_STRATEGY, ConflictChoice, DriveSyncResult, DriveSyncSummary, acquireDriveLock, releaseDriveLock } from "./driveSync";
import { authorizeDrive, completeDriveAuth, ensureFreshDriveToken, revokeDriveToken, DriveAuthExpiredError, DRIVE_PROTOCOL_ACTION } from "./driveAuth";
import { DriveFolderPicker } from "./driveFolderPicker";
import { isProActive, proNeedsRecheck, validateLicense, PRO_BETA_FREE, PRO_PRICE, PRO_CHECKOUT_URL, PRO_BETA_OFFER, ProState } from "./pro";
interface PASettings {
  dataRoot: string;
  notifyTasks: boolean;
  lastSeenVersion: string;
  readableNotesSchema?: number;
  taskListsSchema?: number;
  taskFoldersSchema?: number;
  googleTasksEnabled: boolean;
  googleTasksSyncOnStartup: boolean;
  googleSyncInterval: number; // 0=manual, or minutes: 5, 10, 15, 60, 120, 300, 720, 1440
  googleToken: GoogleToken | null;
  gtBaselines?: Record<string, { title: string; status: string; due: string }>;
  quickAccessPins?: string[];  // vault-relative paths pinned in the File Manager tab
  // Google Drive integration (beta) — FULLY ISOLATED from Tasks: its own token (driveToken,
  // never googleToken), its own broker/deep-link (see driveAuth.ts). Off by default.
  googleDriveEnabled?: boolean;
  driveToken?: GoogleToken | null; // separate from googleToken — Drive auth never touches Tasks
  driveFolderId?: string;          // the Drive folder synced (empty = My Drive root)
  driveFolderName?: string;        // human display name of the chosen Drive folder
  driveMirrorDir?: string;         // the local vault folder mirrored against Drive
  driveSyncInterval?: number;      // 0=manual, or minutes
  driveBaselines?: Record<string, { fileId: string; md5: string; modifiedTime: string; base?: string }>;
  driveConflictStrategy?: DriveConflictStrategy; // how two-sided conflicts resolve (default keep-both)
  driveSyncOnStartup?: boolean;   // run a Drive sync shortly after launch
  driveSyncOnChange?: boolean;    // event-driven: sync (debounced) when vault files change
  driveSyncBinaries?: boolean;    // include binary files (real upload/download) instead of skipping
  driveIncremental?: boolean;     // use Changes API to skip the full scan when remote is unchanged
  driveDeviceId?: string;         // stable per-device id for the multi-device Drive lock
  driveLastSync?: DriveSyncSummary; // persisted summary of the last sync (status panel)
  // Momentum Pro (one-time unlock; license key validated against the store, see pro.ts).
  // Beta-free for now (see pro.ts PRO_BETA_FREE).
  proLicenseKey?: string;
  proValid?: boolean;
  proCheckedAt?: number;
  driveCursor?: string;            // Changes API page token (last clean cycle)
}
const DEFAULT_SETTINGS: PASettings = {
  dataRoot: "Momentum Life",
  notifyTasks: false,
  lastSeenVersion: "",
  readableNotesSchema: 0,
  taskListsSchema: 0,
  taskFoldersSchema: 0,
  googleTasksEnabled: false,
  googleTasksSyncOnStartup: false,
  googleSyncInterval: 0,   // manual by default
  googleToken: null,
  gtBaselines: {},
  quickAccessPins: [],
  googleDriveEnabled: false,
  driveToken: null,
  driveFolderId: "",
  driveFolderName: "",
  driveMirrorDir: "Drive",
  driveSyncInterval: 0,
  driveBaselines: {},
  driveCursor: "",
  driveConflictStrategy: DEFAULT_CONFLICT_STRATEGY,
  driveSyncOnStartup: false,
  driveSyncOnChange: false,
  driveSyncBinaries: false,
  driveIncremental: false,
};
const LEGACY_DATA_ROOT = "Personal Assistant";
/** Bump when the readable-notes migration changes so the guarded auto-run re-triggers. */
const READABLE_NOTES_SCHEMA = 1;
/** Bump when the task-list mirror layout changes so the guarded migration re-runs. */
const TASK_LISTS_SCHEMA = 1;
/** Bump when the per-board folder layout changes so the guarded migration re-runs.
 *  6: re-run repairTaskFrontmatter to strip Obsidian Sync conflict markers that stuck cards. */
const TASK_FOLDERS_SCHEMA = 6;

export default class MomentumPlugin extends Plugin implements PAHost {
  settings: PASettings;
  store: PADataStore;
  currentPage = "cockpit";
  /** True while the plugin itself is (re)writing the task-list mirrors, so the vault
   *  "modify" listener ignores our own writes and never re-enters (prevents runaway loops). */
  private mirrorSyncing = false;
  private googleSyncIntervalId: number | null = null;
  /** User-defined nav sections, loaded from config (source of truth for the nav + views). */
  customPages: CustomPage[] = [];

  async onload(): Promise<void> {
    const data = (await this.loadData()) as Partial<PASettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // Legacy safety: if the user never chose a folder and the new default doesn't
    // exist yet but a legacy "Personal Assistant" folder does, keep using it.
    if (!data || !data.dataRoot) {
      const hasNew = this.app.vault.getAbstractFileByPath(this.settings.dataRoot) instanceof TFolder;
      const hasLegacy = this.app.vault.getAbstractFileByPath(LEGACY_DATA_ROOT) instanceof TFolder;
      if (!hasNew && hasLegacy) this.settings.dataRoot = LEGACY_DATA_ROOT;
    }
    setDataRoot(this.settings.dataRoot);
    this.store = new PADataStore(this.app);

    this.registerView(VIEW_TYPE_PA, (leaf) => new PAView(leaf, this.store, this, this.manifest.name));
    this.registerView(VIEW_TYPE_PA_NAV, (leaf) => new PANavView(leaf, this, this.manifest.name));
    this.registerView(VIEW_TYPE_PA_SIDE, (leaf) => new PASideView(leaf, this.store));
    this.registerView(VIEW_TYPE_DRIVE, (leaf) => new DriveBrowserView(leaf, this.driveViewConfig()));
    this.registerView(VIEW_TYPE_QUICK, (leaf) => new FileManagerView(leaf, {
      getPins: () => this.settings.quickAccessPins ?? [],
      setPins: async (paths) => { this.settings.quickAccessPins = paths; await this.saveSettings(); },
      drive: this.driveViewConfig(),
      driveEnabled: () => !!this.settings.googleDriveEnabled,
      openDriveBrowser: () => void this.activateDriveView(),
      driveStatus: () => this.getDriveStatus(),
    }));

    // Drive (beta) status bar — shows the last sync's counters; empty when Drive is off.
    this.driveStatusEl = this.addStatusBarItem();
    this.updateDriveStatus(this.settings.googleDriveEnabled ? "Drive: idle" : "");

    // Google Tasks OAuth returns here: the Cloudflare Worker deep-links obsidian://momentum-google
    // with the auth code, which completes the pending authorization (desktop and mobile).
    this.registerObsidianProtocolHandler(GOOGLE_PROTOCOL_ACTION, (params) => {
      void completeGoogleAuth(params);
    });
    // Google Drive OAuth returns here — a SEPARATE deep-link (momentum-drive) handled by its
    // own auth module, so a Drive callback never crosses into the Tasks flow.
    this.registerObsidianProtocolHandler(DRIVE_PROTOCOL_ACTION, (params) => {
      void completeDriveAuth(params);
    });

    this.addCommand({
      id: "open",
      name: "Open",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "migrate-readable-notes",
      name: "Momentum: migrate notes to readable names",
      callback: () => void this.runReadableNotesMigration(),
    });

    this.addCommand({
      id: "momentum-open-quick-access",
      name: "Momentum: open file manager",
      callback: () => void this.activateQuickView(),
    });

    this.addCommand({
      id: "momentum-open-drive",
      name: "Momentum: open Google Drive browser (beta)",
      callback: () => void this.activateDriveView(),
    });

    this.addCommand({
      id: "momentum-save-to-drive",
      name: "Momentum: save current file to Google Drive (beta)",
      callback: () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_DRIVE)[0];
        if (leaf?.view instanceof DriveBrowserView) void leaf.view.saveActiveToDrive();
        else new Notice("Open the drive browser first (momentum: open Google Drive browser).");
      },
    });

    this.addCommand({
      id: "momentum-sync-drive",
      name: "Momentum: sync Google Drive now (beta)",
      callback: () => void this.syncGoogleDrive(true),
    });

    this.addCommand({
      id: "momentum-open-left",
      name: "Momentum: open current page in left sidebar",
      callback: () => void this.openPageIn(this.currentPage, "left"),
    });

    this.addCommand({
      id: "momentum-open-right",
      name: "Momentum: open current page in right sidebar",
      callback: () => void this.openPageIn(this.currentPage, "right"),
    });

    this.addCommand({
      id: "momentum-open-bottom",
      name: "Momentum: open current page in bottom split",
      callback: () => void this.openPageIn(this.currentPage, "bottom"),
    });

    this.addCommand({
      id: "momentum-open-center",
      name: "Momentum: open current page in center",
      callback: () => void this.openPageIn(this.currentPage, "center"),
    });

    this.addCommand({
      id: "momentum-open-tasks-summary",
      name: "Momentum: open context panel in sidebar",
      callback: () => void this.openSidePanel(),
    });

    this.addCommand({
      id: "momentum-fix-orphan-tasks",
      name: "Momentum: assign orphan tasks to my tasks board",
      callback: () => void this.fixOrphanTasks(),
    });

    this.addCommand({
      id: "momentum-sync-google-tasks",
      name: "Momentum: sync with Google tasks",
      callback: () => void this.syncGoogleTasks(),
    });

    this.addCommand({
      id: "momentum-dedupe-tasks",
      name: "Momentum: remove duplicate tasks",
      callback: () => void this.dedupeTasks(),
    });

    this.addSettingTab(new PASettingTab(this.app, this));

    // Ensure the nav panel exists in the left sidebar so its access icon is always available.
    this.app.workspace.onLayoutReady(() => {
      // Load user-defined nav sections so the nav can render them.
      void this.reloadCustomPages();
      // Sync currentPage with whatever tab Obsidian restored, so the nav and
      // side panel reflect the right page from the first render.
      const restored = this.app.workspace.getActiveViewOfType(PAView);
      if (restored) {
        this.currentPage = restored.getCurrentPage() ?? this.currentPage;
      }
      // Ensure the "My Tasks" board folder exists — tasks without a board land here.
      void this.store.ensureBoardFolder("My Tasks");
      // Remove any duplicate panels that piled up (e.g. from workspace sync between devices).
      this.dedupeLeaves(VIEW_TYPE_PA_NAV);
      // Close stale PAView tabs in the center split — Obsidian restores every tab it
      // saw last session, producing a "Habit Tracker" ghost alongside the real page.
      // We keep only the most recently active one and re-open the current page.
      void (async () => {
        const { workspace } = this.app;
        const rootSplit = workspace.rootSplit;
        const centerLeaves = workspace.getLeavesOfType(VIEW_TYPE_PA)
          .filter((l) => l.getRoot() === rootSplit);
        if (centerLeaves.length > 1) {
          // Close all but the last one (most recently active is usually last).
          for (const leaf of centerLeaves.slice(0, -1)) leaf.detach();
        }
      })();
      if (this.app.workspace.getLeavesOfType(VIEW_TYPE_PA_NAV).length === 0) {
        const leaf = this.app.workspace.getLeftLeaf(false);
        void leaf?.setViewState({ type: VIEW_TYPE_PA_NAV });
      }
      // Promote any items added externally (e.g. a mobile widget) while the app was
      // closed BEFORE regenerating the mirrors, so those additions are not wiped.
      // Guarded so the mirror rewrites below don't re-trigger the modify listener.
      window.setTimeout(() => void (async () => {
        this.mirrorSyncing = true;
        try {
          // One-time migration of legacy mirror layout (Tasks/Lists/<board>/tasks.md)
          // to the flat, intuitive Tasks/Lists/<board>.md. Guarded by a schema version
          // so it runs once; on failure the guard stays unset so it retries next launch.
          if ((this.settings.taskListsSchema ?? 0) < TASK_LISTS_SCHEMA) {
            try {
              const migrated = await this.store.migrateTaskListStructure();
              this.settings.taskListsSchema = TASK_LISTS_SCHEMA;
              await this.saveSettings();
              if (migrated > 0) new Notice(`Momentum: reorganized ${migrated} task list${migrated === 1 ? "" : "s"} into a cleaner layout.`);
            } catch { /* leave the guard unset so the migration retries next launch */ }
          }
          // One-time migration to the folder-per-board layout: loose task notes at the
          // Tasks/ root are filed into Tasks/<board>/ so boards are visible as folders and
          // anyone can create a task by hand. Backlink-safe; guarded to run once.
          if ((this.settings.taskFoldersSchema ?? 0) < TASK_FOLDERS_SCHEMA) {
            try {
              // Rename the default board General Tasks → My Tasks (pairs with Google's list).
              await this.store.migrateDefaultBoardName();
              await this.store.ensureBoardFolder("My Tasks");
              // Repair malformed YAML frontmatter (e.g. unquoted "[gbm] ..." titles from
              // external widgets) so status/board parse and updates (done button) work.
              await this.store.repairTaskFrontmatter();
              await this.store.repairHabitFrontmatter();
              const filed = await this.store.migrateTaskFolders();
              // Boards are folders now — drop the obsolete Tasks/boards.md once, on upgrade.
              await this.store.removeLegacyBoardsConfig();
              this.settings.taskFoldersSchema = TASK_FOLDERS_SCHEMA;
              await this.saveSettings();
              if (filed > 0) new Notice(`Momentum: filed ${filed} task${filed === 1 ? "" : "s"} into board folders.`);
            } catch { /* leave the guard unset so the migration retries next launch */ }
          }
          await this.store.reconcileTaskLists();
          await this.store.syncTaskLists();
        } finally {
          window.setTimeout(() => { this.mirrorSyncing = false; }, 1000);
        }
      })(), 1500);
      this.maybeShowWhatsNew();
      // Adopt any tasks that arrived via sync without frontmatter.
      void this.adoptOrphanTasks();
      // Always sync with Google Tasks on startup if connected.
      if (this.settings.googleTasksEnabled && this.settings.googleToken) {
        window.setTimeout(() => void this.syncGoogleTasks(true), 3000);
      }
      // Start the periodic sync interval if a non-manual frequency is configured.
      this.resetGoogleSyncInterval();
      this.resetDriveSyncInterval();
      // Optional Drive sync on startup (off by default; unconfirmed so its guards still apply).
      if (this.settings.driveSyncOnStartup && this.settings.googleDriveEnabled && this.settings.driveToken) {
        window.setTimeout(() => void this.syncGoogleDrive(false), 4000);
      }
      // Optional event-driven Drive sync: watch vault changes and sync (debounced).
      this.registerDriveChangeWatcher();
      // Adopt hand-dropped task notes — registered here (post layout-ready) so the initial
      // vault-load "create" flood never runs it once per existing file.
      this.registerTaskInboxListener();
      // Background license re-check (no-op during the free beta).
      window.setTimeout(() => void this.maybeRecheckPro(), 8000);
      // Once the vault has settled, seed the known-boards registry and (on later launches)
      // catch boards deleted while this device was closed. First ever run only initializes.
      window.setTimeout(() => void this.detectDeletedBoards(), 6000);
      // One-time, best-effort migration of module notes to readable filenames. Guarded by a
      // schema version so it runs once; on failure the guard stays unset so the command retries.
      if ((this.settings.readableNotesSchema ?? 0) < READABLE_NOTES_SCHEMA) {
        void (async () => {
          try {
            await this.store.migrateAllReadableNotes();
            this.settings.readableNotesSchema = READABLE_NOTES_SCHEMA;
            await this.saveSettings();
          } catch { /* leave the guard unset so "migrate notes to readable names" can retry */ }
        })();
      }
    });

    // Every 5 minutes: register hand-made board folders, file loose root notes into
    // their board folder, and refresh the mirrors. Silent (no notices).
    this.registerInterval(window.setInterval(() => {
      void this.maintainTaskFolders();
    }, 5 * 60 * 1000));

    // The context side panel follows the note you open. Opening a Momentum note
    // surfaces the panel on the right automatically (like Team Manager), then it
    // keeps following. Non-Momentum notes never force the panel to appear.
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (!(file instanceof TFile) || !momentumNoteType(this.app, file)) return;
      void (async () => {
        await this.ensureSidePanel();
        this.app.workspace.getLeavesOfType(VIEW_TYPE_PA_SIDE).forEach((l) => {
          if (l.view instanceof PASideView) l.view.showFile(file);
        });
      })();
    }));

    // When a task-list mirror file is edited (e.g. a checkbox toggled from another
    // plugin), reflect the done/undone change back into the board tasks.
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) return;
      // Ignore the mirror writes the plugin itself makes, otherwise applyTaskListFile
      // would re-run on our own output and could loop (runaway task creation).
      if (this.mirrorSyncing) return;
      const listsPrefix = this.store.full("Tasks/Lists") + "/";
      if (!file.path.startsWith(listsPrefix)) return;
      void (async () => {
        const changed = await this.store.applyTaskListFile(file);
        if (changed) await this.syncMirrors();
      })();
    }));

    // A task note renamed in the vault keeps its frontmatter `title` in step with the new
    // filename. This is what rescues the common flow of creating a note by hand: Obsidian
    // first writes "Untitled.md", the plugin adopts it (title "Untitled"), and only THEN
    // does the file get its real name — without this the card would stay "Untitled" forever.
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      const tasksPrefix = this.store.full("Tasks") + "/";
      const listsPrefix = this.store.full("Tasks/Lists") + "/";
      const orphanPrefix = this.store.full("Tasks/_orphaned") + "/";
      if (!file.path.startsWith(tasksPrefix)) return;
      if (file.path.startsWith(listsPrefix) || file.path.startsWith(orphanPrefix)) return;
      const oldBase = oldPath.split("/").pop()?.replace(/\.md$/, "") ?? "";
      void (async () => {
        try {
          const cache = this.app.metadataCache.getFileCache(file);
          if (cache?.frontmatter?.["type"] !== "task") return;
          const current = String(cache.frontmatter["title"] ?? "");
          // Only follow the filename when the title was a placeholder or mirrored the old
          // name — never clobber a title the user deliberately made different.
          const placeholder = !current || current.toLowerCase() === "untitled";
          if (!placeholder && current !== oldBase) return;
          if (current === file.basename) return;
          await this.store.patchFrontmatter(file, (fm) => { fm.title = file.basename; });
          await this.syncMirrors();
          this.app.workspace.getLeavesOfType(VIEW_TYPE_PA).forEach((l) => { if (l.view instanceof PAView) l.view.rerender(); });
        } catch { /* best-effort: a rename should never break on a bad note */ }
      })();
    }));

    // NOTE: the vault "create" listener is registered inside onLayoutReady (see
    // registerTaskInboxListener), NOT here. Obsidian fires a "create" for EVERY existing file
    // when the vault first loads; a handler registered in onload would run once per file on
    // startup (a real slowdown on big vaults). Registering after layout-ready skips that flood.
  }

  /** Inbox: adopt any .md dropped into Tasks/ (not Lists/ or _orphaned/) that lacks valid task
   *  frontmatter. Registered AFTER layout-ready so the initial vault-load "create" flood — one
   *  event per existing file — never reaches it. */
  private registerTaskInboxListener(): void {
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (!(file instanceof TFile)) return;
      if (!file.path.endsWith(".md")) return;
      const tasksPrefix = this.store.full("Tasks") + "/";
      const listsPrefix = this.store.full("Tasks/Lists") + "/";
      const orphanPrefix = this.store.full("Tasks/_orphaned") + "/";
      if (!file.path.startsWith(tasksPrefix)) return;
      if (file.path.startsWith(listsPrefix) || file.path.startsWith(orphanPrefix)) return; // mirrors/archive are not tasks
      if (file.name === "boards.md" || file.name === "recurring.md") return;
      // Wait a moment for the metadata cache to index the new file, then check
      // whether it already has a valid task frontmatter. If not, adopt it.
      window.setTimeout(() => void this.adoptTaskFile(file), 800);
    }));
  }

  /**
   * Command: file any loose task notes at the Tasks/ root into their board folder
   * (folder = source of truth; unassigned → General Tasks) and register hand-made
   * board folders as boards. Silent maintenance runs the same on an interval.
   */
  private async fixOrphanTasks(): Promise<void> {
    const moved = await this.store.migrateTaskFolders();
    await this.syncMirrors();
    new Notice(moved > 0 ? `Filed ${moved} loose task${moved === 1 ? "" : "s"} into board folders.` : "No loose tasks found.");
  }

  /** Silent periodic upkeep: file any loose root notes into their board folder. */
  private async maintainTaskFolders(): Promise<void> {
    await this.store.migrateTaskFolders();
    // Realign any task still carrying the "Untitled" placeholder while its file has a real
    // name (covers renames that arrived from another device via Obsidian Sync).
    await this.store.repairTaskTitles();
    await this.syncMirrors();
    // After folders are settled (hand-made boards registered, loose notes filed), check for
    // boards that vanished by any route and tombstone them (with the sanity shield).
    await this.detectDeletedBoards();
  }

  /**
   * Detect boards deleted by ANY route (MCP/Claude, Finder, phone) — not just the in-app
   * "Delete board" button — and tombstone them so their Google Tasks list is removed and
   * discovery won't resurrect them. A sanity shield keeps an Obsidian Sync mid-download or a
   * half-loaded vault from being mistaken for a deletion: a board must be missing across two
   * consecutive sweeps (debounce, ~5 min), and a mass disappearance asks the user first.
   */
  private async detectDeletedBoards(): Promise<void> {
    try {
      const current = this.store.loadBoards().map((b) => b.name).filter((n) => n !== "My Tasks");
      if (current.length === 0) return; // vault not loaded yet — never act on an empty listing.
      const reg = this.store.loadKnownBoards();
      const tombstoned = this.store.loadIgnoredBoards();
      const knownCount = reg.boards.filter((b) => b !== "My Tasks").length;
      const guard = Math.max(2, Math.ceil(knownCount * 0.5));
      const plan = planBoardDeletions(current, reg.boards, reg.pendingRemoval, tombstoned, guard);

      if (plan.suspicious) {
        const list = plan.suspiciousBoards.join(", ");
        const msg = `Momentum: ${plan.suspiciousBoards.length} boards disappeared at once (${list}).\n\n` +
          `This can be a real deletion, or an Obsidian Sync glitch / a half-loaded vault. If you continue, ` +
          `they're removed and their Google Tasks lists are deleted on the next sync.\n\nRemove these boards?`;
        const ok = await this.confirmBoardDeletion(msg);
        // Declined or dismissed → keep everything intact; a genuine deletion is caught later
        // once the vault is settled. Never tombstone behind the user's back.
        if (!ok) return;
        for (const name of plan.suspiciousBoards) await this.store.addIgnoredBoard(name);
        await this.store.writeKnownBoards({
          boards: reg.boards.filter((b) => !plan.suspiciousBoards.includes(b) && b !== "My Tasks"),
          pendingRemoval: [],
        });
        new Notice(`Momentum: removed ${plan.suspiciousBoards.length} deleted board${plan.suspiciousBoards.length === 1 ? "" : "s"}.`);
        if (this.isGoogleTasksReady()) void this.syncGoogleTasks(true);
        return;
      }

      await this.store.writeKnownBoards({ boards: plan.nextBoards, pendingRemoval: plan.nextPending });
      for (const name of plan.toTombstone) await this.store.addIgnoredBoard(name);
      if (plan.toTombstone.length > 0) {
        new Notice(`Momentum: removed ${plan.toTombstone.length} deleted board${plan.toTombstone.length === 1 ? "" : "s"}.`);
        if (this.isGoogleTasksReady()) void this.syncGoogleTasks(true);
      }
    } catch { /* best-effort: detection must never break startup or the sweep */ }
  }

  /** Confirm a suspicious mass board deletion. Resolves true only on explicit confirm. */
  private confirmBoardDeletion(msg: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let done = false;
      const modal = new ConfirmModal(this.app, msg, () => { done = true; resolve(true); });
      modal.onClose = () => { modal.contentEl.empty(); if (!done) resolve(false); };
      modal.open();
    });
  }

  /**
   * Command: remove duplicate task notes (same board + title — e.g. a mobile widget's
   * "name 2" copies). Keeps the Google-linked or oldest note in each group and deletes
   * the rest, after an explicit confirmation showing the count.
   */
  private async dedupeTasks(): Promise<void> {
    const dupes = this.store.findDuplicateTasks();
    const removable = dupes.reduce((n, g) => n + g.remove.length, 0);
    if (!removable) { new Notice("No duplicate tasks found."); return; }
    new ConfirmModal(
      this.app,
      `Remove ${removable} duplicate task${removable === 1 ? "" : "s"} across ${dupes.length} group${dupes.length === 1 ? "" : "s"}? The original of each is kept.`,
      async () => {
        let removed = 0;
        for (const g of dupes) {
          for (const t of g.remove) { try { await this.store.deleteTask(t); removed++; } catch { /* skip */ } }
        }
        await this.syncMirrors();
        this.app.workspace.getLeavesOfType(VIEW_TYPE_PA).forEach((l) => { if (l.view instanceof PAView) l.view.rerender(); });
        new Notice(`Removed ${removed} duplicate task${removed === 1 ? "" : "s"}.`);
      },
    ).open();
  }

  /**
   * Scan Tasks/ for .md files without valid Momentum frontmatter and adopt them.
   * Runs on startup and covers files that arrived via sync before Obsidian was open.
   */
  private async adoptOrphanTasks(): Promise<void> {
    const tasksPrefix = this.store.full("Tasks") + "/";
    const listsPrefix = this.store.full("Tasks/Lists") + "/";
    const orphanPrefix = this.store.full("Tasks/_orphaned") + "/";
    const skip = new Set(["boards.md", "recurring.md"]);
    const files = this.app.vault.getMarkdownFiles().filter((f) =>
      f.path.startsWith(tasksPrefix) &&
      !f.path.startsWith(listsPrefix) &&
      !f.path.startsWith(orphanPrefix) &&
      !skip.has(f.name),
    );
    for (const file of files) {
      await this.adoptTaskFile(file);
    }
    // A note adopted while Obsidian still called it "Untitled.md" keeps that placeholder
    // title; realign it with the real filename before the mirrors are written.
    await this.store.repairTaskTitles();
    // Re-sync mirrors after adoption so new tasks appear in the lists.
    await this.syncMirrors();
  }

  /**
   * Adopt a manually-created (or externally-dropped) file in Tasks/ by injecting
   * a minimal Momentum frontmatter if it doesn't already have one.
   * Preserves whatever body text was written by the external author.
   */
  private async adoptTaskFile(file: TFile): Promise<void> {
    try {
      // Repair malformed YAML first (e.g. an unquoted "[gbm] ..." title) so the cache can
      // parse it and processFrontMatter below can write to it.
      if (await this.store.repairTaskFile(file)) {
        await new Promise((r) => window.setTimeout(r, 50));
      }
      const cache = this.app.metadataCache.getFileCache(file);
      const fmType: unknown = cache?.frontmatter?.["type"];
      const fmId: unknown = cache?.frontmatter?.["task_id"];
      // Already a Momentum task — nothing to do.
      if (fmType === "task" && fmId) return;
      // The board comes from the parent folder (folder = source of truth). A note dropped
      // in Tasks/<Board>/ becomes a task of that board; one dropped loose at the Tasks/
      // root goes to "My Tasks" and is filed there below.
      const tasksRoot = this.store.full("Tasks");
      const parent = file.parent;
      const inBoardFolder = !!parent && parent.path !== tasksRoot &&
        parent.path.startsWith(tasksRoot + "/") && parent.name !== "Lists" && parent.name !== "_orphaned";
      const board = inBoardFolder && parent ? parent.name : "My Tasks";
      // Patch in the minimum required fields, preserving any existing frontmatter
      // fields and all body content.
      // The FILENAME is the note's title in Obsidian, so it is the source of truth here.
      // Obsidian does write "Untitled.md" before the user names the note, though: in that
      // one case fall back to the first body line, and if the body is empty too the title is
      // realigned later by the rename listener / repairTaskTitles sweep.
      let adoptedTitle = file.basename;
      if (!adoptedTitle || adoptedTitle.toLowerCase().startsWith("untitled")) {
        const body = await this.store.readBody(file.path);
        const firstLine = body.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find((l) => l.length > 0);
        if (firstLine) adoptedTitle = firstLine.slice(0, 120);
      }
      await this.app.fileManager.processFrontMatter(file, (matter: Record<string, unknown>) => {
        if (!matter.type) matter.type = "task";
        if (!matter.task_id) matter.task_id = crypto.randomUUID ? crypto.randomUUID() : ("t" + Date.now());
        if (!matter.title) matter.title = adoptedTitle;
        if (!matter.status) matter.status = "backlog";
        matter.kanban_name = board;
        if (!matter.priority) matter.priority = "medium";
        if (!matter.created) matter.created = new Date().toISOString();
        matter.modified = new Date().toISOString();
      });
      // A note in a board folder is already correctly filed (folder = board). A loose root
      // note is filed under General Tasks.
      if (!inBoardFolder) await this.store.moveTaskToBoardFolder(file, board);
      // Re-sync mirrors so the new task appears in task lists.
      await this.syncMirrors();
    } catch { /* best-effort: if adoption fails the file is left as-is */ }
  }

  /** Open (and reveal) the context panel in the right sidebar. */
  async openSidePanel(): Promise<void> {
    const { workspace } = this.app;
    const leaf = workspace.getLeavesOfType(VIEW_TYPE_PA_SIDE)[0] ?? workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_PA_SIDE, active: true });
    void workspace.revealLeaf(leaf);
    // Reflect the page you're currently on when opened from the ribbon/command.
    this.updateSidePage(this.currentPage);
  }

  /** Ensure a context panel exists in the right sidebar. Reveals it the first time
   *  it is created so it doesn't stay hidden behind another sidebar tab. */
  private async ensureSidePanel(): Promise<void> {
    const { workspace } = this.app;
    if (workspace.getLeavesOfType(VIEW_TYPE_PA_SIDE).length) return;
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_PA_SIDE, active: true });
    void workspace.revealLeaf(leaf);
  }

  /** Open the nav panel in the left sidebar and the content in the main area. */
  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let navLeaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_PA_NAV)[0] ?? null;
    if (!navLeaf) {
      navLeaf = workspace.getLeftLeaf(false);
      await navLeaf?.setViewState({ type: VIEW_TYPE_PA_NAV, active: true });
    }
    if (navLeaf) void workspace.revealLeaf(navLeaf);
    await this.openPage(this.currentPage);
  }

  /** Open (or reveal) the File Manager tab in a center tab. */
  async activateQuickView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_QUICK)[0];
    if (existing) { void workspace.revealLeaf(existing); return; }
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_QUICK, active: true });
    void workspace.revealLeaf(leaf);
  }

  // ── Google Drive (beta) — isolated from Tasks: own token, own broker, own deep-link ───────

  /** Open (or reveal) the Google Drive browser in a center tab. */
  async activateDriveView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_DRIVE)[0];
    if (existing) { void workspace.revealLeaf(existing); return; }
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_DRIVE, active: true });
    void workspace.revealLeaf(leaf);
  }

  /** A fresh Drive access_token, or null when Drive is off/disconnected. Reads ONLY driveToken
   *  (never googleToken) and refreshes through the Drive broker — Tasks is never touched. */
  /** Public accessor for a fresh Drive access token (used by the settings folder picker). */
  async getDriveToken(): Promise<string | null> { return this.driveAccessToken(); }

  // ---- Momentum Pro (one-time unlock) ----
  private proState(): ProState {
    return { key: this.settings.proLicenseKey, valid: this.settings.proValid, checkedAt: this.settings.proCheckedAt };
  }
  /** Is a Pro feature unlocked? True during the closed beta (PRO_BETA_FREE) or with a valid license. */
  isProEnabled(): boolean { return isProActive(this.proState()); }

  /** Activate Pro with the license key from the store checkout (validated against the store's API). */
  async activatePro(key: string): Promise<void> {
    const ok = await validateLicense(key);
    this.settings.proLicenseKey = key.trim();
    this.settings.proValid = ok;
    this.settings.proCheckedAt = Date.now();
    await this.saveSettings();
    new Notice(ok ? "✓ Momentum Pro activated — thank you!" : "That license key couldn't be verified.");
  }

  /** Background re-validation of the license when the last check is stale (no-op during beta). */
  private async maybeRecheckPro(): Promise<void> {
    if (!proNeedsRecheck(this.proState()) || !this.settings.proLicenseKey) return;
    try {
      const ok = await validateLicense(this.settings.proLicenseKey);
      this.settings.proValid = ok;
      this.settings.proCheckedAt = Date.now();
      await this.saveSettings();
    } catch { /* keep the last known state offline */ }
  }

  private async driveAccessToken(): Promise<string | null> {
    const tok = this.settings.driveToken;
    if (!this.settings.googleDriveEnabled || !tok) return null;
    try {
      const fresh = await ensureFreshDriveToken(tok);
      if (fresh !== tok) { this.settings.driveToken = fresh; await this.saveSettings(); }
      return fresh.access_token;
    } catch (e) {
      if (e instanceof DriveAuthExpiredError) { new Notice("Google Drive: session expired. Reconnect it in settings."); return null; }
      throw e;
    }
  }

  /** Config passed to the Drive panel (standalone view and the File Manager section). */
  private driveViewConfig(): DriveViewConfig {
    return {
      getToken: () => this.driveAccessToken(),
      mirrorDir: () => this.settings.driveMirrorDir ?? "Drive",
      driveFolderId: () => this.settings.driveFolderId ?? "",
      dataRoot: () => this.settings.dataRoot ?? "",
      syncNow: (onProgress) => this.syncGoogleDrive(true, onProgress),
    };
  }

  /** DriveBaselineStore backed by settings.driveBaselines (persisted in data.json). */
  private driveBaselineStore(): DriveBaselineStore {
    const map = (this.settings.driveBaselines ??= {});
    return {
      get: (n) => map[n],
      set: (n, b) => { map[n] = b; },
      remove: (n) => { delete map[n]; },
      names: () => Object.keys(map),
      getCursor: () => this.settings.driveCursor || undefined,
      setCursor: (t) => { this.settings.driveCursor = t; },
      save: async () => { await this.saveSettings(); },
    };
  }

  /**
   * VaultFS over the mirror scope, keyed by RELATIVE PATH (so subfolders sync, not just a flat
   * folder). `driveMirrorDir` = "" means WHOLE VAULT — in that mode the plugin's own data root
   * (dataRoot) is excluded, to avoid a feedback loop with its own logs/notes and to never let a
   * Drive pull overwrite the app's live state mid-operation.
   */
  private driveVaultFS(): VaultFS {
    const raw = this.settings.driveMirrorDir ?? "Drive";
    const base = raw === "" ? "" : normalizePath(raw); // "" = whole vault
    const dataRoot = normalizePath(this.settings.dataRoot || "");
    const toFull = (rel: string) => normalizePath(base ? `${base}/${rel}` : rel);
    const inScope = (path: string): boolean => {
      if (base) return path === base || path.startsWith(`${base}/`);
      if (dataRoot && (path === dataRoot || path.startsWith(`${dataRoot}/`))) return false; // exclude plugin data
      return true;
    };
    const ensureFolders = async (fullPath: string): Promise<void> => {
      const slash = fullPath.lastIndexOf("/");
      if (slash < 0) return;
      const parts = fullPath.slice(0, slash).split("/");
      let cur = "";
      for (const seg of parts) {
        cur = cur ? `${cur}/${seg}` : seg;
        if (!(this.app.vault.getAbstractFileByPath(cur) instanceof TFolder)) {
          await this.app.vault.createFolder(cur).catch(() => {});
        }
      }
    };
    return {
      list: async () => {
        const out: string[] = [];
        for (const f of this.app.vault.getFiles()) {
          if (!inScope(f.path)) continue;
          out.push(base ? f.path.slice(base.length + 1) : f.path);
        }
        return out;
      },
      read: async (rel) => {
        const f = this.app.vault.getAbstractFileByPath(toFull(rel));
        return f instanceof TFile ? this.app.vault.read(f) : "";
      },
      write: async (rel, content) => {
        const full = toFull(rel);
        await ensureFolders(full);
        const f = this.app.vault.getAbstractFileByPath(full);
        if (f instanceof TFile) await this.app.vault.modify(f, content);
        else await this.app.vault.create(full, content);
      },
      exists: async (rel) => this.app.vault.getAbstractFileByPath(toFull(rel)) instanceof TFile,
      trash: async (rel) => {
        const f = this.app.vault.getAbstractFileByPath(toFull(rel));
        if (f instanceof TFile) await this.app.fileManager.trashFile(f); // reversible, respects user preference
      },
      mtime: async (rel) => {
        const f = this.app.vault.getAbstractFileByPath(toFull(rel));
        return f instanceof TFile ? f.stat.mtime : 0;
      },
      readBinary: async (rel) => {
        const f = this.app.vault.getAbstractFileByPath(toFull(rel));
        return f instanceof TFile ? this.app.vault.readBinary(f) : new ArrayBuffer(0);
      },
      writeBinary: async (rel, data) => {
        const full = toFull(rel);
        await ensureFolders(full);
        const f = this.app.vault.getAbstractFileByPath(full);
        if (f instanceof TFile) await this.app.vault.modifyBinary(f, data);
        else await this.app.vault.createBinary(full, data);
      },
    };
  }

  /** Confirm a Drive mass deletion (over the safety limit). Resolves true only on explicit OK. */
  private confirmDriveDeletion(msg: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let done = false;
      const modal = new ConfirmModal(this.app, msg, () => { done = true; resolve(true); });
      modal.onClose = () => { modal.contentEl.empty(); if (!done) resolve(false); };
      modal.open();
    });
  }

  /** Ask the user how to resolve one Drive conflict (the `ask` strategy). Defaults to keep-both. */
  private askDriveConflict(name: string): Promise<ConflictChoice> {
    return new Promise<ConflictChoice>((resolve) => {
      new ChoiceModal<ConflictChoice>(
        this.app,
        `Drive conflict on "${name}": local and remote both changed. Which version do you want to keep?`,
        [
          { label: "Keep both", value: "both", cta: true },
          { label: "Keep local", value: "local" },
          { label: "Keep remote", value: "remote" },
        ],
        "both",
        (choice) => resolve(choice),
      ).open();
    });
  }

  /** Run one bidirectional Drive sync cycle. `confirmed` (manual) bypasses the mass-change guard.
   *  Any Drive error is contained here and never affects the Tasks sync. */
  async syncGoogleDrive(confirmed = false, onProgress?: (p: { done: number; total: number }) => void): Promise<void> {
    if (this.driveSyncing) { new Notice("Drive: a sync is already running."); return; }
    // Google Drive sync is the Momentum Pro feature (single choke point: covers the manual
    // button, command, startup, interval and on-change paths). No-op while PRO_BETA_FREE.
    if (!this.isProEnabled()) { new Notice("Google Drive sync is a momentum pro feature. Unlock it in settings."); return; }
    const token = await this.driveAccessToken();
    if (!token) { new Notice("Google Drive: not connected."); return; }
    this.driveSyncing = true;
    this.updateDriveStatus("Drive: syncing…");
    const progress = (p: { done: number; total: number }): void => {
      this.updateDriveStatus(p.total ? `Drive: syncing ${p.done}/${p.total}` : "Drive: syncing…");
      onProgress?.(p);
    };
    const rootId = this.settings.driveFolderId || "root";
    const deviceId = this.getDriveDeviceId();
    let locked = false;
    try {
      // Multi-device guard: claim the Drive-folder lock so two devices don't clobber each other.
      const lock = await acquireDriveLock(token, rootId, deviceId);
      if (!lock.ok) {
        this.updateDriveStatus("Drive: locked (other device)");
        new Notice(`Drive: another device is syncing this folder. Try again in a moment.`);
        return;
      }
      locked = true;
      const result = await runDriveSync({
        token,
        driveFolderId: this.settings.driveFolderId || undefined,
        fs: this.driveVaultFS(),
        baselines: this.driveBaselineStore(),
        confirmed,
        conflictStrategy: this.settings.driveConflictStrategy ?? DEFAULT_CONFLICT_STRATEGY,
        resolveConflict: (name) => this.askDriveConflict(name),
        confirmDelete: (msg) => this.confirmDriveDeletion(msg),
        onProgress: progress,
        syncBinaries: !!this.settings.driveSyncBinaries,
        incremental: !!this.settings.driveIncremental,
      });
      this.settings.driveLastSync = {
        time: new Date().toISOString(),
        scope: this.settings.driveMirrorDir === "" ? "whole vault" : (this.settings.driveMirrorDir || "Drive"),
        pushed: result.pushed, pulled: result.pulled, merged: result.merged, conflicted: result.conflicted,
        deletedLocal: result.deletedLocal, deletedRemote: result.deletedRemote, skippedBinary: result.skippedBinary,
        blocked: result.blocked, errorCount: result.errors.length,
        issuesTotal: result.issues.length,
        issues: result.issues.slice(0, 100),
      };
      await this.saveSettings();
      void this.writeDriveDebugLog(result);
      const summary = [
        result.pushed ? `↑${result.pushed}` : "",
        result.pulled ? `↓${result.pulled}` : "",
        result.merged ? `⇄${result.merged}` : "",
        result.conflicted ? `⚠︎${result.conflicted}` : "",
        (result.deletedLocal + result.deletedRemote) ? `🗑${result.deletedLocal + result.deletedRemote}` : "",
        result.skippedBinary ? `⊘${result.skippedBinary}` : "",
      ].filter(Boolean).join(" ");
      this.updateDriveStatus(`Drive: ${summary || "idle"}`);
      if (result.blocked) {
        new Notice(`Drive: ${result.blocked} pending changes (over a safety limit). Use "Sync now" to confirm.`);
      } else {
        const parts = [
          result.pushed ? `↑${result.pushed}` : "",
          result.pulled ? `↓${result.pulled}` : "",
          result.merged ? `⇄${result.merged}` : "",
          result.conflicted ? `⚠︎${result.conflicted}` : "",
          (result.deletedLocal + result.deletedRemote) ? `🗑${result.deletedLocal + result.deletedRemote}` : "",
          result.skippedBinary ? `⊘${result.skippedBinary}` : "",
        ].filter(Boolean).join(" ");
        new Notice(`Drive sync: ${parts || "nothing to do"}${result.errors.length ? ` (${result.errors.length} errors)` : ""}.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void this.writeDriveDebugLog(null, msg);
      this.updateDriveStatus("Drive: error");
      new Notice(`Drive sync failed: ${msg}`);
    } finally {
      if (locked) await releaseDriveLock(token, rootId, deviceId).catch(() => {});
      // Keep the guard up briefly after the run so the sync's own trailing write events don't
      // immediately re-trigger the event-driven watcher.
      window.setTimeout(() => { this.driveSyncing = false; }, 1500);
    }
  }

  /** Append a human-readable Drive sync entry to Config/google-drive-debug.md (diagnostics). */
  private async writeDriveDebugLog(result: DriveSyncResult | null, fatal?: string): Promise<void> {
    try {
      const path = `${this.settings.dataRoot}/Config/google-drive-debug.md`;
      const scope = this.settings.driveMirrorDir === "" ? "whole vault" : (this.settings.driveMirrorDir || "Drive");
      const lines: string[] = [];
      lines.push(`## ${new Date().toISOString()}`);
      lines.push(`- scope: ${scope} · driveFolder: ${this.settings.driveFolderName || "My Drive root"} (${this.settings.driveFolderId || "root"})`);
      if (fatal) lines.push(`- FATAL: ${fatal}`);
      if (result) {
        lines.push(`- pushed=${result.pushed} pulled=${result.pulled} merged=${result.merged} conflicted=${result.conflicted} deletedLocal=${result.deletedLocal} deletedRemote=${result.deletedRemote} skippedBinary=${result.skippedBinary} blocked=${result.blocked}`);
        if (result.errors.length) lines.push(`- errors (${result.errors.length}):`, ...result.errors.slice(0, 30).map((e) => `  - ${e}`));
        if (result.notes.length) lines.push(`- notes (${result.notes.length}):`, ...result.notes.slice(0, 30).map((n) => `  - ${n}`));
      }
      lines.push("");
      const dir = `${this.settings.dataRoot}/Config`;
      if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) await this.app.vault.createFolder(dir).catch(() => {});
      const existing = this.app.vault.getAbstractFileByPath(path);
      const block = lines.join("\n");
      if (existing instanceof TFile) {
        const prev = await this.app.vault.read(existing);
        await this.app.vault.modify(existing, `${block}\n${prev}`); // newest on top
      } else {
        await this.app.vault.create(path, `# Google Drive sync log\n\n${block}\n`);
      }
    } catch { /* logging must never break the sync */ }
  }

  private driveStatusEl: HTMLElement | null = null;
  /** Update the Drive status-bar item (no-op if it doesn't exist). */
  private updateDriveStatus(text: string): void {
    if (this.driveStatusEl) this.driveStatusEl.setText(text);
  }

  /** True while a Drive sync is running — used to ignore the sync's OWN vault writes in the
   *  event-driven watcher (otherwise a pull would re-trigger a sync in a loop). */
  private driveSyncing = false;
  private driveChangeTimer: number | null = null;

  /** Instant Drive status for the File Manager panel: last-sync summary + compliance counts
   *  (baselines that are still in-scope local files vs total in-scope files). No network. */
  getDriveStatus(): { last?: DriveSyncSummary; tracked: number; inScope: number; logPath: string; files: { path: string; status: "synced" | "local"; at?: string; mtime: number }[] } {
    const raw = this.settings.driveMirrorDir ?? "Drive";
    const base = raw === "" ? "" : normalizePath(raw);
    const dataRoot = normalizePath(this.settings.dataRoot || "");
    const inScope: { rel: string; mtime: number }[] = [];
    for (const f of this.app.vault.getFiles()) {
      if (base) {
        if (f.path === base || f.path.startsWith(`${base}/`)) inScope.push({ rel: f.path.slice(base.length + 1), mtime: f.stat.mtime });
      } else {
        if (dataRoot && (f.path === dataRoot || f.path.startsWith(`${dataRoot}/`))) continue;
        inScope.push({ rel: f.path, mtime: f.stat.mtime });
      }
    }
    const baselines = this.settings.driveBaselines ?? {};
    let tracked = 0;
    const files = inScope.map(({ rel, mtime }) => {
      const b = baselines[rel];
      if (b) { tracked++; return { path: rel, status: "synced" as const, at: b.modifiedTime, mtime }; }
      return { path: rel, status: "local" as const, mtime };
    });
    // Local-only first (the actionable ones), then alphabetical.
    files.sort((a, b2) => (a.status === b2.status ? a.path.localeCompare(b2.path) : a.status === "local" ? -1 : 1));
    const logPath = `${this.settings.dataRoot}/Config/google-drive-debug.md`;
    return { last: this.settings.driveLastSync, tracked, inScope: inScope.length, logPath, files };
  }

  /** Stable per-device id for the multi-device Drive lock (generated once, then persisted). */
  private getDriveDeviceId(): string {
    if (!this.settings.driveDeviceId) {
      this.settings.driveDeviceId = (window.crypto?.randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      void this.saveSettings();
    }
    return this.settings.driveDeviceId;
  }

  /** Is `path` inside the current Drive sync scope (a subfolder, or whole vault minus dataRoot)? */
  private pathInDriveScope(path: string): boolean {
    const raw = this.settings.driveMirrorDir ?? "Drive";
    if (raw === "") {
      const dr = this.settings.dataRoot || "";
      return !(dr && (path === dr || path.startsWith(`${dr}/`)));
    }
    return path === raw || path.startsWith(`${raw}/`);
  }

  /** Event-driven Drive sync: on any in-scope vault change, schedule a debounced sync. Gated by
   *  driveSyncOnChange; skips the sync's own writes via driveSyncing. */
  private registerDriveChangeWatcher(): void {
    const schedule = (path: string): void => {
      if (!this.settings.driveSyncOnChange || !this.settings.googleDriveEnabled || !this.settings.driveToken) return;
      if (this.driveSyncing) return; // our own writes during a sync must not re-trigger it
      if (!this.pathInDriveScope(path)) return;
      if (this.driveChangeTimer !== null) window.clearTimeout(this.driveChangeTimer);
      this.driveChangeTimer = window.setTimeout(() => {
        this.driveChangeTimer = null;
        void this.syncGoogleDrive(false);
      }, 8000); // debounce: wait for a lull in edits before syncing
    };
    this.registerEvent(this.app.vault.on("modify", (f) => schedule(f.path)));
    this.registerEvent(this.app.vault.on("create", (f) => schedule(f.path)));
    this.registerEvent(this.app.vault.on("delete", (f) => schedule(f.path)));
    this.registerEvent(this.app.vault.on("rename", (f) => schedule(f.path)));
  }

  private driveSyncTimer: number | null = null;
  /** (Re)start the periodic Drive sync based on settings.driveSyncInterval. */
  resetDriveSyncInterval(): void {
    if (this.driveSyncTimer !== null) { window.clearInterval(this.driveSyncTimer); this.driveSyncTimer = null; }
    const mins = this.settings.driveSyncInterval;
    if (!mins || !this.settings.googleDriveEnabled || !this.settings.driveToken) return;
    this.driveSyncTimer = window.setInterval(() => void this.syncGoogleDrive(false), mins * 60_000);
    this.registerInterval(this.driveSyncTimer);
  }

  /** Connect Google Drive (beta) via its OWN broker/deep-link. Stores driveToken; never touches
   *  the Tasks token or connection. */
  async connectDrive(): Promise<void> {
    try {
      new Notice("Opening Google Drive authorisation…");
      const token = await authorizeDrive((url) => { window.open(url, "_blank"); });
      this.settings.driveToken = token;
      this.settings.googleDriveEnabled = true;
      await this.saveSettings();
      this.resetDriveSyncInterval();
      this.updateDriveStatus("Drive: idle");
      new Notice("✓ connected to Google Drive (beta).");
      new Notice("⚠ Drive is beta: back up your vault before the first sync. Binary files are skipped for now.", 10000);
      const settingTab = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
      if (settingTab) { settingTab.open(); settingTab.openTabById(this.manifest.id); }
    } catch (e) {
      new Notice(`Google Drive connection failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Disconnect Google Drive: revoke the grant, drop driveToken. Vault files are kept, and the
   *  Tasks connection is untouched. */
  async disconnectDrive(): Promise<void> {
    const token = this.settings.driveToken;
    if (!token) return;
    const confirmed = await new Promise<boolean>((resolve) => {
      let decided = false;
      const modal = new ConfirmModal(
        this.app,
        "Disconnect Google Drive? The app's access to your Drive will be revoked. Your vault files are kept.",
        () => { decided = true; resolve(true); },
      );
      modal.onClose = () => { modal.contentEl.empty(); if (!decided) resolve(false); };
      modal.open();
    });
    if (!confirmed) return;
    const outcome = await revokeDriveToken(token);
    this.settings.driveToken = null;
    await this.saveSettings();
    this.resetDriveSyncInterval();
    this.updateDriveStatus("");
    new Notice(outcome.ok
      ? "✓ Google Drive: access revoked and disconnected."
      : "Google Drive: disconnected locally; revocation wasn't confirmed. You can also remove access at myaccount.google.com/permissions.");
  }

  /** Set the active page and ensure a CENTER content view shows it (reusing one if present). */
  async openPage(id: string): Promise<void> {
    // The File Manager and Drive browser are dedicated ItemViews, not PAView pages.
    if (id === "quick-access") { this.currentPage = id; this.refreshNav(); return void this.activateQuickView(); }
    if (id === "drive") { this.currentPage = id; this.refreshNav(); return void this.activateDriveView(); }
    this.currentPage = id;
    const { workspace } = this.app;
    let leaf = this.findCenterPAView();
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
    }
    await leaf.setViewState({ type: VIEW_TYPE_PA, active: true, state: { page: id } });
    void workspace.revealLeaf(leaf);
    this.refreshNav();
    this.updateSidePage(id);
  }

  /** Tell any open context panel to mirror the given Momentum page (nav-driven). */
  private updateSidePage(id: string): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_PA_SIDE).forEach((l) => {
      if (l.view instanceof PASideView) l.view.showPage(id);
    });
  }

  /** Open a page in a chosen workspace location as an independent view. */
  async openPageIn(id: string, location: PALocation): Promise<void> {
    if (id === "quick-access") { this.currentPage = id; this.refreshNav(); return void this.activateQuickView(); }
    if (id === "drive") { this.currentPage = id; this.refreshNav(); return void this.activateDriveView(); }
    this.currentPage = id;
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null;
    switch (location) {
      case "left":
        leaf = workspace.getLeftLeaf(false);
        break;
      case "right":
        leaf = workspace.getRightLeaf(false);
        break;
      case "bottom":
        // Obsidian has no dedicated "bottom" leaf API; a horizontal split of the
        // active center leaf places the new leaf below it.
        leaf = workspace.getLeaf("split", "horizontal");
        break;
      case "center":
      default:
        leaf = this.findCenterPAView() ?? workspace.getLeaf("tab");
        break;
    }
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_PA, active: true, state: { page: id } });
    void workspace.revealLeaf(leaf);
    this.refreshNav();
  }

  /** Find an existing PAView docked in the main/center area (not a sidebar).
   *  Prefers the currently active leaf so navigation always updates the right tab. */
  private findCenterPAView(): WorkspaceLeaf | null {
    const { workspace } = this.app;
    const rootSplit = workspace.rootSplit;
    const centerLeaves = workspace.getLeavesOfType(VIEW_TYPE_PA)
      .filter((l) => l.getRoot() === rootSplit);
    if (!centerLeaves.length) return null;
    // Prefer the active leaf so clicking a nav item updates the focused tab.
    const active = workspace.getActiveViewOfType(PAView);
    if (active && centerLeaves.includes(active.leaf)) return active.leaf;
    return centerLeaves[0];
  }

  /** Re-render nav panels so the active-page highlight stays current. */
  private refreshNav(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_PA_NAV).forEach((l) => {
      if (l.view instanceof PANavView) l.view.render();
    });
  }

  /** Re-render every content view (so custom-page changes show immediately). */
  private rerenderViews(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_PA).forEach((l) => {
      if (l.view instanceof PAView) l.view.rerender();
    });
  }

  /** Reload the custom nav sections from config and refresh the UI. */
  private async reloadCustomPages(): Promise<void> {
    this.customPages = (await this.store.loadConfig()).customPages || [];
    this.refreshNav();
    this.rerenderViews();
  }

  /** Build a stable, unique custom-page id from a label. */
  private customPageId(label: string, taken: Set<string>): string {
    const base = "custom-" + (label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section");
    let id = base;
    let n = 2;
    while (taken.has(id)) { id = `${base}-${n}`; n++; }
    return id;
  }

  /** Access Obsidian's (untyped) command registry. */
  private commandsApi(): { listCommands?: () => Array<{ id: string; name: string }>; executeCommandById?: (id: string) => boolean } {
    return (this.app as unknown as { commands?: { listCommands?: () => Array<{ id: string; name: string }>; executeCommandById?: (id: string) => boolean } }).commands || {};
  }

  /** Run a command (legacy sections). Warns if it's unavailable. */
  private execCommand(id: string): void {
    const ok = this.commandsApi().executeCommandById?.(id);
    if (!ok) new Notice("Couldn't open that — its plugin may be disabled or the command was removed.");
  }

  /**
   * The left-sidebar ribbon icons — one per plugin view (Team, Library, Dogear, …).
   * This is exactly "what opens each plugin", with the plugin's own friendly title.
   * The API is untyped/internal, so we read it defensively.
   */
  private ribbonItems(): Array<{ id: string; title: string; hidden?: boolean; callback?: (e: MouseEvent) => unknown }> {
    const rib = (this.app as unknown as {
      workspace: { leftRibbon?: { items?: Array<{ id: string; title: string; hidden?: boolean; callback?: (e: MouseEvent) => unknown }> } };
    }).workspace.leftRibbon;
    return rib?.items ?? [];
  }

  /** Trigger a ribbon item by id (same as clicking its left-bar icon). */
  private runRibbon(id: string): void {
    const item = this.ribbonItems().find((i) => i.id === id);
    if (item?.callback) { item.callback(new MouseEvent("click")); return; }
    new Notice("Couldn't open that — the plugin's ribbon icon may be gone.");
  }

  /** Ribbon items as dropdown options (value = ribbon id, label = plugin title). */
  private ribbonOptions(current?: string): Array<{ value: string; label: string }> {
    const items = this.ribbonItems();
    const opts = items.map((i) => ({ value: i.id, label: i.title }));
    // Keep the currently-saved item selectable even if its plugin is off / icon hidden.
    if (current && !opts.some((o) => o.value === current)) {
      const cur = items.find((i) => i.id === current);
      opts.push({ value: current, label: cur?.title || current });
    }
    opts.sort((a, b) => a.label.localeCompare(b.label));
    return opts;
  }

  private customPageFields(page?: CustomPage): FieldSpec[] {
    const options = this.ribbonOptions(page?.ribbon);
    return [
      { key: "label", label: "Shortcut name", type: "text", value: page?.label || "", placeholder: "e.g. Library" },
      { key: "emoji", label: "Emoji", type: "emoji", value: page?.emoji || "" },
      // Default to the saved ribbon item, or the first available one, so a value is
      // always submitted even if the user never touches the dropdown.
      { key: "ribbon", label: "Plugin to open", type: "dropdown", value: page?.ribbon || options[0]?.value || "", options },
    ];
  }

  /** Activate a custom section: trigger its ribbon icon / command, or open a legacy folder page. */
  activateCustomPage(id: string): void {
    const page = this.customPages.find((p) => p.id === id);
    if (!page) return;
    if (page.ribbon) { this.runRibbon(page.ribbon); return; }
    if (page.command) { this.execCommand(page.command); return; }
    void this.openPage(id);
  }

  /** Open the "add plugin" dialog and persist it. */
  addCustomPage(): void {
    if (!this.ribbonItems().length) { new Notice("No plugin icons found in the ribbon to open."); return; }
    new FormModal(this.app, "Add plugin", this.customPageFields(), async (v) => {
      const label = (v.label || "").trim();
      const ribbon = (v.ribbon || "").trim();
      if (!label || !ribbon) { new Notice("A shortcut needs a name and a plugin to open."); return; }
      const cfg = await this.store.loadConfig();
      const taken = new Set(cfg.customPages.map((p) => p.id));
      const id = this.customPageId(label, taken);
      cfg.customPages.push({ id, label, emoji: (v.emoji || "").trim(), ribbon });
      await this.store.saveConfig(cfg);
      await this.reloadCustomPages();
      this.runRibbon(ribbon);
    }, "Create").open();
  }

  /** Edit an existing plugin shortcut. */
  editCustomPage(id: string): void {
    const page = this.customPages.find((p) => p.id === id);
    if (!page) return;
    new FormModal(this.app, "Edit plugin", this.customPageFields(page), async (v) => {
      const label = (v.label || "").trim();
      const ribbon = (v.ribbon || "").trim();
      if (!label || !ribbon) { new Notice("A shortcut needs a name and a plugin to open."); return; }
      const cfg = await this.store.loadConfig();
      const idx = cfg.customPages.findIndex((p) => p.id === id);
      if (idx < 0) return;
      cfg.customPages[idx] = { id: cfg.customPages[idx].id, label, emoji: (v.emoji || "").trim(), ribbon };
      await this.store.saveConfig(cfg);
      await this.reloadCustomPages();
    }, "Save").open();
  }

  /** True when the shortcut's target no longer exists — e.g. its plugin was uninstalled
   *  since the shortcut was created. A ribbon shortcut is broken when no ribbon item with
   *  that id is currently registered; a command shortcut is broken when the command
   *  can't be found. Legacy folder-page shortcuts (neither ribbon nor command) never
   *  count as broken here — they just open a Momentum page, which always exists. */
  isCustomPageBroken(id: string): boolean {
    const page = this.customPages.find((p) => p.id === id);
    if (!page) return false;
    if (page.ribbon) return !this.ribbonItems().some((i) => i.id === page.ribbon);
    if (page.command) return !(this.commandsApi().listCommands?.() ?? []).some((c) => c.id === page.command);
    return false;
  }

  /** Delete a custom section (keeps the underlying notes; only removes the nav tab). */
  async removeCustomPage(id: string): Promise<void> {
    const page = this.customPages.find((p) => p.id === id);
    if (!page) return;
    new ConfirmModal(this.app, `Remove the "${page.label}" plugin shortcut? (only the tab is removed)`, async () => {
      const cfg = await this.store.loadConfig();
      cfg.customPages = cfg.customPages.filter((p) => p.id !== id);
      await this.store.saveConfig(cfg);
      await this.reloadCustomPages();
      if (this.currentPage === id) await this.openPage("cockpit");
    }).open();
  }

  /**
   * Regenerate the task-list mirrors with the anti-echo guard set, so the vault
   * "modify" events our own writes produce are ignored by the listener (no re-entrancy,
   * no runaway loop). The guard is cleared shortly after to cover async modify echoes.
   */
  private async syncMirrors(): Promise<void> {
    this.mirrorSyncing = true;
    try {
      await this.store.syncTaskLists();
    } finally {
      window.setTimeout(() => { this.mirrorSyncing = false; }, 1000);
    }
  }

  /** Keep at most one leaf of a given view type; detach the extras. */
  private dedupeLeaves(type: string): void {
    const leaves = this.app.workspace.getLeavesOfType(type);
    leaves.slice(1).forEach((l) => l.detach());
  }

  /** Show the update dialog once per new version, listing changes since last seen. */
  private maybeShowWhatsNew(): void {
    const current = this.manifest.version;
    const last = this.settings.lastSeenVersion;
    if (last === current) return;
    const entries = last ? CHANGELOG.filter((e) => cmpVersion(e.version, last) > 0) : CHANGELOG.slice();
    this.settings.lastSeenVersion = current;
    void this.saveSettings();
    if (entries.length) new WhatsNewModal(this.app, this.manifest.name, entries).open();
  }

  /**
   * Run the readable-notes migration across every module, persist the schema guard, and
   * report an aggregate summary. Invoked by the command and reused as the retry path when
   * the guarded auto-run failed on a previous launch.
   */
  private async runReadableNotesMigration(): Promise<void> {
    try {
      const report = await this.store.migrateAllReadableNotes();
      this.settings.readableNotesSchema = READABLE_NOTES_SCHEMA;
      await this.saveSettings();
      const parts = [
        `${report.renamed} renamed`,
        `${report.skipped} already named`,
        `${report.hubsWritten} hubs updated`,
        `${report.hubsRemoved} hubs removed`,
      ];
      if (report.warnings.length) parts.push(`${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}`);
      new Notice(`Readable notes migration: ${parts.join(", ")}.`);
    } catch (e) {
      new Notice(`Readable notes migration failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** True when Google Tasks sync is enabled AND an account is connected. */
  isGoogleTasksReady(): boolean {
    return !!this.settings.googleTasksEnabled && !!this.settings.googleToken?.access_token;
  }

  /** Open this plugin's own settings tab (Obsidian's setting registry is untyped). */
  openPluginSettings(): void {
    const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
    if (!setting) { new Notice("Open settings → community plugins → momentum life."); return; }
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  /** (Re)start the periodic Google Tasks sync interval based on current settings. */
  resetGoogleSyncInterval(): void {
    if (this.googleSyncIntervalId !== null) {
      window.clearInterval(this.googleSyncIntervalId);
      this.googleSyncIntervalId = null;
    }
    const mins = this.settings.googleSyncInterval;
    if (!mins || !this.settings.googleTasksEnabled || !this.settings.googleToken) return;
    this.googleSyncIntervalId = window.setInterval(() => void this.syncGoogleTasks(true), mins * 60 * 1000);
  }

  // ── Google Tasks integration ──────────────────────────────────────────────

  private gtSync(): GTSyncService {
    return new GTSyncService(
      this.store,
      () => this.settings.googleToken,
      async (t) => { this.settings.googleToken = t; await this.saveSettings(); },
      {
        get: (id) => this.settings.gtBaselines?.[id],
        set: (id, b) => { (this.settings.gtBaselines ??= {})[id] = b; },
        remove: (id) => { if (this.settings.gtBaselines) delete this.settings.gtBaselines[id]; },
        keys: () => Object.keys(this.settings.gtBaselines ?? {}),
        save: async () => { await this.saveSettings(); },
      },
    );
  }

  /**
   * Single writer for the Google auth log. Every line passes through `redactSecrets`, so a
   * token can never reach the file even if a future call site logs a whole URL or header.
   */
  private authLogger(): { log: (stage: string, msg: string) => void; flush: () => Promise<void> } {
    const lines: string[] = [`# Google Tasks Auth Log\n\nStarted: ${new Date().toISOString()}\n`];
    const log = (stage: string, msg: string) => {
      lines.push(`- ${new Date().toISOString()} · stage=${stage} · ${redactSecrets(msg, this.settings.googleToken)}`);
    };
    const flush = async () => {
      try {
        const logPath = `${this.settings.dataRoot}/Config/google-auth-debug.md`;
        const f = this.app.vault.getAbstractFileByPath(logPath);
        const content = lines.join("\n");
        if (f instanceof TFile) await this.app.vault.modify(f, content);
        else await this.app.vault.create(logPath, content);
      } catch { /* best-effort: a log write must never break auth */ }
    };
    return { log, flush };
  }

  async connectGoogleTasks(): Promise<void> {
    const { log, flush } = this.authLogger();
    try {
      log("authorize", "Calling authorizeGoogle…");
      await flush();
      new Notice("Opening Google authorisation in your browser…");
      const token = await authorizeGoogle(
        (url) => { log("authorize", `Opening URL: ${url.slice(0, 80)}…`); window.open(url, "_blank"); },
        (m) => log("authorize", m),
      );
      log("exchange", `Token received — hasAccess: ${!!token.access_token}, hasRefresh: ${!!token.refresh_token}`);
      this.settings.googleToken = token;
      this.settings.googleTasksEnabled = true;
      await this.saveSettings();
      log("exchange", "Settings saved successfully.");
      await flush();
      new Notice("✓ connected to Google tasks. Syncing…");
      const settingTab = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
      if (settingTab) { settingTab.open(); settingTab.openTabById(this.manifest.id); }
      // Kick off an initial sync right after connecting.
      void this.syncGoogleTasks(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("authorize", `ERROR: ${msg}`);
      await flush();
      // The lifetime cap of an unverified app blocks NEW accounts only; anyone already
      // connected keeps syncing. Saying so avoids the conclusion that the plugin is broken.
      if (isUserCapError(msg)) {
        new Notice(
          "Google tasks: this app has reached the limit of accounts Google allows while its " +
          "verification is pending. Accounts already connected keep syncing. See the README " +
          "for the verification status.",
          15000,
        );
      } else {
        new Notice(`Google tasks connection failed: ${msg}`);
      }
    }
  }

  /**
   * Disconnects Google: asks Google to revoke the grant, then drops the local token.
   *
   * Previously this only cleared the token locally, which left the authorisation alive in the
   * user's Google account — an orphan grant, and a privacy policy that would have been lying
   * when it says disconnecting ends the app's access.
   *
   * Vault notes are never touched, including their google_id/google_list fields, so
   * reconnecting later resumes instead of re-importing everything.
   */
  async disconnectGoogleTasks(): Promise<void> {
    const token = this.settings.googleToken;
    if (!token) return;
    const confirmed = await new Promise<boolean>((resolve) => {
      let decided = false;
      const modal = new ConfirmModal(
        this.app,
        "Disconnect Google tasks? The app's access to your Google account will be revoked. Your task notes in the vault are kept.",
        () => { decided = true; resolve(true); },
      );
      modal.onClose = () => { modal.contentEl.empty(); if (!decided) resolve(false); };
      modal.open();
    });
    // Cancelling changes nothing at all — no request sent, token untouched.
    if (!confirmed) return;

    const { log, flush } = this.authLogger();
    const outcome = await revokeGoogleToken(token);
    log("revoke", outcome.ok ? "Revocation confirmed by Google." : `Revocation NOT confirmed (${outcome.reason}): ${outcome.detail}`);

    // The local token goes either way: a user who asked to disconnect must end up
    // disconnected even when Google is unreachable.
    this.settings.googleToken = null;
    await this.saveSettings();
    this.resetGoogleSyncInterval();
    await flush();

    new Notice(
      outcome.ok
        ? "✓ Google tasks: access revoked and disconnected."
        : "Google tasks: disconnected locally, but revocation wasn't confirmed. You can also remove access at myaccount.google.com/permissions.",
      outcome.ok ? undefined : 15000,
    );
  }

  async syncGoogleTasks(silent = false): Promise<void> {
    if (!this.settings.googleTasksEnabled || !this.settings.googleToken) {
      if (!silent) new Notice("Google tasks sync is not enabled or not connected.");
      return;
    }
    // Persistent progress banner (duration 0 = stays until we hide it) so the user sees
    // the sync is running and its progress, and knows not to edit tasks until it finishes.
    const progress = new Notice("⏳ Google tasks: preparing sync… (please don't edit tasks yet)", 0);
    const onProgress = (p: { phase: string; done: number; total: number }) => {
      if (p.phase === "fetching") {
        progress.setMessage(p.total ? `⏳ Google tasks: reading lists ${p.done}/${p.total}…` : "⏳ Google tasks: reading lists…");
      } else if (p.phase === "applying" && p.total > 0) {
        progress.setMessage(`⏳ Google tasks: syncing ${p.done}/${p.total}… (please don't edit tasks yet)`);
      } else if (p.phase === "finishing") {
        progress.setMessage("⏳ Google tasks: finishing…");
      }
    };
    const logLines: string[] = [`# Google Tasks Sync Log\n\nStarted: ${new Date().toISOString()}\n`];
    const log = (msg: string) => { logLines.push(`- ${msg}`); };
    const flushLog = async () => {
      try {
        const logPath = `${this.settings.dataRoot}/Config/google-sync-debug.md`;
        const f = this.app.vault.getAbstractFileByPath(logPath);
        const content = logLines.join("\n");
        if (f instanceof TFile) await this.app.vault.modify(f, content);
        else await this.app.vault.create(logPath, content);
      } catch { /* best-effort */ }
    };
    try {
      log("Starting sync…");
      // All syncs (startup, interval, and manual) run the FULL pipeline — including
      // deletion propagation and list consolidation — and bypass the mass-change guard.
      // (User choice: automatic runs are treated exactly like a manual "Sync now".)
      // When a mass deletion trips the safety guard, ask the user to decide (a glitch could
      // otherwise wipe real data). Resolves true to proceed, false (or dismiss) to keep everything.
      const confirmMass = (msg: string) => new Promise<boolean>((resolve) => {
        let done = false;
        const modal = new ConfirmModal(this.app, msg, () => { done = true; resolve(true); });
        modal.onClose = () => { modal.contentEl.empty(); if (!done) resolve(false); };
        modal.open();
      });
      const result = await this.gtSync().sync({ confirmed: true, onProgress, confirmMass });
      // Log the destructive counters too (deleted/orphaned) — without them a sync that
      // removed a Google task or archived a note left no trace to diagnose afterwards.
      log(`Done: pushed=${result.pushed} pulled=${result.pulled} linked=${result.linked} deleted=${result.deleted} orphaned=${result.orphaned} blocked=${result.blocked} errors=${result.errors.length}`);
      if (result.notes.length) result.notes.forEach((n) => log(`  ${n}`));
      if (result.errors.length) result.errors.forEach((e) => log(`  ERROR: ${e}`));
      await flushLog();
      await this.syncMirrors();
      this.app.workspace.getLeavesOfType(VIEW_TYPE_PA).forEach((l) => { if (l.view instanceof PAView) l.view.rerender(); });
      progress.hide();
      if (result.blocked > 0) {
        // Surface the guard even on automatic runs so the user knows nothing was pushed.
        new Notice(`Google sync paused: ${result.blocked} pending changes. Open the plugin and click "Sync now" to confirm.`);
      } else if (!silent) {
        const extra = [
          result.linked ? `${result.linked} linked` : "",
          result.deleted ? `${result.deleted} deleted` : "",
          result.orphaned ? `${result.orphaned} archived` : "",
          result.errors.length ? `${result.errors.length} error(s)` : "",
        ].filter(Boolean).join(", ");
        new Notice(`Google Tasks sync done: ↑${result.pushed} pushed, ↓${result.pulled} pulled${extra ? `, ${extra}` : ""}.`);
      }
    } catch (e) {
      progress.hide();
      const msg = e instanceof Error ? e.message : String(e);
      log(`FATAL: ${msg}`);
      if (e instanceof GoogleAuthExpiredError) {
        log("  Cause: Google revoked the refresh token. Reconnect Google tasks in settings.");
        log("  If this repeats every ~7 days, set the OAuth consent screen to \"In production\" (Testing revokes refresh tokens after 7 days).");
      }
      await flushLog();
      // An expired grant needs the user to act, so surface it even on a silent (startup /
      // interval) run — staying quiet just leaves the sync dead with no explanation.
      if (e instanceof GoogleAuthExpiredError) new Notice("Google tasks: session expired. Reconnect it in the plugin settings.", 10000);
      else if (!silent) new Notice(`Google tasks sync failed: ${msg}`);
    }
  }

  onunload(): void {}

  async saveSettings(): Promise<void> {
    setDataRoot(this.settings.dataRoot);
    await this.saveData(this.settings);
  }
}

class PASettingTab extends PluginSettingTab {
  plugin: MomentumPlugin;
  constructor(app: App, plugin: MomentumPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display(): void {
    this.renderSettings();
  }

  private renderSettings(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Data root folder")
      .setDesc("Vault folder that stores all plugin data.")
      .addText((t) =>
        t.setValue(this.plugin.settings.dataRoot).onChange(async (v) => {
          this.plugin.settings.dataRoot = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Tasks").setHeading();

    new Setting(containerEl)
      .setName("Task notifications")
      .setDesc("Show desktop notifications for tasks due today. Desktop only, and only while the app is open.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.notifyTasks).onChange(async (v) => {
          this.plugin.settings.notifyTasks = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Finances").setHeading();

    new Setting(containerEl)
      .setName("Currency")
      .setDesc("Currency symbol shown across the finances module.")
      .addDropdown((d) => {
        d.addOption("R$", "R$ — real");
        d.addOption("$", "$ — dollar");
        d.addOption("€", "€ — euro");
        d.addOption("£", "£ — pound");
        d.addOption("¥", "¥ — yen");
        d.addOption("₹", "₹ — rupee");
        d.addOption("C$", "C$ — canadian dollar");
        d.addOption("A$", "A$ — australian dollar");
        void this.plugin.store.loadConfig().then((cfg) => { if (cfg.currency) d.setValue(cfg.currency); });
        d.onChange(async (v) => {
          const c = await this.plugin.store.loadConfig();
          c.currency = v;
          await this.plugin.store.saveConfig(c);
        });
      });

    new Setting(containerEl)
      .setName("Support")
      .setDesc("If you find this plugin useful, you can support its development.")
      .addButton((b) =>
        b.setButtonText("Buy me a coffee").setCta().onClick(() => {
          window.open("https://buymeacoffee.com/jnagase", "_blank");
        })
      );

    // ── Google Tasks ──────────────────────────────────────────────────────
    new Setting(containerEl).setName("Google tasks").setHeading();

    const token = this.plugin.settings.googleToken;
    const connected = !!token?.access_token;

    const rerender = () => { containerEl.empty(); this.renderSettings(); };

    new Setting(containerEl)
      .setName("Enable Google tasks sync")
      .setDesc("Sync momentum tasks bidirectionally with Google tasks.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.googleTasksEnabled).onChange(async (v) => {
          this.plugin.settings.googleTasksEnabled = v;
          await this.plugin.saveSettings();
          rerender();
        })
      );

    if (this.plugin.settings.googleTasksEnabled) {
      new Setting(containerEl)
        .setName("Google account")
        // No email is shown: the Tasks scope doesn't grant access to the user's profile, so
        // the plugin genuinely doesn't know the address (see the note in googletasks.ts).
        .setDesc(connected ? "Connected." : "Not connected.")
        .addButton((b) => {
          if (connected) {
            b.setButtonText("Disconnect").onClick(async () => {
              // Revokes the grant at Google and clears the local token, after confirmation.
              await this.plugin.disconnectGoogleTasks();
              rerender();
            });
          } else {
            b.setButtonText("Connect Google account").setCta().onClick(() => {
              void this.plugin.connectGoogleTasks().then(() => rerender());
            });
          }
        });

      if (connected) {
        new Setting(containerEl)
          .setName("Auto-sync interval")
          .setDesc("How often to sync automatically. Syncs once on startup always.")
          .addDropdown((d) => {
            d.addOption("0", "Manual only");
            d.addOption("5", "Every 5 minutes");
            d.addOption("10", "Every 10 minutes");
            d.addOption("15", "Every 15 minutes");
            d.addOption("60", "Every hour");
            d.addOption("120", "Every 2 hours");
            d.addOption("300", "Every 5 hours");
            d.addOption("720", "Every 12 hours");
            d.addOption("1440", "Every 24 hours");
            d.setValue(String(this.plugin.settings.googleSyncInterval ?? 0));
            d.onChange(async (v) => {
              this.plugin.settings.googleSyncInterval = parseInt(v, 10) || 0;
              await this.plugin.saveSettings();
              this.plugin.resetGoogleSyncInterval();
            });
          });

        new Setting(containerEl)
          .setName("Sync now")
          .setDesc("Push all boards/tasks to Google tasks and pull new ones.")
          .addButton((b) =>
            b.setButtonText("Sync now").setCta().onClick(() => {
              void this.plugin.syncGoogleTasks();
            })
          );
      }
    }

    // ── Google Drive (beta) — separate sign-in, never touches Tasks ───────────────────────
    const driveConnected = !!this.plugin.settings.driveToken;
    new Setting(containerEl).setName("Google Drive (beta)").setHeading();

    if (!this.plugin.isProEnabled()) {
      // The whole Drive sync is a Momentum Pro feature (scope B). Without an active license, show a
      // locked card instead of any live controls, and point to the Momentum pro section just below
      // to unlock — a non-Pro user can't even connect the Drive OAuth from here.
      const locked = containerEl.createDiv({ cls: "pa-pro-locked" });
      locked.createEl("div", { cls: "pa-pro-locked-title", text: "🔒 Momentum pro feature" });
      locked.createEl("p", {
        cls: "pa-pro-locked-desc",
        text: "Two-way Google Drive sync — text notes plus images, pdfs and any other file type, " +
          "between a drive folder (or your whole vault) and Obsidian. Unlock it in the momentum pro " +
          "section just below.",
      });
    } else {

    new Setting(containerEl)
      .setName("Enable Google Drive (beta)")
      .setDesc(
        "Browse and sync files between a drive folder and a vault folder. Uses a SEPARATE Google " +
        "sign-in from Tasks. Full drive access is in Google verification — until it completes, " +
        "connect with a test-user account. Syncing is a Momentum Pro feature (free during the beta).",
      )
      .addToggle((t) =>
        t.setValue(!!this.plugin.settings.googleDriveEnabled).onChange(async (v) => {
          this.plugin.settings.googleDriveEnabled = v;
          await this.plugin.saveSettings();
          rerender();
        })
      );

    if (this.plugin.settings.googleDriveEnabled) {
      new Setting(containerEl)
        .setName("Google Drive account")
        .setDesc(driveConnected ? "Connected (separate from Tasks)." : "Not connected.")
        .addButton((b) => {
          if (driveConnected) {
            b.setButtonText("Disconnect").onClick(async () => {
              await this.plugin.disconnectDrive();
              rerender();
            });
          } else {
            b.setButtonText("Connect Google Drive").setCta().onClick(() => {
              void this.plugin.connectDrive().then(() => rerender());
            });
          }
        });

      // Local scope: a vault folder, or the whole vault.
      new Setting(containerEl)
        .setName("Vault folder to sync")
        .setDesc("Which local folder mirrors drive. Choose \"whole vault\" to sync everything (the plugin's own data folder is excluded to stay safe).")
        .addDropdown((d) => {
          d.addOption("", "🗂️ whole vault");
          const cur = this.plugin.settings.driveMirrorDir ?? "Drive";
          const folders = this.app.vault.getRoot().children
            .filter((c): c is TFolder => c instanceof TFolder)
            .map((f) => f.name)
            .sort((a, b) => a.localeCompare(b));
          if (cur && !folders.includes(cur)) folders.push(cur); // keep a custom/nested value visible
          for (const name of folders) d.addOption(name, name);
          d.setValue(cur);
          d.onChange(async (v) => {
            this.plugin.settings.driveMirrorDir = v; // "" = whole vault
            await this.plugin.saveSettings();
          });
        });

      // Remote scope: which Drive folder, via the in-plugin picker.
      new Setting(containerEl)
        .setName("Google Drive folder")
        .setDesc(`Currently: ${this.plugin.settings.driveFolderName || "My Drive (root)"}. Files sync into this folder on Drive.`)
        .addButton((b) =>
          b.setButtonText("Choose folder…").onClick(() => {
            void (async () => {
              const token = await this.plugin.getDriveToken();
              if (!token) { new Notice("Connect Google Drive first."); return; }
              new DriveFolderPicker(this.app, token, async (choice) => {
                this.plugin.settings.driveFolderId = choice.id;
                this.plugin.settings.driveFolderName = choice.name;
                await this.plugin.saveSettings();
                rerender();
              }).open();
            })();
          })
        );

      new Setting(containerEl)
        .setName("Open drive browser")
        .setDesc("Two-column view: drive files on one side, vault files on the other.")
        .addButton((b) =>
          b.setButtonText("Open").setCta().onClick(() => { void this.plugin.activateDriveView(); })
        );

      if (driveConnected) {
        new Setting(containerEl)
          .setName("Drive auto-sync interval")
          .setDesc("How often to sync the drive folder with the vault mirror folder.")
          .addDropdown((d) => {
            d.addOption("0", "Manual only");
            d.addOption("5", "Every 5 minutes");
            d.addOption("15", "Every 15 minutes");
            d.addOption("60", "Every hour");
            d.addOption("360", "Every 6 hours");
            d.addOption("1440", "Every 24 hours");
            d.setValue(String(this.plugin.settings.driveSyncInterval ?? 0));
            d.onChange(async (v) => {
              this.plugin.settings.driveSyncInterval = parseInt(v, 10) || 0;
              await this.plugin.saveSettings();
              this.plugin.resetDriveSyncInterval();
            });
          });

        new Setting(containerEl)
          .setName("Conflict resolution")
          .setDesc("What happens when a file changed on both sides. Keep both is the safest: it never overwrites.")
          .addDropdown((d) => {
            d.addOption("keep-both", "Keep both (recommended)");
            d.addOption("newer-wins", "Newer wins");
            d.addOption("local-wins", "Local wins");
            d.addOption("remote-wins", "Remote wins");
            d.addOption("ask", "Ask me each time");
            d.setValue(this.plugin.settings.driveConflictStrategy ?? DEFAULT_CONFLICT_STRATEGY);
            d.onChange(async (v) => {
              this.plugin.settings.driveConflictStrategy = v as DriveConflictStrategy;
              await this.plugin.saveSettings();
            });
          });

        new Setting(containerEl)
          .setName("Sync on startup")
          .setDesc("Run a drive sync a few seconds after Obsidian launches.")
          .addToggle((t) =>
            t.setValue(!!this.plugin.settings.driveSyncOnStartup).onChange(async (v) => {
              this.plugin.settings.driveSyncOnStartup = v;
              await this.plugin.saveSettings();
            })
          );

        new Setting(containerEl)
          .setName("Sync on change")
          .setDesc("Automatically sync a few seconds after you edit files in scope (event-driven, debounced).")
          .addToggle((t) =>
            t.setValue(!!this.plugin.settings.driveSyncOnChange).onChange(async (v) => {
              this.plugin.settings.driveSyncOnChange = v;
              await this.plugin.saveSettings();
            })
          );

        new Setting(containerEl)
          .setName("Sync binary files")
          .setDesc("Upload/download images, pdfs and other binaries too (off = text/Markdown only, binaries skipped).")
          .addToggle((t) =>
            t.setValue(!!this.plugin.settings.driveSyncBinaries).onChange(async (v) => {
              this.plugin.settings.driveSyncBinaries = v;
              await this.plugin.saveSettings();
            })
          );

        new Setting(containerEl)
          .setName("Incremental sync")
          .setDesc("Skip the full scan when nothing changed on drive (faster). Falls back to a full scan on any remote change.")
          .addToggle((t) =>
            t.setValue(!!this.plugin.settings.driveIncremental).onChange(async (v) => {
              this.plugin.settings.driveIncremental = v;
              await this.plugin.saveSettings();
            })
          );

        new Setting(containerEl)
          .setName("Sync drive now")
          .setDesc("Bidirectional sync: push, pull, 3-way merge, and safe deletion.")
          .addButton((b) =>
            b.setButtonText("Sync now").setCta().onClick(() => { void this.plugin.syncGoogleDrive(true); })
          );
      }
    }
    }

    // ── Momentum Pro ──────────────────────────────────────────────────────
    new Setting(containerEl).setName("Momentum pro").setHeading();
    const proOn = this.plugin.isProEnabled();

    // What Pro unlocks — shown always, so people know exactly what they're getting.
    const benefits = containerEl.createDiv({ cls: "pa-pro-benefits" });
    benefits.createEl("div", { text: "What you unlock", cls: "pa-pro-benefits-title" });
    const benefitsList = benefits.createEl("ul");
    benefitsList.createEl("li", {
      text: "Google Drive sync — two-way sync between a drive folder (or your whole vault) and Obsidian, on its own Google sign-in, kept separate from tasks.",
    });
    benefitsList.createEl("li", {
      text: "Any file type — images, pdfs and other binaries sync too, not just Markdown and text.",
    });
    benefitsList.createEl("li", {
      text: "Multi-device — phone and desktop stay in step, with a safe keep-both conflict mode and a lock so two devices never clobber each other.",
    });
    benefitsList.createEl("li", {
      text: "One-time purchase, no subscription — what you unlock stays yours.",
    });

    new Setting(containerEl)
      .setName(PRO_BETA_FREE ? "Status: beta — free" : proOn ? "Status: active" : "Status: not active")
      .setDesc(
        PRO_BETA_FREE
          ? "During the closed beta, all Pro features (like Google Drive sync) are unlocked for free."
          : proOn
            ? "Active — thank you!"
            : `A one-time unlock (${PRO_PRICE}) for the features above.`,
      );

    if (!PRO_BETA_FREE && !proOn) {
      new Setting(containerEl)
        .setName(PRO_BETA_OFFER ? "Get momentum pro — free for the first 100 beta users" : "Buy momentum pro")
        .setDesc(
          PRO_BETA_OFFER
            ? "Free while the beta lasts (first 100 sign-ups), then a one-time " + PRO_PRICE + ". " +
              "Checkout opens in your browser and gives you a license key to paste below."
            : `One-time ${PRO_PRICE}, handled by the store (tax included). Opens checkout in your browser.`,
        )
        .addButton((b) =>
          b.setButtonText(PRO_BETA_OFFER ? "Get it free" : "Buy").setCta().onClick(() => {
            if (PRO_CHECKOUT_URL) window.open(PRO_CHECKOUT_URL, "_blank");
            else new Notice("Checkout link isn't configured yet.");
          }),
        );
      let keyInput = this.plugin.settings.proLicenseKey ?? "";
      new Setting(containerEl)
        .setName("Activate with your license key")
        .setDesc("After checkout, your license key is shown on screen and emailed to you. Paste it here and activate. Only the key is sent to the store to verify it — nothing else.")
        .addText((t) => t.setPlaceholder("Your license key").setValue(keyInput).onChange((v) => { keyInput = v; }))
        .addButton((b) => b.setButtonText("Activate").onClick(() => { void this.plugin.activatePro(keyInput).then(() => rerender()); }));
    }
  }
}
