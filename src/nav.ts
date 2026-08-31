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
    const openInMenu = (evt: MouseEvent, id: string, extra?: (m: Menu) => void) => {
      evt.preventDefault();
      const menu = new Menu();
      menu.addItem((i) => i.setTitle("Open in center").setIcon("layout").onClick(() => void this.host.openPageIn(id, "center")));
      menu.addItem((i) => i.setTitle("Open in left sidebar").setIcon("sidebar-left").onClick(() => void this.host.openPageIn(id, "left")));
      menu.addItem((i) => i.setTitle("Open in right sidebar").setIcon("sidebar-right").onClick(() => void this.host.openPageIn(id, "right")));
      menu.addItem((i) => i.setTitle("Open in bottom split").setIcon("layout-panel-top").onClick(() => void this.host.openPageIn(id, "bottom")));
      if (extra) extra(menu);
      menu.showAtMouseEvent(evt);
    };

    PAGES.forEach((p) => {
      const btn = root.createEl("button", {
        text: p.label,
        cls: "pa-nav" + (p.id === this.host.currentPage ? " active" : ""),
      });
      btn.onclick = () => this.host.openPage(p.id);
      btn.oncontextmenu = (evt) => openInMenu(evt, p.id);
    });

    // User-defined sections. Command sections open another plugin/view on click;
    // legacy folder sections open as a Momentum page.
    (this.host.customPages || []).forEach((p) => {
      const isCommand = !!p.command;
      const broken = this.host.isCustomPageBroken(p.id);
      const row = root.createDiv({ cls: "pa-nav-row" });
      const btn = row.createEl("button", {
        text: `${p.emoji || (isCommand ? "🧩" : "📄")} ${p.label}${broken ? " (plugin removed)" : ""}`,
        cls: "pa-nav pa-nav-row-btn" + (!isCommand && p.id === this.host.currentPage ? " active" : "") + (broken ? " pa-nav-broken" : ""),
      });
      if (broken) btn.setAttr("title", "This shortcut's plugin isn't installed/enabled anymore. Click the trash icon to remove it.");
      btn.onclick = () => this.host.activateCustomPage(p.id);
      const editDelete = (menu: Menu) => {
        menu.addSeparator();
        menu.addItem((i) => i.setTitle("Edit plugin").setIcon("pencil").onClick(() => this.host.editCustomPage(p.id)));
        menu.addItem((i) => i.setTitle("Remove plugin").setIcon("trash").onClick(() => void this.host.removeCustomPage(p.id)));
      };
      btn.oncontextmenu = (evt) => {
        if (isCommand) {
          // "Open in X" doesn't apply — the target plugin decides where it opens.
          evt.preventDefault();
          const menu = new Menu();
          menu.addItem((i) => i.setTitle("Open").setIcon("play").onClick(() => this.host.activateCustomPage(p.id)));
          editDelete(menu);
          menu.showAtMouseEvent(evt);
        } else {
          openInMenu(evt, p.id, editDelete);
        }
      };
      // Always-visible trash icon — removing a shortcut no longer requires knowing
      // about the right-click menu (this was easy to miss, especially for a broken
      // shortcut left behind after uninstalling the plugin it pointed to).
      const del = row.createEl("button", { text: "🗑", cls: "pa-icon-btn pa-nav-row-del" });
      del.setAttr("aria-label", "Remove plugin shortcut");
      del.onclick = (evt) => { evt.stopPropagation(); void this.host.removeCustomPage(p.id); };
    });

    // "+ add plugin" — pin another plugin's view as a nav shortcut.
    const add = root.createEl("button", { text: "Add plugin", cls: "pa-nav pa-nav-add" });
    add.onclick = () => this.host.addCustomPage();
  }
}
