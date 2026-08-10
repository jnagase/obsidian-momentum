/**
 * Bidirectional sync: Momentum boards ↔ Google Task lists.
 * Each board ↔ one Google Tasklist matched by title. The default board "My Tasks" pairs
 * with Google's built-in "My Tasks" list, and a list created directly in Google surfaces
 * as a board in Obsidian (discovery).
 *
 * Phase 1 (foundation, non-destructive):
 *  - `google_id` in the note frontmatter is the STABLE sync key (not the title), so a
 *    rename never becomes a delete+create and duplicates can't spawn from title drift.
 *  - A per-item BASELINE (last synced {title,status,due}) drives a 3-way merge: only the
 *    side that actually changed since the baseline wins; an unchanged field is never
 *    overwritten. First contact adopts the remote as the baseline (no clobber).
 *  - Legacy bridge: a local task with no google_id first tries to LINK to an existing
 *    Google task with the same title in its list (adopting the old title-based match)
 *    before creating a new one — so upgrading doesn't duplicate everything.
 *  - A mass-change circuit breaker blocks runs with more than `MAX_WRITES_PER_RUN`
 *    pending writes unless explicitly confirmed (manual "Sync now"), so a widget storm
 *    or a bug can't fan out across Google.
 *  - No deletion here (Phase 2): a task missing on one side is left alone, never removed.
 */

import { PADataStore } from "./data";
import { Task } from "./types";
import {
  GoogleToken, GTTask, GTTaskList,
  ensureFreshToken,
  listTaskLists, createTaskList, getDefaultTaskList, deleteTaskList,
  listTasks, createTask, updateTask, getTask, deleteTask,
} from "./googletasks";

/** Last-synced snapshot of a Google task, keyed by its google id. */
export interface GTBaseline { title: string; status: string; due: string }

/** Persistence for baselines (backed by the plugin's data.json). */
export interface GTBaselineStore {
  get(id: string): GTBaseline | undefined;
  set(id: string, b: GTBaseline): void;
  remove(id: string): void;
  keys(): string[];
  save(): Promise<void>;
}

export interface GTSyncResult {
  pushed: number;
  pulled: number;
  linked: number;
  deleted: number;
  orphaned: number;
  blocked: number;
  errors: string[];
  /** Audit trail of destructive actions (what was deleted/archived and why). */
  notes: string[];
}

/** Above this many pending writes an unconfirmed (automatic) run is blocked. */
const MAX_WRITES_PER_RUN = 50;

/** Coerce a due value to YYYY-MM-DD, converting DD/MM/YYYY; unknown formats → "" (no due). */
function normalizeYmd(v?: string): string {
  const s = (v || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  return ""; // unrecognized → omit the due so Google never gets a malformed value (was a 400).
}
function toGTDue(ymd?: string): string | undefined {
  const d = normalizeYmd(ymd);
  return d ? `${d}T00:00:00.000Z` : undefined;
}
function fromGTDue(due?: string): string { return due ? due.slice(0, 10) : ""; }
function isBlankTitle(t?: string): boolean { const s = (t || "").trim().toLowerCase(); return !s || s === "untitled"; }
function sameBase(a: GTBaseline, b: GTBaseline): boolean {
  return a.title === b.title && a.status === b.status && (a.due || "") === (b.due || "");
}

// ── Reconciliation helpers (multi-device duplicate convergence) ─────────────────
/** Title with a trailing uniquePath suffix (" 2", " 10") removed, trimmed. */
function baseTitle(title: string): string {
  return (title || "").trim().replace(/\s+\d+$/, "").trim();
}
/** A base title that carries no real content (blank or "untitled") → never a duplicate. */
function isBlankBase(title: string): boolean {
  const s = baseTitle(title).toLowerCase();
  return !s || s === "untitled";
}
function normStatus(s?: string): "completed" | "needsAction" {
  return s === "completed" ? "completed" : "needsAction";
}
/** Grouping key: base title + normalized due + normalized status. */
function sigKey(title: string, due: string | undefined, status?: string): string {
  return `${baseTitle(title)}\u0000${normalizeYmd(due)}\u0000${normStatus(status)}`;
}
/** Deterministic winner among Google ids: smallest by code-point order. Same on every device. */
function pickWinnerGoogleId(ids: string[]): string {
  return ids.reduce((w, x) => (x < w ? x : w));
}
/**
 * Deterministic winner note across devices: prefer a linked note (has google_id) and among
 * those the smallest google_id; if none is linked, the smallest task_id. Never uses
 * wall-clock, device state, or API ordering.
 */
function pickWinnerNote(notes: Task[]): Task {
  const linked = notes.filter((n) => n.googleId);
  const pool = linked.length ? linked : notes;
  const key = (n: Task) => (linked.length ? (n.googleId as string) : (n.id || n.title));
  return pool.reduce((w, n) => (key(n) < key(w) ? n : w));
}
function pushInto<T>(m: Map<string, T[]>, k: string, v: T): void {
  const a = m.get(k); if (a) a.push(v); else m.set(k, [v]);
}
/** A Google API error whose HTTP status means the item is gone. */
function isGoneErr(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /\b(404|410)\b/.test(m);
}

type SyncOp =
  | { kind: "create"; listId: string; task: Task }
  | { kind: "link"; listId: string; task: Task; gtId: string; base: GTBaseline }
  | { kind: "patch"; listId: string; gtId: string; body: Partial<GTTask>; base: GTBaseline }
  | { kind: "pullUpdate"; task: Task; changes: Partial<Task>; base: GTBaseline; gtId: string }
  | { kind: "pullCreate"; board: string; listId: string; gt: GTTask };

export class GTSyncService {
  constructor(
    private store: PADataStore,
    private getToken: () => GoogleToken | null,
    private saveToken: (t: GoogleToken) => Promise<void>,
    private baselines: GTBaselineStore,
  ) {}

  async sync(opts: {
    confirmed?: boolean;
    onProgress?: (p: { phase: string; done: number; total: number }) => void;
    /** Ask the user to approve a suspicious mass deletion; resolves true to proceed. */
    confirmMass?: (msg: string) => Promise<boolean>;
  } = {}): Promise<GTSyncResult> {
    const result: GTSyncResult = { pushed: 0, pulled: 0, linked: 0, deleted: 0, orphaned: 0, blocked: 0, errors: [], notes: [] };
    const report = opts.onProgress ?? (() => {});
    report({ phase: "fetching", done: 0, total: 0 });

    const raw = this.getToken();
    if (!raw) throw new Error("No Google token available.");
    const token = await ensureFreshToken(raw);
    if (token !== raw) await this.saveToken(token);
    const at = token.access_token;

    let gtLists: GTTaskList[];
    try { gtLists = await listTaskLists(at); }
    catch (e) { result.errors.push(`Fetch lists: ${String(e)}`); return result; }
    const listByTitle = new Map(gtLists.map((l) => [l.title, l]));

    // Resolve the account's built-in default list ("My Tasks") by its @default alias — it
    // always exists and can't be deleted, so the "My Tasks" board pairs with it by ID
    // (not by title), which also works when the account's default is localized.
    let defaultListId = "";
    try { defaultListId = (await getDefaultTaskList(at)).id ?? ""; }
    catch (e) { result.errors.push(`Default list: ${String(e)}`); }

    const boards = this.store.loadBoards();
    const tasks = this.store.loadTasks();
    const cfg = await this.store.loadConfig();
    const cols = cfg.taskColumns;
    const doneCol = cols.includes("done") ? "done" : cols[cols.length - 1];
    const firstCol = cols[0];

    // Board name === Google list title (the "My Tasks" board pairs with Google's built-in
    // "My Tasks" list). Ensure a Google list exists for every Obsidian board.
    const boardNames = boards.map((b) => b.name);
    const boardToListId = new Map<string, string>();
    const listIdToBoard = new Map<string, string>();
    for (const board of boardNames) {
      // "My Tasks" pairs with the permanent default list (never create/delete it).
      if (board === "My Tasks" && defaultListId) {
        boardToListId.set(board, defaultListId);
        if (!listIdToBoard.has(defaultListId)) listIdToBoard.set(defaultListId, "My Tasks");
        continue;
      }
      let list = listByTitle.get(board);
      if (!list) {
        try { list = await createTaskList(at, board); listByTitle.set(board, list); }
        catch (e) { result.errors.push(`Create list "${board}": ${String(e)}`); continue; }
      }
      boardToListId.set(board, list.id);
      if (!listIdToBoard.has(list.id)) listIdToBoard.set(list.id, board);
    }
    // Discovery: every Google list also maps to a board named after it, so a list created
    // directly in Google Tasks surfaces as a board in Obsidian (its tasks are pulled below,
    // which creates the Tasks/<list>/ folder on first task). Lists whose name is tombstoned
    // (a board the user removed or that was renamed away) are skipped entirely, so deleting
    // a board is permanent even if a stale Google list of the same name lingers.
    const ignored = new Set(this.store.loadIgnoredBoards());
    const ignoredListIds = new Set(gtLists.filter((l) => ignored.has(l.title)).map((l) => l.id));
    for (const l of gtLists) {
      if (ignored.has(l.title) || listIdToBoard.has(l.id)) continue;
      listIdToBoard.set(l.id, l.title);
    }

    const boardOf = (t: Task) => t.kanbanName || "My Tasks";
    const localStatus = (t: Task): GTTask["status"] => (t.status === doneCol ? "completed" : "needsAction");
    const linkedIds = new Set(tasks.filter((t) => t.googleId).map((t) => t.googleId as string));

    // Group local tasks per list: linked ones by their stored google_list, unlinked ones
    // by the list their current board maps to.
    const linkedByList = new Map<string, Task[]>();
    const unlinkedByList = new Map<string, Task[]>();
    for (const t of tasks) {
      if (isBlankTitle(t.title)) continue;
      if (t.googleId && t.googleList) pushInto(linkedByList, t.googleList, t);
      else if (!t.googleId) {
        const listId = boardToListId.get(boardOf(t));
        if (listId) pushInto(unlinkedByList, listId, t);
      }
    }

    // Fetch each relevant list's tasks once: board lists, every Google list (discovery),
    // and any list a local task is already linked to — minus tombstoned lists.
    const listIds = new Set<string>([...boardToListId.values(), ...gtLists.map((l) => l.id), ...linkedByList.keys()]);
    for (const id of ignoredListIds) listIds.delete(id);
    const gtByList = new Map<string, GTTask[]>();
    let fetched = 0;
    for (const listId of listIds) {
      try { gtByList.set(listId, await listTasks(at, listId)); }
      catch (e) { result.errors.push(`Fetch tasks (${listId}): ${String(e)}`); }
      report({ phase: "fetching", done: ++fetched, total: listIds.size });
    }

    // ---- PLAN ----
    const ops: SyncOp[] = [];
    for (const listId of listIds) {
      const gtTasks = gtByList.get(listId);
      if (!gtTasks) continue;
      const gtById = new Map<string, GTTask>();
      const unlinkedGtByTitle = new Map<string, GTTask>();
      for (const gt of gtTasks) {
        if (gt.id) gtById.set(gt.id, gt);
        if (gt.id && gt.title && !linkedIds.has(gt.id) && !unlinkedGtByTitle.has(gt.title)) {
          unlinkedGtByTitle.set(gt.title, gt);
        }
      }
      const usedGtIds = new Set<string>();

      // Linked local tasks living in this list → 3-way merge against the baseline.
      for (const t of (linkedByList.get(listId) ?? [])) {
        const gt = t.googleId ? gtById.get(t.googleId) : undefined;
        if (!gt || !gt.id) continue; // remote gone → Phase 2 (orphan) handles; never delete here.
        usedGtIds.add(gt.id);
        const remote: GTBaseline = { title: gt.title, status: gt.status, due: fromGTDue(gt.due) };
        const base = this.baselines.get(gt.id) ?? remote; // first contact adopts remote.
        const local: GTBaseline = { title: t.title, status: localStatus(t), due: normalizeYmd(t.due) };
        if (!sameBase(local, base)) {
          ops.push({
            kind: "patch", listId, gtId: gt.id, base: local,
            body: { title: local.title, status: local.status as GTTask["status"], due: toGTDue(local.due), notes: "" },
          });
        } else if (!sameBase(remote, base)) {
          const changes: Partial<Task> = {};
          if (remote.title && remote.title !== t.title) changes.title = remote.title;
          if (remote.due !== (t.due || "")) changes.due = remote.due || "";
          if (remote.status === "completed" && t.status !== doneCol) changes.status = doneCol;
          if (remote.status === "needsAction" && t.status === doneCol) changes.status = firstCol;
          if (Object.keys(changes).length) ops.push({ kind: "pullUpdate", task: t, changes, base: remote, gtId: gt.id });
          else this.baselines.set(gt.id, remote);
        } else {
          this.baselines.set(gt.id, base); // persist the converged baseline.
        }
      }

      // Unlinked local tasks whose board maps here → LINK by title (legacy bridge) or CREATE.
      for (const t of (unlinkedByList.get(listId) ?? [])) {
        const match = unlinkedGtByTitle.get(t.title);
        if (match && match.id && !usedGtIds.has(match.id)) {
          usedGtIds.add(match.id);
          ops.push({ kind: "link", listId, task: t, gtId: match.id, base: { title: match.title, status: match.status, due: fromGTDue(match.due) } });
        } else {
          ops.push({ kind: "create", listId, task: t });
        }
      }

      // Pull: unlinked remote tasks with no local match → create local (skip completed/blank).
      const board = listIdToBoard.get(listId) ?? "My Tasks";
      for (const gt of gtTasks) {
        if (!gt.id || usedGtIds.has(gt.id) || linkedIds.has(gt.id)) continue;
        if (gt.status === "completed" || isBlankTitle(gt.title)) continue;
        ops.push({ kind: "pullCreate", board, listId, gt });
      }
    }

    // ---- BREAKER: block unconfirmed runs that would fan out. Links are safe (no Google
    // writes), so they still run and attach ids even when the guard trips. ----
    const writeOps = ops.filter((o) => o.kind !== "link").length;
    if (!opts.confirmed && writeOps > MAX_WRITES_PER_RUN) {
      result.blocked = writeOps;
      result.errors.push(`Mass-change guard: ${writeOps} changes pending (limit ${MAX_WRITES_PER_RUN}). Run "Sync now" manually to confirm.`);
      const links = ops.filter((o) => o.kind === "link");
      let dl = 0;
      for (const op of links) { await this.applyOp(at, op, result, localStatus, firstCol); report({ phase: "applying", done: ++dl, total: links.length }); }
      await this.baselines.save();
      return result;
    }

    // ---- APPLY ----
    let done = 0;
    for (const op of ops) {
      try { await this.applyOp(at, op, result, localStatus, firstCol); }
      catch (e) { result.errors.push(`${op.kind}: ${String(e)}`); }
      report({ phase: "applying", done: ++done, total: ops.length });
    }

    // ---- DELETION RECONCILIATION (Phase 2) ----
    report({ phase: "finishing", done: ops.length, total: ops.length });
    // Deletion is destructive, so it runs ONLY on confirmed (manual) syncs, and each
    // direction has a sanity guard that aborts if too much vanished at once (a signal
    // that a load glitch — not a real deletion — caused the disappearance).
    if (opts.confirmed) {
      await this.reconcileDeletions(at, tasks, gtByList, listIds, result, opts.confirmMass);
      await this.consolidateLists(at, tasks, boardToListId, gtLists, defaultListId, localStatus, result);
      // End-of-sync convergence: collapse duplicate Google tasks / notes created by the
      // multi-device race so two devices converge on one item each. Wrapped so a failure
      // in one group never aborts the run.
      try {
        await this.reconcileDuplicates(at, boardToListId, listIdToBoard, ignoredListIds, defaultListId, localStatus, result, opts.confirmMass);
      } catch (e) { result.errors.push(`Reconcile duplicates: ${String(e)}`); }
    }

    await this.baselines.save();
    return result;
  }

  /**
   * End-of-sync reconciliation (multi-device convergence). After the normal ops ran, the
   * same vault synced on two devices can have (a) duplicate Google tasks with distinct ids
   * for one logical task and (b) duplicate notes (" 2"/" 3"). This pass re-reads the fresh
   * Google state and the local notes, groups by a deterministic Match_Signature
   * (baseTitle + due + status), and collapses each duplicate set to a single Winner chosen
   * the SAME way on every device (smallest google_id, then smallest task_id), deleting the
   * losing Google tasks and notes. Google deletions are counted against a mass guard.
   */
  private async reconcileDuplicates(
    at: string,
    boardToListId: Map<string, string>,
    listIdToBoard: Map<string, string>,
    ignoredListIds: Set<string>,
    defaultListId: string,
    localStatus: (t: Task) => GTTask["status"],
    result: GTSyncResult,
    confirmMass?: (msg: string) => Promise<boolean>,
  ): Promise<void> {
    // Lists to inspect: board lists + discovered lists, minus tombstoned ones.
    const listIds = new Set<string>([...boardToListId.values(), ...listIdToBoard.keys()]);
    for (const id of ignoredListIds) listIds.delete(id);

    // Re-list fresh Google state (post-apply).
    const gtByList = new Map<string, GTTask[]>();
    for (const listId of listIds) {
      try { gtByList.set(listId, await listTasks(at, listId)); }
      catch (e) { result.errors.push(`Reconcile fetch (${listId}): ${String(e)}`); }
    }

    const googleDeletes: Array<{ listId: string; gtId: string }> = [];
    // For each (list, signature) the surviving Google winner id — used to relink stray notes.
    const listSigWinner = new Map<string, string>();

    // Google-side: within a list, tasks with the SAME full title + due + status are race
    // duplicates (Google has no uniquePath suffixing). Keep the smallest id, delete the rest.
    for (const [listId, arr] of gtByList) {
      const groups = new Map<string, GTTask[]>();
      for (const gt of arr) {
        if (!gt.id || isBlankBase(gt.title)) continue;
        pushInto(groups, sigKey(gt.title, fromGTDue(gt.due), gt.status), gt);
      }
      for (const [k, g] of groups) {
        if (g.length < 2) continue;
        if (new Set(g.map((x) => (x.title || "").trim())).size !== 1) continue; // distinct titles → not artifacts
        const winner = pickWinnerGoogleId(g.map((x) => x.id as string));
        listSigWinner.set(`${listId}\u0000${k}`, winner);
        for (const x of g) if (x.id !== winner) googleDeletes.push({ listId, gtId: x.id as string });
      }
    }

    // Note-side: within a board, notes sharing base title + due + status are artifacts when
    // their full titles are identical OR form a base + " N" suffix set (the base is present).
    const tasks = this.store.loadTasks();
    const noteDeletes: Task[] = [];
    const byBoard = new Map<string, Task[]>();
    for (const t of tasks) { if (!isBlankBase(t.title)) pushInto(byBoard, t.kanbanName || "My Tasks", t); }
    for (const [, arr] of byBoard) {
      const groups = new Map<string, Task[]>();
      for (const t of arr) pushInto(groups, sigKey(t.title, t.due, localStatus(t)), t);
      for (const [, g] of groups) {
        if (g.length < 2) continue;
        const fulls = g.map((t) => t.title.trim());
        const allSame = new Set(fulls).size === 1;
        const hasPlainBase = fulls.some((f) => f === baseTitle(f));
        if (!(allSame || hasPlainBase)) continue; // e.g. "Phase 2"/"Phase 3" with no "Phase" → keep both
        const winner = pickWinnerNote(g);
        for (const t of g) {
          if (t === winner) continue;
          if (t.googleId && t.googleId !== winner.googleId) googleDeletes.push({ listId: t.googleList || "", gtId: t.googleId });
          noteDeletes.push(t);
        }
      }
    }

    const dels = googleDeletes.filter((d) => d.gtId && d.listId);
    if (!dels.length && !noteDeletes.length) return;

    // Mass guard on Google deletions (same shape as the deletion phase).
    const tracked = this.baselines.keys().length || tasks.filter((t) => t.googleId).length;
    const guard = Math.max(15, Math.ceil(tracked * 0.25));
    if (dels.length > guard) {
      const msg = `Momentum sync: reconciliation wants to remove ${dels.length} duplicate Google tasks — more than the safety limit (${guard}).\n\nThis usually means duplicates piled up from syncing on two devices, but it can also be a sync glitch. If you continue, the extra copies are removed from Google (one is kept per task).\n\nRemove the duplicates?`;
      const ok = confirmMass ? await confirmMass(msg) : false;
      if (!ok) { result.errors.push(`Reconcile guard: user declined; kept ${dels.length} duplicate Google tasks.`); return; }
    }

    // Apply Google deletions.
    const deletedIds = new Set<string>();
    for (const d of dels) {
      try {
        await deleteTask(at, d.listId, d.gtId);
        this.baselines.remove(d.gtId);
        deletedIds.add(d.gtId);
        result.deleted++;
        result.notes.push(`Reconcile: removed duplicate Google task ${d.gtId}.`);
      }
      catch (e) { result.errors.push(`Reconcile delete GT ${d.gtId}: ${String(e)}`); }
    }

    // Delete loser notes (hard delete — the Winner note is kept; not archived).
    for (const t of noteDeletes) {
      try {
        await this.store.deleteTask(t);
        result.orphaned++;
        result.notes.push(`Reconcile: removed duplicate note "${t.title}".`);
      }
      catch (e) { result.errors.push(`Reconcile delete note "${t.title}": ${String(e)}`); }
    }

    // Relink any surviving note whose Google task was deleted as a loser to the Winner id,
    // and repair duplicate-key frontmatter on it so a previously stuck card works again.
    for (const t of this.store.loadTasks()) {
      try { await this.store.repairTaskFileByPath(t.path); } catch { /* best-effort */ }
      if (t.googleId && deletedIds.has(t.googleId) && t.googleList) {
        const winnerId = listSigWinner.get(`${t.googleList}\u0000${sigKey(t.title, t.due, localStatus(t))}`);
        if (winnerId && winnerId !== t.googleId) {
          try {
            await this.store.setTaskGoogleLink(t, winnerId, t.googleList);
            this.baselines.set(winnerId, { title: t.title, status: localStatus(t), due: normalizeYmd(t.due) });
          } catch (e) { result.errors.push(`Reconcile relink "${t.title}": ${String(e)}`); }
        }
      }
    }
  }

  /**
   * Bring the Google side in line with the Obsidian side (confirmed/manual syncs only):
   *  1. RELOCATE any linked task whose Google list ≠ the list its board maps to. Google
   *     has no cross-list move, so we re-create it in the correct list, delete the old
   *     copy, and re-link the note. This is what actually moves tasks from a stale list
   *     (e.g. an old "General Tasks") into the "My Tasks" default list.
   *  2. DELETE tombstoned (ignored) Google lists entirely — the old boards the user removed
   *     or that were renamed away (e.g. "General Tasks", "Momentum Life"). Never the default.
   */
  private async consolidateLists(
    at: string, tasks: Task[], boardToListId: Map<string, string>,
    gtLists: GTTaskList[], defaultListId: string,
    localStatus: (t: Task) => GTTask["status"], result: GTSyncResult,
  ): Promise<void> {
    // 1. Relocate mislinked tasks to their board's list.
    for (const t of tasks) {
      if (!t.googleId || !t.googleList) continue;
      const target = boardToListId.get(t.kanbanName || "My Tasks");
      if (!target || target === t.googleList) continue;
      try {
        const created = await createTask(at, target, { title: t.title, notes: "", status: localStatus(t), due: toGTDue(t.due) });
        try { await deleteTask(at, t.googleList, t.googleId); } catch { /* old copy may already be gone */ }
        if (created.id) {
          await this.store.setTaskGoogleLink(t, created.id, target);
          this.baselines.remove(t.googleId);
          this.baselines.set(created.id, { title: t.title, status: localStatus(t), due: normalizeYmd(t.due) });
          result.pushed++;
        }
      } catch (e) { result.errors.push(`Relocate "${t.title}": ${String(e)}`); }
    }
    // 2. Delete tombstoned lists (never the permanent default).
    const ignored = new Set(this.store.loadIgnoredBoards());
    for (const l of gtLists) {
      if (!ignored.has(l.title) || l.id === defaultListId) continue;
      try { await deleteTaskList(at, l.id); result.deleted++; }
      catch (e) { result.errors.push(`Delete list "${l.title}": ${String(e)}`); }
    }
  }

  /**
   * Propagate deletions safely, both directions:
   *  A. Obsidian → Google: a baseline id we synced before, still present on Google, but no
   *     longer referenced by any local note → the note was deleted → delete the Google task.
   *  B. Google → Obsidian: a linked local note whose Google item is confirmed gone (direct
   *     GET returns 404/410 or deleted=true) → the note is ARCHIVED into Tasks/_orphaned/,
   *     never hard-deleted.
   * Both are gated by a sanity guard against mass disappearance.
   */
  private async reconcileDeletions(
    at: string, tasks: Task[], gtByList: Map<string, GTTask[]>, listIds: Set<string>, result: GTSyncResult,
    confirmMass?: (msg: string) => Promise<boolean>,
  ): Promise<void> {
    const fetchedIds = new Set<string>();
    const idToListId = new Map<string, string>();
    for (const [lid, arr] of gtByList) for (const gt of arr) if (gt.id) { fetchedIds.add(gt.id); idToListId.set(gt.id, lid); }
    const localIdSet = new Set(tasks.filter((t) => t.googleId).map((t) => t.googleId as string));

    // A. Local note deleted → delete on Google.
    const baseIds = this.baselines.keys();
    const candidates = baseIds.filter((id) => !localIdSet.has(id) && fetchedIds.has(id));
    // SHIELD: `loadTasks()` reads the metadata cache, so a note that momentarily fails to
    // parse (malformed YAML, a file Obsidian Sync hasn't finished writing) vanishes from it —
    // and this branch would read that as "the user deleted the note" and delete the task from
    // Google. Re-check the RAW text: if the id is still written in a note, keep the task.
    const localDeleted: string[] = [];
    if (candidates.length) {
      let rawIds: Set<string>;
      try { rawIds = await this.store.rawGoogleIds(); }
      catch { rawIds = new Set(candidates); } // can't verify → shield everything (never delete blind)
      for (const id of candidates) {
        if (rawIds.has(id)) result.errors.push(`Deletion shield: kept Google task ${id} — a note still references it.`);
        else localDeleted.push(id);
      }
    }
    const staleBoth = baseIds.filter((id) => !localIdSet.has(id) && !fetchedIds.has(id));
    for (const id of staleBoth) this.baselines.remove(id); // both sides gone → drop the tombstone.
    const delGuard = Math.max(15, Math.ceil(baseIds.length * 0.25));
    let proceedDel = localDeleted.length <= delGuard;
    if (!proceedDel) {
      const msg = `Momentum sync: ${localDeleted.length} tasks disappeared from Obsidian since the last sync — more than the safety limit (${delGuard}).\n\nThis is normal if you really deleted that many, but it can also be a sync/load glitch (e.g. a device that hadn't finished downloading). If you continue, these tasks are ALSO deleted from Google Tasks.\n\nDelete them from Google too?`;
      proceedDel = confirmMass ? await confirmMass(msg) : false;
      if (!proceedDel) result.errors.push(`Deletion guard: user declined; kept ${localDeleted.length} Google tasks.`);
    }
    if (proceedDel) {
      for (const id of localDeleted) {
        const lid = idToListId.get(id);
        if (!lid) continue;
        try {
          await deleteTask(at, lid, id);
          this.baselines.remove(id);
          result.deleted++;
          result.notes.push(`Deleted Google task ${id} (its Obsidian note is gone).`);
        }
        catch (e) { result.errors.push(`Delete GT ${id}: ${String(e)}`); }
      }
    }

    // B. Google item deleted → archive the local note (confirmed via direct GET).
    const orphanCandidates = tasks.filter((t) =>
      t.googleId && t.googleList && listIds.has(t.googleList) && !fetchedIds.has(t.googleId));
    const orphGuard = Math.max(15, Math.ceil(localIdSet.size * 0.25));
    if (orphanCandidates.length > orphGuard) {
      const msg = `Momentum sync: ${orphanCandidates.length} tasks are missing on Google since the last sync — more than the safety limit (${orphGuard}).\n\nThis is normal if you cleared that many in Google, but it can also be a sync/load glitch. If you continue, the matching Obsidian notes are moved to Tasks/_orphaned/ (archived, never deleted).\n\nArchive them?`;
      const ok = confirmMass ? await confirmMass(msg) : false;
      if (!ok) { result.errors.push(`Orphan guard: user declined; kept ${orphanCandidates.length} notes in place.`); return; }
    }
    for (const t of orphanCandidates) {
      try {
        const remote = await getTask(at, t.googleList as string, t.googleId as string);
        if (remote.deleted === true) {
          await this.store.orphanTaskNote(t);
          this.baselines.remove(t.googleId as string);
          result.orphaned++;
          result.notes.push(`Archived "${t.title}" to _orphaned (Google reported it deleted).`);
        }
      } catch (e) {
        if (isGoneErr(e)) {
          await this.store.orphanTaskNote(t);
          this.baselines.remove(t.googleId as string);
          result.orphaned++;
          result.notes.push(`Archived "${t.title}" to _orphaned (Google task ${t.googleId} is gone).`);
        } else {
          result.errors.push(`Orphan check ${t.googleId}: ${String(e)}`);
        }
      }
    }
  }

  private async applyOp(
    at: string, op: SyncOp, result: GTSyncResult,
    localStatus: (t: Task) => GTTask["status"], firstCol: string,
  ): Promise<void> {
    switch (op.kind) {
      case "link":
        await this.store.setTaskGoogleLink(op.task, op.gtId, op.listId);
        this.baselines.set(op.gtId, op.base);
        result.linked++;
        break;
      case "create": {
        const created = await createTask(at, op.listId, { title: op.task.title, notes: "", status: localStatus(op.task), due: toGTDue(op.task.due) });
        if (created.id) {
          await this.store.setTaskGoogleLink(op.task, created.id, op.listId);
          this.baselines.set(created.id, { title: op.task.title, status: localStatus(op.task), due: normalizeYmd(op.task.due) });
        }
        result.pushed++;
        break;
      }
      case "patch":
        await updateTask(at, op.listId, op.gtId, op.body);
        this.baselines.set(op.gtId, op.base);
        result.pushed++;
        break;
      case "pullUpdate":
        await this.store.updateTask(op.task, op.changes);
        this.baselines.set(op.gtId, op.base);
        result.pulled++;
        break;
      case "pullCreate":
        await this.store.createTask({
          title: op.gt.title, status: firstCol, priority: "medium",
          kanbanName: op.board,
          due: fromGTDue(op.gt.due) || undefined,
          googleId: op.gt.id, googleList: op.listId,
        });
        if (op.gt.id) this.baselines.set(op.gt.id, { title: op.gt.title, status: op.gt.status, due: fromGTDue(op.gt.due) });
        result.pulled++;
        break;
    }
  }
}
