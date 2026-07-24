import { ItemView, Menu, WorkspaceLeaf } from "obsidian";
import { PAGES, PAHost } from "./view";

export const VIEW_TYPE_PA_NAV = "personal-assistant-nav";

/** Left-sidebar navigation panel that drives the main content view. */
export class PANavView extends ItemView {
  private host: PAHost;
  private displayName: string;

  constructor(leaf: WorkspaceLeaf, host: PAHost, displayName: string) {
    super(leaf);
    this.host = host;
    this.displayName = displayName;
  }

  getViewType(): string { return VIEW_TYPE_PA_NAV; }
  getDisplayText(): string { return this.displayName; }
  getIcon(): string { return "target"; }

  async onOpen(): Promise<void> { this.render(); }
  async onClose(): Promise<void> {}

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("pa-root", "pa-nav-root");
    root.createDiv({ text: `🎯 ${this.displayName}`, cls: "pa-logo" });
    PAGES.forEach((p) => {
      const btn = root.createEl("button", {
        text: p.label,
        cls: "pa-nav" + (p.id === this.host.currentPage ? " active" : ""),
      });
      btn.onclick = () => this.host.openPage(p.id);
      btn.oncontextmenu = (evt) => {
        evt.preventDefault();
        const menu = new Menu();
        menu.addItem((i) => i.setTitle("Open in center").setIcon("layout")
          .onClick(() => void this.host.openPageIn(p.id, "center")));
        menu.addItem((i) => i.setTitle("Open in left sidebar").setIcon("sidebar-left")
          .onClick(() => void this.host.openPageIn(p.id, "left")));
        menu.addItem((i) => i.setTitle("Open in right sidebar").setIcon("sidebar-right")
          .onClick(() => void this.host.openPageIn(p.id, "right")));
        menu.addItem((i) => i.setTitle("Open in bottom split").setIcon("layout-panel-top")
          .onClick(() => void this.host.openPageIn(p.id, "bottom")));
        menu.showAtMouseEvent(evt);
      };
    });
  }
}
