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
  it("remote gone WITH an explicit removal event, local unchanged → delete_local", () => {
    expect(decideAction({ base: B, localExists: true, remoteExists: false, localChanged: false, remoteChanged: false, mergeable: true, remoteDeletedExplicit: true }))
      .toBe("delete_local");
  });

  it("EDIT BEATS DELETE: remote gone but local CHANGED → push (never lose the local edit)", () => {
    expect(decideAction({ base: B, localExists: true, remoteExists: false, localChanged: true, remoteChanged: false, mergeable: true, remoteDeletedExplicit: true }))
      .toBe("push");
  });

  it("EDIT BEATS DELETE: local gone but remote CHANGED → pull (never lose the remote edit)", () => {
    expect(decideAction({ base: B, localExists: false, remoteExists: true, localChanged: false, remoteChanged: true, mergeable: true, localDeletedExplicit: true }))
      .toBe("pull");
  });

  it("local gone WITH explicit local delete, remote unchanged → delete_remote", () => {
    expect(decideAction({ base: B, localExists: false, remoteExists: true, localChanged: false, remoteChanged: false, mergeable: true, localDeletedExplicit: true }))
      .toBe("delete_remote");
  });

  // Deletion is EVENT-DRIVEN, not absence-driven: absence WITHOUT explicit evidence must NEVER
  // delete — it resolves to the safe side (noop / re-pull). This is the fix for files that came
  // back or got deleted on another device that hadn't finished syncing.
  it("remote absent, NO event and NOT authoritative → noop (a partial/incremental view must not delete)", () => {
    expect(decideAction({ base: B, localExists: true, remoteExists: false, localChanged: false, remoteChanged: false, mergeable: true }))
      .toBe("noop");
  });

  it("remote absent on an AUTHORITATIVE full walk → delete_local (real deletion, e.g. a folder trashed on Drive)", () => {
    expect(decideAction({ base: B, localExists: true, remoteExists: false, localChanged: false, remoteChanged: false, mergeable: true, remoteAuthoritative: true }))
      .toBe("delete_local");
  });

  it("EDIT BEATS DELETE even on an authoritative walk: remote absent but local changed → push", () => {
    expect(decideAction({ base: B, localExists: true, remoteExists: false, localChanged: true, remoteChanged: false, mergeable: true, remoteAuthoritative: true }))
      .toBe("push");
  });

  it("local absent but NO local-delete event → pull (re-download; never delete the remote)", () => {
    expect(decideAction({ base: B, localExists: false, remoteExists: true, localChanged: false, remoteChanged: false, mergeable: true }))
      .toBe("pull");
  });

  // First-contact, both exist, no baseline (Req 9.1): identical content is NOT a conflict.
  it("first-contact both-exist, identical content → noop (no false conflict)", () => {
    expect(decideAction({ localExists: true, remoteExists: true, localChanged: false, remoteChanged: false, mergeable: true, contentEqual: true }))
      .toBe("noop");
  });

  it("first-contact both-exist, different content → conflict", () => {
    expect(decideAction({ localExists: true, remoteExists: true, localChanged: true, remoteChanged: false, mergeable: true, contentEqual: false }))
      .toBe("conflict");
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
