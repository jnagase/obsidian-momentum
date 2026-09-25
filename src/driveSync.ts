import {
  DriveFile,
  listFiles,
  downloadFile,
  createTextFile,
  updateTextFile,
  createBinaryFile,
  updateBinaryFile,
  trashFile,
  createFolder,
  findChildFolder,
  getStartPageToken,
  listChanges,
  setAppProperties,
  InvalidDriveCursorError,
  isFolder,
  isGoogleNative,
} from "./googledrive";

/** appProperties key holding a file's stable logical identity (its vault-relative path at the
 *  time it was written). Lets a file renamed/moved on Drive stay the SAME file, not a duplicate. */
export const MOMENTUM_PATH_KEY = "momentumPath";
/** appProperties key recording which device first created the file (diagnostics for dup races). */
export const MOMENTUM_ORIGIN_KEY = "momentumOrigin";

/** FNV-1a hash over raw bytes — a fast, non-cryptographic content fingerprint for binary files
 *  (used only to detect local-side changes against the last-synced baseline). */
function hashBytes(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return `${b.length}_${(h >>> 0).toString(16)}`;
}

// ============================================================================================
// Drive sync engine — the bidirectional motor for a Drive folder ⇄ a vault mirror folder.
//
// It mirrors the proven idioms of gtSync.ts:
//   - a per-file BASELINE (last-synced snapshot) is the third leg of a 3-way decision;
//   - a mass-change CIRCUIT BREAKER blocks an automatic run with too many writes;
//   - deletion is SAFE: an edit always beats a deletion, and removals are soft (trash).
// It adds the Drive-specific delta primitive: the Changes API cursor (startPageToken), advanced
// only on a clean cycle (atomic commit), so an interrupted run re-observes instead of corrupting.
//
// The engine is filesystem-agnostic: it talks to the vault through the VaultFS port, so it can
// be unit-tested with an in-memory fake (see test/drive-sync.test.ts).
// ============================================================================================

/** Above this many pending writes an unconfirmed (automatic) run is blocked. */
export const DRIVE_MAX_WRITES_PER_RUN = 50;

/**
 * Above this many DELETIONS in one cycle the run abstains (or asks, when a confirm callback is
 * given). This is a SEPARATE guard from the write circuit breaker: a bulk deletion is far more
 * dangerous than a bulk edit, and a sync/load glitch (a device that hasn't finished downloading)
 * can look like a mass deletion. Mirrors rclone's `--max-delete`.
 */
export const DRIVE_MAX_DELETES_PER_RUN = 10;

/** Max multi-device duplicate files consolidated (loser saved as .conflict, then trashed on
 *  Drive) in a single cycle — a safety cap so a pathological state can't cause a trash storm. */
export const DRIVE_MAX_CONSOLIDATE_PER_RUN = 20;

/** Text extensions eligible for line-level 3-way merge. Others conflict-duplicate instead. */
const MERGEABLE_EXT = new Set(["md", "txt", "csv", "json", "canvas", "css", "js", "ts", "yaml", "yml"]);
/** Max size (bytes) eligible for merge. */
const MERGE_MAX_BYTES = 1_048_576;

/**
 * Extensions the engine is willing to move as text. Anything outside this set is treated as
 * BINARY and — for the beta — skipped with a warning rather than round-tripped through
 * `TextDecoder`/`text` upload, which would silently corrupt it (Req 9.5). Real binary media
 * upload/download is a post-beta task; until then "block-and-warn" is the safe contract.
 */
const TEXT_EXT = new Set([
  ...MERGEABLE_EXT,
  "html", "htm", "xml", "svg", "markdown", "mdx", "log", "text", "tsv",
  "toml", "ini", "conf", "env", "gitignore", "list", "org", "rst", "tex",
]);

/** True when a file name is NOT a known text type (→ treat as binary for the beta). */
export function isBinaryName(name: string): boolean {
  const ext = extOf(name);
  return ext === "" || !TEXT_EXT.has(ext);
}

/**
 * Progress ticks for the UI. A sync moves through phases: `scanning` (list/compare the remote —
 * the long part of a full run; `incremental:true` means the fast change-check path was taken),
 * `planning` (deciding each file, may download for first-contact compares) and `applying`
 * (executing the planned writes). `done`/`total` are per-phase (total 0 = indeterminate).
 */
export interface DriveProgress {
  phase: "scanning" | "planning" | "applying";
  done: number;
  total: number;
  incremental?: boolean;
  /** The vault-relative path being examined/applied this tick (lets the UI colour per folder). */
  path?: string;
  /** Why a requested incremental sync fell back to a full scan (e.g. "3 changes on Drive",
   *  "first full sync") — shown in the scanning label so it isn't confusing. */
  reason?: string;
}

/** The conflict-resolution strategy applied when both sides diverged (Req 9.2). */
export type DriveConflictStrategy =
  | "keep-both"    // default: keep local, save the remote alongside as a .conflict copy
  | "local-wins"   // local content wins; push it over the remote
  | "remote-wins"  // remote content wins; pull it over the local
  | "newer-wins"   // whichever side has the newer modified time wins
  | "ask";         // ask the user per file (via a callback); falls back to keep-both

// Drive is the source of truth. The default resolves a two-sided conflict by the shared clock
// (Drive's modifiedTime): whoever wrote last wins. keep-both is still available for users who
// prefer to never drop either side (it saves a .conflict copy instead).
export const DEFAULT_CONFLICT_STRATEGY: DriveConflictStrategy = "newer-wins";

/** Per-file resolution the `ask` strategy returns. */
export type ConflictChoice = "local" | "remote" | "both";

/** Per-file last-synced snapshot. `md5` is Drive's md5Checksum at last sync; content is the merge base. */
export interface DriveBaseline {
  fileId: string;
  md5: string;
  modifiedTime: string;
  /** Last-synced text content, the base for 3-way merge (only kept for mergeable text). */
  base?: string;
  /** True once the Drive file carries its `momentumPath` appProperty (so we don't re-stamp it). */
  tagged?: boolean;
}

/** Persistence for Drive baselines + the change cursor (backed by data.json). */
export interface DriveBaselineStore {
  get(name: string): DriveBaseline | undefined;
  set(name: string, b: DriveBaseline): void;
  remove(name: string): void;
  names(): string[];
  getCursor(): string | undefined;
  setCursor(token: string): void;
  save(): Promise<void>;
  /**
   * Paths the user explicitly deleted locally since the last sync (path → timestamp ms). This is
   * the evidence that turns a local absence into a real `delete_remote` (Req 1.2). Optional so the
   * in-memory test store can omit it (deletions then only propagate from explicit remote events).
   */
  getLocalDeletes?: () => Record<string, number>;
  clearLocalDelete?: (name: string) => void;
  /**
   * Declined-deletion tombstones (path → situation signature). When the user declines a mass
   * deletion, the same deletions are suppressed next run so we stop re-prompting (Req 3). Cleared
   * when the situation changes or the user later accepts. Optional (see above).
   */
  getDeclined?: () => Record<string, string>;
  setDeclined?: (name: string, sig: string) => void;
  clearDeclined?: (name: string) => void;
}

/** The minimal vault surface the engine needs — real impl wraps Obsidian's Vault. */
export interface VaultFS {
  /** List file names directly under the mirror dir. */
  list(): Promise<string[]>;
  read(name: string): Promise<string>;
  write(name: string, content: string): Promise<void>;
  exists(name: string): Promise<boolean>;
  /** Soft-delete locally (move to a .trash or Obsidian trash). */
  trash(name: string): Promise<void>;
  /** Local last-modified time in ms (optional — enables the `newer-wins` conflict strategy). */
  mtime?(name: string): Promise<number>;
  /** Read raw bytes (optional — required for real binary sync). */
  readBinary?(name: string): Promise<ArrayBuffer>;
  /** Write raw bytes, creating subfolders as needed (optional — required for real binary sync). */
  writeBinary?(name: string, data: ArrayBuffer): Promise<void>;
}

/** Per-file outcome bucket, so the status panel can show WHICH files fell into each pill. */
export type DriveIssueCategory = "held" | "skipped" | "error" | "conflict" | "deleted";
export interface DriveIssue { path: string; reason: string; category: DriveIssueCategory }

export interface DriveSyncResult {
  pushed: number;
  pulled: number;
  merged: number;
  conflicted: number;
  deletedLocal: number;
  deletedRemote: number;
  blocked: number;
  /** Binary/non-text files skipped this cycle (block-and-warn, Req 9.5). */
  skippedBinary: number;
  errors: string[];
  notes: string[];
  /** Per-file outcomes worth surfacing (held / skipped / error / conflict / deleted), with the
   *  reason and category — powers the clickable status pills + per-file table. */
  issues: DriveIssue[];
}

function emptyResult(): DriveSyncResult {
  return {
    pushed: 0, pulled: 0, merged: 0, conflicted: 0, deletedLocal: 0, deletedRemote: 0,
    blocked: 0, skippedBinary: 0, errors: [], notes: [], issues: [],
  };
}

/** A persisted summary of the last Drive sync — drives the File Manager status panel (instant). */
export interface DriveSyncSummary {
  time: string;          // ISO timestamp of the run
  scope: string;         // "whole vault" or the mirror folder
  pushed: number;
  pulled: number;
  merged: number;
  conflicted: number;
  deletedLocal: number;
  deletedRemote: number;
  skippedBinary: number;
  blocked: number;
  errorCount: number;
  issuesTotal: number; // total per-file outcomes recorded (the issues list below is capped)
  issues: DriveIssue[]; // capped list of per-file outcomes + reason + category
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function isMergeable(name: string, size: number): boolean {
  return MERGEABLE_EXT.has(extOf(name)) && size <= MERGE_MAX_BYTES;
}

/** Conflict file name: `note.md` → `note.conflict.md`, then `note.conflict-2.md`, … */
export function conflictName(name: string, taken: (n: string) => boolean): string {
  const dot = name.lastIndexOf(".");
  const stem = dot >= 0 ? name.slice(0, dot) : name;
  const ext = dot >= 0 ? name.slice(dot) : "";
  let candidate = `${stem}.conflict${ext}`;
  let n = 2;
  while (taken(candidate)) {
    candidate = `${stem}.conflict-${n}${ext}`;
    n++;
    if (n > 100) { candidate = `${stem}.conflict-${Date.now()}${ext}`; break; }
  }
  return candidate;
}

/**
 * Line-level 3-way merge. Returns merged text when exactly one side changed relative to base,
 * or when both sides made the SAME change. Returns null (→ conflict) when both changed
 * differently. Deliberately conservative: it never fabricates a line-interleave it can't prove
 * safe — that's what keeps "edit never lost" true.
 */
export function threeWayMerge(base: string, local: string, remote: string): string | null {
  if (local === remote) return local;          // same content both sides
  if (local === base) return remote;           // only remote changed
  if (remote === base) return local;           // only local changed
  return null;                                 // both changed differently → conflict
}

/** The decision for one file name across the three sources. */
export type DriveAction =
  | "noop"
  | "pull"          // copy remote → local (remote-only, or remote changed & local didn't)
  | "push"          // copy local → remote (local-only, or local changed & remote didn't)
  | "merge"         // both changed, mergeable → 3-way merge
  | "conflict"      // both changed, not mergeable or merge failed → keep both
  | "delete_local"  // remote gone, local unchanged since base
  | "delete_remote";// local gone, remote unchanged since base

/**
 * Decide the action for one file. `base` is the last-synced baseline (undefined = never synced).
 * `localChanged`/`remoteChanged` are computed against the baseline by the caller.
 *
 * DELETION IS EVENT-DRIVEN, NOT ABSENCE-DRIVEN. A file simply missing from one side's listing is
 * NOT proof it was deleted — it may just not be present on this device yet (still downloading, a
 * transient listing gap, or a device whose baseline is out of date). So a delete only fires with
 * EXPLICIT evidence:
 *   - `remoteDeletedExplicit`: a Drive Changes event reported this file removed/trashed;
 *   - `localDeletedExplicit`:  the vault emitted a `delete` for this path (the user removed it).
 * Without that evidence, absence resolves to the SAFE side (re-pull or noop), never a delete.
 * As before, any two-sided edit routes to merge/conflict, never a silent overwrite, and an edit
 * always beats a deletion.
 */
export function decideAction(args: {
  base?: DriveBaseline;
  localExists: boolean;
  remoteExists: boolean;
  localChanged: boolean;
  remoteChanged: boolean;
  mergeable: boolean;
  /** First-contact-both-exist only: whether the two sides are byte-identical (Req 9.1). */
  contentEqual?: boolean;
  /** A Drive Changes event reported this file removed/trashed (explicit remote deletion). */
  remoteDeletedExplicit?: boolean;
  /** The vault emitted a delete for this path since the last sync (explicit local deletion). */
  localDeletedExplicit?: boolean;
}): DriveAction {
  const {
    base, localExists, remoteExists, localChanged, remoteChanged, mergeable, contentEqual,
    remoteDeletedExplicit, localDeletedExplicit,
  } = args;

  // Both present.
  if (localExists && remoteExists) {
    if (!base) {
      // First contact, both exist. Identical content is NOT a conflict — adopt it as the
      // baseline (noop). Only genuinely different content conflicts (Req 9.1). The caller
      // passes contentEqual after comparing the two sides.
      return contentEqual ? "noop" : "conflict";
    }
    if (localChanged && remoteChanged) return mergeable ? "merge" : "conflict";
    if (remoteChanged) return "pull";
    if (localChanged) return "push";
    return "noop";
  }

  // Only remote exists (the LOCAL file is gone from this device's listing).
  if (remoteExists && !localExists) {
    if (!base) return "pull";                       // new remote file → bring it in
    if (remoteChanged) return "pull";               // edit-beats-delete: never lose a remote edit
    // Local absent with an UNCHANGED remote. Honour a real local deletion ONLY with explicit
    // evidence; otherwise the file just isn't here yet → re-pull it, never delete the remote.
    return localDeletedExplicit ? "delete_remote" : "pull";
  }

  // Only local exists (the REMOTE file is gone from the listing).
  if (localExists && !remoteExists) {
    if (!base) return "push";                       // new local file → send it up
    if (localChanged) return "push";                // edit-beats-delete: never lose a local edit
    // Remote absent with an UNCHANGED local. Honour a real remote deletion ONLY with an explicit
    // Changes event; a transient listing gap must NOT delete the local copy → leave it (noop).
    return remoteDeletedExplicit ? "delete_local" : "noop";
  }

  return "noop"; // neither exists
}

/**
 * One sync cycle. `confirmed` bypasses the mass-change guard (a manual "Sync now").
 * Downloads/uploads via the Drive client and the VaultFS port; advances the cursor only when
 * the whole cycle finishes without a fatal error (atomic commit).
 */
export async function runDriveSync(args: {
  token: string;
  driveFolderId?: string;
  fs: VaultFS;
  baselines: DriveBaselineStore;
  confirmed?: boolean;
  /** Conflict-resolution strategy (default keep-both). */
  conflictStrategy?: DriveConflictStrategy;
  /** For the `ask` strategy: resolve one conflict. No callback → falls back to keep-both. */
  resolveConflict?: (name: string) => Promise<ConflictChoice>;
  /** Approve a mass deletion over the limit. No callback / declined → deletions are withheld. */
  confirmDelete?: (msg: string) => Promise<boolean>;
  /** Progress callback fired across the scan/plan/apply phases (for a UI indicator). */
  onProgress?: (p: DriveProgress) => void;
  /** Enable REAL binary upload/download (needs fs.readBinary/writeBinary). Off → block-and-warn. */
  syncBinaries?: boolean;
  /** Use the Changes API to skip the full tree walk when nothing changed remotely (safe: any
   *  remote change or error falls back to a full walk). */
  incremental?: boolean;
  /** Skip the content read for a baselined file whose local mtime is strictly older than this
   *  (ms since epoch): it can't have changed since the last successful sync, so its baseline
   *  still holds. Safety net: any file touched at/after this time is read and compared normally.
   *  Cuts the per-file local reads that dominate a large-vault sync. */
  lastSyncMs?: number;
  /** Checked between files; when it returns true the sync stops gracefully after the current
   *  file. Files already applied keep their new baseline, the rest are left untouched, and the
   *  change cursor is NOT advanced so the next sync re-checks everything. */
  shouldStop?: () => boolean;
  /** Stable id of this device — stamped into a created file's `momentumOrigin` appProperty so a
   *  multi-device duplicate race can be told apart in the logs. */
  deviceId?: string;
}): Promise<DriveSyncResult> {
  const { token, driveFolderId, fs, baselines, confirmed } = args;
  const strategy = args.conflictStrategy ?? DEFAULT_CONFLICT_STRATEGY;
  const result = emptyResult();
  const rootId = driveFolderId || "root";

  // ---- OBSERVATION (recursive: walk the Drive tree, keyed by relative path) --------------
  let remoteByPath: Map<string, DriveFile> = new Map();
  let remoteDups: { rel: string; file: DriveFile }[] = [];
  let folderCache: Map<string, string> = new Map();
  let usedIncremental = false;

  args.onProgress?.({ phase: "scanning", done: 0, total: 0, incremental: !!args.incremental });

  // ---- CHANGE EVENTS: explicit remote removals + the chained cursor ----------------------
  // The Drive Changes API is the SOURCE OF TRUTH FOR DELETIONS. A file missing from the tree
  // walk is NOT proof it was deleted (it may not be present on this device yet), so we never
  // infer a remote deletion from absence — only from an explicit removed/trashed event here.
  // We also chain the cursor correctly: the committed token is the `newStartPageToken` this call
  // returns (advanced only on a clean cycle), instead of resetting to "now" and skipping changes
  // that landed during the run. No cursor / an invalid cursor → this run is a reconciliation
  // (no remote-absence deletions) and the cursor is (re)seeded at commit.
  const removedFileIds = new Set<string>();
  let chainedCursor: string | undefined;
  let cursorWasValid = false;
  let changeCount = 0;
  {
    const cursor = baselines.getCursor();
    if (cursor) {
      try {
        const { changes, newStartPageToken } = await listChanges(token, cursor);
        cursorWasValid = true;
        chainedCursor = newStartPageToken;
        changeCount = changes.length;
        for (const c of changes) {
          if (c.removed || c.file?.trashed) removedFileIds.add(c.fileId);
        }
      } catch (e) {
        if (e instanceof InvalidDriveCursorError) {
          result.notes.push("Change cursor expired → full reconciliation; remote deletions come from explicit events only this run.");
        } else {
          result.notes.push(`Change check failed (${e instanceof Error ? e.message : String(e)}) → full reconciliation this run.`);
        }
      }
    } else {
      result.notes.push("First sync on this device → full adoption scan (no deletions inferred).");
    }
  }

  // INCREMENTAL fast-path (Req 8): if the caller asked for it, the cursor is valid and there were
  // ZERO remote changes since it, reconstruct the remote view from the baselines and skip the full
  // walk. Any change, an invalid cursor, or no cursor yet → the authoritative full walk (and we
  // tell the UI why, so an "Incremental" click that shows "full" isn't confusing).
  if (args.incremental) {
    if (cursorWasValid && changeCount === 0 && baselines.names().length > 0) {
      remoteByPath = new Map();
      for (const name of baselines.names()) {
        const b = baselines.get(name);
        if (!b) continue;
        remoteByPath.set(name, { id: b.fileId, name: baseOf(name), mimeType: "text/plain", md5Checksum: b.md5, modifiedTime: b.modifiedTime });
      }
      folderCache = new Map<string, string>([["", rootId]]);
      usedIncremental = true;
      result.notes.push("Incremental: no remote changes since last sync (skipped full scan).");
      args.onProgress?.({ phase: "scanning", done: 0, total: 0, incremental: true });
    } else if (cursorWasValid && changeCount > 0) {
      result.notes.push(`Incremental check found ${changeCount} remote change(s) → full scan.`);
      args.onProgress?.({ phase: "scanning", done: 0, total: 0, reason: `${changeCount} change${changeCount === 1 ? "" : "s"} on Drive` });
    } else {
      args.onProgress?.({ phase: "scanning", done: 0, total: 0, reason: "first full sync" });
    }
  }

  if (!usedIncremental) {
    let tree: RemoteTree;
    try {
      tree = await walkRemoteTree(token, rootId);
    } catch (e) {
      result.errors.push(`list drive: ${e instanceof Error ? e.message : String(e)}`);
      return result;
    }
    remoteByPath = tree.files;
    remoteDups = tree.dups;
    folderCache = new Map(tree.folders); // seeds push so a subfolder is created at most once/cycle
  }

  // ---- IDENTITY RECONCILIATION (Req 2: stable identity, anti-duplicate) ------------------
  // Re-key the remote by its stable logical identity (appProperties.momentumPath) when present,
  // so a file renamed/moved on Drive stays the SAME file (keyed by its momentumPath) instead of
  // appearing as a new path that would duplicate. Files without the tag key by their tree path
  // (legacy / not yet stamped). When two DIFFERENT Drive files claim the SAME explicit
  // momentumPath, that's a multi-device duplicate race → consolidate non-destructively: keep the
  // newest, preserve the loser's content locally as a .conflict copy, then trash the loser.
  {
    const rawEntries: [string, DriveFile][] = [
      ...remoteByPath.entries(),
      ...remoteDups.map((d) => [d.rel, d.file] as [string, DriveFile]),
    ];
    const dupLosers = new Map<string, DriveFile[]>();
    remoteByPath = new Map<string, DriveFile>();
    for (const [treePath, f] of rawEntries) {
      const logical = f.appProperties?.[MOMENTUM_PATH_KEY] || treePath;
      const existing = remoteByPath.get(logical);
      if (!existing) { remoteByPath.set(logical, f); continue; }
      const bothTagged =
        existing.appProperties?.[MOMENTUM_PATH_KEY] === logical &&
        f.appProperties?.[MOMENTUM_PATH_KEY] === logical;
      const fNewer = (Date.parse(f.modifiedTime || "") || 0) >= (Date.parse(existing.modifiedTime || "") || 0);
      const winner = fNewer ? f : existing;
      const loser = fNewer ? existing : f;
      remoteByPath.set(logical, winner);
      if (bothTagged) {
        const g = dupLosers.get(logical) ?? [];
        g.push(loser);
        dupLosers.set(logical, g);
      } else {
        result.notes.push(`Two remote files map to "${logical}"; kept the newer (${winner.id}).`);
      }
    }

    let consolidated = 0;
    for (const [logical, losers] of dupLosers) {
      const canonical = remoteByPath.get(logical);
      const b = baselines.get(logical);
      if (canonical && b && losers.some((l) => l.id === b.fileId)) {
        baselines.set(logical, { ...b, fileId: canonical.id }); // repoint baseline off a loser
      }
      for (const loser of losers) {
        if (args.shouldStop?.()) break;
        if (consolidated >= DRIVE_MAX_CONSOLIDATE_PER_RUN) {
          result.notes.push(`Duplicate consolidation capped at ${DRIVE_MAX_CONSOLIDATE_PER_RUN} this run.`);
          break;
        }
        try {
          // Preserve the loser's content locally as a .conflict BEFORE trashing (never lose data).
          const isBin = isBinaryName(logical);
          if (isBin && !fs.writeBinary) {
            result.notes.push(`Duplicate for "${logical}" left as-is (binary; enable Sync binary files to consolidate).`);
            continue; // can't safely preserve the binary → don't trash it
          }
          const taken = new Set<string>();
          let cName = conflictName(logical, (x) => taken.has(x));
          while (await fs.exists(cName)) { taken.add(cName); cName = conflictName(logical, (x) => taken.has(x)); }
          if (isBin) await fs.writeBinary!(cName, await downloadFile(token, loser.id));
          else await fs.write(cName, new TextDecoder().decode(await downloadFile(token, loser.id)));
          await trashFile(token, loser.id);
          result.conflicted++;
          result.issues.push({ path: logical, reason: "duplicate on Drive consolidated — kept newest, extra copy saved as .conflict", category: "conflict" });
          result.notes.push(`Consolidated duplicate for "${logical}": extra Drive file ${loser.id} → .conflict + trash.`);
          consolidated++;
        } catch (e) {
          result.errors.push(`consolidate ${logical}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  // Snapshot of paths the user explicitly deleted locally since last sync (evidence for a real
  // delete_remote — see decideAction). Empty when the store doesn't track it (e.g. tests).
  const localDeletes = baselines.getLocalDeletes?.() ?? {};

  const localPaths = new Set(await fs.list());
  const allPaths = new Set<string>([...remoteByPath.keys(), ...localPaths]);

  // ---- ADMISSION (decide every file, then guard) ----------------------------------------
  // `create` = a brand-new file on the destination side (safe, non-destructive). The mass-change
  // guard ignores creates so a first sync / enabling binaries / adding a big folder flows freely.
  interface Plan { path: string; action: DriveAction; remote?: DriveFile; remoteText?: string; binary?: boolean; create?: boolean }
  const isCreate = (action: DriveAction, localExists: boolean, remoteExists: boolean): boolean =>
    (action === "push" && !remoteExists) || (action === "pull" && !localExists);
  // mtime fast-path: a baselined file whose local mtime predates the last successful sync can't
  // have changed since — skip reading its (possibly large) content. Falls back to a real read
  // whenever mtime is unavailable, the file was touched at/after the last sync, or there's no
  // baselineMs yet. Only LOCAL-change detection is gated; remote changes still come from md5.
  const unchangedSinceLastSync = async (p: string): Promise<boolean> => {
    if (args.lastSyncMs === undefined || !fs.mtime) return false;
    const mt = await fs.mtime(p);
    return mt > 0 && mt < args.lastSyncMs;
  };

  const plans: Plan[] = [];
  const planTotal = allPaths.size;
  let planned = 0;
  let stopped = false;
  for (const path of allPaths) {
   if (args.shouldStop?.()) { stopped = true; break; }
   args.onProgress?.({ phase: "planning", done: planned++, total: planTotal, path });
   try {
    const remote = remoteByPath.get(path);
    const base = baselines.get(path);
    const localExists = localPaths.has(path);
    const remoteExists = !!remote;
    // Explicit deletion evidence (see decideAction): a Drive removal event for this file's id,
    // or a vault delete the user made for this path. Absence alone never counts as a deletion.
    const remoteDeletedExplicit = !!base?.fileId && removedFileIds.has(base.fileId);
    const localDeletedExplicit = localDeletes[path] !== undefined;

    // BINARY files (Req 9.5). Two modes:
    //  - syncBinaries OFF (default) or no binary VaultFS: BLOCK-AND-WARN — never round-trip a
    //    non-text file through TextDecoder/text upload, which corrupts it.
    //  - syncBinaries ON: REAL binary upload/download (bytes), change-detected by an FNV hash
    //    (local) and md5Checksum (remote). No 3-way merge — a two-sided change is a conflict.
    if (isBinaryName(path)) {
      if (!args.syncBinaries || !fs.readBinary || !fs.writeBinary) {
        const remoteChangedB = !!base && !!remote && remote.md5Checksum !== base.md5;
        const needsWork = localExists !== remoteExists || remoteChangedB || (localExists && remoteExists && !base);
        if (needsWork) {
          result.skippedBinary++;
          result.notes.push(`Skipped binary (enable "sync binaries" to include): ${path}.`);
          result.issues.push({ path, reason: "binary skipped (enable Sync binary files)", category: "skipped" });
        }
        continue;
      }
      const remoteChangedB = !!base && !!remote && remote.md5Checksum !== base.md5;
      let localChangedB = false;
      let localBuf: ArrayBuffer | undefined;
      if (localExists) {
        if (base?.base !== undefined && await unchangedSinceLastSync(path)) {
          localChangedB = false; // unchanged since last sync — skip the (potentially large) read
        } else {
          localBuf = await fs.readBinary(path);
          if (base?.base !== undefined) localChangedB = hashBytes(localBuf) !== base.base;
          else if (!base) localChangedB = true;
        }
      }
      // First contact both exist: adopt as baseline when byte-sizes match (cheap heuristic);
      // otherwise conflict (keep-both) — never overwrite.
      let contentEqualB = false;
      if (localExists && remoteExists && !base && localBuf) {
        const rsize = remote.size ? parseInt(remote.size, 10) : -1;
        contentEqualB = rsize === localBuf.byteLength;
        if (contentEqualB) {
          baselines.set(path, { fileId: remote.id, md5: remote.md5Checksum ?? "", modifiedTime: remote.modifiedTime ?? "", base: hashBytes(localBuf) });
          result.notes.push(`Adopted identical binary as baseline (by size): ${path}.`);
          continue;
        }
      }
      const actionB = decideAction({ base, localExists, remoteExists, localChanged: localChangedB, remoteChanged: remoteChangedB, mergeable: false, contentEqual: contentEqualB, remoteDeletedExplicit, localDeletedExplicit });
      if (actionB !== "noop") plans.push({ path, action: actionB, remote, binary: true, create: isCreate(actionB, localExists, remoteExists) });
      continue;
    }

    const remoteChanged = !!base && !!remote && remote.md5Checksum !== base.md5;
    // local change: compare current local content to the baseline content — unless mtime proves
    // it hasn't changed since the last sync (then skip the read).
    let localChanged = false;
    if (localExists && base?.base !== undefined) {
      if (await unchangedSinceLastSync(path)) {
        localChanged = false;
      } else {
        const cur = await fs.read(path);
        localChanged = cur !== base.base;
      }
    } else if (localExists && !base) {
      localChanged = true;
    }

    const size = remote?.size ? parseInt(remote.size, 10) : 0;
    const mergeable = isMergeable(path, size);

    // FIRST-CONTACT CONTENT-AWARE (Req 9.1): both sides exist with no baseline. Identical content
    // is NOT a conflict — adopt it as the baseline (noop). Only genuinely different content
    // conflicts. We download the remote once here and cache it for the conflict handler.
    let contentEqual = false;
    let cachedRemoteText: string | undefined;
    if (localExists && remoteExists && !base) {
      const localText = await fs.read(path);
      cachedRemoteText = new TextDecoder().decode(await downloadFile(token, remote.id));
      contentEqual = localText === cachedRemoteText;
      if (contentEqual) {
        baselines.set(path, {
          fileId: remote.id,
          md5: remote.md5Checksum ?? "",
          modifiedTime: remote.modifiedTime ?? "",
          base: isMergeable(path, localText.length) ? localText : undefined,
        });
        result.notes.push(`Adopted identical file as baseline (no false conflict): ${path}.`);
        continue; // noop
      }
    }

    const action = decideAction({ base, localExists, remoteExists, localChanged, remoteChanged, mergeable, contentEqual, remoteDeletedExplicit, localDeletedExplicit });
    if (action !== "noop") plans.push({ path, action, remote, remoteText: cachedRemoteText, create: isCreate(action, localExists, remoteExists) });
   } catch (e) {
    // One bad file must never abort the whole cycle (esp. in whole-vault mode).
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push(`examine ${path}: ${msg}`);
    result.issues.push({ path, reason: `examine failed: ${msg}`, category: "error" });
   }
  }

  // ---- DECLINED-DELETION SUPPRESSION (Req 3: stop re-prompting) ---------------------------
  // A signature of the deletion's situation (action + the baseline's file identity). If the user
  // declined this exact deletion before, skip it silently; if the situation changed (different
  // signature), the old tombstone is stale — drop it and reconsider the deletion this run.
  const deleteSig = (p: Plan): string => {
    const b = baselines.get(p.path);
    return `${p.action}:${b?.fileId ?? ""}:${b?.md5 ?? ""}`;
  };
  const declined = baselines.getDeclined?.() ?? {};
  const clearDeclined = baselines.clearDeclined; // function-typed property → safe to capture; keeps type in the closure
  if (Object.keys(declined).length && clearDeclined) {
    const kept = plans.filter((p) => {
      if (p.action !== "delete_local" && p.action !== "delete_remote") return true;
      const prev = declined[p.path];
      if (prev === undefined) return true;
      if (prev === deleteSig(p)) {
        result.issues.push({ path: p.path, reason: "deletion suppressed — you declined it earlier", category: "held" });
        return false; // same situation the user already refused → don't re-propose
      }
      clearDeclined(p.path); // situation changed → tombstone stale, reconsider
      return true;
    });
    plans.length = 0;
    plans.push(...kept);
  }

  // ---- MASS-DELETE GUARD (separate from the write breaker) -------------------------------
  const deletePlans = plans.filter((p) => p.action === "delete_local" || p.action === "delete_remote");
  if (deletePlans.length > DRIVE_MAX_DELETES_PER_RUN) {
    const msg =
      `Momentum Drive: this sync wants to delete ${deletePlans.length} files ` +
      `(limit ${DRIVE_MAX_DELETES_PER_RUN}). Each of these was reported deleted by an explicit ` +
      `event (removed on Drive, or deleted here), so this is normal if you really removed that ` +
      `many. Deletions go to the trash (reversible). Proceed? Declining remembers your choice so ` +
      `you won't be asked about the same files again.`;
    const ok = args.confirmDelete ? await args.confirmDelete(msg) : false;
    if (!ok) {
      result.blocked += deletePlans.length;
      result.errors.push(`Deletion guard: withheld ${deletePlans.length} deletions (over the limit of ${DRIVE_MAX_DELETES_PER_RUN}).`);
      for (const dp of deletePlans) {
        baselines.setDeclined?.(dp.path, deleteSig(dp)); // remember the decline so we stop asking (Req 3.1)
        result.issues.push({
          path: dp.path,
          reason: dp.action === "delete_local" ? "deletion held — gone on Drive, would delete locally" : "deletion held — gone locally, would delete on Drive",
          category: "held",
        });
      }
      const kept = plans.filter((p) => p.action !== "delete_local" && p.action !== "delete_remote");
      plans.length = 0;
      plans.push(...kept);
    } else {
      // Accepted → these deletions are wanted; clear any stale decline tombstones for them.
      for (const dp of deletePlans) baselines.clearDeclined?.(dp.path);
    }
  }

  // ---- WRITE CIRCUIT BREAKER (unconfirmed automatic runs) --------------------------------
  // Only DATA-CHANGING ops count: overwrites, merges and deletions. Brand-new creates and
  // keep-both conflicts never lose data, so a first sync / enabling binaries / adding a big
  // folder flows freely even on an automatic run. (Deletions also have their own guard above.)
  const riskyWrites = plans.filter((p) => !p.create && p.action !== "conflict").length;
  if (!confirmed && riskyWrites > DRIVE_MAX_WRITES_PER_RUN) {
    result.blocked = plans.length;
    result.errors.push(
      `Mass-change guard: ${riskyWrites} changes to existing files pending (limit ${DRIVE_MAX_WRITES_PER_RUN}). Run "Sync now" manually to confirm.`,
    );
    for (const pp of plans) {
      result.issues.push({ path: pp.path, reason: `held (${pp.action}) — run Sync now to confirm`, category: "held" });
    }
    return result; // do NOT advance the cursor
  }

  // ---- EXECUTION ------------------------------------------------------------------------
  let fatal = false;
  const total = plans.length;
  args.onProgress?.({ phase: "applying", done: 0, total });
  let done = 0;
  for (const p of plans) {
    if (args.shouldStop?.()) { stopped = true; break; }
    let okThis = true;
    try {
      if (p.binary) {
        switch (p.action) {
          case "pull": await this_pullBinary(token, p.path, p.remote!, fs, baselines, result); break;
          case "push": await this_pushBinary(token, p.path, rootId, folderCache, fs, baselines, result, args.deviceId); break;
          case "conflict": await this_conflictBinary(token, p.path, p.remote!, fs, baselines, result, strategy, args.resolveConflict); break;
          case "delete_local": await this_deleteLocal(p.path, fs, baselines, result); break;
          case "delete_remote": await this_deleteRemote(token, p.path, p.remote, baselines, result); break;
          default: break;
        }
      } else {
        switch (p.action) {
          case "pull": await this_pull(token, p.path, p.remote!, fs, baselines, result); break;
          case "push": await this_push(token, p.path, rootId, folderCache, fs, baselines, result, args.deviceId); break;
          case "merge": await this_merge(token, p.path, p.remote!, fs, baselines, result, strategy, args.resolveConflict); break;
          case "conflict": await this_conflict(token, p.path, p.remote!, fs, baselines, result, strategy, args.resolveConflict, p.remoteText); break;
          case "delete_local": await this_deleteLocal(p.path, fs, baselines, result); break;
          case "delete_remote": await this_deleteRemote(token, p.path, p.remote, baselines, result); break;
          default: break;
        }
      }
    } catch (e) {
      okThis = false;
      fatal = true;
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${p.action} ${p.path}: ${msg}`);
      result.issues.push({ path: p.path, reason: `${p.action} failed: ${msg}`, category: "error" });
    }
    // Record the successful per-file outcomes the user asked to see by name.
    if (okThis) {
      if (p.action === "conflict") {
        result.issues.push({ path: p.path, reason: "changed on both sides — kept both copies", category: "conflict" });
      } else if (p.action === "delete_local") {
        result.issues.push({ path: p.path, reason: "deleted locally (gone on Drive)", category: "deleted" });
      } else if (p.action === "delete_remote") {
        result.issues.push({ path: p.path, reason: "deleted on Drive (gone locally)", category: "deleted" });
      }
    }
    done++;
    args.onProgress?.({ phase: "applying", done, total, path: p.path });
  }

  // ---- COMMIT (advance cursor only on a clean, complete cycle) --------------------------
  await baselines.save();
  if (stopped) result.notes.push("Sync stopped by user — partial run; cursor not advanced, next sync re-checks everything.");
  if (!fatal && !stopped) {
    try {
      // Chain the cursor correctly: prefer the newStartPageToken the Changes API returned for
      // this run (so nothing that happened during the run is skipped). Only when we had no valid
      // cursor this run (first sync / expired token) do we seed a fresh "now" token.
      const next = (cursorWasValid && chainedCursor) ? chainedCursor : await getStartPageToken(token);
      baselines.setCursor(next);
      await baselines.save();
    } catch (e) {
      result.notes.push(`cursor refresh skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Local-delete evidence is single-use: drop entries whose file exists again (the user undid
    // the delete). Entries that produced a delete_remote are cleared by the delete helper itself.
    if (baselines.getLocalDeletes && baselines.clearLocalDelete) {
      for (const p of Object.keys(baselines.getLocalDeletes())) {
        if (await fs.exists(p)) baselines.clearLocalDelete(p);
      }
      await baselines.save();
    }
  }
  return result;
}

// ---- remote tree + folder helpers -----------------------------------------------------

export interface RemoteTree {
  /** relPath → file metadata (folders and Google-native docs excluded). */
  files: Map<string, DriveFile>;
  /** relDir → Drive folder id ("" maps to the root folder id). */
  folders: Map<string, string>;
  /** Same-path collisions: extra files that share a relative path with another (Drive allows
   *  duplicate names). Surfaced separately so identity reconciliation can consolidate them instead
   *  of silently dropping one — this is the classic multi-device duplicate. */
  dups: { rel: string; file: DriveFile }[];
}

/** Safety cap on how many entries a single tree walk will enumerate. */
const REMOTE_WALK_MAX = 20_000;

/** Name of the cross-device advisory lock file kept in the synced Drive folder (Req: multi-device). */
export const DRIVE_LOCK_NAME = ".momentum-drive-sync.lock";
/** A lock older than this is considered stale (a crashed/abandoned device) and can be taken. */
const DRIVE_LOCK_TTL_MS = 15 * 60 * 1000;

interface DriveLockData { deviceId: string; ts: number }

/**
 * Try to claim the Drive-folder lock for this device (multi-device guard). Returns {ok:false,
 * holder} when another device holds a FRESH lock. Advisory, not perfectly atomic — it drastically
 * reduces two devices clobbering the same folder, and the content-aware/keep-both engine covers
 * the residual race. A stale or unreadable lock is taken over.
 */
export async function acquireDriveLock(token: string, rootId: string, deviceId: string): Promise<{ ok: boolean; holder?: string }> {
  const query = `name = '${DRIVE_LOCK_NAME}' and trashed = false`;
  const found = await listFiles(token, { folderId: rootId, query });
  const lock = found[0];
  if (lock) {
    try {
      const data = JSON.parse(new TextDecoder().decode(await downloadFile(token, lock.id))) as DriveLockData;
      if (data.deviceId && data.deviceId !== deviceId && data.ts && Date.now() - data.ts < DRIVE_LOCK_TTL_MS) {
        return { ok: false, holder: data.deviceId };
      }
    } catch { /* unreadable → treat as stale and take it */ }
    await updateTextFile(token, lock.id, JSON.stringify({ deviceId, ts: Date.now() }));
    return { ok: true };
  }
  await createTextFile(token, DRIVE_LOCK_NAME, JSON.stringify({ deviceId, ts: Date.now() }), rootId === "root" ? undefined : rootId);
  return { ok: true };
}

/** Release the Drive-folder lock if this device holds it (best-effort). */
export async function releaseDriveLock(token: string, rootId: string, deviceId: string): Promise<void> {
  try {
    const found = await listFiles(token, { folderId: rootId, query: `name = '${DRIVE_LOCK_NAME}' and trashed = false` });
    const lock = found[0];
    if (!lock) return;
    const data = JSON.parse(new TextDecoder().decode(await downloadFile(token, lock.id))) as DriveLockData;
    if (!data.deviceId || data.deviceId === deviceId) await trashFile(token, lock.id);
  } catch { /* best-effort */ }
}

/**
 * Walk the Drive folder subtree rooted at `rootId` (a real folder id, or the "root" alias),
 * building maps keyed by RELATIVE PATH so the engine can mirror subfolders — not just a flat
 * folder. Google-native docs are excluded (read-only export, never synced). BFS, one listing
 * per folder.
 */
export async function walkRemoteTree(token: string, rootId: string): Promise<RemoteTree> {
  const files = new Map<string, DriveFile>();
  const folders = new Map<string, string>([["", rootId]]);
  const dups: { rel: string; file: DriveFile }[] = [];
  const queue: { id: string; prefix: string }[] = [{ id: rootId, prefix: "" }];
  let seen = 0;
  while (queue.length) {
    const { id, prefix } = queue.shift()!;
    const children = await listFiles(token, { folderId: id });
    for (const f of children) {
      const rel = prefix ? `${prefix}/${f.name}` : f.name;
      if (f.name === DRIVE_LOCK_NAME) continue; // the multi-device lock is never synced
      if (isFolder(f)) { folders.set(rel, f.id); queue.push({ id: f.id, prefix: rel }); }
      else if (!isGoogleNative(f)) {
        const existing = files.get(rel);
        if (existing) {
          // Two Drive files at the same path (duplicate name). Keep the newer as canonical and
          // surface the other for consolidation instead of silently losing it.
          const keepNew = (Date.parse(f.modifiedTime || "") || 0) >= (Date.parse(existing.modifiedTime || "") || 0);
          files.set(rel, keepNew ? f : existing);
          dups.push({ rel, file: keepNew ? existing : f });
        } else {
          files.set(rel, f);
        }
      }
      if (++seen > REMOTE_WALK_MAX) return { files, folders, dups };
    }
  }
  return { files, folders, dups };
}

/** Directory portion of a relative path ("a/b/c.md" → "a/b"; "c.md" → ""). */
function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

/** Final segment of a path ("a/b/c.md" → "c.md"). */
function baseOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/**
 * Ensure the Drive folder chain for `dir` exists under `rootId`, creating any missing segment,
 * and return the leaf folder id. `cache` (relDir → id, seeded from the tree walk) is consulted
 * and extended so each folder is resolved/created at most once per cycle.
 */
async function ensureRemoteFolderPath(
  token: string, dir: string, rootId: string, cache: Map<string, string>,
): Promise<string> {
  if (!dir) return rootId;
  const cached = cache.get(dir);
  if (cached) return cached;
  const parentId = await ensureRemoteFolderPath(token, dirOf(dir), rootId, cache);
  const name = baseOf(dir);
  let id = await findChildFolder(token, name, parentId);
  if (!id) id = (await createFolder(token, name, parentId === "root" ? undefined : parentId)).id;
  cache.set(dir, id);
  return id;
}

// ---- per-action helpers (free functions; `this_` prefix avoids clashing with class methods) --

/** Build the appProperties that stamp a file's stable identity (its logical path + origin). */
function momentumProps(path: string, deviceId?: string): Record<string, string> {
  const props: Record<string, string> = { [MOMENTUM_PATH_KEY]: path };
  if (deviceId) props[MOMENTUM_ORIGIN_KEY] = deviceId;
  return props;
}

async function this_pull(
  token: string, path: string, remote: DriveFile, fs: VaultFS, baselines: DriveBaselineStore, result: DriveSyncResult,
): Promise<void> {
  const buf = await downloadFile(token, remote.id);
  const text = new TextDecoder().decode(buf);
  await fs.write(path, text); // VaultFS.write creates local subfolders as needed
  baselines.set(path, {
    fileId: remote.id,
    md5: remote.md5Checksum ?? "",
    modifiedTime: remote.modifiedTime ?? "",
    base: isMergeable(path, text.length) ? text : undefined,
    tagged: !!remote.appProperties?.[MOMENTUM_PATH_KEY],
  });
  result.pulled++;
}

async function this_push(
  token: string, path: string, rootId: string, folderCache: Map<string, string>,
  fs: VaultFS, baselines: DriveBaselineStore, result: DriveSyncResult, deviceId?: string,
): Promise<void> {
  const content = await fs.read(path);
  const existing = baselines.get(path);
  const props = momentumProps(path, deviceId);
  let meta: DriveFile;
  let tagged = true;
  if (existing?.fileId) {
    meta = await updateTextFile(token, existing.fileId, content);
    // Lazily stamp identity on a file created before this feature existed (once).
    if (!existing.tagged) {
      try { meta = await setAppProperties(token, existing.fileId, props); }
      catch (e) { tagged = false; result.notes.push(`tag ${path}: ${e instanceof Error ? e.message : String(e)}`); }
    }
  } else {
    const parentId = await ensureRemoteFolderPath(token, dirOf(path), rootId, folderCache);
    meta = await createTextFile(token, baseOf(path), content, parentId === "root" ? undefined : parentId, props);
  }
  baselines.set(path, {
    fileId: meta.id,
    md5: meta.md5Checksum ?? "",
    modifiedTime: meta.modifiedTime ?? "",
    base: isMergeable(path, content.length) ? content : undefined,
    tagged,
  });
  result.pushed++;
}

async function this_merge(
  token: string, path: string, remote: DriveFile, fs: VaultFS, baselines: DriveBaselineStore, result: DriveSyncResult,
  strategy: DriveConflictStrategy, resolveCb?: (name: string) => Promise<ConflictChoice>,
): Promise<void> {
  const base = baselines.get(path);
  const local = await fs.read(path);
  const remoteText = new TextDecoder().decode(await downloadFile(token, remote.id));
  const merged = base?.base !== undefined ? threeWayMerge(base.base, local, remoteText) : null;
  if (merged !== null) {
    await fs.write(path, merged);
    const meta = await updateTextFile(token, remote.id, merged);
    baselines.set(path, { fileId: meta.id, md5: meta.md5Checksum ?? "", modifiedTime: meta.modifiedTime ?? "", base: merged });
    result.merged++;
  } else {
    // Merge not provable safe → resolve per the configured strategy.
    await this_conflict(token, path, remote, fs, baselines, result, strategy, resolveCb, remoteText, local);
  }
}

/** Pick the winning side for a conflict per the strategy. `both` = keep both (no overwrite). */
async function resolveChoice(
  strategy: DriveConflictStrategy, path: string, remote: DriveFile, fs: VaultFS,
  resolveCb?: (name: string) => Promise<ConflictChoice>,
): Promise<ConflictChoice> {
  switch (strategy) {
    case "local-wins": return "local";
    case "remote-wins": return "remote";
    case "newer-wins": {
      if (!fs.mtime) return "both"; // can't compare timestamps → safe default keeps both
      const localMs = await fs.mtime(path).catch(() => 0);
      const remoteMs = remote.modifiedTime ? Date.parse(remote.modifiedTime) : 0;
      if (!localMs || !remoteMs) return "both";
      return localMs >= remoteMs ? "local" : "remote";
    }
    case "ask": return resolveCb ? await resolveCb(path) : "both";
    case "keep-both":
    default: return "both";
  }
}

async function this_conflict(
  token: string, path: string, remote: DriveFile,
  fs: VaultFS, baselines: DriveBaselineStore, result: DriveSyncResult,
  strategy: DriveConflictStrategy, resolveCb?: (name: string) => Promise<ConflictChoice>,
  remoteTextIn?: string, localIn?: string,
): Promise<void> {
  const remoteText = remoteTextIn ?? new TextDecoder().decode(await downloadFile(token, remote.id));
  const choice = await resolveChoice(strategy, path, remote, fs, resolveCb);

  if (choice === "local") {
    // Local wins: overwrite the remote with the local content. In every conflict path the
    // remote file exists, so updating by its id is safe (no folder creation needed).
    const local = localIn ?? (await fs.read(path));
    const meta = await updateTextFile(token, remote.id, local);
    baselines.set(path, {
      fileId: meta.id, md5: meta.md5Checksum ?? "", modifiedTime: meta.modifiedTime ?? "",
      base: isMergeable(path, local.length) ? local : undefined,
    });
    result.pushed++;
    result.notes.push(`Conflict on ${path}: local kept (${strategy}); remote overwritten.`);
    return;
  }

  if (choice === "remote") {
    // Remote wins: overwrite the local with the remote content.
    await fs.write(path, remoteText);
    baselines.set(path, {
      fileId: remote.id, md5: remote.md5Checksum ?? "", modifiedTime: remote.modifiedTime ?? "",
      base: isMergeable(path, remoteText.length) ? remoteText : undefined,
    });
    result.pulled++;
    result.notes.push(`Conflict on ${path}: remote kept (${strategy}); local overwritten.`);
    return;
  }

  // "both" (keep-both, the default): keep local at its path; save the remote alongside as a
  // unique .conflict copy. Never overwrites.
  const local = localIn ?? (await fs.read(path));

  // Req 4.3 — don't spawn yet another .conflict-N if an existing .conflict sibling already holds
  // this exact remote content (which is what made copies pile up every run).
  const dot = path.lastIndexOf(".");
  const stem = dot >= 0 ? path.slice(0, dot) : path;
  const ext = dot >= 0 ? path.slice(dot) : "";
  let alreadySaved = false;
  for (let i = 1; i <= 50; i++) {
    const cand = i === 1 ? `${stem}.conflict${ext}` : `${stem}.conflict-${i}${ext}`;
    if (!(await fs.exists(cand))) break; // names are assigned in order, so the first gap ends the run
    if ((await fs.read(cand)) === remoteText) { alreadySaved = true; break; }
  }
  if (!alreadySaved) {
    const taken = new Set<string>();
    let cName = conflictName(path, (x) => taken.has(x));
    while (await fs.exists(cName)) { taken.add(cName); cName = conflictName(path, (x) => taken.has(x)); }
    await fs.write(cName, remoteText);
    result.conflicted++;
    result.notes.push(`Conflict on ${path}: remote copy saved as ${cName}. Your local version was kept.`);
  } else {
    result.notes.push(`Conflict on ${path}: remote copy was already saved earlier — not duplicated.`);
  }

  // Req 4.1 — CLOSE THE LOOP so this pair doesn't re-conflict (and spawn another copy) every run:
  // adopt the current local as the merge base and record the remote's current md5. An unchanged
  // pair is then a noop next run; the .conflict copy syncs on its own as a new file.
  baselines.set(path, {
    fileId: remote.id,
    md5: remote.md5Checksum ?? "",
    modifiedTime: remote.modifiedTime ?? "",
    base: isMergeable(path, local.length) ? local : undefined,
  });
}

// ---- binary per-action helpers (real bytes; no 3-way merge) ---------------------------

async function this_pullBinary(
  token: string, path: string, remote: DriveFile, fs: VaultFS, baselines: DriveBaselineStore, result: DriveSyncResult,
): Promise<void> {
  const buf = await downloadFile(token, remote.id);
  await fs.writeBinary!(path, buf);
  baselines.set(path, { fileId: remote.id, md5: remote.md5Checksum ?? "", modifiedTime: remote.modifiedTime ?? "", base: hashBytes(buf), tagged: !!remote.appProperties?.[MOMENTUM_PATH_KEY] });
  result.pulled++;
}

async function this_pushBinary(
  token: string, path: string, rootId: string, folderCache: Map<string, string>,
  fs: VaultFS, baselines: DriveBaselineStore, result: DriveSyncResult, deviceId?: string,
): Promise<void> {
  const buf = await fs.readBinary!(path);
  const existing = baselines.get(path);
  const props = momentumProps(path, deviceId);
  let meta: DriveFile;
  let tagged = true;
  if (existing?.fileId) {
    meta = await updateBinaryFile(token, existing.fileId, buf, baseOf(path));
    if (!existing.tagged) {
      try { meta = await setAppProperties(token, existing.fileId, props); }
      catch (e) { tagged = false; result.notes.push(`tag ${path}: ${e instanceof Error ? e.message : String(e)}`); }
    }
  } else {
    const parentId = await ensureRemoteFolderPath(token, dirOf(path), rootId, folderCache);
    meta = await createBinaryFile(token, baseOf(path), buf, parentId === "root" ? undefined : parentId, props);
  }
  baselines.set(path, { fileId: meta.id, md5: meta.md5Checksum ?? "", modifiedTime: meta.modifiedTime ?? "", base: hashBytes(buf), tagged });
  result.pushed++;
}

async function this_conflictBinary(
  token: string, path: string, remote: DriveFile, fs: VaultFS, baselines: DriveBaselineStore, result: DriveSyncResult,
  strategy: DriveConflictStrategy, resolveCb?: (name: string) => Promise<ConflictChoice>,
): Promise<void> {
  const choice = await resolveChoice(strategy, path, remote, fs, resolveCb);
  if (choice === "local") {
    const buf = await fs.readBinary!(path);
    const meta = await updateBinaryFile(token, remote.id, buf, baseOf(path));
    baselines.set(path, { fileId: meta.id, md5: meta.md5Checksum ?? "", modifiedTime: meta.modifiedTime ?? "", base: hashBytes(buf) });
    result.pushed++;
    result.notes.push(`Binary conflict on ${path}: local kept (${strategy}); remote overwritten.`);
    return;
  }
  if (choice === "remote") {
    const buf = await downloadFile(token, remote.id);
    await fs.writeBinary!(path, buf);
    baselines.set(path, { fileId: remote.id, md5: remote.md5Checksum ?? "", modifiedTime: remote.modifiedTime ?? "", base: hashBytes(buf) });
    result.pulled++;
    result.notes.push(`Binary conflict on ${path}: remote kept (${strategy}); local overwritten.`);
    return;
  }
  // keep-both: save the remote binary alongside as a unique .conflict copy; keep local as-is.
  const taken = new Set<string>();
  let cName = conflictName(path, (x) => taken.has(x));
  while (await fs.exists(cName)) { taken.add(cName); cName = conflictName(path, (x) => taken.has(x)); }
  const buf = await downloadFile(token, remote.id);
  await fs.writeBinary!(cName, buf);
  result.conflicted++;
  result.notes.push(`Binary conflict on ${path}: remote copy saved as ${cName}. Your local version was kept.`);
}

async function this_deleteLocal(
  name: string, fs: VaultFS, baselines: DriveBaselineStore, result: DriveSyncResult,
): Promise<void> {
  // Re-confirm the local file still exists (guard against a stale listing) before trashing.
  if (await fs.exists(name)) {
    await fs.trash(name);
    result.deletedLocal++;
    result.notes.push(`Removed locally (deleted on Drive): ${name} → trash.`);
  }
  baselines.remove(name);
  baselines.clearDeclined?.(name); // deletion executed → any decline tombstone is moot
}

async function this_deleteRemote(
  token: string, name: string, remote: DriveFile | undefined, baselines: DriveBaselineStore, result: DriveSyncResult,
): Promise<void> {
  const base = baselines.get(name);
  const fileId = remote?.id ?? base?.fileId;
  if (fileId) {
    await trashFile(token, fileId);
    result.deletedRemote++;
    result.notes.push(`Removed on Drive (deleted locally): ${name} → Drive trash.`);
  }
  baselines.remove(name);
  baselines.clearLocalDelete?.(name); // the local-delete evidence has been acted on
  baselines.clearDeclined?.(name);
}
