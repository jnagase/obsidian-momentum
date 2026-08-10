import { App } from "obsidian";
import { PADataStore } from "./data";
import { PAConfig, defaultConfig } from "./types";

/**
 * Shared context passed to every module renderer. Holds the data store,
 * the loaded config, and a callback to re-render the current page after
 * a data mutation.
 */
export class PAContext {
  app: App;
  store: PADataStore;
  config: PAConfig = defaultConfig();
  /** Re-render the currently active page. Set by the view. */
  refresh: () => void = () => {};
  /** Open the context side panel in the right sidebar. Set by the view. */
  openSidePanel: () => void = () => {};
  /** Run a Google Tasks sync now. Set by the view. */
  syncGoogleTasks?: () => void;
  /** True when the Google Tasks beta is enabled AND an account is connected. */
  googleTasksReady?: () => boolean;
  /** Open this plugin's settings tab (used by the "connect Google" walkthrough). */
  openPluginSettings?: () => void;

  constructor(app: App, store: PADataStore) {
    this.app = app;
    this.store = store;
  }

  async reloadConfig(): Promise<void> {
    this.config = await this.store.loadConfig();
  }
}
