import { Plugin, WorkspaceLeaf, PluginSettingTab, App, Setting } from "obsidian";
import { PADataStore, setDataRoot } from "./data";
import { PAView, VIEW_TYPE_PA, PAHost } from "./view";
import { PANavView, VIEW_TYPE_PA_NAV } from "./nav";

interface PASettings { dataRoot: string; }
const DEFAULT_SETTINGS: PASettings = { dataRoot: "Personal Assistant" };

export default class MomentumPlugin extends Plugin implements PAHost {
  settings: PASettings;
  store: PADataStore;
  currentPage = "habit-tracker";

  async onload(): Promise<void> {
    const data = (await this.loadData()) as Partial<PASettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    setDataRoot(this.settings.dataRoot);
    this.store = new PADataStore(this.app);

    this.registerView(VIEW_TYPE_PA, (leaf) => new PAView(leaf, this.store, this));
    this.registerView(VIEW_TYPE_PA_NAV, (leaf) => new PANavView(leaf, this, this.manifest.name));

    this.addCommand({
      id: "open",
      name: "Open",
      callback: () => this.activateView(),
    });

    this.addSettingTab(new PASettingTab(this.app, this));

    // Ensure the nav panel exists in the left sidebar so its access icon is always available.
    this.app.workspace.onLayoutReady(() => {
      if (this.app.workspace.getLeavesOfType(VIEW_TYPE_PA_NAV).length === 0) {
        const leaf = this.app.workspace.getLeftLeaf(false);
        void leaf?.setViewState({ type: VIEW_TYPE_PA_NAV });
      }
    });
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
