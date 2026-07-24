import { Plugin, WorkspaceLeaf, PluginSettingTab, App, Setting, TFolder, TFile, Platform, Notice } from "obsidian";
import { PADataStore, setDataRoot } from "./data";
import { todayLocal } from "./util";
import { PAView, VIEW_TYPE_PA, PAHost, PALocation } from "./view";
import { PANavView, VIEW_TYPE_PA_NAV } from "./nav";
import { WhatsNewModal, CHANGELOG, cmpVersion } from "./whatsnew";

interface PASettings { dataRoot: string; notifyTasks: boolean; lastSeenVersion: string; readableNotesSchema?: number; }
const DEFAULT_SETTINGS: PASettings = { dataRoot: "Momentum Life", notifyTasks: false, lastSeenVersion: "", readableNotesSchema: 0 };
const LEGACY_DATA_ROOT = "Personal Assistant";
/** Bump when the readable-notes migration changes so the guarded auto-run re-triggers. */
const READABLE_NOTES_SCHEMA = 1;

export default class MomentumPlugin extends Plugin implements PAHost {
  settings: PASettings;
  store: PADataStore;
  currentPage = "habit-tracker";
  /** True while the plugin itself is (re)writing the task-list mirrors, so the vault
   *  "modify" listener ignores our own writes and never re-enters (prevents runaway loops). */
  private mirrorSyncing = false;

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

    this.registerView(VIEW_TYPE_PA, (leaf) => new PAView(leaf, this.store, this));
    this.registerView(VIEW_TYPE_PA_NAV, (leaf) => new PANavView(leaf, this, this.manifest.name));

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

    this.addSettingTab(new PASettingTab(this.app, this));

    // Ensure the nav panel exists in the left sidebar so its access icon is always available.
    this.app.workspace.onLayoutReady(() => {
      // Remove any duplicate panels that piled up (e.g. from workspace sync between devices).
      this.dedupeLeaves(VIEW_TYPE_PA_NAV);
      if (this.app.workspace.getLeavesOfType(VIEW_TYPE_PA_NAV).length === 0) {
        const leaf = this.app.workspace.getLeftLeaf(false);
        void leaf?.setViewState({ type: VIEW_TYPE_PA_NAV });
      }
      // Promote any items added externally (e.g. a mobile widget) while the app was
      // closed BEFORE regenerating the mirrors, so those additions are not wiped.
      // Guarded so the mirror rewrites below don't re-trigger the modify listener.
      void (async () => {
        this.mirrorSyncing = true;
        try {
          await this.store.reconcileTaskLists();
          await this.store.syncTaskLists();
        } finally {
          window.setTimeout(() => { this.mirrorSyncing = false; }, 1000);
        }
      })();
      this.maybeShowWhatsNew();
      void this.runTaskAutomations();
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

    // Re-check recurring tasks and due reminders every 30 minutes while Obsidian is open.
    this.registerInterval(window.setInterval(() => void this.runTaskAutomations(), 30 * 60 * 1000));

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

  /** Set the active page and ensure a CENTER content view shows it (reusing one if present). */
  async openPage(id: string): Promise<void> {
    this.currentPage = id;
    const { workspace } = this.app;
    let leaf = this.findCenterPAView();
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
    }
    await leaf.setViewState({ type: VIEW_TYPE_PA, active: true, state: { page: id } });
    void workspace.revealLeaf(leaf);
    this.refreshNav();
  }

  /** Open a page in a chosen workspace location as an independent view. */
  async openPageIn(id: string, location: PALocation): Promise<void> {
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

  /** Find an existing PAView docked in the main/center area (not a sidebar). */
  private findCenterPAView(): WorkspaceLeaf | null {
    const { workspace } = this.app;
    const rootSplit = workspace.rootSplit;
    return (
      workspace.getLeavesOfType(VIEW_TYPE_PA).find((l) => l.getRoot() === rootSplit) ?? null
    );
  }

  /** Re-render nav panels so the active-page highlight stays current. */
  private refreshNav(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_PA_NAV).forEach((l) => {
      if (l.view instanceof PANavView) l.view.render();
    });
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

  private lastDueNotified = "";

  /** Generate any due recurring tasks and fire desktop notifications (while Obsidian is open). */
  private async runTaskAutomations(): Promise<void> {
    try {
      const created = await this.store.generateDueRecurringTasks();
      if (created.length) {
        await this.notify("Momentum Life", created.length === 1 ? `New recurring task: ${created[0]}` : `${created.length} recurring tasks added`);
        this.app.workspace.getLeavesOfType(VIEW_TYPE_PA).forEach((l) => { if (l.view instanceof PAView) l.view.rerender(); });
      }
      await this.maybeNotifyDue();
    } catch { /* automations are best-effort */ }
  }

  /** Once per day, notify about tasks whose due date is today and are not done. */
  private async maybeNotifyDue(): Promise<void> {
    if (!this.settings.notifyTasks) return;
    const today = todayLocal();
    if (this.lastDueNotified === today) return;
    const due = this.store.loadTasks().filter((t) => t.due === today && t.status !== "done");
    if (!due.length) return;
    this.lastDueNotified = today;
    await this.notify("Tasks due today", due.length === 1 ? due[0].title : `${due.length} tasks are due today`);
  }

  /** Show a native desktop notification, if enabled and available. Desktop-only. */
  private async notify(title: string, body: string): Promise<void> {
    if (!this.settings.notifyTasks || !Platform.isDesktopApp) return;
    try {
      const N = window.Notification;
      if (!N) return;
      if (N.permission === "default") await N.requestPermission();
      if (N.permission === "granted") new N(title, { body });
    } catch { /* notifications are best-effort */ }
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
      .setDesc("Show desktop notifications for new recurring tasks and tasks due today. Desktop only, and only while the app is open.")
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
  }
}
