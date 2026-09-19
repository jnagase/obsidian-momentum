import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";
import path from "path";

const builtins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

const mode = process.argv[2];
const prod = mode === "production";
// 'drivetest' builds a LOCAL test build whose WORKER_BASE points at the Drive worker
// (app-domain.test.json) instead of production. Never commit/publish this build — it is only
// copied into the obsidian_1 test vault. Production and dev builds are unaffected.
const driveTest = mode === "drivetest";

/** esbuild plugin: redirect app-domain.json → app-domain.test.json for the drivetest build. */
const driveTestAlias = {
  name: "drive-test-app-domain",
  setup(build) {
    build.onResolve({ filter: /app-domain\.json$/ }, (args) => ({
      path: path.resolve(process.cwd(), "app-domain.test.json"),
      external: false,
    }));
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  plugins: driveTest ? [driveTestAlias] : [],
  outfile: "main.js",
});

if (prod || driveTest) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
