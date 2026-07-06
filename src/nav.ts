import { ItemView, WorkspaceLeaf } from "obsidian";
import { PAGES, PAHost } from "./view";

export const VIEW_TYPE_PA_NAV = "personal-assistant-nav";

/** Left-sidebar navigation panel that drives the main content view. */
export class PANavView extends ItemView {
  private host: PAHost;

  constructor(leaf: WorkspaceLeaf, host: PAHost) {
    super(leaf);
    this.host = host;
  }

  getViewType(): string { return VIEW_TYPE_PA_NAV; }
  // eslint-disable-next-line obsidianmd/ui/sentence-case -- "Momentum Life" is the plugin's proper name
  getDisplayText(): string { return "Momentum Life"; }
  getIcon(): string { return "target"; }

  async onOpen(): Promise<void> { this.render(); }
  async onClose(): Promise<void> {}

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("pa-root", "pa-nav-root");
    root.createDiv({ text: "🎯 Momentum Life", cls: "pa-logo" });
    PAGES.forEach((p) => {
      const btn = root.createEl("button", {
        text: p.label,
        cls: "pa-nav" + (p.id === this.host.currentPage ? " active" : ""),
      });
      btn.onclick = () => this.host.openPage(p.id);
    });
  }
}
