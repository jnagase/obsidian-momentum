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

  constructor(app: App, store: PADataStore) {
    this.app = app;
    this.store = store;
  }

  async reloadConfig(): Promise<void> {
    this.config = await this.store.loadConfig();
  }
}
