/**
 * Validates a generated demo vault: every note's YAML frontmatter must parse, and the
 * per-module key sets must match what src/data.ts reads. Catches a silent mistake in
 * make-demo-vault.mjs (bad YAML, a renamed key) that would otherwise only show up as an
 * empty or broken panel once the vault is open in Obsidian.
 *
 * Usage: node tools/check-demo-vault.mjs [vaultDir]
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse } from "yaml";

const VAULT = process.argv[2] || join(homedir(), "Documents", "momentum-demo");
const ROOT = join(VAULT, "Momentum Life");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const errors = [];
const byType = new Map();

for (const f of files) {
  const raw = readFileSync(f, "utf8");
  const m = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!m) { errors.push(`${f}: no frontmatter block`); continue; }
  let fm;
  try {
    fm = parse(m[1]);
  } catch (e) {
    errors.push(`${f}: YAML parse failed — ${e.message}`);
    continue;
  }
  if (!fm || typeof fm !== "object") { errors.push(`${f}: frontmatter is not a mapping`); continue; }

  // A duplicated key is valid-looking but breaks the plugin, so assert uniqueness too.
  const keys = m[1].split("\n").map((l) => /^([A-Za-z0-9_-]+):/.exec(l)?.[1]).filter(Boolean);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length) errors.push(`${f}: duplicated frontmatter key(s): ${[...new Set(dupes)].join(", ")}`);

  const t = String(fm.type || "(none)");
  byType.set(t, (byType.get(t) || 0) + 1);
}

/** Required frontmatter keys per note type, mirroring what src/data.ts actually reads. */
const REQUIRED = {
  task: ["task_id", "title", "status", "priority", "kanban_name"],
  habit: ["id", "habit_type", "name", "log"],
  "workout-log": ["id", "date", "split", "duration", "exercises"],
  "meal-plan": ["id", "name", "items"],
  "meal-log": ["id", "date", "meal", "calories", "items"],
  study: ["id", "title", "topic", "status"],
  transaction: ["id", "date", "tx_type", "amount", "category"],
  config: ["task_columns", "currency"],
  "splits-config": ["splits"],
  "recurring-config": ["items"],
  "savings-config": ["buckets"],
  "study-boards-config": ["boards"],
  "water-log": ["log"],
};

for (const f of files) {
  const raw = readFileSync(f, "utf8");
  const m = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!m) continue;
  let fm;
  try { fm = parse(m[1]); } catch { continue; }
  if (!fm) continue;
  const need = REQUIRED[String(fm.type)];
  if (!need) continue;
  const missing = need.filter((k) => fm[k] === undefined);
  if (missing.length) errors.push(`${f}: type "${fm.type}" missing ${missing.join(", ")}`);
}

console.log(`Scanned ${files.length} notes under ${ROOT}`);
console.log("By type:");
for (const [t, n] of [...byType.entries()].sort()) console.log(`  ${t.padEnd(22)} ${n}`);

if (errors.length) {
  console.log(`\n${errors.length} PROBLEM(S):`);
  errors.slice(0, 40).forEach((e) => console.log("  - " + e));
  process.exit(1);
}
console.log("\nAll frontmatter parses and carries the keys the plugin reads.");
