import { describe, it, expect, beforeEach, vi } from "vitest";

// =====================================================================================
// Feature: google-drive-isolated-rollout — Bloco G (beta-blockers) + path-based engine.
//
// Integration test of the WHOLE runDriveSync cycle against an in-memory, PARENT-AWARE fake
// Drive (vi.mock of src/googledrive) and a fake VaultFS. Covers:
//   14) first-run content-aware (identical files must NOT conflict)
//   15) binary block-and-warn (never round-trip a .png through TextDecoder)
//   16) configurable conflict strategy (keep-both / local-wins / remote-wins / newer-wins / ask)
//   17) mass-delete guard (withhold over the limit unless confirmed)
//   +  path-based engine: subfolders (create on Drive, recreate locally) via relative paths.
// =====================================================================================

// Shared in-memory Drive (parent-aware), hoisted so the vi.mock factory can close over it.
const D = vi.hoisted(() => {
  interface F {
    id: string; name: string; mimeType: string; content: string;
    md5Checksum: string; modifiedTime: string; size: string; parents: string[]; trashed?: boolean; bin?: Uint8Array;
    appProperties?: Record<string, string>;
  }
  const FOLDER = "application/vnd.google-apps.folder";
  const files = new Map<string, F>();
  let seq = 1;
  const hash = (s: string): string => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return `${s.length}_${h >>> 0}`;
  };
  const hashBuf = (u8: Uint8Array): string => {
    let h = 0;
    for (let i = 0; i < u8.length; i++) h = (h * 31 + u8[i]) | 0;
    return `b${u8.length}_${h >>> 0}`;
  };
  const nextId = (): string => `id${seq++}`;
  const reset = (): void => { files.clear(); seq = 1; };
  const seed = (name: string, content: string, opts: { parent?: string; mimeType?: string; modifiedTime?: string; appProperties?: Record<string, string> } = {}): string => {
    const id = nextId();
    files.set(id, {
      id, name, content,
      mimeType: opts.mimeType ?? "text/plain",
      md5Checksum: hash(content),
      modifiedTime: opts.modifiedTime ?? "2020-01-01T00:00:00.000Z",
      size: String(content.length),
      parents: [opts.parent ?? "root"],
      appProperties: opts.appProperties,
    });
    return id;
  };
  const seedFolder = (name: string, opts: { parent?: string } = {}): string => {
    const id = nextId();
    files.set(id, { id, name, content: "", mimeType: FOLDER, md5Checksum: "", modifiedTime: "2020-01-01T00:00:00.000Z", size: "0", parents: [opts.parent ?? "root"] });
    return id;
  };
  const seedBinary = (name: string, bytes: number[], opts: { parent?: string } = {}): string => {
    const id = nextId();
    const u8 = new Uint8Array(bytes);
    files.set(id, { id, name, content: "", mimeType: "application/octet-stream", md5Checksum: hashBuf(u8), modifiedTime: "2020-01-01T00:00:00.000Z", size: String(u8.length), parents: [opts.parent ?? "root"], bin: u8 });
    return id;
  };
  const live = (): F[] => [...files.values()].filter((f) => !f.trashed);
  const byName = (name: string): F | undefined => live().find((f) => f.name === name);
  const flags = { failSetAppProps: false, bumpMetaMd5: false };
  const reset2 = (): void => { reset(); flags.failSetAppProps = false; flags.bumpMetaMd5 = false; };
  return { files, FOLDER, hash, hashBuf, nextId, reset: reset2, seed, seedFolder, seedBinary, live, byName, flags };
});

vi.mock("../src/googledrive", () => {
  const PREFIX = "application/vnd.google-apps.";
  interface F { id: string; name: string; mimeType: string; content: string; md5Checksum: string; modifiedTime: string; size: string; parents: string[]; trashed?: boolean; bin?: Uint8Array; appProperties?: Record<string, string> }
  const meta = (f: F) => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, md5Checksum: f.md5Checksum, size: f.size, parents: f.parents, trashed: f.trashed, appProperties: f.appProperties });
  return {
    GOOGLE_NATIVE_PREFIX: PREFIX,
    EXPORT_MIME: {},
    listFiles: async (_t: string, opts: { folderId?: string; query?: string } = {}) => {
      let list = D.live();
      if (opts.folderId) list = list.filter((f) => f.parents.includes(opts.folderId as string));
      if (opts.query && opts.query.includes("google-apps.folder")) {
        const m = opts.query.match(/name = '(.*)'/);
        const nm = m ? m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\") : undefined;
        list = list.filter((f) => f.mimeType === D.FOLDER && (nm === undefined || f.name === nm));
      }
      return list.map(meta);
    },
    getFileMeta: async (_t: string, id: string) => {
      const m = meta(D.files.get(id) as F);
      if (D.flags.bumpMetaMd5) m.md5Checksum = `${m.md5Checksum ?? ""}X`; // simulate the remote advancing mid-run
      return m;
    },
    downloadFile: async (_t: string, id: string) => {
      const f = D.files.get(id);
      if (f?.bin) return f.bin.buffer.slice(f.bin.byteOffset, f.bin.byteOffset + f.bin.byteLength);
      return new TextEncoder().encode(f?.content ?? "").buffer;
    },
    exportFile: async () => "",
    mimeForName: () => "application/octet-stream",
    createBinaryFile: async (_t: string, name: string, data: ArrayBuffer, parent?: string, appProperties?: Record<string, string>) => {
      const id = D.nextId();
      const u8 = new Uint8Array(data);
      const f: F = { id, name, mimeType: "application/octet-stream", content: "", md5Checksum: D.hashBuf(u8), modifiedTime: new Date().toISOString(), size: String(u8.length), parents: [parent || "root"], bin: u8, appProperties };
      D.files.set(id, f);
      return meta(f);
    },
    updateBinaryFile: async (_t: string, id: string, data: ArrayBuffer) => {
      const f = D.files.get(id);
      if (!f) throw new Error(`updateBinaryFile: no file ${id}`);
      const u8 = new Uint8Array(data);
      f.bin = u8; f.md5Checksum = D.hashBuf(u8); f.modifiedTime = new Date().toISOString(); f.size = String(u8.length);
      return meta(f);
    },
    createTextFile: async (_t: string, name: string, content: string, parent?: string, appProperties?: Record<string, string>) => {
      const id = D.nextId();
      const f: F = { id, name, mimeType: "text/plain", content, md5Checksum: D.hash(content), modifiedTime: new Date().toISOString(), size: String(content.length), parents: [parent || "root"], appProperties };
      D.files.set(id, f);
      return meta(f);
    },
    setAppProperties: async (_t: string, id: string, appProperties: Record<string, string>) => {
      if (D.flags.failSetAppProps) throw new Error("setAppProperties: simulated transient failure");
      const f = D.files.get(id);
      if (!f) throw new Error(`setAppProperties: no file ${id}`);
      f.appProperties = { ...(f.appProperties ?? {}), ...appProperties };
      return meta(f);
    },
    updateTextFile: async (_t: string, id: string, content: string) => {
      const f = D.files.get(id);
      if (!f) throw new Error(`updateTextFile: no file ${id}`);
      f.content = content; f.md5Checksum = D.hash(content); f.modifiedTime = new Date().toISOString(); f.size = String(content.length);
      return meta(f);
    },
    trashFile: async (_t: string, id: string) => { const f = D.files.get(id); if (f) f.trashed = true; },
    createFolder: async (_t: string, name: string, parent?: string) => {
      const id = D.nextId();
      const f: F = { id, name, mimeType: D.FOLDER, content: "", md5Checksum: "", modifiedTime: new Date().toISOString(), size: "0", parents: [parent || "root"] };
      D.files.set(id, f);
      return meta(f);
    },
    findChildFolder: async (_t: string, name: string, parent: string) =>
      D.live().find((f) => f.mimeType === D.FOLDER && f.name === name && f.parents.includes(parent))?.id,
    getStartPageToken: async () => "cursor-1",
    listChanges: async () => ({ changes: [], newStartPageToken: "cursor-1" }),
    isFolder: (f: F) => f.mimeType === D.FOLDER,
    isGoogleNative: (f: F) => typeof f.mimeType === "string" && f.mimeType.startsWith(PREFIX),
  };
});

import { runDriveSync, DriveBaseline, DriveBaselineStore, VaultFS, DriveConflictStrategy } from "../src/driveSync";

function makeVault(init: Record<string, string> = {}, binInit: Record<string, number[]> = {}) {
  const map = new Map(Object.entries(init));
  const mtimes = new Map<string, number>();
  const bin = new Map<string, Uint8Array>(Object.entries(binInit).map(([k, v]) => [k, new Uint8Array(v)]));
  const fs: VaultFS = {
    list: async () => [...new Set([...map.keys(), ...bin.keys()])],
    read: async (n) => map.get(n) ?? "",
    write: async (n, c) => { map.set(n, c); mtimes.set(n, Date.now()); },
    exists: async (n) => map.has(n) || bin.has(n),
    trash: async (n) => { map.delete(n); bin.delete(n); },
    mtime: async (n) => mtimes.get(n) ?? 0,
    readBinary: async (n) => { const u = bin.get(n) ?? new Uint8Array(0); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); },
    writeBinary: async (n, data) => { bin.set(n, new Uint8Array(data)); mtimes.set(n, Date.now()); },
  };
  return { fs, map, mtimes, bin };
}

function makeBaselines(seed: Record<string, DriveBaseline> = {}, localDeletes: Record<string, number> = {}) {
  const m = new Map(Object.entries(seed));
  const ld = new Map<string, number>(Object.entries(localDeletes));
  const declined = new Map<string, string>();
  let cursor: string | undefined;
  const store: DriveBaselineStore = {
    get: (n) => m.get(n),
    set: (n, b) => { m.set(n, b); },
    remove: (n) => { m.delete(n); },
    names: () => [...m.keys()],
    getCursor: () => cursor,
    setCursor: (t) => { cursor = t; },
    save: async () => {},
    getLocalDeletes: () => Object.fromEntries(ld),
    clearLocalDelete: (n) => { ld.delete(n); },
    getDeclined: () => Object.fromEntries(declined),
    setDeclined: (n, sig) => { declined.set(n, sig); },
    clearDeclined: (n) => { declined.delete(n); },
  };
  return { store, m, ld, declined };
}

const run = (fs: VaultFS, baselines: DriveBaselineStore, extra: Partial<Parameters<typeof runDriveSync>[0]> = {}) =>
  runDriveSync({ token: "tok", fs, baselines, confirmed: true, ...extra });

beforeEach(() => D.reset());

describe("runDriveSync — core push/pull", () => {
  it("pushes a brand-new local file up to Drive", async () => {
    const v = makeVault({ "a.md": "hello" });
    const b = makeBaselines();
    const r = await run(v.fs, b.store);
    expect(r.pushed).toBe(1);
    expect(D.byName("a.md")?.content).toBe("hello");
    expect(b.m.get("a.md")?.fileId).toBeTruthy();
  });

  it("pulls a brand-new remote file into the vault", async () => {
    D.seed("b.md", "from drive");
    const v = makeVault();
    const b = makeBaselines();
    const r = await run(v.fs, b.store);
    expect(r.pulled).toBe(1);
    expect(v.map.get("b.md")).toBe("from drive");
  });
});

describe("path-based engine — subfolders", () => {
  it("pulls a remote file that lives in a subfolder, preserving the relative path", async () => {
    const sub = D.seedFolder("notes");
    D.seed("deep.md", "nested", { parent: sub });
    const v = makeVault();
    const b = makeBaselines();
    const r = await run(v.fs, b.store);
    expect(r.pulled).toBe(1);
    expect(v.map.get("notes/deep.md")).toBe("nested");
    expect(b.m.get("notes/deep.md")).toBeTruthy();
  });

  it("pushes a local file in a subfolder, creating the folder chain on Drive", async () => {
    const v = makeVault({ "proj/sub/y.md": "body" });
    const b = makeBaselines();
    const r = await run(v.fs, b.store);
    expect(r.pushed).toBe(1);
    const file = D.byName("y.md");
    expect(file?.content).toBe("body");
    // Its parent must be the "sub" folder, whose parent is "proj" under root.
    const sub = D.live().find((f) => f.mimeType === D.FOLDER && f.name === "sub");
    const proj = D.live().find((f) => f.mimeType === D.FOLDER && f.name === "proj");
    expect(sub && file?.parents.includes(sub.id)).toBeTruthy();
    expect(proj && sub?.parents.includes(proj.id)).toBeTruthy();
  });
});

describe("first-run content-aware (Req 9.1, task 14)", () => {
  it("adopts identical files as baseline — NO spurious .conflict", async () => {
    D.seed("c.md", "same text");
    const v = makeVault({ "c.md": "same text" });
    const b = makeBaselines();
    const r = await run(v.fs, b.store);
    expect(r.conflicted).toBe(0);
    expect(r.pushed).toBe(0);
    expect(r.pulled).toBe(0);
    expect(v.map.has("c.conflict.md")).toBe(false);
    expect(b.m.get("c.md")).toBeTruthy();
  });

  it("conflicts when first-contact content differs (keep-both default)", async () => {
    D.seed("d.md", "REMOTE version");
    const v = makeVault({ "d.md": "LOCAL version" });
    const b = makeBaselines();
    const r = await run(v.fs, b.store);
    expect(r.conflicted).toBe(1);
    expect(v.map.get("d.md")).toBe("LOCAL version");
    expect(v.map.get("d.conflict.md")).toBe("REMOTE version");
  });
});

describe("binary block-and-warn (Req 9.5, task 15)", () => {
  it("skips a new remote binary instead of corrupting it", async () => {
    D.seed("pic.png", "\u0000\u0001binary", { mimeType: "image/png" });
    const v = makeVault();
    const b = makeBaselines();
    const r = await run(v.fs, b.store);
    expect(r.skippedBinary).toBe(1);
    expect(r.pulled).toBe(0);
    expect(v.map.has("pic.png")).toBe(false);
  });
});

describe("binary sync (opt-in, task 21)", () => {
  it("blocks-and-warns binaries when syncBinaries is off (default)", async () => {
    const v = makeVault({}, { "img.png": [1, 2, 3, 4] });
    const b = makeBaselines();
    const r = await run(v.fs, b.store); // syncBinaries defaults off
    expect(r.pushed).toBe(0);
    expect(r.skippedBinary).toBe(1);
    expect(D.byName("img.png")).toBeUndefined();
  });

  it("pushes a local binary when syncBinaries is on", async () => {
    const v = makeVault({}, { "img.png": [1, 2, 3, 4] });
    const b = makeBaselines();
    const r = await run(v.fs, b.store, { syncBinaries: true });
    expect(r.pushed).toBe(1);
    expect(r.skippedBinary).toBe(0);
    expect(D.byName("img.png")?.size).toBe("4");
  });

  it("pulls a remote binary when syncBinaries is on", async () => {
    D.seedBinary("photo.jpg", [9, 8, 7]);
    const v = makeVault();
    const b = makeBaselines();
    const r = await run(v.fs, b.store, { syncBinaries: true });
    expect(r.pulled).toBe(1);
    expect([...(v.bin.get("photo.jpg") ?? [])]).toEqual([9, 8, 7]);
  });
});

describe("configurable conflict strategy (Req 9.2, task 16)", () => {
  const setup = () => {
    D.seed("e.md", "REMOTE", { modifiedTime: "2020-01-01T00:00:00.000Z" });
    const v = makeVault({ "e.md": "LOCAL" });
    v.mtimes.set("e.md", Date.parse("2024-01-01T00:00:00.000Z")); // local newer
    return { v, b: makeBaselines() };
  };

  it("local-wins overwrites the remote with the local content", async () => {
    const { v, b } = setup();
    const r = await run(v.fs, b.store, { conflictStrategy: "local-wins" });
    expect(r.conflicted).toBe(0);
    expect(r.pushed).toBe(1);
    expect(D.byName("e.md")?.content).toBe("LOCAL");
    expect(v.map.has("e.conflict.md")).toBe(false);
  });

  it("remote-wins overwrites the local with the remote content", async () => {
    const { v, b } = setup();
    const r = await run(v.fs, b.store, { conflictStrategy: "remote-wins" });
    expect(r.pulled).toBe(1);
    expect(v.map.get("e.md")).toBe("REMOTE");
  });

  it("newer-wins keeps the side with the newer timestamp (local here)", async () => {
    const { v, b } = setup();
    const r = await run(v.fs, b.store, { conflictStrategy: "newer-wins" });
    expect(r.pushed).toBe(1);
    expect(D.byName("e.md")?.content).toBe("LOCAL");
  });

  it("ask uses the resolver callback (choose remote)", async () => {
    const { v, b } = setup();
    const r = await run(v.fs, b.store, { conflictStrategy: "ask", resolveConflict: async () => "remote" });
    expect(r.pulled).toBe(1);
    expect(v.map.get("e.md")).toBe("REMOTE");
  });
});

describe("mass-delete guard (Req 9.7, task 17)", () => {
  const setupDeletions = (count: number) => {
    const baseSeed: Record<string, DriveBaseline> = {};
    const localDeletes: Record<string, number> = {};
    for (let i = 0; i < count; i++) {
      const content = `file ${i}`;
      const name = `del${i}.md`;
      const id = D.seed(name, content);
      baseSeed[name] = { fileId: id, md5: D.hash(content), modifiedTime: "2020-01-01T00:00:00.000Z", base: content };
      // Deletion is now event-driven: the local files were explicitly deleted by the user, which
      // is the evidence that turns their absence into a real delete_remote (not a re-pull).
      localDeletes[name] = Date.now();
    }
    return { v: makeVault(), b: makeBaselines(baseSeed, localDeletes) };
  };

  it("withholds deletions over the limit when not confirmed", async () => {
    const { v, b } = setupDeletions(12);
    const r = await run(v.fs, b.store, { confirmDelete: async () => false });
    expect(r.deletedRemote).toBe(0);
    expect(r.blocked).toBe(12);
    expect(D.live().length).toBe(12);
  });

  it("performs the deletions when the guard is confirmed", async () => {
    const { v, b } = setupDeletions(12);
    const r = await run(v.fs, b.store, { confirmDelete: async () => true });
    expect(r.deletedRemote).toBe(12);
    expect(D.live().length).toBe(0);
  });

  it("does not trigger the guard below the limit", async () => {
    const { v, b } = setupDeletions(3);
    const declineSpy = vi.fn(async () => false);
    const r = await run(v.fs, b.store, { confirmDelete: declineSpy });
    expect(declineSpy).not.toHaveBeenCalled();
    expect(r.deletedRemote).toBe(3);
  });
});

describe("event-driven deletion — absence is never proof (anti-resurrection)", () => {
  it("remote missing from the listing but with NO removal event → keeps the local file", async () => {
    // Baseline exists (synced before), local file present & unchanged, but the remote isn't in
    // the tree this run and no Changes event reported it removed → must NOT delete locally.
    const v = makeVault({ "keep.md": "still here" });
    const b = makeBaselines({ "keep.md": { fileId: "ghost", md5: D.hash("still here"), modifiedTime: "2020-01-01T00:00:00.000Z", base: "still here" } });
    const r = await run(v.fs, b.store, { confirmDelete: async () => true });
    expect(r.deletedLocal).toBe(0);
    expect(v.map.get("keep.md")).toBe("still here");
  });

  it("local missing with NO explicit local delete → re-pulls instead of deleting the remote", async () => {
    // Remote present & unchanged, baseline exists, but the vault doesn't have it and the user
    // didn't delete it here (empty localDeletes) → treat as not-yet-downloaded → re-pull.
    const id = D.seed("back.md", "from drive");
    const v = makeVault();
    const b = makeBaselines({ "back.md": { fileId: id, md5: D.hash("from drive"), modifiedTime: "2020-01-01T00:00:00.000Z", base: "from drive" } });
    const r = await run(v.fs, b.store, { confirmDelete: async () => true });
    expect(r.deletedRemote).toBe(0);
    expect(r.pulled).toBe(1);
    expect(v.map.get("back.md")).toBe("from drive");
    expect(D.byName("back.md")).toBeTruthy();
  });
});

describe("stable identity via appProperties.momentumPath (Req 2, Phase 5)", () => {
  it("a file renamed on Drive is mirrored into the vault (move, not duplicate)", async () => {
    // Drive file's tree name is "renamed.md" but it still carries momentumPath "note.md" (it was
    // renamed on Drive). Drive is the source of truth → the vault follows: note.md becomes
    // renamed.md, no duplicate, and the Drive tag is realigned to the new path.
    const id = D.seed("renamed.md", "content", { appProperties: { momentumPath: "note.md" } });
    const v = makeVault({ "note.md": "content" });
    const b = makeBaselines({ "note.md": { fileId: id, md5: D.hash("content"), modifiedTime: "2020-01-01T00:00:00.000Z", base: "content", tagged: true } });
    const r = await run(v.fs, b.store, { deviceId: "dev-1" });
    expect(v.map.has("note.md")).toBe(false);            // old local name gone
    expect(v.map.get("renamed.md")).toBe("content");     // moved to the new name
    expect(b.m.has("note.md")).toBe(false);              // baseline rekeyed
    expect(b.m.get("renamed.md")?.fileId).toBe(id);
    expect(D.files.get(id)?.appProperties?.momentumPath).toBe("renamed.md"); // Drive tag realigned
    expect(r.conflicted).toBe(0);
  });

  it("mirrors a Drive rename AND pulls the new content when it also changed", async () => {
    // The file was renamed on Drive AND its content changed. The vault should end up at the new
    // path with the new content (rekeyed baseline keeps the old md5, so the loop pulls).
    const id = D.seed("renamed.md", "NEW BODY", { appProperties: { momentumPath: "note.md" } });
    const v = makeVault({ "note.md": "OLD BODY" });
    const b = makeBaselines({ "note.md": { fileId: id, md5: D.hash("OLD BODY"), modifiedTime: "2020-01-01T00:00:00.000Z", base: "OLD BODY", tagged: true } });
    const r = await run(v.fs, b.store, { deviceId: "dev-1" });
    expect(v.map.has("note.md")).toBe(false);
    expect(v.map.get("renamed.md")).toBe("NEW BODY");
    expect(r.pulled).toBe(1);
  });

  it("stamps momentumPath on a newly pushed file", async () => {
    const v = makeVault({ "fresh.md": "hi" });
    const b = makeBaselines();
    await run(v.fs, b.store, { deviceId: "dev-1" });
    const f = D.byName("fresh.md");
    expect(f?.appProperties?.momentumPath).toBe("fresh.md");
    expect(f?.appProperties?.momentumOrigin).toBe("dev-1");
    expect(b.m.get("fresh.md")?.tagged).toBe(true);
  });

  it("a Drive rename whose tag-realign fails is deferred (no duplicate), then completes next run", async () => {
    const id = D.seed("renamed.md", "content", { appProperties: { momentumPath: "note.md" } });
    const v = makeVault({ "note.md": "content" });
    const b = makeBaselines({ "note.md": { fileId: id, md5: D.hash("content"), modifiedTime: "2020-01-01T00:00:00.000Z", base: "content", tagged: true } });
    D.flags.failSetAppProps = true;
    await run(v.fs, b.store, { deviceId: "dev-1" });
    // No duplicate: at most one of the two endpoints exists locally, and the baseline stayed at
    // the old path so the move is retried (not lost).
    expect([...v.map.keys()].filter((n) => n === "note.md" || n === "renamed.md").length).toBeLessThanOrEqual(1);
    expect(b.m.has("note.md")).toBe(true);
    // Next run (failure cleared) completes the move.
    D.flags.failSetAppProps = false;
    await run(v.fs, b.store, { deviceId: "dev-1" });
    expect(v.map.get("renamed.md")).toBe("content");
    expect(v.map.has("note.md")).toBe(false);
    expect(b.m.get("renamed.md")?.fileId).toBe(id);
    expect(b.m.has("note.md")).toBe(false);
  });

  it("lost-update guard: skips the overwrite when the remote advanced during the run", async () => {
    const id = D.seed("note.md", "v1", { appProperties: { momentumPath: "note.md" } });
    const v = makeVault({ "note.md": "v2" }); // local edited since baseline
    const b = makeBaselines({ "note.md": { fileId: id, md5: D.hash("v1"), modifiedTime: "2020-01-01T00:00:00.000Z", base: "v1", tagged: true } });
    D.flags.bumpMetaMd5 = true; // getFileMeta reports a different md5 than the walk → remote moved mid-run
    const r = await run(v.fs, b.store);
    expect(r.pushed).toBe(0);
    expect(D.byName("note.md")?.content).toBe("v1"); // NOT clobbered with v2
    expect(r.issues.some((i) => i.reason.includes("push skipped"))).toBe(true);
  });

  it("removes an identical duplicate without creating a .conflict copy", async () => {
    const older = D.seed("dup.md", "SAME", { appProperties: { momentumPath: "dup.md" }, modifiedTime: "2020-01-01T00:00:00.000Z" });
    D.seed("dup.md", "SAME", { appProperties: { momentumPath: "dup.md" }, modifiedTime: "2024-01-01T00:00:00.000Z" });
    const v = makeVault();
    const b = makeBaselines();
    await run(v.fs, b.store);
    expect(D.files.get(older)?.trashed).toBe(true);
    expect(v.map.has("dup.conflict.md")).toBe(false); // identical → no .conflict noise
    expect(v.map.get("dup.md")).toBe("SAME");
  });

  it("consolidates two Drive files sharing the same momentumPath — keeps newest, saves loser as .conflict", async () => {
    const older = D.seed("dup.md", "OLDER", { appProperties: { momentumPath: "dup.md" }, modifiedTime: "2020-01-01T00:00:00.000Z" });
    const newer = D.seed("dup.md", "NEWER", { appProperties: { momentumPath: "dup.md" }, modifiedTime: "2024-01-01T00:00:00.000Z" });
    const v = makeVault();
    const b = makeBaselines();
    const r = await run(v.fs, b.store);
    expect(D.files.get(older)?.trashed).toBe(true);   // loser trashed on Drive
    expect(D.files.get(newer)?.trashed).toBeFalsy();  // newest kept
    expect(v.map.get("dup.conflict.md")).toBe("OLDER"); // loser content preserved locally
    expect(v.map.get("dup.md")).toBe("NEWER");          // canonical pulled
    expect(r.conflicted).toBeGreaterThanOrEqual(1);
  });
});

describe("local rename is a move, not a duplicate (Phase 5)", () => {
  it("old path (explicitly deleted by the rename) is removed on Drive; new path is pushed", async () => {
    const id = D.seed("old.md", "body", { appProperties: { momentumPath: "old.md" } });
    const v = makeVault({ "new.md": "body" }); // the file now lives under the new name locally
    const b = makeBaselines(
      { "old.md": { fileId: id, md5: D.hash("body"), modifiedTime: "2020-01-01T00:00:00.000Z", base: "body", tagged: true } },
      { "old.md": Date.now() }, // the rename recorded old.md as an explicit local deletion
    );
    const r = await run(v.fs, b.store);
    expect(r.deletedRemote).toBe(1);          // old.md trashed on Drive
    expect(D.files.get(id)?.trashed).toBe(true);
    expect(r.pushed).toBe(1);                 // new.md uploaded
    expect(D.byName("new.md")?.content).toBe("body");
  });
});

describe("strategy typing sanity", () => {
  it("accepts every documented strategy value", () => {
    const all: DriveConflictStrategy[] = ["keep-both", "local-wins", "remote-wins", "newer-wins", "ask"];
    expect(all).toHaveLength(5);
  });
});
