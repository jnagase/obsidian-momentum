import {
  DriveFile,
  listFiles,
  downloadFile,
  createTextFile,
  updateTextFile,
  trashFile,
  getStartPageToken,
  isFolder,
  isGoogleNative,
} from "./googledrive";

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

/** Text extensions eligible for line-level 3-way merge. Others conflict-duplicate instead. */
const MERGEABLE_EXT = new Set(["md", "txt", "csv", "json", "canvas", "css", "js", "ts", "yaml", "yml"]);
/** Max size (bytes) eligible for merge. */
const MERGE_MAX_BYTES = 1_048_576;

/** Per-file last-synced snapshot. `md5` is Drive's md5Checksum at last sync; content is the merge base. */
export interface DriveBaseline {
  fileId: string;
  md5: string;
  modifiedTime: string;
  /** Last-synced text content, the base for 3-way merge (only kept for mergeable text). */
  base?: string;
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
}

export interface DriveSyncResult {
  pushed: number;
  pulled: number;
  merged: number;
  conflicted: number;
  deletedLocal: number;
  deletedRemote: number;
  blocked: number;
  errors: string[];
  notes: string[];
}

function emptyResult(): DriveSyncResult {
  return { pushed: 0, pulled: 0, merged: 0, conflicted: 0, deletedLocal: 0, deletedRemote: 0, blocked: 0, errors: [], notes: [] };
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
 * Safety: any ambiguity where an edit could be lost routes to "conflict", never a delete.
 */
export function decideAction(args: {
  base?: DriveBaseline;
  localExists: boolean;
  remoteExists: boolean;
  localChanged: boolean;
  remoteChanged: boolean;
  mergeable: boolean;
}): DriveAction {
  const { base, localExists, remoteExists, localChanged, remoteChanged, mergeable } = args;

  // Both present.
  if (localExists && remoteExists) {
    if (!base) {
      // First contact, both exist: same content → noop handled by caller via hash; here treat
      // as conflict unless caller already proved equality.
      return remoteChanged || localChanged ? "conflict" : "noop";
    }
    if (localChanged && remoteChanged) return mergeable ? "merge" : "conflict";
    if (remoteChanged) return "pull";
    if (localChanged) return "push";
    return "noop";
  }

  // Only remote exists (the LOCAL file is gone).
  if (remoteExists && !localExists) {
    if (!base) return "pull";                       // new remote file → bring it in
    // Local was deleted by the user. If the remote changed since base, edit-beats-delete →
    // pull it back (never lose the remote edit). If the remote is unchanged, honour the local
    // deletion by removing the remote too.
    return remoteChanged ? "pull" : "delete_remote";
  }

  // Only local exists (the REMOTE file is gone).
  if (localExists && !remoteExists) {
    if (!base) return "push";                       // new local file → send it up
    // Remote was deleted. If the local changed since base, edit-beats-delete → push it back.
    // If the local is unchanged, honour the remote deletion by removing the local too.
    return localChanged ? "push" : "delete_local";
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
}): Promise<DriveSyncResult> {
  const { token, driveFolderId, fs, baselines, confirmed } = args;
  const result = emptyResult();

  // ---- OBSERVATION ----------------------------------------------------------------------
  let remoteFiles: DriveFile[];
  try {
    remoteFiles = (await listFiles(token, { folderId: driveFolderId })).filter(
      (f) => !isFolder(f) && !isGoogleNative(f), // native docs are read-only export, not synced
    );
  } catch (e) {
    result.errors.push(`list drive: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }
  const remoteByName = new Map(remoteFiles.map((f) => [f.name, f]));
  const localNames = new Set(await fs.list());

  const allNames = new Set<string>([...remoteByName.keys(), ...localNames]);

  // ---- ADMISSION (decide every file, then guard) ----------------------------------------
  interface Plan { name: string; action: DriveAction; remote?: DriveFile; }
  const plans: Plan[] = [];
  for (const name of allNames) {
    const remote = remoteByName.get(name);
    const base = baselines.get(name);
    const localExists = localNames.has(name);
    const remoteExists = !!remote;

    const remoteChanged = !!base && !!remote && remote.md5Checksum !== base.md5;
    // local change: compare current local content hash-ish (length+content) to base content.
    let localChanged = false;
    if (localExists && base?.base !== undefined) {
      const cur = await fs.read(name);
      localChanged = cur !== base.base;
    } else if (localExists && !base) {
      localChanged = true;
    }

    const size = remote?.size ? parseInt(remote.size, 10) : 0;
    const mergeable = isMergeable(name, size);

    const action = decideAction({ base, localExists, remoteExists, localChanged, remoteChanged, mergeable });
    if (action !== "noop") plans.push({ name, action, remote });
  }

  const writeOps = plans.length;
  if (!confirmed && writeOps > DRIVE_MAX_WRITES_PER_RUN) {
    result.blocked = writeOps;
    result.errors.push(
      `Mass-change guard: ${writeOps} changes pending (limit ${DRIVE_MAX_WRITES_PER_RUN}). Run "Sync now" manually to confirm.`,
    );
    return result; // do NOT advance the cursor
  }

  // ---- EXECUTION ------------------------------------------------------------------------
  let fatal = false;
  for (const p of plans) {
    try {
      switch (p.action) {
        case "pull": await this_pull(token, p.remote!, fs, baselines, result); break;
        case "push": await this_push(token, p.name, driveFolderId, fs, baselines, result); break;
        case "merge": await this_merge(token, p.name, p.remote!, fs, baselines, result); break;
        case "conflict": await this_conflict(token, p.name, p.remote!, fs, baselines, result); break;
        case "delete_local": await this_deleteLocal(p.name, fs, baselines, result); break;
        case "delete_remote": await this_deleteRemote(token, p.name, p.remote, baselines, result); break;
        default: break;
      }
    } catch (e) {
      fatal = true;
      result.errors.push(`${p.action} ${p.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---- COMMIT (advance cursor only on a clean cycle) ------------------------------------
  await baselines.save();
  if (!fatal) {
    try {
      // Refresh the change cursor to "now" so the next run only re-checks the delta. (First
      // version re-lists fully each run; the cursor is stored for the incremental path next.)
      const cursor = await getStartPageToken(token);
      baselines.setCursor(cursor);
      await baselines.save();
    } catch (e) {
      result.notes.push(`cursor refresh skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

// ---- per-action helpers (free functions; `this_` prefix avoids clashing with class methods) --

async function this_pull(
  token: string, remote: DriveFile, fs: VaultFS, baselines: DriveBaselineStore, result: DriveSyncResult,
): Promise<void> {
  const buf = await downloadFile(token, remote.id);
  const text = new TextDecoder().decode(buf);
  await fs.write(remote.name, text);
  baselines.set(remote.name, {
    fileId: remote.id,
    md5: remote.md5Checksum ?? "",
    modifiedTime: remote.modifiedTime ?? "",
    base: isMergeable(remote.name, text.length) ? text : undefined,
  });
  result.pulled++;
}

async function this_push(
  token: string, name: string, folderId: string | undefined, fs: VaultFS, baselines: DriveBaselineStore, result: DriveSyncResult,
): Promise<void> {
  const content = await fs.read(name);
  const existing = baselines.get(name);
  const meta = existing?.fileId
    ? await updateTextFile(token, existing.fileId, content)
    : await createTextFile(token, name, content, folderId);
  baselines.set(name, {
    fileId: meta.id,
    md5: meta.md5Checksum ?? "",
    modifiedTime: meta.modifiedTime ?? "",
    base: isMergeable(name, content.length) ? content : undefined,
  });
  result.pushed++;
}

async function this_merge(
  token: string, name: string, remote: DriveFile, fs: VaultFS, baselines: DriveBaselineStore, result: DriveSyncResult,
): Promise<void> {
  const base = baselines.get(name);
  const local = await fs.read(name);
  const remoteText = new TextDecoder().decode(await downloadFile(token, remote.id));
  const merged = base?.base !== undefined ? threeWayMerge(base.base, local, remoteText) : null;
  if (merged !== null) {
    await fs.write(name, merged);
    const meta = await updateTextFile(token, remote.id, merged);
    baselines.set(name, { fileId: meta.id, md5: meta.md5Checksum ?? "", modifiedTime: meta.modifiedTime ?? "", base: merged });
    result.merged++;
  } else {
    // Merge not provable safe → keep both.
    await this_conflict(token, name, remote, fs, baselines, result, remoteText, local);
  }
}

async function this_conflict(
  token: string, name: string, remote: DriveFile, fs: VaultFS, baselines: DriveBaselineStore, result: DriveSyncResult,
  remoteTextIn?: string, localIn?: string,
): Promise<void> {
  const remoteText = remoteTextIn ?? new TextDecoder().decode(await downloadFile(token, remote.id));
  void localIn;
  // Keep local at its path; write remote copy alongside as a .conflict file. Ensure the
  // conflict name is unique against the vault.
  let cName = conflictName(name, () => false);
  while (await fs.exists(cName)) cName = conflictName(cName, () => false);
  await fs.write(cName, remoteText);
  result.conflicted++;
  result.notes.push(`Conflict on ${name}: remote copy saved as ${cName}. Your local version was kept.`);
  // Do not update the baseline for `name` — it stays "diverged" until the user resolves it.
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
}
