# Implementation Plan

- [ ] 1. Add deterministic Match_Signature and Winner_Selector helpers in `src/gtSync.ts`
  - `baseTitle(title)`: trim + strip trailing ` N` (space + digits, N>=2) uniquePath suffix
  - `sigKey(title, due, status)`: normalized signature; excludes blank/`untitled`
  - `pickWinnerGoogleId(ids)`: min by code-point; `pickWinnerNote(notes)`: linked-first then min `task_id`
  - _Requirements: 4.4, 4.6, 4.7, 4.8, 6.1, 6.2, 6.3, 6.4, 6.5, 10.6_

- [ ] 2. Add `findDuplicateTaskGroups` (signature-based, deterministic) to `src/data.ts`
  - Group by `(board, baseTitle, due, normalizedStatus)`; deterministic keep/remove
  - Refactor existing `findDuplicateTasks`/`dedupeTasks` command to reuse it
  - _Requirements: 4.1, 4.2, 4.3, 5.4, 8.6_

- [ ] 3. Implement `reconcileDuplicates` in `GTSyncService` (`src/gtSync.ts`)
  - Re-list non-tombstoned lists; Google-side group+collapse; note-side group+collapse
  - Re-link Winner note; clear stale links; hard-delete loser notes
  - Update baselines (set Winner, remove losers)
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 10.2, 10.3, 10.4, 10.5_

- [ ] 4. Wire the deletion guard into `reconcileDuplicates`
  - Count google deletions toward the run guard; `confirmMass` when over threshold; decline → skip + record
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 5. Call `reconcileDuplicates` at end of `sync()` (confirmed branch, after `consolidateLists`) and repair frontmatter on touched notes
  - Use `store.repairTaskFile`; wrap so one failing group doesn't abort the rest; Notice on user-visible changes
  - _Requirements: 5.1, 7.1, 7.5, 7.6, 7.7, 9.1, 9.3, 9.4, 9.5_

- [ ] 6. Keep pre-create linking (Legacy_Bridge) and confirm it prefers linking over creating
  - Verify unlinked local task links to an existing google task by normalized title before create
  - _Requirements: 1.1, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 10.1_

- [ ] 7. Unit tests for the pure helpers (vitest)
  - `baseTitle`, `sigKey`, `pickWinnerGoogleId`, `pickWinnerNote`, determinism on shuffled input
  - _Requirements: 4.4, 4.6, 4.7, 6.2, 6.3_

- [ ] 8. Mirror any Tasks/Boards model change into `mcp/src/store.mjs` if needed
  - Reconciliation is plugin-only (MCP does no Google sync); update only if note-dedupe helpers are shared
  - _Requirements: n/a (parity rule)_

- [ ] 9. Build and deploy locally for testing
  - `npm run build`; copy `main.js`/`manifest.json`/`styles.css` to the test vault plugin folder
  - _Requirements: all_
