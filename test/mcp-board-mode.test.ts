// The MCP decides the task model from the vault itself (it can't read the plugin's device flag).
// Since 0.9.2 board notes are the default, so a fresh/empty vault must get board notes, while a
// vault still in the folder model keeps getting per-task notes until the plugin consolidates it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MomentumStore } from "../mcp/src/store.mjs";

const exists = (p: string) => access(p).then(() => true, () => false);

describe("MCP task model detection", () => {
  let vault: string;
  const tasks = () => join(vault, "Momentum Life", "Tasks");

  beforeEach(async () => { vault = await mkdtemp(join(process.env.KIROCREW_SCRATCH || tmpdir(), "mcp-vault-")); });
  afterEach(async () => { await rm(vault, { recursive: true, force: true }); });

  it("empty vault → board note (the 0.9.2 default)", async () => {
    const s = new MomentumStore(vault);
    await s.createTask({ title: "First task" });
    const raw = await readFile(join(tasks(), "My Tasks.md"), "utf8");
    expect(raw).toContain('type: "task-board"');
    expect(raw).toContain("First task");
    expect(await exists(join(tasks(), "My Tasks", "First task.md"))).toBe(false);
  });

  it("vault still in the folder model → keeps writing per-task notes", async () => {
    await mkdir(join(tasks(), "Work"), { recursive: true });
    await writeFile(join(tasks(), "Work", "Old.md"), '---\ntype: "task"\ntitle: "Old"\n---\n');
    const s = new MomentumStore(vault);
    await s.createTask({ title: "New one", board: "Work" });
    expect(await exists(join(tasks(), "Work.md"))).toBe(false);
    const list = (await s.loadTasks()) as { title: string }[];
    expect(list.map((t) => t.title).sort()).toEqual(["New one", "Old"]);
  });

  it("vault with a board note → board-note mode", async () => {
    await mkdir(tasks(), { recursive: true });
    await writeFile(join(tasks(), "Work.md"), '---\ntype: "task-board"\nboard: "Work"\ntasks: []\n---\n');
    const s = new MomentumStore(vault);
    await s.createTask({ title: "Into note", board: "Work" });
    expect(await readFile(join(tasks(), "Work.md"), "utf8")).toContain("Into note");
  });
});
