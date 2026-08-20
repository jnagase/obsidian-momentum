import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Test harness only. This config drives `npm test` (vitest) and is completely
// independent of the plugin build (esbuild.config.mjs / tsc). It never emits or
// bundles anything into main.js.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // The real `obsidian` package is types-only and has no runtime entry, so importing any
      // module that depends on it (src/googletasks.ts) fails to resolve under vitest.
      // test/stubs/obsidian.ts provides the small surface the tests exercise.
      obsidian: resolve(__dirname, "test/stubs/obsidian.ts"),
    },
  },
});
