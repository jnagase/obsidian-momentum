import { defineConfig } from "vitest/config";

// Test harness only. This config drives `npm test` (vitest) and is completely
// independent of the plugin build (esbuild.config.mjs / tsc). It never emits or
// bundles anything into main.js.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
