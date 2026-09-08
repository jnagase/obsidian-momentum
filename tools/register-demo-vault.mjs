/**
 * Registers the demo vault in Obsidian's vault list so `obsidian://open?path=...` can open
 * it (that URI only resolves vaults Obsidian already knows about).
 *
 * Additive and reversible: writes a timestamped backup of obsidian.json next to it first,
 * and only ever ADDS an entry — existing vaults are left untouched. Run with `--revert` to
 * remove the demo entry and restore the file from the newest backup.
 *
 * Usage:
 *   node tools/register-demo-vault.mjs [vaultDir]
 *   node tools/register-demo-vault.mjs --revert
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

const CFG_DIR = join(homedir(), "Library", "Application Support", "obsidian");
const CFG = join(CFG_DIR, "obsidian.json");
const revert = process.argv.includes("--revert");
// slice(2) matters: argv[0] is the node binary, which is itself an absolute path and would
// otherwise be picked up as the vault directory.
const VAULT = process.argv.slice(2).find((a) => a.startsWith("/")) || join(homedir(), "Documents", "momentum-demo");

if (!existsSync(CFG)) {
  console.error(`obsidian.json not found at ${CFG}`);
  process.exit(1);
}

if (revert) {
  const backups = readdirSync(CFG_DIR).filter((f) => f.startsWith("obsidian.json.bak.")).sort();
  if (!backups.length) { console.error("No backup found to restore."); process.exit(1); }
  const newest = join(CFG_DIR, backups[backups.length - 1]);
  copyFileSync(newest, CFG);
  console.log(`Restored ${CFG} from ${newest}`);
  process.exit(0);
}

const raw = readFileSync(CFG, "utf8");
const cfg = JSON.parse(raw);
cfg.vaults = cfg.vaults || {};

const already = Object.entries(cfg.vaults).find(([, v]) => v.path === VAULT);
if (already) {
  console.log(`Already registered as id ${already[0]} — nothing to do.`);
  process.exit(0);
}

const backup = `${CFG}.bak.${Date.now()}`;
copyFileSync(CFG, backup);

const id = randomBytes(8).toString("hex");
// `open: false` so this never steals the "currently open vault" flag from the real vault.
cfg.vaults[id] = { path: VAULT, ts: Date.now(), open: false };
writeFileSync(CFG, JSON.stringify(cfg), "utf8");

console.log(`Backup:     ${backup}`);
console.log(`Registered: ${VAULT}`);
console.log(`Vault id:   ${id}`);
console.log(`Existing vaults preserved: ${Object.keys(cfg.vaults).length - 1}`);
