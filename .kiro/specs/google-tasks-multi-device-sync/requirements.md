# Requirements Document

## Introduction

The Momentum Life plugin performs bidirectional sync between Momentum task boards (folders under `Tasks/`, where each note is a task with YAML frontmatter) and Google Task lists (one list per board). The sync engine lives in `src/gtSync.ts`, the data layer in `src/data.ts`, and the Google API wrapper in `src/googletasks.ts`. Sync triggers on startup, on an optional interval, on connect, and via manual "Sync now", and every trigger currently runs the full confirmed pipeline.

When the SAME vault is mirrored by Obsidian Sync across two devices (for example desktop and phone) AND Google Tasks sync is enabled on both, two failure modes appear:

1. **Duplicate-key frontmatter corruption.** Both devices write `google_id`/`google_list` onto the same note; Obsidian Sync merges the file line-by-line, producing duplicate YAML keys. The frontmatter becomes invalid, `processFrontMatter` fails silently, and the card gets stuck (its column can no longer change). A raw-text repair for duplicate keys was recently added to `repairFrontmatterText` in `data.ts`.
2. **Duplicate Google tasks with distinct ids.** Before a note's `google_id` propagates via Obsidian Sync, each device sees the task as unlinked and creates its own Google task. The result is duplicate Google tasks with DIFFERENT `google_id`s for the same logical task, plus duplicate notes with ` 2`/` 3` suffixes (via `uniquePath`). The existing dedup-by-`google_id` cannot catch these because the ids differ.

This feature hardens the sync engine against multi-device duplication while preserving full bidirectional sync. It introduces an end-of-sync reconciliation pass that deterministically collapses duplicate Google tasks and duplicate notes so that two devices running independently converge on the same result instead of deleting each other's work. The upgrade must be transparent (automatic, no manual steps, no data loss), consistent with the project's migration rules.

## Glossary

- **Sync_Engine**: The service in `src/gtSync.ts` (`GTSyncService`) that plans and applies bidirectional sync operations between boards and Google lists.
- **Data_Layer**: The `PADataStore` in `src/data.ts` that reads and writes task notes, frontmatter, and links.
- **Reconciliation_Pass**: The new end-of-sync stage that re-lists affected Google lists and collapses duplicate-artifacts (Google tasks and notes) after the normal sync operations have been applied.
- **Task_Note**: A Markdown note under `Tasks/<Board>/` representing one task, carrying frontmatter.
- **Local_Task_Id**: The `task_id` frontmatter field (a UUID assigned at note creation), the identity of a Task_Note before it is linked to Google.
- **Google_Id**: The `google_id` frontmatter field, the Google Tasks item id assigned after a task is created in or linked to Google.
- **Google_List**: The `google_list` frontmatter field, the Google Tasks list id a linked task belongs to.
- **Primary_Key**: The identifier used for normal sync operations (3-way merge, updates, deletion). It is the Local_Task_Id before first sync and the pair (Google_Id, Google_List) after first sync.
- **Duplicate_Artifact**: Two or more Google tasks in the same Google_List, or two or more Task_Notes in the same Board, that resulted from the multi-device race and represent the same logical task.
- **Board**: A folder under `Tasks/`. The folder is the source of truth. The default board is "My Tasks".
- **Default_List**: Google's built-in task list, resolved by its `@default` alias; the "My Tasks" board pairs with it by id.
- **Winner_Selector**: The deterministic rule that, given a set of Duplicate_Artifacts, chooses the single surviving item.
- **Winner**: The Duplicate_Artifact chosen by the Winner_Selector to be kept.
- **Legacy_Bridge**: The existing pre-create step that links an unlinked local task to an existing Google task in the same list matching by title before creating a new Google task.
- **Deletion_Guard**: The existing sanity check that, when more than 25% (minimum 15) of tracked tasks disappear at once, asks the user via a ConfirmModal (`confirmMass`) instead of proceeding silently.
- **Frontmatter_Repairer**: The `repairFrontmatterText`/`repairTaskFile` logic in `data.ts` that repairs malformed frontmatter in raw text, including duplicate keys.
- **Tombstoned_Board**: A board the user removed or renamed, tracked in `Config/deleted-boards.md` and excluded from discovery and sync.
- **Match_Signature**: The tuple (title, Google_List, due, status) used to decide whether two Google tasks are Duplicate_Artifacts.

## Requirements

### Requirement 1: Preserve full bidirectional sync

**User Story:** As a Momentum user, I want tasks I create in Obsidian to still be created in Google, so that hardening against duplicates does not weaken the sync I rely on.

#### Acceptance Criteria

1. WHEN the Sync_Engine processes an unlinked local Task_Note whose Board maps to a Google_List and neither the Legacy_Bridge nor the Reconciliation_Pass can link it to an existing Google task in that Google_List, THE Sync_Engine SHALL create one Google task in that Google_List whose title, due date, and completion status equal those of the Task_Note.
2. WHEN a Google task exists in a Google_List with no linked Task_Note, THE Sync_Engine SHALL create one Task_Note in the Board that pairs with that Google_List whose title, due date, and completion status equal those of the Google task.
3. WHEN the Sync_Engine creates a Task_Note for an unlinked Google task, THE Data_Layer SHALL persist that Google task's Google_Id and Google_List onto the new Task_Note frontmatter before the run ends.
4. WHILE exactly one of a linked Task_Note or its paired Google task has changed since the baseline, THE Sync_Engine SHALL push only the changed side and SHALL leave the unchanged side untouched.
5. THE Sync_Engine SHALL, within a single run, create Google tasks from unlinked local Task_Notes and create Task_Notes from unlinked Google tasks, and SHALL NOT suppress creation of a Google task solely because the corresponding item does not yet exist in Google.

### Requirement 2: Two-phase identity model

**User Story:** As a developer, I want the identity of a task to be well defined before and after its first sync, so that reconciliation and merges operate on a consistent key.

#### Acceptance Criteria

1. WHILE a Task_Note has no non-empty Google_Id field, THE Sync_Engine SHALL treat the Local_Task_Id as the Primary_Key for that task's 3-way merge, updates, and deletion.
2. WHILE a Task_Note has a non-empty Google_Id field, THE Sync_Engine SHALL treat the pair (Google_Id, Google_List) as the Primary_Key for 3-way merge, updates, and deletion.
3. WHEN a Task_Note is created, THE Data_Layer SHALL assign a Local_Task_Id that is a UUID unique across the vault, written to the note frontmatter before any sync operation runs on that note.
4. WHEN a Task_Note is first linked to a Google task, THE Data_Layer SHALL persist the Google_Id and Google_List onto the note frontmatter in a single write.
5. WHILE a Task_Note already has a non-empty Google_Id, THE Sync_Engine SHALL NOT overwrite its Google_Id or Google_List with a different value during linking.
6. IF a Task_Note exists without a Local_Task_Id, THEN THE Data_Layer SHALL assign one before using that note in any sync operation.

### Requirement 3: Pre-create linking to shrink the race window

**User Story:** As a user syncing on two devices, I want the plugin to link to an existing Google task before creating a new one, so that fewer duplicate Google tasks are ever created.

#### Acceptance Criteria

1. WHEN the Sync_Engine processes a Task_Note that has no Google_Id and whose Board maps to a Google_List, THE Sync_Engine SHALL first attempt to link it to an existing unlinked Google task in that Google_List whose title matches the Task_Note title, where an unlinked Google task is one whose id is not recorded as the Google_Id of any Task_Note.
2. IF exactly one matching unlinked Google task is found, THEN THE Sync_Engine SHALL link the Task_Note to it by persisting its Google_Id and Google_List, and SHALL NOT create a new Google task.
3. WHERE more than one unlinked Google task in the Google_List shares the matching title, THE Sync_Engine SHALL select the link target using the Winner_Selector and SHALL NOT create a new Google task.
4. IF no matching unlinked Google task is found, THEN THE Sync_Engine SHALL create a new Google task for the Task_Note.
5. WHEN comparing titles for linking, THE Sync_Engine SHALL treat two titles as matching using the same title normalization defined for the Match_Signature in Requirement 4.
6. IF a Task_Note title is blank or "untitled" per the Requirement 10 title rule, THEN THE Sync_Engine SHALL exclude it from title-based linking.

### Requirement 4: Duplicate-artifact detection by match signature

**User Story:** As a user, I want only true duplicates collapsed, so that two genuinely different tasks that happen to share a title are never merged.

#### Acceptance Criteria

1. THE Reconciliation_Pass SHALL classify two or more Google tasks in the same Google_List as Duplicate_Artifacts only when all four Match_Signature components are equal: their titles are equal per criterion 6, their Google_List ids are identical, their due dates are equal per criterion 7, and their normalized status values are equal per criterion 8.
2. IF two Google tasks in the same Google_List have equal titles per criterion 6 but differ in due date per criterion 7 or in normalized status per criterion 8, THEN THE Reconciliation_Pass SHALL NOT classify them as Duplicate_Artifacts.
3. THE Reconciliation_Pass SHALL classify two or more Task_Notes in the same Board whose titles are equal per criterion 6 as duplicate note candidates.
4. WHEN comparing titles for the Match_Signature, THE Reconciliation_Pass SHALL treat a note title carrying a `uniquePath` suffix consisting of a single space followed by one or more decimal digits (for example ` 2`, ` 3`, ` 10`) as equal to the same title with that suffix removed.
5. THE Reconciliation_Pass SHALL NOT stamp the Local_Task_Id into the Google task notes field as part of duplicate detection.
6. WHEN comparing two titles for the Match_Signature, THE Reconciliation_Pass SHALL treat them as equal only when they are identical after trimming leading and trailing whitespace and removing the `uniquePath` suffix defined in criterion 4, using a character-for-character case-sensitive comparison of the remaining text.
7. WHEN comparing two due dates for the Match_Signature, THE Reconciliation_Pass SHALL normalize each due date to `YYYY-MM-DD` before comparison and SHALL treat a missing due date as equal only to another missing due date.
8. WHEN comparing status for the Match_Signature, THE Reconciliation_Pass SHALL normalize each status to either completed or needsAction and SHALL treat two statuses as equal only when the normalized values match.

### Requirement 5: End-of-sync reconciliation pass

**User Story:** As a user with duplicates already created by the race, I want the plugin to collapse them automatically, so that my boards and Google lists return to one task per logical item.

#### Acceptance Criteria

1. WHEN the normal sync operations have been applied in a run, THE Reconciliation_Pass SHALL re-list the Google tasks of every Google_List in which that run created, updated, linked, or deleted at least one Google task.
2. WHEN a set of Duplicate_Artifact Google tasks is found in a Google_List, THE Reconciliation_Pass SHALL keep the Winner selected by the Winner_Selector and SHALL delete every other Google task in that set.
3. WHEN the Reconciliation_Pass keeps a Winner Google task, THE Reconciliation_Pass SHALL re-link the kept Task_Note to the Winner's Google_Id and Google_List and SHALL clear any Google_Id and Google_List on surviving notes that referenced a deleted Google task.
4. WHEN a set of duplicate note candidates is found in a Board, THE Reconciliation_Pass SHALL keep exactly one Task_Note chosen by the Winner_Selector, SHALL preserve the user's task content on that kept Task_Note, and SHALL remove the other Task_Notes in that set.
5. WHEN the Reconciliation_Pass keeps a Winner Google task, THE Reconciliation_Pass SHALL update the baseline store so the kept Google_Id carries the converged baseline and SHALL drop the baseline entries for every removed Google_Id.
6. WHERE a Google_List contains no Duplicate_Artifacts, THE Reconciliation_Pass SHALL make no deletions in that Google_List.
7. IF the deletion of a losing Duplicate_Artifact Google task fails, THEN THE Reconciliation_Pass SHALL retain the kept Task_Note's link to the Winner, SHALL leave the remaining Google tasks in that set in place, and SHALL record the failure in the run errors.

### Requirement 6: Deterministic winner selection

**User Story:** As a user running sync independently on two devices, I want both devices to pick the same survivor, so that they converge instead of deleting each other's keeper and losing data.

#### Acceptance Criteria

1. THE Winner_Selector SHALL select the Winner from a set of Duplicate_Artifacts using a total order computed only from stable per-artifact identifiers that are byte-for-byte identical on every device: the Google_Id for linked Google tasks and the Local_Task_Id for Task_Notes.
2. THE Winner_Selector SHALL order the Duplicate_Artifacts by ascending byte-wise (code-point) comparison of their primary identifier (Google_Id for Google tasks, Local_Task_Id for Task_Notes) and SHALL select the first artifact in that order as the Winner.
3. IF two Duplicate_Artifacts compare equal under the primary identifier, THEN THE Winner_Selector SHALL break the tie by ascending byte-wise comparison of a secondary stable identifier (the Local_Task_Id when the primary identifier is the Google_Id) so that exactly one Winner is selected.
4. WHEN two devices independently run the Winner_Selector over the same set of Duplicate_Artifacts, THE Winner_Selector SHALL select the same single Winner on both devices on every run.
5. THE Winner_Selector SHALL NOT use as any ordering or tie-break key: device-local state, the wall-clock time of the run, or the position or ordering of items in Google API responses.

### Requirement 7: Duplicate-key frontmatter repair during reconciliation

**User Story:** As a user whose card got stuck from duplicate YAML keys, I want the plugin to repair the frontmatter automatically, so that the card becomes editable again.

#### Acceptance Criteria

1. WHEN the Reconciliation_Pass processes a Task_Note whose frontmatter contains one or more keys appearing more than once, THE Frontmatter_Repairer SHALL collapse each duplicated key to a single occurrence, retaining the value from the last occurrence of that key in the raw text and placing it at the character position of the first occurrence.
2. WHEN the Reconciliation_Pass processes a Task_Note whose frontmatter contains a value that opens a flow collection (for example `[`) without a matching closing token, THE Frontmatter_Repairer SHALL rewrite that value into a form that parses as valid YAML.
3. WHERE a Task_Note frontmatter already parses as valid YAML with no duplicated keys, THE Frontmatter_Repairer SHALL leave the note's raw text byte-for-byte unchanged.
4. THE Frontmatter_Repairer SHALL operate on the raw note text so that repair succeeds even when `processFrontMatter` cannot parse the note.
5. WHEN the Frontmatter_Repairer repairs a Task_Note, THE Frontmatter_Repairer SHALL preserve every non-duplicated frontmatter field and the entire note body unchanged, so that no user content is lost.
6. WHEN the Frontmatter_Repairer finishes repairing a Task_Note, THE resulting frontmatter SHALL parse successfully via `processFrontMatter` so that the card's column can change again.
7. IF the Frontmatter_Repairer cannot produce parseable frontmatter for a Task_Note, THEN THE Frontmatter_Repairer SHALL leave the note's raw text unchanged and SHALL record the failure in the run errors.

### Requirement 8: Deletion safety during reconciliation

**User Story:** As a user, I want reconciliation deletions to respect the existing mass-deletion safeguard, so that a sync glitch cannot silently wipe many tasks.

#### Acceptance Criteria

1. WHEN the Reconciliation_Pass deletes Duplicate_Artifact Google tasks during a run, THE Sync_Engine SHALL count each such deletion toward the run's total deletion count that the Deletion_Guard evaluates.
2. IF the run's total deletion count exceeds the Deletion_Guard threshold, defined as the greater of 15 tasks and 25% of the tracked tasks (the tasks the Sync_Engine holds under management with a Primary_Key at the start of the run), THEN THE Sync_Engine SHALL, before performing any of those deletions, prompt the user via `confirmMass` with a message indicating the number of tasks to be deleted and that the cause may be a real deletion or a sync glitch.
3. IF the user declines the `confirmMass` confirmation, THEN THE Sync_Engine SHALL perform none of the deletions guarded by that confirmation, SHALL leave all affected Task_Notes and Google tasks unchanged, and SHALL record the declined decision in the run errors.
4. WHEN the user confirms the `confirmMass` prompt, THE Sync_Engine SHALL proceed to delete the Duplicate_Artifact Google tasks counted by the Deletion_Guard.
5. WHERE the run's total deletion count does not exceed the Deletion_Guard threshold, THE Sync_Engine SHALL perform the reconciliation deletions without prompting the user.
6. WHEN the Reconciliation_Pass removes a duplicate Task_Note whose Google task was deleted, THE Data_Layer SHALL delete the redundant duplicate note rather than archiving it, because the Winner note is retained.

### Requirement 9: Transparent upgrade and legacy reconciliation

**User Story:** As an existing user upgrading the plugin, I want my already-duplicated tasks reconciled automatically without losing content, so that the upgrade is transparent.

#### Acceptance Criteria

1. WHEN the plugin runs the first sync after being upgraded to a version that contains the Reconciliation_Pass, THE Reconciliation_Pass SHALL reconcile pre-existing Duplicate_Artifacts that have distinct Google_Ids, selecting the surviving item with the Winner_Selector.
2. WHILE reconciling legacy Duplicate_Artifacts, THE Reconciliation_Pass SHALL retain on the surviving Task_Note the title, due date, status, and note body, and SHALL NOT overwrite any of these non-empty fields on the surviving Task_Note with an empty value taken from a removed Duplicate_Artifact.
3. THE Reconciliation_Pass SHALL run automatically on the first sync after upgrade without requiring any manual step from the user, except the mass-deletion confirmation required by the Deletion_Guard when its threshold is exceeded.
4. WHEN reconciliation makes user-visible changes, THE plugin SHALL display a Notice indicating the number of Duplicate_Artifacts reconciled during the run.
5. IF the Reconciliation_Pass fails to reconcile a specific Duplicate_Artifact set during the upgrade sync, THEN THE Reconciliation_Pass SHALL leave that set unchanged, continue reconciling the remaining sets, and record the failure in the run errors.

### Requirement 10: Edge cases and interactions

**User Story:** As a user with varied board and task states, I want reconciliation to handle special cases correctly, so that it never corrupts protected lists or mislabels tasks.

#### Acceptance Criteria

1. WHILE a Task_Note has no Google_Id, THE Sync_Engine SHALL attempt to link it to an existing matching Google task via the Legacy_Bridge before creating a new Google task, so that a link that has not yet propagated via Obsidian Sync does not spawn a duplicate Google task.
2. WHEN a Duplicate_Artifact is present in a re-listed Google_List during the Reconciliation_Pass, THE Reconciliation_Pass SHALL collapse it in that run regardless of which earlier run created it.
3. WHERE the Board is "My Tasks", THE Sync_Engine SHALL pair it with the Default_List resolved by its `@default` id.
4. WHERE the Board is "My Tasks", THE Sync_Engine SHALL NOT create or delete the Default_List during reconciliation.
5. WHERE a Google_List corresponds to a Tombstoned_Board, THE Reconciliation_Pass SHALL exclude that Google_List from reconciliation.
6. IF a Task_Note or Google task has a title that is empty, contains only whitespace characters, or equals "untitled" (case-insensitive) after stripping any trailing ` N` numeric suffix produced by `uniquePath`, THEN THE Reconciliation_Pass SHALL exclude it from Duplicate_Artifact detection.
7. WHEN evaluating the Match_Signature, THE Reconciliation_Pass SHALL treat status as the normalized `completed` or `needsAction` value so that a completed duplicate is only merged with another task of the same title, Google_List, and due whose normalized status is also `completed`.
8. IF the Winner and a losing candidate share title, Google_List, and due but differ only in normalized status (one `completed`, one `needsAction`), THEN THE Reconciliation_Pass SHALL NOT classify them as Duplicate_Artifacts.
