import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";

const builtins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

const prod = process.argv[2] === "production";
// Personal, desktop-only local-command bridge. Off by default so the community
// build never bundles child_process; enable with MOMENTUM_LOCAL=1 for a local build.
const localCmd = process.env.MOMENTUM_LOCAL === "1";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  define: { MOMENTUM_LOCAL_CMD: JSON.stringify(localCmd) },
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
