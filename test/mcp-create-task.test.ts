import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MomentumStore } from "../mcp/src/store.mjs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// =====================================================================================
// Bug 2 (functional): MCP createTask/updateTask must FILE the task into the requested
// column even when spelled "in-progress" — end-to-end against a real temp vault, not just
// the pure resolveColumn(). Reproduces the reported "two cards landed in backlog" defect.
// =====================================================================================

let vault: string;
let store: InstanceType<typeof MomentumStore>;

beforeEach(async () => {
  vault = await mkdtemp(join(process.env.KIROCREW_SCRATCH || tmpdir(), "momentum-mcp-"));
  store = new MomentumStore(vault, "Momentum Life");
});
afterEach(async () => { await rm(vault, { recursive: true, force: true }); });

/** Pull the `status:` value out of a created note's frontmatter. */
async function statusOf(path: string): Promise<string> {
  const raw = await readFile(path, "utf8");
  const m = raw.match(/^status:\s*(.+)$/m);
  // Tolerate optional YAML quoting ("in progress" vs in progress).
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

describe("MCP createTask honours the requested column", () => {
  it("files an 'in-progress' card into 'in progress', NOT backlog (the reported bug)", async () => {
    const r = await store.createTask({ title: "Buy milk", status: "in-progress", board: "Shopping" });
    expect(r.status).toBe("in progress");
    expect(await statusOf(r.path)).toBe("in progress");
  });

  it("files a second card the same way (both cards, per the report)", async () => {
    const a = await store.createTask({ title: "Card A", status: "in-progress" });
    const b = await store.createTask({ title: "Card B", status: "In Progress" });
    expect(a.status).toBe("in progress");
    expect(b.status).toBe("in progress");
  });

  it("still honours an exact column name", async () => {
    const r = await store.createTask({ title: "Done thing", status: "done" });
    expect(r.status).toBe("done");
  });

  it("falls back to the first column only for a genuinely unknown status", async () => {
    const r = await store.createTask({ title: "Mystery", status: "todo" });
    expect(r.status).toBe("backlog");
  });

  it("updateTask also resolves a hyphenated column", async () => {
    const created = await store.createTask({ title: "Move me", status: "backlog" });
    await store.updateTask(created.path, { status: "in-progress" });
    expect(await statusOf(created.path)).toBe("in progress");
  });
});
