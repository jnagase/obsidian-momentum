import { ItemView, WorkspaceLeaf, debounce } from "obsidian";
import { PAContext } from "./context";
import { PADataStore, DATA_ROOT } from "./data";
import { HabitTrackerModule } from "./modules/habit-tracker";
import { TasksModule } from "./modules/tasks";
import { FitnessModule } from "./modules/fitness";
import { NutritionModule } from "./modules/nutrition";
import { StudiesModule } from "./modules/studies";
import { FinancesModule } from "./modules/finances";

export const VIEW_TYPE_PA = "personal-assistant-view";

export const PAGES = [
  { id: "habit-tracker", label: "🎯 Habit Tracker" },
  { id: "tasks", label: "✅ Tasks & Lists" },
  { id: "fitness", label: "🏋️ Fitness" },
  { id: "nutrition", label: "🥗 Nutrition" },
  { id: "studies", label: "📚 Studies" },
  { id: "finances", label: "💰 Finances" },
];

/** Implemented by the plugin so the nav + content views stay in sync. */
export interface PAHost {
  currentPage: string;
  openPage(id: string): void | Promise<void>;
}

export class PAView extends ItemView {
  private ctx: PAContext;
  private host: PAHost;
  private mainEl: HTMLElement | null = null;

  private habitTrackerModule: HabitTrackerModule;
  private tasksModule: TasksModule;
  private fitnessModule: FitnessModule;
  private nutritionModule: NutritionModule;
  private studiesModule: StudiesModule;
  private financesModule: FinancesModule;

  constructor(leaf: WorkspaceLeaf, store: PADataStore, host: PAHost) {
    super(leaf);
    this.host = host;
    this.ctx = new PAContext(this.app, store);
    this.ctx.refresh = () => this.renderPage();
    this.habitTrackerModule = new HabitTrackerModule(this.ctx);
    this.tasksModule = new TasksModule(this.ctx);
    this.fitnessModule = new FitnessModule(this.ctx);
    this.nutritionModule = new NutritionModule(this.ctx);
    this.studiesModule = new StudiesModule(this.ctx);
    this.financesModule = new FinancesModule(this.ctx);
  }

  getViewType(): string { return VIEW_TYPE_PA; }
  getDisplayText(): string {
    const p = PAGES.find((x) => x.id === this.host.currentPage);
    return p ? p.label.replace(/^\S+\s/, "") : "Personal Assistant";
  }
  getIcon(): string { return "target"; }

  async onOpen(): Promise<void> {
    await this.ctx.reloadConfig();
    const root = this.contentEl;
    root.empty();
    root.addClass("pa-root", "pa-content-root");
    this.mainEl = root.createDiv({ cls: "pa-page" });
    this.renderPage();

    const refresh = debounce(() => this.renderPage(), 400, true);
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!file.path.startsWith(DATA_ROOT + "/")) return;
        // Currency/targets live in the config file — reload it so the change shows immediately.
        if (file.path === `${DATA_ROOT}/Config/settings.md`) {
          void this.ctx.reloadConfig().then(() => this.renderPage());
        } else {
          refresh();
        }
      })
    );
  }

  async onClose(): Promise<void> {
    this.fitnessModule.destroy();
  }

  /** Switch the active page (called by the nav view via the plugin). */
  setPage(id: string): void {
    if (this.mainEl) this.renderPage();
    // Refresh the tab title to reflect the current page.
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
  }

  private renderPage(): void {
    const main = this.mainEl;
    if (!main) return;
    this.fitnessModule.destroy();
    main.empty();

    switch (this.host.currentPage) {
      case "habit-tracker": this.habitTrackerModule.render(main); break;
      case "tasks": this.tasksModule.render(main); break;
      case "fitness": this.fitnessModule.render(main); break;
      case "nutrition": this.nutritionModule.render(main); break;
      case "studies": this.studiesModule.render(main); break;
      case "finances": this.financesModule.render(main); break;
      default: this.habitTrackerModule.render(main);
    }
  }
}
