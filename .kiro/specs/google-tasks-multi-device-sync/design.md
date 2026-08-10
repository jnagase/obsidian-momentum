# Design Document

## Overview

This design hardens the existing Google Tasks bidirectional sync (`src/gtSync.ts`) so the
same vault synced by Obsidian Sync across two devices, both with Google sync enabled, no
longer produces duplicate Google tasks or stuck cards. It keeps full bidirectional sync and
`google_id` as the primary key, and adds a deterministic, self-converging **reconciliation
pass** that runs at the end of every sync. Two devices running independently pick the same
survivor, so they converge instead of fighting.

Two failure modes are addressed:
1. Duplicate YAML keys in a note's frontmatter (Obsidian Sync line-merge) → stuck card.
   Already mitigated by `repairFrontmatterText` (duplicate-key collapse); this design wires
   that repair into the sync path so stuck cards heal without a manual step.
2. Duplicate Google tasks with distinct `google_id`s for the same logical task (create-race)
   plus ` 2`/` 3` suffixed notes. Addressed by pre-create linking + the reconciliation pass.

## Architecture

```
syncGoogleTasks()
  └─ GTSyncService.sync()
       ├─ PLAN (existing): link-by-title (Legacy_Bridge) or create; pull; 3-way merge
       ├─ APPLY (existing)
       ├─ [confirmed] reconcileDeletions (existing Phase 2)
       ├─ [confirmed] consolidateLists (existing)
       └─ [confirmed] reconcileDuplicates (NEW)  ← end-of-sync convergence
```

`reconcileDuplicates` is the only new stage. It re-reads the affected Google lists and the
local tasks, groups by a Match_Signature, and collapses each duplicate group down to a single
deterministic Winner, deleting the losing Google tasks (counted against the existing deletion
guard) and the losing notes.

## Components and Interfaces

### Match_Signature (module-level helper in `gtSync.ts`)

```ts
// Normalized title: trim, strip a trailing " N" (space + digits, N>=2) uniquePath suffix.
function baseTitle(title: string): string;
// Signature key for grouping duplicates within a list/board.
function sigKey(title: string, due: string, status: "completed" | "needsAction"): string;
```

- Title comparison is case-sensitive on the remaining text after trim + suffix strip
  (single source of truth, referenced by both linking and dedupe).
- Due normalized via existing `normalizeYmd`.
- Status normalized to `completed` / `needsAction` (Google) / mapped from local done column.
- Blank/`untitled` titles are excluded from grouping.

### Winner_Selector (module-level helper)

```ts
// Deterministic across devices: no wall-clock, no device state, no API order.
// Google tasks: min google id by code-point (localeCompare with sensitivity base? no —
//   use plain < / > on the string for byte-wise/code-point order).
// Notes: prefer a note WITH a google_id (min google id), else min task_id.
function pickWinnerGoogleId(ids: string[]): string;      // min by code-point
function pickWinnerNote(notes: Task[]): Task;            // linked-first, then min id
```

Rationale: `google_id` and `task_id` are stable and identical on every device, so both
devices compute the same Winner. Ties broken by the secondary stable id.

### reconcileDuplicates (new private method on `GTSyncService`)

Signature:
```ts
private async reconcileDuplicates(
  at: string,
  boardToListId: Map<string, string>,
  listIdToBoard: Map<string, string>,
  ignoredListIds: Set<string>,
  result: GTSyncResult,
  confirmMass?: (msg: string) => Promise<boolean>,
): Promise<void>
```

Steps:
1. **Re-list** each non-tombstoned list in `boardToListId`/`listIdToBoard` (fresh state after
   apply). Build `gtByList` again.
2. **Google-side dedupe** per list: group tasks by `sigKey`; for each group with >1 (skip
   blank/untitled), Winner = `pickWinnerGoogleId`; collect losing google ids to delete.
3. **Note-side dedupe** per board: reload tasks; group by `sigKey`; for each group with >1,
   Winner note = `pickWinnerNote`; losers are deleted (hard delete, not orphaned — the Winner
   is retained). If a loser note is linked to a google id that is NOT the Winner's, that google
   id is added to the delete set.
4. **Re-link**: ensure the Winner note points at the surviving Winner google id/list; clear a
   note's `google_id`/`google_list` if it referenced a deleted google task.
5. **Deletion guard**: total google deletions in this pass are added to the run's deletion
   count; if it exceeds `max(15, 25% of tracked)`, ask via `confirmMass`; decline → skip the
   deletions, keep everything, record in `result.errors`.
6. **Baselines**: `baselines.set(winnerId, convergedBaseline)`; `baselines.remove(loserId)`
   for each deleted google id.
7. Repair duplicate-key frontmatter on any note it touches via `store.repairTaskFile`.

### Data layer additions (`src/data.ts`)

- `deleteTaskByPath` / reuse existing `deleteTask(task)` (hard delete) for losing notes.
- Extend `findDuplicateTasks` OR add `findDuplicateTaskGroups(signature)` that groups by
  `(board, baseTitle, due, status)` and returns deterministic keep/remove — used by the note
  side and by the existing manual "remove duplicate tasks" command so both share one rule.

## Data Models

No new persisted fields. Identity stays:
- `task_id` (uuid) — local primary key before linking; Winner tiebreak.
- `google_id` + `google_list` — primary key after linking; Winner primary key.
- Baselines in `data.json` (`gtBaselines`) keyed by google id — updated on convergence.

The Google task `notes` field is NOT used to stamp identity (keeps the user's Google Tasks
"Details" clean; dedupe is title+list+due+status on the Obsidian side).

## Error Handling

- A failed google-task deletion: keep the Winner link, leave the remaining tasks, push the
  error into `result.errors`; the next sync retries (idempotent — same Winner chosen).
- A note that can't be parsed: `repairTaskFile` runs first; if still unparseable, it is left
  untouched and recorded, never deleted.
- Reconciliation is wrapped so one failing group does not abort the rest.
- Mass-deletion guard reuses `confirmMass`; declining is safe (no deletions).

## Testing Strategy

- Unit (vitest, pure helpers): `baseTitle` suffix stripping (` 2`, ` 10`, no-suffix, blank),
  `sigKey` equality/inequality on due/status, `pickWinnerGoogleId` (code-point order, ties),
  `pickWinnerNote` (linked-first, id tiebreak), determinism (shuffled input → same Winner).
- Manual/local: reproduce the two-device duplicates in the test vault, run "Sync now",
  confirm one note + one google task per logical task, and that a stuck (dup-key) card moves.
- Regression: single-device sync, pull-create, 3-way merge, and the mass-deletion guard still
  behave as before.
```
