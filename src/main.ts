import { Plugin, WorkspaceLeaf, PluginSettingTab, App, Setting, TFolder, TFile, Notice, normalizePath, Platform } from "obsidian";
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
import { runDriveSync, DriveBaselineStore, VaultFS, DriveConflictStrategy, DEFAULT_CONFLICT_STRATEGY, ConflictChoice, DriveSyncResult, DriveSyncSummary, DriveProgress, acquireDriveLock, releaseDriveLock, isObsidianConfigSyncPath } from "./driveSync";
import { authorizeDrive, completeDriveAuth, ensureFreshDriveToken, revokeDriveToken, DriveAuthExpiredError, DRIVE_PROTOCOL_ACTION } from "./driveAuth";
import { authorizeHealth, completeHealthAuth, ensureFreshHealthToken, revokeHealthToken, grantedHealthScopes, HealthAuthExpiredError, HealthClientError, HealthToken, HEALTH_PROTOCOL_ACTION, HEALTH_SCOPES } from "./healthAuth";
import { HEALTH_REDIRECT_URI } from "./healthdomain";
import { runHealthSync } from "./healthSync";
import { decideImporter, importerFromFrontmatter, ImporterInfo } from "./healthImporter";
import { todayLocal } from "./util";
import { DriveFolderPicker } from "./driveFolderPicker";
import { isProActive, proNeedsRecheck, validateLicense, PRO_BETA_FREE, PRO_PRICE, PRO_CHECKOUT_URL, PRO_BETA_OFFER, ProState } from "./pro";
interface PASettings {
  dataRoot: string;
  lastSeenVersion: string;
  readableNotesSchema?: number;
  taskListsSchema?: number;
  taskFoldersSchema?: number;
  monthlyLedgerSchema?: number;
  // Board-note task model (beta, off by default). Device flag: when on, a board is one
  // Tasks/<Board>.md note with a `tasks[]` frontmatter array. The schema guard runs the
  // per-task→board-note migration once when the flag is first turned on (see Phase 3).
  boardNoteTasks?: boolean;
  boardNoteTasksSchema?: number;
  /** Set once the board-note model was made the default on this device (0.9.2+). */
  boardNoteDefaultApplied?: boolean;
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
  /** LEGACY (≤0.9.1): baselines used to live here. They hold a full copy of every synced note
   *  (megabytes), which made data.json huge and fragile. Now kept in drive-state.json; this field
   *  is only read once to migrate, then dropped. */
  driveBaselines?: Record<string, DriveBaselineEntry>;
  driveLocalDeletes?: Record<string, number>;     // paths the user deleted locally (evidence for delete_remote)
  driveDeclinedDeletions?: Record<string, string>; // path → situation signature the user declined to delete
  driveConflictStrategy?: DriveConflictStrategy; // how two-sided conflicts resolve (default keep-both)
  // Auto-sync (on startup, on change, incremental) is now CORE — always on, no user toggle.
  driveSyncBinaries?: boolean;    // include binary files (real upload/download) instead of skipping
  driveSyncObsidianConfig?: boolean; // Pro: replicate .obsidian config (theme/plugins) across devices
  driveScopeDefaultMigrated?: boolean; // one-time: flipped the stale "Drive" default scope to whole vault
  driveDeviceId?: string;         // stable per-device id for the multi-device Drive lock
  driveLastSync?: DriveSyncSummary; // persisted summary of the last sync (status panel)
  // Momentum Pro (one-time unlock; license key validated against the store, see pro.ts).
  // Beta-free for now (see pro.ts PRO_BETA_FREE).
  proLicenseKey?: string;
  proValid?: boolean;
  proCheckedAt?: number;
  proLicenseSeeded?: boolean; // true once the key has been mirrored into the vault (Config/pro.md)
  driveCursor?: string;            // Changes API page token (last clean cycle)
  driveFolderIds?: string[];       // Drive folder ids of our tree (for scoping the account-wide change feed)
  driveFolderMap?: Record<string, string>; // relDir → Drive folder id from the last full walk (incremental edit check)
  // Google Health (beta, bring-your-own OAuth client). Device-local: the client secret and the
  // token live only in this device's data.json (never in a vault note, never synced by Drive).
  googleHealthEnabled?: boolean;
  healthClientId?: string;
  healthClientSecret?: string;
  healthToken?: HealthToken | null;
  healthLastSync?: string;         // ISO time of the last successful Google Health import
}
const DEFAULT_SETTINGS: PASettings = {
  dataRoot: "Momentum Life",
  lastSeenVersion: "",
  readableNotesSchema: 0,
  taskListsSchema: 0,
  taskFoldersSchema: 0,
  monthlyLedgerSchema: 0,
  boardNoteTasks: true, // the default task model since 0.9.2 (one note per board)
  boardNoteTasksSchema: 0,
  boardNoteDefaultApplied: false,
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
  driveMirrorDir: "", // "" = whole vault (the safe, obvious default; a fresh vault has no "Drive/" folder)
  driveSyncInterval: 0,
  driveLocalDeletes: {},
  driveDeclinedDeletions: {},
  driveCursor: "",
  driveFolderIds: [],
  driveConflictStrategy: DEFAULT_CONFLICT_STRATEGY,
  driveSyncBinaries: false,   // Pro-gated; stays off until Pro is active and the user turns it on
  driveSyncObsidianConfig: false, // Pro-gated, opt-in; off by default
  driveScopeDefaultMigrated: false,
};
const LEGACY_DATA_ROOT = "Personal Assistant";
/**
 * Files INSIDE the data root that whole-vault Drive sync must never carry, keyed by their path
 * relative to the data root. These are per-device / volatile: the debug logs are rewritten on
 * every sync (a feedback loop if synced), and the Google-Tasks control files would fight the
 * Google Tasks sync across devices. User data (Journal, Fitness, settings.md, pro.md, …) is NOT
 * here — it syncs. Task NOTES are handled separately (owned by Google Tasks sync when enabled).
 */
const DRIVE_DATA_EXCLUDE = new Set<string>([
  "Config/google-drive-debug.md",
  "Config/google-sync-debug.md",
  "Config/google-auth-debug.md",
  "Config/pending-google-deletes.md",
  "Config/known-boards.md",
  "Config/deleted-boards.md",
  "Config/google-health-debug.md",
]);
/** One synced file's last-sync snapshot (`base` = full text, the 3-way merge base). */
type DriveBaselineEntry = { fileId: string; md5: string; modifiedTime: string; base?: string };
/** drive-state.json: Drive baselines kept OUT of data.json, tagged with the Drive folder they
 *  belong to (so baselines from one folder are never used against another), plus a backup of the
 *  folder choice (so losing data.json never silently redirects the sync to My Drive root). */
interface DriveStateFile {
  version: 1;
  folderId: string;
  folderName: string;
  /** Local folder mirrored ("" = whole vault). Backed up so a lost data.json can't silently
   *  switch an older single-folder setup to whole vault (baseline keys would no longer match). */
  mirrorDir?: string;
  baselines: Record<string, DriveBaselineEntry>;
}

/** Bump when the readable-notes migration changes so the guarded auto-run re-triggers. */
const READABLE_NOTES_SCHEMA = 1;
/** Bump when the task-list mirror layout changes so the guarded migration re-runs. */
const TASK_LISTS_SCHEMA = 1;
/** Bump when the per-board folder layout changes so the guarded migration re-runs.
 *  6: re-run repairTaskFrontmatter to strip Obsidian Sync conflict markers that stuck cards. */
const TASK_FOLDERS_SCHEMA = 6;
/** Bump when the monthly-ledger consolidation changes so the guarded migration re-runs. */
const MONTHLY_LEDGER_SCHEMA = 1;
/** Bump when the per-task→board-note migration changes so it re-runs once on a flagged device. */
const BOARD_NOTE_TASKS_SCHEMA = 1;

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
    // Board-note tasks are the default for everyone since 0.9.2. Existing users have an explicit
    // `boardNoteTasks: false` saved, so flip it ONCE here — BEFORE any task listener or upkeep
    // runs (a migration with the flag still off gets corrupted by the adopt listeners). The
    // consolidation itself runs on layout-ready (guarded by boardNoteTasksSchema), with Google
    // tasks sync held off until it finishes. Users can still switch back in settings afterwards.
    if (!this.settings.boardNoteDefaultApplied) {
      this.settings.boardNoteTasks = true;
      this.settings.boardNoteDefaultApplied = true;
      await this.saveData(this.settings);
    }
    // Hold Google tasks sync from the very start when a consolidation is still pending.
    if (this.settings.boardNoteTasks && (this.settings.boardNoteTasksSchema ?? 0) < BOARD_NOTE_TASKS_SCHEMA) {
      this.taskMigrationRunning = true;
    }
    this.store = new PADataStore(this.app);
    // Mirror the board-note device flag into the store so every task read/write picks the right
    // model. Default OFF → the store's folder-per-board path is used, unchanged from today.
    this.store.boardNoteTasks = !!this.settings.boardNoteTasks;

    // One-time (transparent): the old default local Drive scope was a folder literally named
    // "Drive". On a fresh vault with no such folder that silently synced NOTHING. Flip that stale
    // default to "whole vault" — but ONLY when there's no local "Drive" folder, so anyone who
    // deliberately mirrors a real "Drive" folder keeps it. Guarded so it runs once.
    if (!this.settings.driveScopeDefaultMigrated) {
      if (this.settings.driveMirrorDir === "Drive"
          && !(this.app.vault.getAbstractFileByPath("Drive") instanceof TFolder)) {
        this.settings.driveMirrorDir = "";
      }
      this.settings.driveScopeDefaultMigrated = true;
      await this.saveSettings();
    }
    // Drive baselines live in their own file (drive-state.json). Migrates them out of data.json
    // once (transparent), and restores the Drive folder choice if data.json lost it.
    await this.loadDriveState();

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
      isSyncing: () => this.driveSyncActive,
      subscribeDriveProgress: (cb) => this.onDriveProgress(cb),
      cancelSync: () => this.cancelDriveSync(),
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
    // Google Health OAuth returns here (obsidian://momentum-health), via the stateless relay.
    this.registerObsidianProtocolHandler(HEALTH_PROTOCOL_ACTION, (params) => {
      void completeHealthAuth(params);
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
      id: "consolidate-monthly-notes",
      name: "Momentum: consolidate monthly notes",
      callback: () => void this.runMonthlyConsolidation(),
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
      id: "sync-google-health",
      name: "Momentum: import from Google health now (beta)",
      callback: () => void this.syncGoogleHealth(false),
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
          if (!this.boardNoteMode() && (this.settings.taskListsSchema ?? 0) < TASK_LISTS_SCHEMA) {
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
          if (!this.boardNoteMode() && (this.settings.taskFoldersSchema ?? 0) < TASK_FOLDERS_SCHEMA) {
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
          // Board-note mode is on but this device hasn't consolidated its folders yet (e.g. the
          // flag was set and the migration logic later bumped). Run it once, guarded by schema.
          if (this.boardNoteMode() && (this.settings.boardNoteTasksSchema ?? 0) < BOARD_NOTE_TASKS_SCHEMA) {
            this.taskMigrationRunning = true; // Google tasks sync waits (it would see half-moved tasks)
            try {
              const n = await this.store.migrateToBoardNotes();
              this.settings.boardNoteTasksSchema = BOARD_NOTE_TASKS_SCHEMA;
              await this.saveSettings();
              if (n > 0) new Notice(`Momentum: tasks now live in one note per board — consolidated ${n} task${n === 1 ? "" : "s"}. Old notes are in the trash.`);
            } catch { /* leave the guard unset so it retries next launch */ }
            finally { this.taskMigrationRunning = false; }
          }
          await this.store.reconcileTaskLists();
          await this.store.syncTaskLists();
        } finally {
          this.taskMigrationRunning = false; // never leave Google tasks sync held
          window.setTimeout(() => { this.mirrorSyncing = false; }, 1000);
        }
      })(), 1500);
      this.maybeShowWhatsNew();
      // Adopt any tasks that arrived via sync without frontmatter.
      void this.adoptOrphanTasks();
      // Sync with Google Tasks on startup if enabled and connected. Google Tasks is the SOLE
      // task-sync channel — Drive never carries task notes — so this is a plain per-device
      // setting with no cross-device owner to reconcile; a mixed setup can no longer clobber
      // anything (one device syncs its tasks with Google, another simply keeps them local).
      if (this.settings.googleTasksEnabled && this.settings.googleToken) {
        window.setTimeout(() => void this.syncGoogleTasks(true), 3000);
      }
      // Start the periodic sync interval if a non-manual frequency is configured.
      this.resetGoogleSyncInterval();
      this.resetDriveSyncInterval();
      // Optional Drive sync on startup (off by default; unconfirmed so its guards still apply).
      // INCREMENTAL: opening the app shouldn't cost a full tree walk. The incremental path checks
      // the Drive change feed and reconstructs from the baselines when nothing changed remotely
      // (fast); it auto-escalates to a full walk when the feed reports changes (e.g. something
      // edited/deleted on Drive while closed), and the very first sync (no cursor yet) is a full
      // walk anyway to seed. So "first sync is full, every open after is incremental" — for free.
      if (this.settings.googleDriveEnabled && this.settings.driveToken) {
        window.setTimeout(() => void this.syncGoogleDrive(false, undefined, true), 4000);
      }
      // Google Health (beta): pick up the client shared by another device, then import the latest
      // watch data a few seconds after startup.
      void this.loadHealthClientFromVault();
      if (this.settings.googleHealthEnabled && this.settings.healthToken) {
        window.setTimeout(() => void this.syncGoogleHealth(true), 6000);
      }
      // Optional event-driven Drive sync: watch vault changes and sync (debounced).
      this.registerDriveChangeWatcher();
      // Adopt hand-dropped task notes — registered here (post layout-ready) so the initial
      // vault-load "create" flood never runs it once per existing file.
      this.registerTaskInboxListener();
      // Bridge the Pro license with the vault (Config/pro.md) so it syncs across devices, then
      // run the background re-check (no-op during the free beta). Reconcile first so an adopted
      // key is in place before the re-check validates it.
      void this.reconcileProLicense().then(() => window.setTimeout(() => void this.maybeRecheckPro(), 8000));
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

      // Consolidate per-item Finance/Nutrition/Fitness notes into one note per month (reversible:
      // old notes go to the trash). Guarded so it runs once; a failure leaves the guard unset to
      // retry next launch or via the manual command.
      if ((this.settings.monthlyLedgerSchema ?? 0) < MONTHLY_LEDGER_SCHEMA) {
        void (async () => {
          try {
            const n = await this.store.consolidateMonthlyLedgers();
            this.settings.monthlyLedgerSchema = MONTHLY_LEDGER_SCHEMA;
            await this.saveSettings();
            if (n > 0) new Notice(`Momentum: consolidated ${n} ${n === 1 ? "entry" : "entries"} into monthly notes.`);
          } catch { /* leave the guard unset so the consolidate command can retry */ }
        })();
      }

      // Heal month-ledger `.conflict` copies left by older Drive syncs (every launch; cheap no-op
      // when there are none).
      void this.healLedgerConflicts();
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
      if (this.boardNoteMode()) return; // board-note mode has no per-task inbox to adopt.
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
    if (this.boardNoteMode()) { new Notice("Board-note mode: tasks live inside their board note, nothing to file."); return; }
    const moved = await this.store.migrateTaskFolders();
    await this.syncMirrors();
    new Notice(moved > 0 ? `Filed ${moved} loose task${moved === 1 ? "" : "s"} into board folders.` : "No loose tasks found.");
  }

  /** Silent periodic upkeep: file any loose root notes into their board folder. */
  private async maintainTaskFolders(): Promise<void> {
    // In board-note mode there are no per-task files to file or retitle; only the
    // board-deletion sweep still applies (a board note removed by any route is tombstoned).
    if (!this.boardNoteMode()) {
      await this.store.migrateTaskFolders();
      // Realign any task still carrying the "Untitled" placeholder while its file has a real
      // name (covers renames that arrived from another device via Obsidian Sync).
      await this.store.repairTaskTitles();
      await this.syncMirrors();
    }
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
    if (this.boardNoteMode()) return; // board notes aren't per-task files; nothing to adopt.
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
    if (this.boardNoteMode()) return; // never rewrite a board note as a per-task note.
    try {
      // Repair malformed YAML first (e.g. an unquoted "[gbm] ..." title) so the cache can
      // parse it and processFrontMatter below can write to it.
      if (await this.store.repairTaskFile(file)) {
        await new Promise((r) => window.setTimeout(r, 50));
      }
      const cache = this.app.metadataCache.getFileCache(file);
      const fmType: unknown = cache?.frontmatter?.["type"];
      const fmId: unknown = cache?.frontmatter?.["task_id"];
      // Never adopt a board note (board-note model) as a per-task note — doing so would inject
      // task frontmatter and move it into a board folder, corrupting the board. This guard holds
      // even if the device flag hasn't flipped yet (e.g. mid-migration).
      if (fmType === "task-board") return;
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
    // Reuse the center Momentum tab (swap its content in place) like every other page —
    // only fall back to a new tab when there's no Momentum view open in the center yet.
    const leaf = this.findCenterMomentumLeaf() ?? workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_QUICK, active: true });
    void workspace.revealLeaf(leaf);
  }

  // ── Google Drive (beta) — isolated from Tasks: own token, own broker, own deep-link ───────

  /** Open (or reveal) the Google Drive browser in a center tab. */
  async activateDriveView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_DRIVE)[0];
    if (existing) { void workspace.revealLeaf(existing); return; }
    const leaf = this.findCenterMomentumLeaf() ?? workspace.getLeaf("tab");
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
    const st = await validateLicense(key);
    this.settings.proLicenseKey = key.trim();
    // Unreachable (offline/rate-limited) is NOT a rejection — accept optimistically and re-verify
    // when back online (checkedAt=0 marks it stale so the background re-check runs soon).
    this.settings.proValid = st !== "invalid";
    this.settings.proCheckedAt = st === "valid" ? Date.now() : 0;
    this.settings.proLicenseSeeded = true;
    await this.saveSettings();
    // Mirror the key into the vault so it syncs to your other devices (unlock once, everywhere).
    if (this.settings.proLicenseKey) await this.store.saveProLicenseKey(this.settings.proLicenseKey);
    new Notice(
      st === "valid" ? "✓ Momentum Pro activated — thank you!"
      : st === "unreachable" ? "Activated — we'll verify your license once you're back online."
      : "That license key couldn't be verified.",
    );
  }

  /**
   * Bridge the Pro license with the vault (Config/pro.md) so it rides Obsidian Sync. Runs on
   * startup: adopt a key that synced in from another device (validated in the background), or —
   * one time — seed the vault from a license this device activated before the vault-synced model.
   */
  private async reconcileProLicense(): Promise<void> {
    if (PRO_BETA_FREE) return;
    await this.store.migrateProLicense(); // move a legacy Config/pro.md into Config/state.md (base64)
    const vaultKey = this.store.loadProLicenseKey();
    const localKey = (this.settings.proLicenseKey ?? "").trim();
    if (vaultKey && vaultKey !== localKey) {
      // A key arrived (or changed) on another device → adopt it and unlock optimistically (it came
      // from a device that already activated it). checkedAt=0 marks it stale so the background
      // re-check confirms it; a transient offline check won't lock it, and a real "invalid" will.
      this.settings.proLicenseKey = vaultKey;
      this.settings.proValid = true;
      this.settings.proCheckedAt = 0;
      this.settings.proLicenseSeeded = true;
      await this.saveSettings();
    } else if (localKey && !vaultKey && !this.settings.proLicenseSeeded) {
      // Existing user, activated before this change → write the key into the vault once so it
      // starts syncing. Guarded by the seeded flag so a later manual delete isn't resurrected.
      await this.store.saveProLicenseKey(localKey);
      this.settings.proLicenseSeeded = true;
      await this.saveSettings();
    }
  }

  /** Background re-validation of the license when the last check is stale (no-op during beta). */
  private async maybeRecheckPro(): Promise<void> {
    if (!proNeedsRecheck(this.proState()) || !this.settings.proLicenseKey) return;
    try {
      const st = await validateLicense(this.settings.proLicenseKey);
      // Only a DEFINITIVE result changes the stored state. "unreachable" (offline / store blip)
      // is a no-op: we keep the last known validity and its offline grace, and — by not advancing
      // proCheckedAt — the check stays due so it retries at the next opportunity instead of
      // locking Pro for the whole re-check window.
      if (st === "unreachable") return;
      this.settings.proValid = st === "valid";
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
      mirrorDir: () => this.settings.driveMirrorDir ?? "",
      driveFolderId: () => this.settings.driveFolderId ?? "",
      dataRoot: () => this.settings.dataRoot ?? "",
      syncNow: (onProgress, incremental) => this.syncGoogleDrive(true, onProgress, incremental),
    };
  }

  /** Drive baselines (in memory; persisted to drive-state.json, NOT data.json). */
  private driveBaselines: Record<string, DriveBaselineEntry> = {};
  /** Serialises drive-state.json writes so two saves never interleave. */
  private driveStateWrite: Promise<void> = Promise.resolve();

  private driveStatePath(): string {
    const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    return normalizePath(`${dir}/drive-state.json`);
  }

  /**
   * Load drive-state.json. Order of trust: the `.tmp` copy (written last; only used when it
   * parses, so a half-written one is skipped), then the main file. Then:
   *  - data.json lost the folder choice but the state file has it → restore it (an update or a
   *    crash that wiped data.json must never redirect the sync to My Drive root);
   *  - baselines are used only when they belong to the folder now configured;
   *  - no state file yet but legacy baselines in data.json → migrate them out (once).
   */
  private async loadDriveState(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const p = this.driveStatePath();
    let st: DriveStateFile | null = null;
    for (const f of [`${p}.tmp`, p]) {
      try {
        if (!(await adapter.exists(f))) continue;
        const j = JSON.parse(await adapter.read(f)) as Partial<DriveStateFile>;
        if (j && typeof j.baselines === "object" && j.baselines) { st = j as DriveStateFile; break; }
      } catch { /* unreadable/truncated → try the other copy */ }
    }
    const s = this.settings;
    const legacy = s.driveBaselines;
    let dirty = false;
    if (st) {
      if (!s.driveFolderId && !s.driveFolderName && (st.folderId || st.folderName)) {
        s.driveFolderId = st.folderId;
        s.driveFolderName = st.folderName;
        // data.json was lost: restore the local scope too (an older single-folder setup).
        if (!s.driveMirrorDir && st.mirrorDir) s.driveMirrorDir = st.mirrorDir;
        dirty = true;
      }
      // Baselines are only valid for the same Drive folder AND the same local scope.
      const sameFolder = (s.driveFolderId ?? "") === (st.folderId ?? "");
      const sameScope = (s.driveMirrorDir ?? "") === (st.mirrorDir ?? "");
      this.driveBaselines = sameFolder && sameScope ? st.baselines : {};
    } else if (legacy && Object.keys(legacy).length) {
      this.driveBaselines = legacy;
      await this.saveDriveState(); // write the new file BEFORE dropping the old copy
    }
    if (legacy !== undefined) { delete s.driveBaselines; dirty = true; }
    if (dirty) await this.saveSettings();
  }

  /** Atomic-ish write of drive-state.json: write `.tmp`, then swap it in. A crash mid-write
   *  leaves either the old file or a complete `.tmp` — never a truncated state file. */
  private saveDriveState(): Promise<void> {
    const run = async (): Promise<void> => {
      const adapter = this.app.vault.adapter;
      const p = this.driveStatePath();
      const tmp = `${p}.tmp`;
      const body: DriveStateFile = {
        version: 1,
        folderId: this.settings.driveFolderId ?? "",
        folderName: this.settings.driveFolderName ?? "",
        mirrorDir: this.settings.driveMirrorDir ?? "",
        baselines: this.driveBaselines,
      };
      await adapter.write(tmp, JSON.stringify(body));
      if (await adapter.exists(p)) await adapter.remove(p);
      await adapter.rename(tmp, p);
    };
    this.driveStateWrite = this.driveStateWrite.then(run, run);
    return this.driveStateWrite;
  }

  /** Point the Drive sync at another folder. Baselines, cursor and delete evidence belong to the
   *  OLD folder, so they are reset: the next sync is a first-contact adoption (merges, never
   *  deletes). Without this, files missing from the new folder looked "deleted on Drive". */
  async setDriveFolder(id: string, name: string): Promise<void> {
    const s = this.settings;
    if ((s.driveFolderId ?? "") !== id) {
      this.driveBaselines = {};
      s.driveCursor = "";
      s.driveFolderIds = [];
      s.driveFolderMap = {};
      s.driveLocalDeletes = {};
      s.driveDeclinedDeletions = {};
    }
    s.driveFolderId = id;
    s.driveFolderName = name;
    await this.saveSettings();
    await this.saveDriveState();
  }

  /** How many files the Drive sync currently tracks (baselines). */
  driveTrackedCount(): number { return Object.keys(this.driveBaselines).length; }

  /** True once the user picked a Drive folder (My Drive root counts: the picker names it). */
  driveFolderChosen(): boolean {
    return !!(this.settings.driveFolderId || this.settings.driveFolderName);
  }

  /** Debounced saveSettings for bursty callers (e.g. hundreds of delete events). */
  private saveSoonTimer: number | null = null;
  private saveSettingsSoon(): void {
    if (this.saveSoonTimer !== null) window.clearTimeout(this.saveSoonTimer);
    this.saveSoonTimer = window.setTimeout(() => { this.saveSoonTimer = null; void this.saveSettings(); }, 1000);
  }

  /** DriveBaselineStore backed by this.driveBaselines (persisted in drive-state.json). */
  private driveBaselineStore(): DriveBaselineStore {
    const map = this.driveBaselines;
    return {
      get: (n) => map[n],
      set: (n, b) => { map[n] = b; },
      remove: (n) => { delete map[n]; },
      names: () => Object.keys(map),
      getCursor: () => this.settings.driveCursor || undefined,
      setCursor: (t) => { this.settings.driveCursor = t; },
      getFolderIds: () => this.settings.driveFolderIds ?? [],
      setFolderIds: (ids) => { this.settings.driveFolderIds = ids; },
      getFolderMap: () => this.settings.driveFolderMap ?? {},
      setFolderMap: (m) => { this.settings.driveFolderMap = m; },
      save: async () => { await this.saveDriveState(); await this.saveSettings(); },
      getLocalDeletes: () => (this.settings.driveLocalDeletes ??= {}),
      clearLocalDelete: (n) => { delete (this.settings.driveLocalDeletes ??= {})[n]; },
      getDeclined: () => (this.settings.driveDeclinedDeletions ??= {}),
      setDeclined: (n, sig) => { (this.settings.driveDeclinedDeletions ??= {})[n] = sig; },
      clearDeclined: (n) => { delete (this.settings.driveDeclinedDeletions ??= {})[n]; },
    };
  }

  /** The mirror-relative key for a vault path (matching driveVaultFS/baseline keys), or null if
   *  the path is outside the Drive sync scope. Used to record explicit local deletions. */
  private driveRelKey(path: string): string | null {
    if (!this.driveInScope(path)) return null;
    const raw = this.settings.driveMirrorDir ?? "";
    const base = raw === "" ? "" : normalizePath(raw);
    return base ? path.slice(base.length + 1) : path;
  }

  /**
   * VaultFS over the mirror scope, keyed by RELATIVE PATH (so subfolders sync, not just a flat
   * folder). `driveMirrorDir` = "" means WHOLE VAULT — in that mode the plugin's own data root
   * (dataRoot) IS synced too (so your Momentum data and the pro.md license travel), with one
   * exception per file so nothing fights over the same note:
   *  - volatile control/debug files (DRIVE_DATA_EXCLUDE) are always skipped (loop / per-device);
   *  - task notes (Tasks/…) are NEVER carried by Drive — Google Tasks is the sole task-sync
   *    channel (the user enables it in settings to sync tasks across devices). This keeps the
   *    scope symmetric so a task note can't be re-pulled over the Google-Tasks-owned copy.
   */
  /**
   * Whether a vault file path is in the Drive sync scope. Shared by the sync engine's VaultFS
   * and the status panel so both always agree on what syncs. See driveVaultFS for the rules.
   */
  private driveInScope(path: string): boolean {
    const raw = this.settings.driveMirrorDir ?? "";
    const base = raw === "" ? "" : normalizePath(raw); // "" = whole vault
    if (base) return path === base || path.startsWith(`${base}/`);
    const dataRoot = normalizePath(this.settings.dataRoot || "");
    if (dataRoot && (path === dataRoot || path.startsWith(`${dataRoot}/`))) {
      const rel = path.slice(dataRoot.length + 1); // "" for the data-root folder itself
      if (!rel) return false;
      if (DRIVE_DATA_EXCLUDE.has(rel)) return false;                                    // volatile/per-device
      if (rel.startsWith("Tasks/")) return false;                                       // tasks NEVER sync via Drive — use Google Tasks sync
      return true;                                                                      // sync the rest (data, pro.md)
    }
    return true;
  }

  private driveVaultFS(): VaultFS {
    const raw = this.settings.driveMirrorDir ?? "";
    const base = raw === "" ? "" : normalizePath(raw); // "" = whole vault
    const toFull = (rel: string) => normalizePath(base ? `${base}/${rel}` : rel);
    const inScope = (path: string): boolean => this.driveInScope(path);
    // Pro + opt-in: also mirror SAFE .obsidian config files (theme, which plugins are enabled,
    // hotkeys…) across devices. Whole-vault scope only. Accessed via the raw adapter because the
    // vault API (getFiles/getAbstractFileByPath) never sees the .obsidian config folder. The
    // allowlist (isObsidianConfigSyncPath) guarantees data.json/workspace.json never sync.
    const cfgDir = this.app.vault.configDir; // not necessarily ".obsidian" — the user can customise it
    const cfgOn = base === "" && this.isProEnabled() && !!this.settings.driveSyncObsidianConfig;
    const adapter = this.app.vault.adapter;
    const isCfg = (rel: string): boolean => rel.startsWith(`${cfgDir}/`);
    const ensureAdapterDir = async (filePath: string): Promise<void> => {
      const slash = filePath.lastIndexOf("/");
      if (slash < 0) return;
      const parts = filePath.slice(0, slash).split("/");
      let cur = "";
      for (const seg of parts) {
        cur = cur ? `${cur}/${seg}` : seg;
        if (!(await adapter.exists(cur))) await adapter.mkdir(cur).catch(() => {});
      }
    };
    const ensureFolders = async (fullPath: string): Promise<void> => {
      const slash = fullPath.lastIndexOf("/");
      if (slash < 0) return;
      const parts = fullPath.slice(0, slash).split("/");
      let cur = "";
      for (const seg of parts) {
        cur = cur ? `${cur}/${seg}` : seg;
        if (!(this.app.vault.getAbstractFileByPath(cur) instanceof TFolder)) {
          this.markDriveOwn(this.driveOwnWrites, cur);
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
        if (cfgOn) {
          const queue = [cfgDir];
          while (queue.length) {
            const dir = queue.shift()!;
            let listing: { files: string[]; folders: string[] };
            try { listing = await adapter.list(dir); } catch { continue; }
            for (const sub of listing.folders) queue.push(sub);
            for (const file of listing.files) if (isObsidianConfigSyncPath(file, cfgDir)) out.push(file);
          }
        }
        return out;
      },
      read: async (rel) => {
        if (isCfg(rel)) return (await adapter.exists(rel)) ? adapter.read(rel) : "";
        const f = this.app.vault.getAbstractFileByPath(toFull(rel));
        return f instanceof TFile ? this.app.vault.read(f) : "";
      },
      write: async (rel, content) => {
        if (isCfg(rel)) {
          await ensureAdapterDir(rel);
          // The enabled-plugins list is MERGED, never replaced: a device with fewer plugins (a
          // fresh phone, say) must not switch off every plugin on this one. Union, local order first.
          if (rel === `${cfgDir}/community-plugins.json` && await adapter.exists(rel)) {
            try {
              const mine = JSON.parse(await adapter.read(rel)) as unknown;
              const theirs = JSON.parse(content) as unknown;
              if (Array.isArray(mine) && Array.isArray(theirs)) {
                const ids = (a: unknown[]): string[] => a.filter((x): x is string => typeof x === "string");
                const merged = [...new Set([...ids(mine as unknown[]), ...ids(theirs as unknown[])])];
                content = JSON.stringify(merged, null, 2);
              }
            } catch { /* unparseable → fall through and write the remote copy as is */ }
          }
          await adapter.write(rel, content);
          return;
        }
        const full = toFull(rel);
        await ensureFolders(full);
        this.markDriveOwn(this.driveOwnWrites, full);
        const f = this.app.vault.getAbstractFileByPath(full);
        if (f instanceof TFile) await this.app.vault.modify(f, content);
        else await this.app.vault.create(full, content);
      },
      exists: async (rel) => isCfg(rel) ? adapter.exists(rel) : this.app.vault.getAbstractFileByPath(toFull(rel)) instanceof TFile,
      trash: async (rel) => {
        // NEVER delete Obsidian config/plugin files because they vanished from Drive. That used to
        // hard-delete (adapter.remove, no trash) every community plugin's code when the Drive copy
        // of .obsidian was moved or trashed. Keeping the local file is self-healing: its baseline
        // is dropped, so the next sync sees "local only" and uploads it back to Drive.
        if (isCfg(rel)) return;
        const full = toFull(rel);
        const f = this.app.vault.getAbstractFileByPath(full);
        if (f instanceof TFile) {
          this.markDriveOwn(this.driveOwnDeletes, full);
          await this.app.fileManager.trashFile(f); // reversible, respects user preference
        }
        // Prune parent folders left empty by the deletion — up to (but not including) the mirror
        // root — so deleting all of a folder's files on Drive doesn't leave an empty shell locally.
        let dir = full.lastIndexOf("/") >= 0 ? full.slice(0, full.lastIndexOf("/")) : "";
        while (dir && dir !== base) {
          const folder = this.app.vault.getAbstractFileByPath(dir);
          if (folder instanceof TFolder && folder.children.length === 0) {
            this.markDriveOwn(this.driveOwnDeletes, dir);
            await this.app.fileManager.trashFile(folder);
            dir = dir.lastIndexOf("/") >= 0 ? dir.slice(0, dir.lastIndexOf("/")) : "";
          } else break;
        }
      },
      mtime: async (rel) => {
        if (isCfg(rel)) { const st = await adapter.stat(rel).catch(() => null); return st?.mtime ?? 0; }
        const f = this.app.vault.getAbstractFileByPath(toFull(rel));
        return f instanceof TFile ? f.stat.mtime : 0;
      },
      readBinary: async (rel) => {
        if (isCfg(rel)) return (await adapter.exists(rel)) ? adapter.readBinary(rel) : new ArrayBuffer(0);
        const f = this.app.vault.getAbstractFileByPath(toFull(rel));
        return f instanceof TFile ? this.app.vault.readBinary(f) : new ArrayBuffer(0);
      },
      writeBinary: async (rel, data) => {
        if (isCfg(rel)) { await ensureAdapterDir(rel); await adapter.writeBinary(rel, data); return; }
        const full = toFull(rel);
        await ensureFolders(full);
        this.markDriveOwn(this.driveOwnWrites, full);
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
  async syncGoogleDrive(confirmed = false, onProgress?: (p: DriveProgress) => void, incremental?: boolean): Promise<void> {
    if (this.driveSyncing) { new Notice("Drive: a sync is already running."); return; }
    // Scope A: text notes sync on every plan; only real binary upload/download is a Momentum Pro
    // feature. So we never block the whole sync — text always flows — and only gate the binary
    // lever: binaries round-trip as bytes just when Pro is active AND the toggle is on. Without
    // Pro (or with it off) the engine's block-and-warn keeps binaries safe, and text still syncs.
    const proBinaries = this.isProEnabled() && !!this.settings.driveSyncBinaries;
    // Never start a FIRST sync without a folder chosen: that used to dump the whole vault into
    // My Drive root (e.g. after data.json was lost and the user reconnected). Existing setups that
    // already sync into root keep working (they have baselines).
    if (!this.driveFolderChosen() && Object.keys(this.driveBaselines).length === 0) {
      this.updateDriveStatus("Drive: choose a folder");
      if (confirmed) new Notice("Google Drive: choose a folder in settings before the first sync.");
      return;
    }
    const token = await this.driveAccessToken();
    if (!token) { new Notice("Google Drive: not connected."); return; }
    this.driveSyncing = true;
    this.driveSyncActive = true;
    this.driveStopRequested = false;
    const useIncremental = incremental ?? true; // auto runs are always incremental (core); the Full-sync button passes false
    this.updateDriveStatus("Drive: syncing…");
    this.emitDriveProgress({ phase: "scanning", done: 0, total: 0, incremental: useIncremental }); // flip cards to "syncing" with the right mode
    // An automatic sync (startup / on change / interval) used to be visible only in the status
    // bar, so a long one ran unnoticed. If it takes more than a few seconds, surface its progress
    // in a persistent notice (closed when it ends). Runs with their own progress UI skip this.
    let lastLabel = "Drive: syncing…";
    let bgNotice: Notice | null = null;
    const bgText = (label: string): string => `${label}\nBackground sync. You can keep working.`;
    const bgTimer = onProgress ? null : window.setTimeout(() => { bgNotice = new Notice(bgText(lastLabel), 0); }, 10_000);
    const progress = (p: DriveProgress): void => {
      const label =
        p.phase === "scanning" ? (p.incremental ? "Drive: checking changes…" : "Drive: scanning…")
        : p.phase === "planning" ? (p.total ? `Drive: comparing ${p.done}/${p.total}` : "Drive: comparing…")
        : (p.total ? `Drive: syncing ${p.done}/${p.total}` : "Drive: syncing…");
      this.updateDriveStatus(label);
      lastLabel = label;
      bgNotice?.setMessage(bgText(label));
      onProgress?.(p);
      this.emitDriveProgress(p);
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
        syncBinaries: proBinaries,
        // Per-call override (Incremental/Full buttons) wins over the saved toggle. Incremental is
        // still safe: it falls back to a full walk whenever there's no cursor or any remote change.
        incremental: useIncremental,
        // mtime fast-path ONLY on incremental runs (speed). A FULL scan must be exhaustive: using
        // the fast-path there let a local edit whose mtime predates lastSyncMs stay masked forever
        // (if an earlier sync advanced lastSyncMs without pushing it — e.g. a blocked/fatal run),
        // so diverged files never pushed. Full sync now re-reads content and reconciles them.
        lastSyncMs: useIncremental ? (() => { const t = Date.parse(this.settings.driveLastSync?.time ?? ""); return Number.isFinite(t) ? t : undefined; })() : undefined,
        shouldStop: () => this.driveStopRequested,
        deviceId,
        // Mirror the local listing's scope onto the remote walk, so a file that lives on Drive but
        // is out of scope on THIS device (e.g. Momentum Life/Tasks/* when Google Tasks owns the
        // notes here) is ignored instead of being re-pulled over the owned copy every cycle.
        inScope: (rel) => {
          const raw = this.settings.driveMirrorDir ?? "";
          const base = raw === "" ? "" : normalizePath(raw);
          return this.driveInScope(base ? normalizePath(`${base}/${rel}`) : rel);
        },
        // Month ledger notes (workouts/meals/transactions/health) are merged item by item, so two
        // devices logging in the same month never leave a hidden `.conflict` copy behind.
        mergeConflict: (rel, baseText, local, remote) => {
          const raw = this.settings.driveMirrorDir ?? "";
          const base = raw === "" ? "" : normalizePath(raw);
          const full = base ? normalizePath(`${base}/${rel}`) : rel;
          if (!full.endsWith(".md")) return Promise.resolve(null);
          return this.store.mergeLedgerConflict(baseText, local, remote, full);
        },
      });
      // Fold any `.conflict` copy of a month ledger note back into the real note (older syncs
      // left these; the UI ignores them, so their entries would stay hidden).
      void this.healLedgerConflicts();
      this.settings.driveLastSync = {
        time: new Date().toISOString(),
        scope: (this.settings.driveMirrorDir ?? "") === "" ? "whole vault" : this.settings.driveMirrorDir!,
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
      if (bgTimer !== null) window.clearTimeout(bgTimer);
      (bgNotice as Notice | null)?.hide();
      if (locked) await releaseDriveLock(token, rootId, deviceId).catch(() => {});
      this.driveSyncActive = false;      // logically done NOW (UI can finalize immediately)
      this.driveStopRequested = false;
      this.emitDriveProgress(null);      // signal "done" so listening cards finalize/re-render
      // Keep the watcher guard up briefly after the run so the sync's own trailing write events
      // don't immediately re-trigger the event-driven watcher. Then, if the user changed something
      // while we were running, sync once more so that change (e.g. a mid-sync delete) lands now.
      window.setTimeout(() => {
        this.driveSyncing = false;
        if (this.driveRerunPending) { this.driveRerunPending = false; this.queueDriveSync(); }
      }, 1500);
    }
  }

  /** Request a graceful stop of the running Drive sync (checked between files by the engine). */
  cancelDriveSync(): void { if (this.driveSyncActive) this.driveStopRequested = true; }

  /** Merge `.conflict` copies of month ledger notes back into the real note (see store). */
  private async healLedgerConflicts(): Promise<void> {
    try {
      const n = await this.store.healLedgerConflicts();
      if (n > 0) {
        new Notice(`Momentum: merged ${n} sync conflict ${n === 1 ? "copy" : "copies"} back into your monthly notes.`);
        this.rerenderViews();
      }
    } catch { /* best-effort; retried next launch / sync */ }
  }

  /** Append a human-readable Drive sync entry to Config/google-drive-debug.md (diagnostics). */
  private async writeDriveDebugLog(result: DriveSyncResult | null, fatal?: string): Promise<void> {
    try {
      const path = `${this.settings.dataRoot}/Config/google-drive-debug.md`;
      const scope = (this.settings.driveMirrorDir ?? "") === "" ? "whole vault" : this.settings.driveMirrorDir;
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

  private driveProgressCbs = new Set<(p: DriveProgress | null) => void>();
  /** Subscribe to Drive sync progress from ANY trigger (button, interval, startup, on-change).
   *  The callback gets each DriveProgress tick, then a final null when the sync ends. Returns an
   *  unsubscribe fn. Lets the File Manager card reflect every sync, not just its own button. */
  onDriveProgress(cb: (p: DriveProgress | null) => void): () => void {
    this.driveProgressCbs.add(cb);
    return () => { this.driveProgressCbs.delete(cb); };
  }
  private emitDriveProgress(p: DriveProgress | null): void {
    for (const cb of this.driveProgressCbs) { try { cb(p); } catch { /* a listener must never break a sync */ } }
  }

  /** True while a Drive sync is running — used to ignore the sync's OWN vault writes in the
   *  event-driven watcher (otherwise a pull would re-trigger a sync in a loop). */
  private driveSyncing = false;
  /** Logical "a sync is running" for the UI. Unlike driveSyncing (which lingers ~1.5s after the
   *  run to suppress the change-watcher), this flips false the instant the sync finishes. */
  private driveSyncActive = false;
  /** Set by a Stop request; the engine checks it between files and stops gracefully. */
  private driveStopRequested = false;
  private driveChangeTimer: number | null = null;
  /** Vault paths the sync ITSELF just wrote / trashed. The change watcher ignores events on these
   *  (they are our own writes), while every other event during a run is treated as the user's —
   *  so a file the user deletes mid-sync is recorded instead of silently re-pulled. */
  private driveOwnWrites = new Set<string>();
  private driveOwnDeletes = new Set<string>();
  /** The user changed something while a sync was running → run one more sync right after it. */
  private driveRerunPending = false;
  /** Mark `path` as the sync's own write/delete for a few seconds (vault events arrive async). */
  private markDriveOwn(set: Set<string>, path: string): void {
    set.add(path);
    window.setTimeout(() => set.delete(path), 5000);
  }

  /** Instant Drive status for the File Manager panel: last-sync summary + compliance counts
   *  (baselines that are still in-scope local files vs total in-scope files). No network. */
  getDriveStatus(): { last?: DriveSyncSummary; tracked: number; inScope: number; logPath: string; files: { path: string; status: "synced" | "local"; at?: string; mtime: number }[] } {
    const raw = this.settings.driveMirrorDir ?? "";
    const base = raw === "" ? "" : normalizePath(raw);
    const inScope: { rel: string; mtime: number }[] = [];
    for (const f of this.app.vault.getFiles()) {
      if (!this.driveInScope(f.path)) continue;
      inScope.push({ rel: base ? f.path.slice(base.length + 1) : f.path, mtime: f.stat.mtime });
    }
    const baselines = this.driveBaselines;
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
    const raw = this.settings.driveMirrorDir ?? "";
    if (raw === "") {
      const dr = this.settings.dataRoot || "";
      return !(dr && (path === dr || path.startsWith(`${dr}/`)));
    }
    return path === raw || path.startsWith(`${raw}/`);
  }

  /** Event-driven Drive sync (CORE — always on): on any in-scope vault change, schedule a
   *  debounced incremental sync. Skips the sync's own writes via driveSyncing. */
  private registerDriveChangeWatcher(): void {
    const schedule = (path: string): void => {
      if (!this.settings.googleDriveEnabled || !this.settings.driveToken) return;
      if (!this.pathInDriveScope(path)) return;
      if (this.driveOwnWrites.has(path) || this.driveOwnDeletes.has(path)) return; // our own write
      // A change by the USER while a sync is running: don't start a second sync now, but make
      // sure one runs right after (previously the change was simply dropped until the next edit).
      if (this.driveSyncing) { this.driveRerunPending = true; return; }
      this.queueDriveSync();
    };
    this.registerEvent(this.app.vault.on("modify", (f) => schedule(f.path)));
    this.registerEvent(this.app.vault.on("create", (f) => schedule(f.path)));
    this.registerEvent(this.app.vault.on("delete", (f) => {
      // Record a REAL user deletion as evidence so the sync can honour it (delete_remote) instead
      // of re-pulling the file. Only the sync's OWN trash writes are skipped (driveOwnDeletes) —
      // a delete the user makes WHILE a sync runs is recorded too (it used to be dropped, and the
      // running sync then pulled the file straight back).
      if (this.settings.googleDriveEnabled && !this.driveOwnDeletes.has(f.path)) {
        const rel = this.driveRelKey(f.path);
        if (rel) { (this.settings.driveLocalDeletes ??= {})[rel] = Date.now(); this.saveSettingsSoon(); }
      }
      schedule(f.path);
    }));
    this.registerEvent(this.app.vault.on("rename", (f, oldPath) => {
      // A rename fires no `delete` event, but the OLD path genuinely ceased to exist (it became
      // the new path). Record it as an explicit local deletion so the sync moves the file on Drive
      // instead of re-pulling the old name back (which would duplicate). Skip the sync's own writes.
      if (this.settings.googleDriveEnabled && !this.driveOwnDeletes.has(oldPath)) {
        const relOld = this.driveRelKey(oldPath);
        if (relOld) { (this.settings.driveLocalDeletes ??= {})[relOld] = Date.now(); this.saveSettingsSoon(); }
      }
      schedule(f.path);
    }));
  }

  /** Debounced event-driven Drive sync: wait for a short lull in edits, then sync. */
  private queueDriveSync(): void {
    if (this.driveChangeTimer !== null) window.clearTimeout(this.driveChangeTimer);
    this.driveChangeTimer = window.setTimeout(() => {
      this.driveChangeTimer = null;
      // Event-driven runs are ALWAYS incremental: react to a LOCAL change by checking the Drive
      // change feed and pushing just the delta off the baselines (no full tree walk). Structural
      // remote changes (folder trashed, file moved/added on Drive) still escalate to a full walk,
      // so correctness is preserved. This is independent of the "Incremental sync" toggle (which
      // governs manual/interval runs); an event reaction should never pay for a full scan.
      void this.syncGoogleDrive(false, undefined, true);
    }, 3000);
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

  /** Connect Google Health (beta) with the user's OWN OAuth client (bring-your-own). Stores
   *  healthToken locally; never touches the Tasks or Drive connections. */
  async connectHealth(): Promise<void> {
    await this.loadHealthClientFromVault(); // the client may have arrived from another device
    try {
      new Notice("Opening Google sign-in for Google health…");
      const token = await authorizeHealth(
        { clientId: this.settings.healthClientId ?? "", clientSecret: this.settings.healthClientSecret ?? "" },
        (url) => { window.open(url, "_blank"); },
      );
      this.settings.healthToken = token;
      this.settings.googleHealthEnabled = true;
      await this.saveSettings();
      const granted = grantedHealthScopes(token).length;
      new Notice(granted === HEALTH_SCOPES.length
        ? "✓ connected to Google Health (beta)."
        : `✓ connected to Google Health (beta) — ${granted} of ${HEALTH_SCOPES.length} data types allowed.`);
      void this.syncGoogleHealth(false); // first import right away (last 30 days)
    } catch (e) {
      new Notice(`Google Health connection failed: ${e instanceof Error ? e.message : String(e)}`, 10000);
    }
  }

  /** Disconnect Google Health: revoke the grant, drop the token. Vault notes are kept. The
   *  pasted client ID/secret stay, so reconnecting is one click. */
  async disconnectHealth(): Promise<void> {
    const token = this.settings.healthToken;
    if (!token) return;
    const outcome = await revokeHealthToken(token);
    this.settings.healthToken = null;
    await this.saveSettings();
    new Notice(outcome.ok
      ? "✓ Google Health: access revoked and disconnected."
      : "Google Health: disconnected locally; revocation wasn't confirmed. You can also remove access at myaccount.google.com/permissions.");
  }

  // ---- Google Health client (bring-your-own): kept in a VAULT note so it travels to every device
  // with Drive/Obsidian Sync (author decision). Only the client ID + secret — never the token, which
  // stays per-device in data.json. The note is the source of truth; data.json mirrors it.
  private static readonly HEALTH_CLIENT_NOTE = "Config/google-health.md";

  /** Pull the client ID/secret from the vault note into settings (when the note has them). */
  async loadHealthClientFromVault(): Promise<void> {
    const f = this.store.fileAt(MomentumPlugin.HEALTH_CLIENT_NOTE);
    if (!f) {
      // First run after this change: seed the note from what this device already has.
      if (this.settings.healthClientId || this.settings.healthClientSecret) await this.saveHealthClientToVault();
      return;
    }
    const fm = this.store.frontmatter(f);
    const id = typeof fm.client_id === "string" ? fm.client_id.trim() : "";
    const secret = typeof fm.client_secret === "string" ? fm.client_secret.trim() : "";
    if ((id && id !== this.settings.healthClientId) || (secret && secret !== this.settings.healthClientSecret)) {
      if (id) this.settings.healthClientId = id;
      if (secret) this.settings.healthClientSecret = secret;
      await this.saveSettings();
    }
  }

  /** Write the shared Google Health note: client ID/secret + the importer device (idempotent). */
  async saveHealthClientToVault(importer?: ImporterInfo | null): Promise<void> {
    const f = this.store.fileAt(MomentumPlugin.HEALTH_CLIENT_NOTE);
    // Keep the current importer unless a new one is given (a settings edit must not drop it).
    const keep = importer === undefined ? (f ? importerFromFrontmatter(this.store.frontmatter(f)) : null) : importer;
    const body = "# Google health client\n\nYour own Google Cloud OAuth client, shared by your devices so you only paste it once. "
      + "Your sign-in itself is NOT stored here (it stays on each device). To rotate the secret, create a new one in "
      + "Google Cloud, paste it in settings and delete the old one.\n\n"
      + "Only the **importer** device imports from Google; the others read the notes it writes. Another device takes over "
      + "after a day without imports, or when you choose it in settings.\n";
    const meta: Record<string, unknown> = {
      type: "google-health-client",
      client_id: this.settings.healthClientId ?? "",
      client_secret: this.settings.healthClientSecret ?? "",
    };
    if (keep) { meta.importer_device = keep.deviceId; meta.importer_name = keep.name; meta.importer_last = keep.last; }
    await this.store.writeFile(MomentumPlugin.HEALTH_CLIENT_NOTE, this.store.buildDoc(meta, body));
  }

  /** The importer device recorded in the shared note, or null. */
  healthImporter(): ImporterInfo | null {
    const f = this.store.fileAt(MomentumPlugin.HEALTH_CLIENT_NOTE);
    return f ? importerFromFrontmatter(this.store.frontmatter(f)) : null;
  }

  /** A short human name for this device ("Desktop · macOS", "Phone · Android"). */
  private deviceLabel(): string {
    const kind = Platform.isMobile ? (Platform.isTablet ? "Tablet" : "Phone") : "Desktop";
    const os = Platform.isMacOS ? "macOS" : Platform.isWin ? "Windows" : Platform.isLinux ? "Linux"
      : Platform.isIosApp ? "iOS" : Platform.isAndroidApp ? "Android" : "";
    return os ? `${kind} · ${os}` : kind;
  }

  /** Make this device the Google Health importer (records it in the shared note). */
  async claimHealthImporter(last = ""): Promise<void> {
    await this.saveHealthClientToVault({ deviceId: this.getDriveDeviceId(), name: this.deviceLabel(), last });
  }

  /** True when this device is the importer (or none is set yet). */
  isHealthImporter(): boolean {
    const imp = this.healthImporter();
    return !imp || imp.deviceId === this.getDriveDeviceId();
  }

  private healthClientSaveTimer: number | null = null;
  /** Debounced vault write while the user types in the settings fields. */
  queueHealthClientSave(): void {
    if (this.healthClientSaveTimer !== null) window.clearTimeout(this.healthClientSaveTimer);
    this.healthClientSaveTimer = window.setTimeout(() => {
      this.healthClientSaveTimer = null;
      void this.saveHealthClientToVault();
    }, 800);
  }

  private healthSyncing = false;

  /**
   * Import Google Health into the vault (read-only from Google). First run: last 30 days; then
   * the last 7 (late watch syncs and edits still land). Silent runs (startup) only notify on
   * errors. Writes a log to Config/google-health-debug.md (never synced by Drive).
   */
  async syncGoogleHealth(silent = false): Promise<void> {
    if (this.healthSyncing) { if (!silent) new Notice("Google health: a sync is already running."); return; }
    // Single writer across devices: only the importer device imports (see healthImporter.ts).
    const decision = decideImporter(this.getDriveDeviceId(), this.healthImporter(), Date.now(), !silent);
    if (decision.action === "skip") return;
    if (decision.action === "ask") {
      const when = decision.importer.last ? new Date(decision.importer.last).toLocaleString() : "not yet";
      const ok = await new Promise<boolean>((resolve) => {
        let decided = false;
        const modal = new ConfirmModal(this.app,
          `Google health is imported by ${decision.importer.name} (last import: ${when}); this device just reads its notes. Make this device the importer instead?`,
          () => { decided = true; resolve(true); });
        modal.onClose = () => { modal.contentEl.empty(); if (!decided) resolve(false); };
        modal.open();
      });
      if (!ok) return;
    }
    const token = await this.healthAccessToken();
    if (!token) { if (!silent) new Notice("Google health: not connected."); return; }
    this.healthSyncing = true;
    const notice = silent ? null : new Notice("⏳ Google health: importing…", 0);
    const lines: string[] = [`## ${new Date().toISOString()}`];
    try {
      const today = todayLocal();
      const back = this.settings.healthLastSync ? 7 : 30;
      const startD = new Date(); startD.setDate(startD.getDate() - back);
      const pad = (n: number) => String(n).padStart(2, "0");
      const startYmd = `${startD.getFullYear()}-${pad(startD.getMonth() + 1)}-${pad(startD.getDate())}`;
      const endD = new Date(); endD.setDate(endD.getDate() + 1);
      const endYmd = `${endD.getFullYear()}-${pad(endD.getMonth() + 1)}-${pad(endD.getDate())}`;
      lines.push(`- range: ${startYmd} → ${today}`);
      const res = await runHealthSync({
        token, sink: this.store,
        granted: this.settings.healthToken ? grantedHealthScopes(this.settings.healthToken) : [],
        startYmd, endYmd,
        log: (m) => lines.push(`- ${m}`),
      });
      lines.push(`- days=${res.days} workouts=${res.workouts} meals=${res.meals} weights=${res.weights} water=${res.water}`);
      for (const n of res.notes) lines.push(`- note: ${n}`);
      for (const er of res.errors) lines.push(`- ERROR: ${er}`);
      if (!res.errors.length) {
        this.settings.healthLastSync = new Date().toISOString();
        await this.saveSettings();
        await this.claimHealthImporter(this.settings.healthLastSync); // this device is (now) the importer
        if (decision.action === "import" && decision.reason === "takeover") lines.push("- note: took over as the importer (the previous one was silent for over a day)");
      }
      this.app.workspace.getLeavesOfType(VIEW_TYPE_PA).forEach((l) => { if (l.view instanceof PAView) l.view.rerender(); });
      const summary = `${res.days} days, ${res.workouts} workouts, ${res.meals} meals`;
      if (res.errors.length) new Notice(`Google health: imported ${summary}, with ${res.errors.length} error(s). See Config/google-health-debug.md.`, 10000);
      else if (!silent) new Notice(`✓ Google health: imported ${summary}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lines.push(`- FATAL: ${msg}`);
      new Notice(`Google health sync failed: ${msg}`, 10000);
    } finally {
      notice?.hide();
      this.healthSyncing = false;
      await this.writeHealthLog(lines);
    }
  }

  /** Prepend a run to Config/google-health-debug.md (kept to the last ~40 runs). */
  private async writeHealthLog(lines: string[]): Promise<void> {
    try {
      const path = normalizePath(`${this.settings.dataRoot}/Config/google-health-debug.md`);
      const f = this.app.vault.getAbstractFileByPath(path);
      const prev = f instanceof TFile ? await this.app.vault.read(f) : "";
      const runs = prev.split(/\n(?=## )/).filter((r) => r.trim()).slice(0, 40);
      const text = [lines.join("\n"), ...runs].join("\n\n") + "\n";
      if (f instanceof TFile) await this.app.vault.modify(f, text);
      else await this.app.vault.create(path, text);
    } catch { /* best-effort */ }
  }

  /** A fresh Google Health access token, or null when off/disconnected/expired (with a Notice). */
  async healthAccessToken(): Promise<string | null> {
    const tok = this.settings.healthToken;
    if (!this.settings.googleHealthEnabled || !tok) return null;
    try {
      const fresh = await ensureFreshHealthToken(tok, {
        clientId: this.settings.healthClientId ?? "", clientSecret: this.settings.healthClientSecret ?? "",
      });
      if (fresh !== tok) { this.settings.healthToken = fresh; await this.saveSettings(); }
      return fresh.access_token;
    } catch (e) {
      if (e instanceof HealthAuthExpiredError) { new Notice("Google health: session expired. Reconnect it in settings.", 10000); return null; }
      if (e instanceof HealthClientError) { new Notice(e.message, 10000); return null; }
      throw e;
    }
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
      if (!this.driveFolderChosen()) new Notice("Next: choose the Google Drive folder to sync. Nothing syncs until you do.", 10000);
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
    let leaf = this.findCenterMomentumLeaf();
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
        leaf = this.findCenterMomentumLeaf() ?? workspace.getLeaf("tab");
        break;
    }
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_PA, active: true, state: { page: id } });
    void workspace.revealLeaf(leaf);
    this.refreshNav();
  }

  /** Find an existing PAView docked in the main/center area (not a sidebar).
   *  Prefers the currently active leaf so navigation always updates the right tab. */
  private findCenterMomentumLeaf(): WorkspaceLeaf | null {
    const { workspace } = this.app;
    const rootSplit = workspace.rootSplit;
    // Any Momentum content view docked in the center — a page (PA), the File Manager (QUICK)
    // or the Drive browser (DRIVE). Treating them as one lets every nav item swap the content
    // of the SAME center tab, instead of the File Manager/Drive popping a new tab.
    const centerLeaves = [VIEW_TYPE_PA, VIEW_TYPE_QUICK, VIEW_TYPE_DRIVE]
      .flatMap((t) => workspace.getLeavesOfType(t))
      .filter((l) => l.getRoot() === rootSplit);
    if (!centerLeaves.length) return null;
    // Prefer the active leaf so clicking a nav item updates the focused tab.
    const active = workspace.getActiveViewOfType(PAView)
      ?? workspace.getActiveViewOfType(FileManagerView)
      ?? workspace.getActiveViewOfType(DriveBrowserView);
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
  /** True when the board-note task model is active (device flag). Mirrors store.boardNoteTasks. */
  private boardNoteMode(): boolean { return !!this.settings.boardNoteTasks; }

  /**
   * Flip the board-note task model (device flag) and run the matching one-time migration:
   * enabling consolidates each board's per-task notes into a single board note; disabling restores
   * individual notes. Both are reversible (sources go to Obsidian trash). The store flag is only
   * flipped AFTER a successful migration, so a failure leaves tasks exactly as they were.
   */
  /** True while tasks are being moved between models; Google tasks sync waits for it. */
  private taskMigrationRunning = false;

  async setBoardNoteTasks(enabled: boolean): Promise<void> {
    if (enabled === !!this.settings.boardNoteTasks) return;
    const prev = !!this.settings.boardNoteTasks;
    this.taskMigrationRunning = true;
    try {
      if (enabled) {
        // Flip the flag FIRST so every task listener/upkeep (adopt, inbox, mirrors, folder
        // maintenance) is already in board-note mode while the migration writes the board notes —
        // otherwise those listeners "adopt" the fresh board notes and move them into folders.
        this.store.boardNoteTasks = true;
        this.settings.boardNoteTasks = true;
        const n = await this.store.migrateToBoardNotes();
        this.settings.boardNoteTasksSchema = BOARD_NOTE_TASKS_SCHEMA;
        await this.saveSettings();
        new Notice(`Momentum: board-note tasks on — consolidated ${n} task${n === 1 ? "" : "s"} into board notes.`);
      } else {
        // Keep the flag ON during rollback so the inbox listener doesn't re-adopt each per-task
        // note we write; flip OFF only once every note is back in its folder.
        const n = await this.store.migrateToPerTaskNotes();
        this.store.boardNoteTasks = false;
        this.settings.boardNoteTasks = false;
        await this.saveSettings();
        new Notice(`Momentum: board-note tasks off — restored ${n} task${n === 1 ? "" : "s"} to individual notes.`);
      }
      this.app.workspace.getLeavesOfType(VIEW_TYPE_PA).forEach((l) => { if (l.view instanceof PAView) l.view.rerender(); });
    } catch (e) {
      // Revert to the previous state so a failed switch never leaves the app in a mode with no notes.
      this.settings.boardNoteTasks = prev;
      this.store.boardNoteTasks = prev;
      new Notice(`Momentum: board-note switch failed — ${String(e)}. Your tasks are unchanged; restore from a backup if needed.`);
    } finally {
      this.taskMigrationRunning = false;
    }
  }

  private async syncMirrors(): Promise<void> {
    if (this.boardNoteMode()) return; // board notes are self-rendering; no Lists/ mirrors to sync.
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

  /**
   * Consolidate per-item Finance/Nutrition/Fitness notes into one note per month, persist the
   * schema guard and report a summary. Invoked by the command and reused as the retry path when
   * the guarded auto-run failed. Reversible: the old per-item notes go to Obsidian's trash.
   */
  private async runMonthlyConsolidation(): Promise<void> {
    try {
      const n = await this.store.consolidateMonthlyLedgers();
      this.settings.monthlyLedgerSchema = MONTHLY_LEDGER_SCHEMA;
      await this.saveSettings();
      new Notice(n > 0
        ? `Consolidated ${n} ${n === 1 ? "entry" : "entries"} into monthly notes (old notes moved to trash).`
        : "Monthly notes already consolidated — nothing to do.");
    } catch (e) {
      new Notice(`Monthly consolidation failed: ${e instanceof Error ? e.message : String(e)}`);
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
    // Tasks are being moved into board notes: a sync now would see them half-moved and could
    // treat the missing ones as deleted. Wait, then sync.
    if (this.taskMigrationRunning) {
      window.setTimeout(() => void this.syncGoogleTasks(silent), 3000);
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

  onunload(): void {
    // Flush a pending debounced save (e.g. a delete recorded just before closing).
    if (this.saveSoonTimer !== null) { window.clearTimeout(this.saveSoonTimer); this.saveSoonTimer = null; void this.saveSettings(); }
  }

  /** True while a Drive sync is running (settings tab blocks folder changes meanwhile). */
  isDriveSyncing(): boolean { return this.driveSyncing; }

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
    const root = this.containerEl;
    root.empty();
    root.addClass("pa-settings");
    // Each section is ONE card: a heading plus all of its settings (and sub-groups) inside, so
    // related options read as a unit instead of a stream of loose boxes. `containerEl` always
    // points at the current card; every `new Setting(containerEl)` below lands in it.
    let containerEl: HTMLElement = root;
    const card = (title: string, beta = false): HTMLElement => {
      const c = root.createDiv({ cls: "pa-settings-card" });
      const h = new Setting(c).setName(title).setHeading();
      if (beta) h.nameEl.createSpan({ cls: "pa-beta-tag", text: "beta" });
      return c;
    };
    const sub = (title: string): void => { containerEl.createDiv({ cls: "pa-settings-subhead", text: title }); };

    containerEl = card("General");
    new Setting(containerEl)
      .setName("Data root folder")
      .setDesc("Vault folder that stores all plugin data.")
      .addText((t) =>
        t.setValue(this.plugin.settings.dataRoot).onChange(async (v) => {
          this.plugin.settings.dataRoot = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Support")
      .setDesc("If you find this plugin useful, you can support its development.")
      .addButton((b) =>
        b.setButtonText("Buy me a coffee").setCta().onClick(() => {
          window.open("https://buymeacoffee.com/jnagase", "_blank");
        })
      );

    containerEl = card("Tasks");

    new Setting(containerEl)
      .setName("One note per board")
      .setDesc("The default: each board keeps its tasks inside a single board note. Turn off to go back to one note per task in a board folder. Switching migrates your tasks and is reversible (old notes move to trash); back up your vault first.")
      .addToggle((t) => {
        const cur = !!this.plugin.settings.boardNoteTasks;
        t.setValue(cur).onChange((v) => {
          if (v === cur) return;
          const msg = v
            ? "Turn on board-note tasks? Each board's task notes are consolidated into one board note and the old notes move to trash (reversible). Back up your vault first."
            : "Turn off board-note tasks? Individual task notes are restored and the board notes move to trash (reversible).";
          let done = false;
          const modal = new ConfirmModal(this.plugin.app, msg, async () => {
            done = true;
            await this.plugin.setBoardNoteTasks(v);
            this.renderSettings();
          });
          // Cancel (or dismiss) → re-render so the toggle snaps back to the real, unchanged state.
          modal.onClose = () => { modal.contentEl.empty(); if (!done) this.renderSettings(); };
          modal.open();
        });
      });

    containerEl = card("Finances");

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

    // ── Google Tasks ──────────────────────────────────────────────────────
    containerEl = card("Google tasks"); // in production (verified OAuth client) — no beta tag

    const token = this.plugin.settings.googleToken;
    const connected = !!token?.access_token;

    const rerender = () => { root.empty(); this.renderSettings(); };

    new Setting(containerEl)
      .setName("Enable Google tasks sync")
      .setDesc("Sync momentum tasks bidirectionally with Google tasks. Google tasks is the only way tasks sync across devices — they never travel through Google Drive. This is a per-device setting, so with it off your tasks stay on this device only.")
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
    containerEl = card("Google Drive", true);

    // A calm, informational callout (not an alarming red box): Drive is authoritative and its
    // changes — including deletions — flow to every device, so a backup before the first sync is
    // wise. Styled neutrally (see .pa-drive-sot-warning in styles.css).
    const driveInfo = containerEl.createDiv({ cls: "pa-drive-sot-warning" });
    driveInfo.createEl("strong", { text: "Google Drive is the source of truth." });
    driveInfo.createSpan({
      text: " When sync is on, changes made on Drive win and flow to every device — including "
        + "deletions. It's a good idea to back up your vault before the first sync.",
    });

    new Setting(containerEl)
      .setName("Enable Google Drive sync")
      .setDesc(
        "Two-way sync between Google Drive and your vault, on a SEPARATE Google sign-in from Tasks. " +
        "Text notes always sync; images, PDFs and other file types are a Google Drive Pro feature " +
        "(free during the beta).",
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

      // Everything below needs a connection; keep it hidden until connected so the panel isn't
      // cluttered with controls that can't work yet.
      if (driveConnected) {
        // ── What syncs ────────────────────────────────────────────────────
        // The whole vault always syncs (no local-folder picker any more). The only choice is WHERE
        // on Google Drive it goes. Older setups that mirrored a single local folder keep it
        // (driveMirrorDir is left as is — switching it would re-key every baseline and duplicate
        // files on Drive), it's just no longer offered in the UI.
        sub("Where it syncs");

        new Setting(containerEl)
          .setName("Google Drive folder")
          .setDesc(this.plugin.driveFolderChosen() || this.plugin.driveTrackedCount() > 0
            ? `Your whole vault syncs into: ${this.plugin.settings.driveFolderName || "My Drive (root)"}. Changing it starts a fresh merge with the new folder (nothing is deleted).`
            : "Your whole vault syncs into one Google Drive folder. Choose it before the first sync.")
          .addButton((b) =>
            b.setButtonText("Choose folder…").onClick(() => {
              void (async () => {
                const token = await this.plugin.getDriveToken();
                if (!token) { new Notice("Connect Google Drive first."); return; }
                new DriveFolderPicker(this.app, token, async (choice) => {
                  if (this.plugin.isDriveSyncing()) { new Notice("Drive: wait for the sync to finish, then change the folder."); return; }
                  await this.plugin.setDriveFolder(choice.id, choice.name);
                  rerender();
                }).open();
              })();
            })
          );

        // ── Automatic sync ────────────────────────────────────────────────
        sub("Automatic sync");

        // Auto-sync is CORE now: Momentum always syncs on startup and as you edit (debounced,
        // incremental). There's no on/off toggle — it's just how sync works. The only knob left
        // is an optional extra timer below.
        new Setting(containerEl)
          .setName("Auto-sync interval")
          .setDesc("Momentum syncs automatically on startup and as you edit. This adds an extra sync on a timer.")
          .addDropdown((d) => {
            d.addOption("0", "Off (rely on startup/on-change)");
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

        // ── Advanced ──────────────────────────────────────────────────────
        sub("Advanced");
        // (The pro toggles — all file types, appearance & plugins — live in the Momentum pro card.)

        new Setting(containerEl)
          .setName("Conflict resolution")
          .setDesc("What happens when a file changed on both sides since the last sync. Keep both never loses data (saves a .conflict copy). Newer wins uses drive's clock, but across devices with skewed clocks it can drop the genuinely newer edit.")
          .addDropdown((d) => {
            d.addOption("keep-both", "Keep both (recommended, never loses data)");
            d.addOption("newer-wins", "Newer wins (drive's clock)");
            d.addOption("remote-wins", "Drive always wins");
            d.addOption("local-wins", "This device always wins");
            d.addOption("ask", "Ask me each time");
            d.setValue(this.plugin.settings.driveConflictStrategy ?? DEFAULT_CONFLICT_STRATEGY);
            d.onChange(async (v) => {
              this.plugin.settings.driveConflictStrategy = v as DriveConflictStrategy;
              await this.plugin.saveSettings();
            });
          });

        // ── Actions ───────────────────────────────────────────────────────
        sub("Actions");

        new Setting(containerEl)
          .setName("Open drive browser")
          .setDesc("Two-column view: drive files on one side, vault files on the other.")
          .addButton((b) =>
            b.setButtonText("Open").onClick(() => { void this.plugin.activateDriveView(); })
          );

        new Setting(containerEl)
          .setName("Sync now")
          .setDesc("Run a full two-way sync now: push, pull, 3-way merge and safe deletion.")
          .addButton((b) =>
            b.setButtonText("Sync now").setCta().onClick(() => { void this.plugin.syncGoogleDrive(true); })
          );

        // Footer note: tasks are deliberately out of Drive's scope — Google tasks is their only
        // sync channel. Spelling this out here stops the "why didn't my tasks sync?" confusion.
        const tasksNote = containerEl.createDiv({ cls: "pa-drive-tasks-note" });
        tasksNote.createEl("strong", { text: "Note: " });
        tasksNote.createSpan({
          text: "Google Drive sync never syncs your tasks. To sync tasks across devices, enable Google tasks sync in the tasks section above.",
        });
      }
    }

    // ── Google Health (beta) — bring your own Google OAuth client ─────────────────────────
    containerEl = card("Google health", true);
    {
      const s = this.plugin.settings;
      const healthConnected = !!s.healthToken;
      const intro = containerEl.createDiv({ cls: "pa-drive-sot-warning" });
      intro.createEl("strong", { text: "Reads your watch data into fitness." });
      intro.createSpan({
        text: " Steps, sleep, heart rate, workouts, weight and more come from your Google account (Fitbit, "
          + "Pixel Watch, phone). Read-only: nothing is ever written to Google. You connect with your own "
          + "Google Cloud client, so your data goes straight from Google to this device.",
      });

      new Setting(containerEl)
        .setName("Enable Google health")
        .setDesc("Off by default. This device only.")
        .addToggle((t) => t.setValue(!!s.googleHealthEnabled).onChange(async (v) => {
          s.googleHealthEnabled = v;
          await this.plugin.saveSettings();
          rerender();
        }));

      if (s.googleHealthEnabled) {
        sub("Your Google Cloud client");
        new Setting(containerEl)
          .setName("Redirect address")
          .setDesc(`Add this exact address to your OAuth client's authorized redirect URIs: ${HEALTH_REDIRECT_URI}`)
          .addButton((b) => b.setButtonText("Copy").onClick(() => {
            void navigator.clipboard.writeText(HEALTH_REDIRECT_URI).then(() => new Notice("Redirect address copied."));
          }));
        new Setting(containerEl)
          .setName("Client ID")
          .setDesc("From your Google cloud project → Google auth platform → clients.")
          .addText((t) => t.setPlaceholder("1234-abc.apps.googleusercontent.com")
            .setValue(s.healthClientId ?? "")
            .onChange(async (v) => { s.healthClientId = v.trim(); await this.plugin.saveSettings(); this.plugin.queueHealthClientSave(); }));
        new Setting(containerEl)
          .setName("Client secret")
          .setDesc("Shared with your other devices through a note in your vault, so you paste it once. Your sign-in stays on each device.")
          .addText((t) => {
            t.inputEl.type = "password";
            t.setPlaceholder("Paste your client secret")
              .setValue(s.healthClientSecret ?? "")
              .onChange(async (v) => { s.healthClientSecret = v.trim(); await this.plugin.saveSettings(); this.plugin.queueHealthClientSave(); });
          });

        sub("Connection");
        const granted = s.healthToken ? grantedHealthScopes(s.healthToken).length : 0;
        new Setting(containerEl)
          .setName("Google account")
          .setDesc(healthConnected
            ? (granted === HEALTH_SCOPES.length
              ? "Connected."
              : `Connected — ${granted} of ${HEALTH_SCOPES.length} data types allowed. Reconnect to allow the rest.`)
            : "Not connected.")
          .addButton((b) => {
            if (healthConnected) {
              b.setButtonText("Disconnect").onClick(async () => { await this.plugin.disconnectHealth(); rerender(); });
            } else {
              // Always clickable: the disabled state was computed once at render, so typing the
              // ID/secret never enabled it. Missing or malformed values are reported on click.
              b.setButtonText("Connect").setCta()
                .onClick(() => {
                  if (!s.healthClientId || !s.healthClientSecret) {
                    new Notice("Paste your client ID and client secret first.");
                    return;
                  }
                  void this.plugin.connectHealth().then(() => rerender());
                });
            }
          });

        if (healthConnected) {
          const last = s.healthLastSync ? new Date(s.healthLastSync).toLocaleString() : "never";
          const imp = this.plugin.healthImporter();
          const mine = this.plugin.isHealthImporter();
          new Setting(containerEl)
            .setName("Importer device")
            .setDesc(mine
              ? "This device imports from Google. Your other devices read the notes it writes."
              : `${imp?.name ?? "Another device"} imports from Google (last: ${imp?.last ? new Date(imp.last).toLocaleString() : "not yet"}). This device reads its notes, and takes over by itself after a day without imports.`)
            .addButton((b) => {
              if (mine) { b.setButtonText("This device").setDisabled(true); return; }
              b.setButtonText("Use this device").onClick(async () => { await this.plugin.claimHealthImporter(); rerender(); });
            });
          new Setting(containerEl)
            .setName("Import now")
            .setDesc(`Imports the last days into fitness and nutrition. Also runs when Obsidian opens. Last import: ${last}.`)
            .addButton((b) => b.setButtonText("Import now").setCta().onClick(() => {
              void this.plugin.syncGoogleHealth(false).then(() => rerender());
            }));
        }
      }
    }

    // ── Momentum Pro ──────────────────────────────────────────────────────
    containerEl = card("Momentum pro");
    const proOn = this.plugin.isProEnabled();

    // What Pro unlocks — shown always, so people know exactly what they're getting.
    const benefits = containerEl.createDiv({ cls: "pa-pro-benefits" });
    benefits.createDiv({ text: "What you unlock", cls: "pa-pro-benefits-title" });
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

    // Pro features of the Google Drive sync. They only do something with Drive on and connected,
    // so outside that they're shown disabled with a pointer to the Google Drive card.
    const driveReady = !!this.plugin.settings.googleDriveEnabled && !!this.plugin.settings.driveToken;
    sub("Google Drive pro features");
    new Setting(containerEl)
      .setName("Sync every file type")
      .setDesc(!proOn
        ? "Free syncs your text and Markdown notes. Pro adds images, PDFs and every other file type."
        : driveReady
          ? "Images, PDFs and every other file type sync as real uploads/downloads. Turn off to sync text and Markdown only."
          : "Turn on Google Drive sync above to use this.")
      .addToggle((t) =>
        t.setValue(proOn && !!this.plugin.settings.driveSyncBinaries)
          .setDisabled(!proOn || !driveReady)
          .onChange(async (v) => {
            this.plugin.settings.driveSyncBinaries = v;
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName("Sync Obsidian appearance & plugins")
      .setDesc(!proOn
        ? "🔒 replicate your theme, plugins and hotkeys across devices. Your tokens and window layout are never synced."
        : driveReady
          ? "Replicate your look and enabled plugins across devices: theme, snippets, hotkeys, and which plugins are on. Your tokens and window layout are never synced (only safe config files travel)."
          : "Turn on Google Drive sync above to use this.")
      .addToggle((t) =>
        t.setValue(proOn && !!this.plugin.settings.driveSyncObsidianConfig)
          .setDisabled(!proOn || !driveReady)
          .onChange(async (v) => {
            this.plugin.settings.driveSyncObsidianConfig = v;
            await this.plugin.saveSettings();
          })
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

    new Setting(containerEl)
      .setName("Terms")
      .setDesc(
        "Beta, provided as-is, with no guaranteed support. If the project is ever discontinued, the " +
        "intent is to open-source it (Pro becomes free for everyone) or hand it to a new maintainer. " +
        "Your free, local features never depend on us. Activating Pro means you accept these terms.",
      )
      .addButton((b) => b.setButtonText("View terms").onClick(() => {
        window.open("https://github.com/jnagase/obsidian-momentum/blob/main/docs/pro-terms.md", "_blank");
      }));
  }
}
