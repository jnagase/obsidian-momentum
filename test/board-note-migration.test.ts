// End-to-end check of the folder-per-board → board-note consolidation (src/data.ts
// migrateToBoardNotes), which 0.9.2 runs automatically for every user on upgrade.
// Uses a small in-memory vault so the real store code runs unchanged.
import { describe, it, expect, beforeEach } from "vitest";
import { parse as parseYaml } from "yaml";
import { TFile, TFolder } from "obsidian";
import { PADataStore, setDataRoot } from "../src/data";

const ROOT = "Momentum Life";

/** Minimal in-memory Obsidian vault: files are the source of truth, tree objects are rebuilt per call. */
class FakeVault {
  files = new Map<string, string>();
  folders = new Set<string>();
  trashed: string[] = [];

  private addParents(p: string): void {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) this.folders.add(parts.slice(0, i).join("/"));
  }
  put(p: string, content: string): void { this.addParents(p); this.files.set(p, content); }

  private folderObj(p: string): TFolder {
    const f = new TFolder();
    f.path = p;
    f.name = p.split("/").pop() ?? "";
    const prefix = p ? `${p}/` : "";
    const direct = (x: string) => x.startsWith(prefix) && !x.slice(prefix.length).includes("/");
    f.children = [
      ...[...this.folders].filter(direct).map((d) => this.folderObj(d)),
      ...[...this.files.keys()].filter(direct).map((x) => this.fileObj(x)),
    ];
    return f;
  }
  private fileObj(p: string): TFile {
    const f = new TFile();
    f.path = p;
    f.name = p.split("/").pop() ?? "";
    const dot = f.name.lastIndexOf(".");
    f.basename = dot > 0 ? f.name.slice(0, dot) : f.name;
    f.extension = dot > 0 ? f.name.slice(dot + 1) : "";
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    f.parent = Object.assign(new TFolder(), { path: dir, name: dir.split("/").pop() ?? "" });
    return f;
  }

  app() {
    const get = (p: string): TFile | TFolder | null =>
      this.files.has(p) ? this.fileObj(p) : this.folders.has(p) ? this.folderObj(p) : null;
    const vault = {
      getAbstractFileByPath: get,
      getMarkdownFiles: () => [...this.files.keys()].filter((p) => p.endsWith(".md")).map((p) => this.fileObj(p)),
      read: async (f: TFile) => this.files.get(f.path) ?? "",
      cachedRead: async (f: TFile) => this.files.get(f.path) ?? "",
      create: async (p: string, c: string) => { this.put(p, c); return this.fileObj(p); },
      modify: async (f: TFile, c: string) => { this.files.set(f.path, c); },
      process: async (f: TFile, fn: (s: string) => string) => { const n = fn(this.files.get(f.path) ?? ""); this.files.set(f.path, n); return n; },
      createFolder: async (p: string) => { this.addParents(`${p}/x`); },
    };
    const fileManager = {
      trashFile: async (f: TFile | TFolder) => {
        this.trashed.push(f.path);
        if (this.files.has(f.path)) this.files.delete(f.path);
        else this.folders.delete(f.path);
      },
    };
    const metadataCache = {
      getFileCache: (f: TFile) => {
        const raw = this.files.get(f.path) ?? "";
        const m = /^---\n([\s\S]*?)\n---/.exec(raw);
        if (!m) return null;
        try { return { frontmatter: parseYaml(m[1]) as Record<string, unknown> }; } catch { return { frontmatter: undefined }; }
      },
    };
    return { vault, fileManager, metadataCache } as unknown as ConstructorParameters<typeof PADataStore>[0];
  }
}

const task = (fm: Record<string, unknown>) =>
  ["---", ...Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), "---", "", "notes"].join("\n");

const tasksArray = (raw: string): Record<string, unknown>[] => {
  const m = /^tasks:\s*(.*)$/m.exec(raw);
  return m ? (JSON.parse(m[1]) as Record<string, unknown>[]) : [];
};

describe("migrateToBoardNotes (0.9.2 default upgrade)", () => {
  let v: FakeVault;
  let store: PADataStore;

  beforeEach(() => {
    setDataRoot(ROOT);
    v = new FakeVault();
    v.put(`${ROOT}/Tasks/My Tasks/Pay rent.md`, task({ type: "task", task_id: "t1", title: "Pay rent", status: "todo", google_id: "g-1", google_list: "@default" }));
    v.put(`${ROOT}/Tasks/Work/Ship release.md`, task({ type: "task", task_id: "t2", title: "Ship release", status: "done", priority: "high", due: "2026-11-12" }));
    v.put(`${ROOT}/Tasks/Work/No id yet.md`, task({ type: "task", title: "No id yet" }));
    v.put(`${ROOT}/Tasks/Work/diagram.png`, "binary");                       // not a task → must stay
    v.put(`${ROOT}/Tasks/Work/Ship release.conflict.md`, "sync conflict copy"); // skipped by the loader → must stay
    v.put(`${ROOT}/Tasks/Lists/Work.md`, "- [ ] mirror");                     // generated mirror → trashed
    v.put(`${ROOT}/Tasks/_orphaned/Old.md`, task({ type: "task", title: "Old" })); // archive → untouched
    store = new PADataStore(v.app());
    store.boardNoteTasks = true;
  });

  it("consolidates every board and keeps ids", async () => {
    const n = await store.migrateToBoardNotes();
    expect(n).toBe(3);

    const my = v.files.get(`${ROOT}/Tasks/My Tasks.md`) ?? "";
    const work = v.files.get(`${ROOT}/Tasks/Work.md`) ?? "";
    expect(my).toContain('type: "task-board"');
    const myTasks = tasksArray(my);
    expect(myTasks).toHaveLength(1);
    expect(myTasks[0]).toMatchObject({ task_id: "t1", title: "Pay rent", google_id: "g-1", google_list: "@default" });

    const workTasks = tasksArray(work);
    expect(workTasks.map((t) => t.title).sort()).toEqual(["No id yet", "Ship release"]);
    expect(workTasks.find((t) => t.title === "Ship release")).toMatchObject({ task_id: "t2", status: "done", priority: "high", due: "2026-11-12" });
    expect(workTasks.find((t) => t.title === "No id yet")?.task_id).toBeTruthy();
  });

  it("trashes only what was consolidated", async () => {
    await store.migrateToBoardNotes();
    expect(v.files.has(`${ROOT}/Tasks/My Tasks/Pay rent.md`)).toBe(false);
    expect(v.files.has(`${ROOT}/Tasks/Work/Ship release.md`)).toBe(false);
    expect(v.files.has(`${ROOT}/Tasks/Work/No id yet.md`)).toBe(false);
    expect(v.files.has(`${ROOT}/Tasks/Lists/Work.md`)).toBe(false);
    // Not tasks → kept, and their folder survives because it isn't empty.
    expect(v.files.has(`${ROOT}/Tasks/Work/diagram.png`)).toBe(true);
    expect(v.files.has(`${ROOT}/Tasks/Work/Ship release.conflict.md`)).toBe(true);
    expect(v.folders.has(`${ROOT}/Tasks/Work`)).toBe(true);
    // Emptied board folder goes to trash; the archive is never touched.
    expect(v.folders.has(`${ROOT}/Tasks/My Tasks`)).toBe(false);
    expect(v.files.has(`${ROOT}/Tasks/_orphaned/Old.md`)).toBe(true);
    // Nothing is hard-deleted: every removal went through the trash.
    expect(v.trashed.every((p) => p.startsWith(`${ROOT}/Tasks/`))).toBe(true);
  });

  it("is idempotent: a second run changes nothing", async () => {
    await store.migrateToBoardNotes();
    const before = new Map(v.files);
    const n = await store.migrateToBoardNotes();
    expect(n).toBe(0);
    expect(v.files).toEqual(before);
  });

  it("merges into an existing board note instead of overwriting it", async () => {
    v.put(`${ROOT}/Tasks/Work.md`, ["---", 'type: "task-board"', 'board: "Work"',
      `tasks: ${JSON.stringify([{ task_id: "t9", title: "Already here", status: "todo" }])}`, "---", ""].join("\n"));
    await store.migrateToBoardNotes();
    const titles = tasksArray(v.files.get(`${ROOT}/Tasks/Work.md`) ?? "").map((t) => t.title).sort();
    expect(titles).toEqual(["Already here", "No id yet", "Ship release"]);
  });
});
