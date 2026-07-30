import { Plugin, WorkspaceLeaf, PluginSettingTab, App, Setting, TFolder, TFile, Platform, Notice } from "obsidian";
import { PADataStore, setDataRoot } from "./data";
import { todayLocal } from "./util";
import { PAView, VIEW_TYPE_PA, PAHost, PALocation } from "./view";
import { PANavView, VIEW_TYPE_PA_NAV } from "./nav";
import { PASideView, VIEW_TYPE_PA_SIDE, momentumNoteType } from "./side";
import { WhatsNewModal, CHANGELOG, cmpVersion } from "./whatsnew";
import { CustomPage } from "./types";
import { FormModal, ConfirmModal, FieldSpec } from "./ui";

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

    this.registerView(VIEW_TYPE_PA, (leaf) => new PAView(leaf, this.store, this));
    this.registerView(VIEW_TYPE_PA_NAV, (leaf) => new PANavView(leaf, this, this.manifest.name));
    this.registerView(VIEW_TYPE_PA_SIDE, (leaf) => new PASideView(leaf, this.store));

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

    this.addCommand({
      id: "momentum-open-tasks-summary",
      name: "Momentum: open context panel in sidebar",
      callback: () => void this.openSidePanel(),
    });

    // Ribbon icon (left bar) to open the context panel — the most discoverable entry point.
    this.addRibbonIcon("target", "Open context panel", () => void this.openSidePanel());

    this.addSettingTab(new PASettingTab(this.app, this));

    // Ensure the nav panel exists in the left sidebar so its access icon is always available.
    this.app.workspace.onLayoutReady(() => {
      // Load user-defined nav sections so the nav can render them.
      void this.reloadCustomPages();
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

  /** Delete a custom section (keeps the underlying notes; only removes the nav tab). */
  async removeCustomPage(id: string): Promise<void> {
    const page = this.customPages.find((p) => p.id === id);
    if (!page) return;
    new ConfirmModal(this.app, `Remove the "${page.label}" plugin shortcut? (only the tab is removed)`, async () => {
      const cfg = await this.store.loadConfig();
      cfg.customPages = cfg.customPages.filter((p) => p.id !== id);
      await this.store.saveConfig(cfg);
      await this.reloadCustomPages();
      if (this.currentPage === id) await this.openPage("habit-tracker");
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
