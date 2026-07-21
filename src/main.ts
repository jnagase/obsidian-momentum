import { Plugin, WorkspaceLeaf, PluginSettingTab, App, Setting, TFolder, TFile, Platform } from "obsidian";
import { PADataStore, setDataRoot } from "./data";
import { todayLocal } from "./util";
import { PAView, VIEW_TYPE_PA, PAHost } from "./view";
import { PANavView, VIEW_TYPE_PA_NAV } from "./nav";
import { MomentumAIView, VIEW_TYPE_MOMENTUM_AI, AIHost } from "./aiview";
import { AIConfig, DEFAULT_MODELS } from "./ai";
import { WhatsNewModal, CHANGELOG, cmpVersion } from "./whatsnew";

interface PASettings { dataRoot: string; aiProvider: string; aiApiKey: string; aiModel: string; aiBaseUrl: string; aiCommand: string; aiCommandArgs: string; notifyTasks: boolean; lastSeenVersion: string; }
const DEFAULT_SETTINGS: PASettings = { dataRoot: "Momentum Life", aiProvider: "gemini", aiApiKey: "", aiModel: "gemini-3.5-flash", aiBaseUrl: "", aiCommand: "", aiCommandArgs: "", notifyTasks: false, lastSeenVersion: "" };
const LEGACY_DATA_ROOT = "Personal Assistant";

export default class MomentumPlugin extends Plugin implements PAHost, AIHost {
  settings: PASettings;
  store: PADataStore;
  currentPage = "habit-tracker";

  async onload(): Promise<void> {
    const data = (await this.loadData()) as (Partial<PASettings> & { geminiApiKey?: string }) | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // Migrate the earlier Gemini-only key field to the generic AI key.
    if (data?.geminiApiKey && !this.settings.aiApiKey) this.settings.aiApiKey = data.geminiApiKey;
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
    this.registerView(VIEW_TYPE_MOMENTUM_AI, (leaf) => new MomentumAIView(leaf, this));

    this.addCommand({
      id: "open",
      name: "Open",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "open-ai",
      name: "Open AI assistant",
      callback: () => this.activateAIView(),
    });

    this.addRibbonIcon("bot", "Momentum AI", () => this.activateAIView());

    this.addSettingTab(new PASettingTab(this.app, this));

    // Ensure the nav panel exists in the left sidebar so its access icon is always available.
    this.app.workspace.onLayoutReady(() => {
      // Remove any duplicate panels that piled up (e.g. from workspace sync between devices).
      this.dedupeLeaves(VIEW_TYPE_PA_NAV);
      this.dedupeLeaves(VIEW_TYPE_MOMENTUM_AI);
      if (this.app.workspace.getLeavesOfType(VIEW_TYPE_PA_NAV).length === 0) {
        const leaf = this.app.workspace.getLeftLeaf(false);
        void leaf?.setViewState({ type: VIEW_TYPE_PA_NAV });
      }
      void this.store.syncTaskLists();
      this.maybeShowWhatsNew();
      void this.runTaskAutomations();
    });

    // Re-check recurring tasks and due reminders every 30 minutes while Obsidian is open.
    this.registerInterval(window.setInterval(() => void this.runTaskAutomations(), 30 * 60 * 1000));

    // When a task-list mirror file is edited (e.g. a checkbox toggled from another
    // plugin), reflect the done/undone change back into the board tasks.
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) return;
      const listsPrefix = this.store.full("Tasks/Lists") + "/";
      if (!file.path.startsWith(listsPrefix)) return;
      void (async () => {
        const changed = await this.store.applyTaskListFile(file);
        if (changed) await this.store.syncTaskLists();
      })();
    }));
  }

  // ---- AIHost ----
  getAIConfig(): AIConfig {
    return {
      provider: this.settings.aiProvider || "gemini",
      apiKey: this.settings.aiApiKey || "",
      model: this.settings.aiModel || "",
      baseUrl: this.settings.aiBaseUrl || "",
      command: this.settings.aiCommand || "",
      args: this.settings.aiCommandArgs || "",
    };
  }

  /** Open the AI chat panel in the right sidebar. */
  async activateAIView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_MOMENTUM_AI)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_MOMENTUM_AI, active: true });
    }
    if (leaf) void workspace.revealLeaf(leaf);
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

  /** Set the active page and ensure the content view shows it. */
  async openPage(id: string): Promise<void> {
    this.currentPage = id;
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_PA)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_PA, active: true });
    }
    if (leaf.view instanceof PAView) leaf.view.setPage(id);
    void workspace.revealLeaf(leaf);
    workspace.getLeavesOfType(VIEW_TYPE_PA_NAV).forEach((l) => {
      if (l.view instanceof PANavView) l.view.render();
    });
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

  private lastDueNotified = "";

  /** Generate any due recurring tasks and fire desktop notifications (while Obsidian is open). */
  private async runTaskAutomations(): Promise<void> {
    try {
      const created = await this.store.generateDueRecurringTasks();
      if (created.length) {
        await this.notify("Momentum Life", created.length === 1 ? `New recurring task: ${created[0]}` : `${created.length} recurring tasks added`);
        this.app.workspace.getLeavesOfType(VIEW_TYPE_PA).forEach((l) => { if (l.view instanceof PAView) l.view.setPage(this.currentPage); });
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

    new Setting(containerEl).setName("AI assistant").setHeading();

    const providerSetting = new Setting(containerEl)
      .setName("Provider")
      .setDesc("Which AI service to use. Bring your own API key. The chat only contacts the selected provider when you send a message, with a short summary of your dashboard data. No telemetry is collected.");

    const providerFields = containerEl.createDiv();

    const renderProviderFields = () => {
      providerFields.empty();
      const p = this.plugin.settings.aiProvider;

      if (MOMENTUM_LOCAL_CMD && p === "local") {
        if (!Platform.isDesktopApp) {
          providerFields.createEl("p", { cls: "setting-item-description", text: "The local command option is only available on desktop." });
          return;
        }
        new Setting(providerFields)
          .setName("Command")
          .setDesc("Full path to a local CLI binary to run. Runs on your machine, desktop only.")
          .addText((t) =>
            t.setValue(this.plugin.settings.aiCommand).onChange(async (v) => { this.plugin.settings.aiCommand = v.trim(); await this.plugin.saveSettings(); })
          );
        new Setting(providerFields)
          .setName("Command arguments")
          .setDesc("Arguments separated by spaces. Use {prompt} to pass the prompt as an argument; leave it out to send the prompt on standard input.")
          .addText((t) =>
            t.setValue(this.plugin.settings.aiCommandArgs).onChange(async (v) => { this.plugin.settings.aiCommandArgs = v; await this.plugin.saveSettings(); })
          );
        return;
      }

      new Setting(providerFields)
        .setName("API key")
        .setDesc("Your own API key for the selected provider.")
        .addText((t) => {
          t.inputEl.type = "password";
          t.setPlaceholder("Paste your key here")
            .setValue(this.plugin.settings.aiApiKey)
            .onChange(async (v) => { this.plugin.settings.aiApiKey = v.trim(); await this.plugin.saveSettings(); });
        });

      new Setting(providerFields)
        .setName("Model")
        .setDesc("Model ID for the selected provider. Change it if the default is not available to you.")
        .addText((t) =>
          t.setValue(this.plugin.settings.aiModel).onChange(async (v) => { this.plugin.settings.aiModel = v.trim(); await this.plugin.saveSettings(); })
        );

      if (p === "openai") {
        new Setting(providerFields)
          .setName("Base URL")
          .setDesc("Endpoint for the OpenAI-compatible option. Leave empty to use the default.")
          .addText((t) =>
            t.setValue(this.plugin.settings.aiBaseUrl).onChange(async (v) => { this.plugin.settings.aiBaseUrl = v.trim(); await this.plugin.saveSettings(); })
          );
      }
    };

    providerSetting.addDropdown((d) => {
      d.addOption("gemini", "Gemini (Google)");
      d.addOption("anthropic", "Claude (Anthropic)");
      d.addOption("xai", "Grok");
      d.addOption("openai", "OpenAI-compatible (custom)");
      if (MOMENTUM_LOCAL_CMD && Platform.isDesktopApp) d.addOption("local", "Local command (desktop, personal)");
      d.setValue(this.plugin.settings.aiProvider).onChange(async (v) => {
        this.plugin.settings.aiProvider = v;
        if (v !== "local") this.plugin.settings.aiModel = DEFAULT_MODELS[v] || this.plugin.settings.aiModel;
        await this.plugin.saveSettings();
        renderProviderFields();
      });
    });

    renderProviderFields();

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
