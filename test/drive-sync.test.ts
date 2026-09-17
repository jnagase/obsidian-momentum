import { describe, it, expect } from "vitest";
import {
  decideAction,
  threeWayMerge,
  conflictName,
  DriveBaseline,
} from "../src/driveSync";

// =====================================================================================
// Feature: google-drive-sync-and-browser — sync engine (blocks 4-8)
//
// The safety-critical guarantees: an edit is NEVER lost to a deletion, a two-sided edit
// never silently overwrites, and the mass-change guard blocks a runaway automatic run.
// =====================================================================================

describe("decideAction — the 3-way decision matrix", () => {
  const B: DriveBaseline = { fileId: "f1", md5: "m0", modifiedTime: "t0", base: "base" };

  it("pulls a brand-new remote file (no baseline)", () => {
    expect(decideAction({ localExists: false, remoteExists: true, localChanged: false, remoteChanged: false, mergeable: true }))
      .toBe("pull");
  });

  it("pushes a brand-new local file (no baseline)", () => {
    expect(decideAction({ localExists: true, remoteExists: false, localChanged: true, remoteChanged: false, mergeable: true }))
      .toBe("push");
  });

  it("pulls when only remote changed since baseline", () => {
    expect(decideAction({ base: B, localExists: true, remoteExists: true, localChanged: false, remoteChanged: true, mergeable: true }))
      .toBe("pull");
  });

  it("pushes when only local changed since baseline", () => {
    expect(decideAction({ base: B, localExists: true, remoteExists: true, localChanged: true, remoteChanged: false, mergeable: true }))
      .toBe("push");
  });

  it("merges when both changed and mergeable", () => {
    expect(decideAction({ base: B, localExists: true, remoteExists: true, localChanged: true, remoteChanged: true, mergeable: true }))
      .toBe("merge");
  });

  it("conflicts when both changed and NOT mergeable", () => {
    expect(decideAction({ base: B, localExists: true, remoteExists: true, localChanged: true, remoteChanged: true, mergeable: false }))
      .toBe("conflict");
  });

  it("noops when neither side changed", () => {
    expect(decideAction({ base: B, localExists: true, remoteExists: true, localChanged: false, remoteChanged: false, mergeable: true }))
      .toBe("noop");
  });

  // The safety-critical rows: edit must beat deletion.
  it("remote gone, local unchanged → delete_local (honour the remote deletion)", () => {
    expect(decideAction({ base: B, localExists: true, remoteExists: false, localChanged: false, remoteChanged: false, mergeable: true }))
      .toBe("delete_local");
  });

  it("EDIT BEATS DELETE: remote gone but local CHANGED → push (never lose the local edit)", () => {
    expect(decideAction({ base: B, localExists: true, remoteExists: false, localChanged: true, remoteChanged: false, mergeable: true }))
      .toBe("push");
  });

  it("EDIT BEATS DELETE: local gone but remote CHANGED → pull (never lose the remote edit)", () => {
    expect(decideAction({ base: B, localExists: false, remoteExists: true, localChanged: false, remoteChanged: true, mergeable: true }))
      .toBe("pull");
  });

  it("local gone, remote unchanged → delete_remote (honour the local deletion)", () => {
    expect(decideAction({ base: B, localExists: false, remoteExists: true, localChanged: false, remoteChanged: false, mergeable: true }))
      .toBe("delete_remote");
  });
});

describe("threeWayMerge — conservative, never fabricates", () => {
  it("returns identical content when both sides equal", () => {
    expect(threeWayMerge("a", "x", "x")).toBe("x");
  });
  it("takes remote when only remote changed", () => {
    expect(threeWayMerge("base", "base", "remote")).toBe("remote");
  });
  it("takes local when only local changed", () => {
    expect(threeWayMerge("base", "local", "base")).toBe("local");
  });
  it("returns null (→ conflict) when both changed differently", () => {
    expect(threeWayMerge("base", "local-edit", "remote-edit")).toBeNull();
  });
});

describe("conflictName — .conflict.<ext> with incremental counter", () => {
  it("inserts .conflict before the extension", () => {
    expect(conflictName("note.md", () => false)).toBe("note.conflict.md");
  });
  it("increments when the first is taken", () => {
    const taken = new Set(["note.conflict.md"]);
    expect(conflictName("note.md", (n) => taken.has(n))).toBe("note.conflict-2.md");
  });
});

// ---- mass-change guard ----------------------------------------------------------------

describe("mass-change circuit breaker", () => {
  it("exposes a write limit that 60 pending changes would exceed", async () => {
    const { DRIVE_MAX_WRITES_PER_RUN } = await import("../src/driveSync");
    expect(DRIVE_MAX_WRITES_PER_RUN).toBe(50);
    expect(60).toBeGreaterThan(DRIVE_MAX_WRITES_PER_RUN);
  });
});
