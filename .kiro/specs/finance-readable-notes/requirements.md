# Requirements Document

## Introduction

The Finance module of the Momentum Life Obsidian plugin currently writes one Markdown file per transaction using an opaque, machine-generated name (e.g. `2026-06-30-expense-142530-a3f9k.md`). This makes the Obsidian file list and Graph View unreadable and leaves no structure connecting a month's transactions.

This feature makes per-transaction notes human-readable and organizes them in the Graph View through monthly hub notes. It keeps one file per transaction, renames each file to a readable scheme (`<category>-<note>-<amount>-<YYYY-MM-DD>`), links every transaction note to its month's hub via a wikilink, and generates a consolidated monthly hub note with an income/expense/balance summary plus links to that month's transactions. A retroactive migration brings existing vaults onto the new scheme safely: it preserves user-added body lines, is idempotent, is guarded so it never runs needlessly, and offers a dry-run preview.

The work touches only the data layer, reuses existing store primitives, does not depend on the personal build's kiro-cli bridge (so it works in both the community and personal builds), and is scoped to Finance transactions only. Frontmatter remains the source of truth for transaction data; filenames and hub notes are derived, regenerable views.

## Glossary

- **Finance Data Store**: The data-layer component (`PADataStore` in `src/data.ts`) that creates, deletes, loads, and migrates finance transaction notes and month hubs.
- **Filename Builder**: The set of pure functions (`sanitizeSegment`, `formatAmount`, `financeTxTitle`) that deterministically turn a transaction into a readable, filesystem-safe title.
- **Month Hub Generator**: The `syncMonthHub` routine that regenerates or removes the consolidated note for a single month.
- **Transaction Note**: A single Markdown file under `Finance/Transactions` whose frontmatter (`id`, `date`, `tx_type`, `amount`, `category`, `note`) is the source of truth for one transaction.
- **Month Hub**: A regenerable Markdown note under `Finance/Months` (named `<YYYY-MM Month>`, e.g. `2026-06 June`) that summarizes a month's income, expenses, and balance and links that month's transactions.
- **Migration**: The `migrateFinanceNotes` operation that renames legacy transaction files to the readable scheme, ensures hub links, and regenerates month hubs — idempotently and guarded.
- **Schema Guard**: A persisted, versioned settings flag (`financeNotesSchema`) that ensures migration runs at most once per schema version.
- **Dry-run**: A migration mode that computes and returns a report (renames, skips, hubs, warnings) without writing any changes.
- **Plugin**: The Momentum Life Obsidian plugin host that registers commands and the guarded auto-run.
- **Sanitize**: To transform a raw category or note string into a filesystem-safe filename segment.

## Requirements

### Requirement 1: Readable Transaction Filenames

**User Story:** As a user browsing my vault, I want transaction files to have readable, meaningful names, so that the file list and Graph View are legible.

#### Acceptance Criteria

1. WHEN the Finance Data Store creates a Transaction Note, THE Filename Builder SHALL name the file using the format `<category>-<note>-<amount>-<YYYY-MM-DD>`.
2. WHERE a transaction note sanitizes to a non-empty value, THE Filename Builder SHALL include the note segment between the category and the amount.
3. IF a transaction note is empty, blank, or sanitizes to an empty value, THEN THE Filename Builder SHALL omit the note segment from the filename.
4. THE Filename Builder SHALL format the amount with exactly two decimal places, using a period as the decimal separator and no digit grouping.
5. THE Filename Builder SHALL exclude any income or expense marker from the filename.
6. WHEN sanitizing a filename segment, THE Filename Builder SHALL replace characters that are invalid in filenames with a separator, convert whitespace runs to single hyphens, collapse repeated hyphens, and trim leading and trailing hyphens.
7. WHEN sanitizing a filename segment, THE Filename Builder SHALL preserve Unicode letters including accented characters and digits.
8. IF a filename segment sanitizes to an empty value (for example a symbol-only segment), THEN THE Filename Builder SHALL drop that segment from the filename.
9. WHEN given identical transaction input, THE Filename Builder SHALL produce an identical filename.

### Requirement 2: Collision-Free Naming

**User Story:** As a user, I want transactions that share a readable name to coexist with clean, predictable filenames, so that names stay legible and free of random noise.

#### Acceptance Criteria

1. WHEN no file with the desired readable base name exists, THE Finance Data Store SHALL use the clean base name as the filename.
2. IF a file with the desired base name already exists, THEN THE Finance Data Store SHALL append the smallest available sequential numeric suffix (` 2`, ` 3`, …) so that the resulting path does not already exist.
3. THE Finance Data Store SHALL apply sequential numeric suffixes only, using a random suffix in no case.

### Requirement 3: Monthly Hub Notes

**User Story:** As a user, I want a consolidated monthly hub note summarizing my income, expenses, and balance and listing that month's transactions, so that I can review a month at a glance and see it clustered in the Graph View.

#### Acceptance Criteria

1. WHEN a transaction is created or deleted, THE Month Hub Generator SHALL regenerate the Month Hub for the affected month.
2. THE Month Hub Generator SHALL name each Month Hub using the format `<YYYY-MM Month>` (for example `2026-06 June`).
3. THE Month Hub Generator SHALL include the month's consolidated Income, Expenses, and Balance formatted in the currency from the configuration.
4. THE Month Hub Generator SHALL compute Income as the sum of income transaction amounts, Expenses as the sum of expense transaction amounts, and Balance as Income minus Expenses.
5. THE Month Hub Generator SHALL include a linked list of exactly the transactions belonging to that month, ordered by date and then by title.
6. IF a month has zero transactions, THEN THE Month Hub Generator SHALL remove that month's Month Hub.
7. WHILE the regenerated hub body for a month is unchanged, THE Month Hub Generator SHALL perform no write to the hub file.
8. THE Month Hub Generator SHALL create hub notes per month only and SHALL maintain month-scoped hubs as the sole finance hubs.

### Requirement 4: Transaction-to-Hub Linking

**User Story:** As a user, I want each transaction note to link to its month's hub, so that the Graph View clusters transactions by month.

#### Acceptance Criteria

1. WHEN the Finance Data Store creates a Transaction Note, THE Finance Data Store SHALL include a wikilink to the corresponding Month Hub (for example `[[2026-06 June]]`) in the note body.
2. THE Finance Data Store SHALL reference the Month Hub by its basename so the wikilink resolves without a path.

### Requirement 5: Retroactive Migration

**User Story:** As a user with an existing vault of legacy-named transaction files, I want to migrate them onto the readable scheme safely and without losing my edits, so that my whole finance history benefits from the new format.

#### Acceptance Criteria

1. WHEN the migration command is invoked, THE Migration SHALL rename all legacy transaction files under `Finance/Transactions` to the readable scheme.
2. THE Migration SHALL ensure each transaction has a stable frontmatter `id` before renaming that file.
3. WHEN renaming a transaction file, THE Migration SHALL use a backlink-aware rename so existing wikilinks to that transaction remain valid.
4. WHEN migrating a transaction note body, THE Migration SHALL retain every user-added body line, including manual lines such as `Hub: [[Hub - Personal]]`.
5. WHEN migrating a transaction note body, THE Migration SHALL add the Month Hub wikilink to the body at most once.
6. WHEN the Migration runs a second time on an already-migrated vault, THE Migration SHALL perform no renames and rewrite no bodies, and SHALL report zero renames.
7. WHERE the dry-run option is set, THE Migration SHALL compute and return a report of renames, skips, hubs, and warnings without writing any changes.
8. IF a transaction file has missing or malformed frontmatter (no date or no amount), THEN THE Migration SHALL skip that file and record a warning.
9. IF a rename fails, THEN THE Migration SHALL record a warning, continue processing the remaining files, and leave the Schema Guard unset.
10. THE Migration SHALL be guarded by the versioned Schema Guard so it runs at most once per schema version.
11. WHEN the migration command completes successfully, THE Plugin SHALL set the Schema Guard to the current schema version.
12. WHEN the workspace layout becomes ready AND the Schema Guard is below the current schema version, THE Plugin SHALL run the Migration once as a guarded auto-run.
13. WHEN migration processes a month, THE Migration SHALL regenerate that month's Month Hub.
14. THE Plugin SHALL document rollback and backup guidance for migration, covering vault backup or commit, Obsidian trash recovery for removed files, and dry-run preview.

### Requirement 6: Data Integrity Across Renames

**User Story:** As a user, I want my transaction data and totals to remain exactly the same when files are renamed or hubs regenerated, so that presentation changes never corrupt my records.

#### Acceptance Criteria

1. WHEN a transaction file is renamed, THE Finance Data Store SHALL load the transaction data (`id`, `date`, `type`, `amount`, `category`, `note`) unchanged from before the rename.
2. THE Finance Data Store SHALL derive transaction data solely from frontmatter and SHALL treat the filename as presentation only.
3. WHEN transactions are renamed, THE Month Hub Generator SHALL produce the same Income, Expenses, and Balance totals as before the rename.

### Requirement 7: Compatibility and Scope Constraints

**User Story:** As a maintainer, I want this feature confined to the data layer and portable across both plugin builds, so that it ships safely without new dependencies or scope creep.

#### Acceptance Criteria

1. THE feature SHALL modify only the data layer of the plugin.
2. THE feature SHALL operate identically in the community build and the personal local build without depending on the kiro-cli bridge.
3. THE feature SHALL apply only to Finance transactions and SHALL leave meal logs and workouts unchanged.

### Requirement 8: Module-Prefixed Month Hubs (multi-module)

**User Story:** As a user, I want each module's month hub to be uniquely named, so that wikilinks resolve correctly and the Graph View shows one cluster per module per month.

#### Acceptance Criteria

1. THE Month Hub Generator SHALL name each hub `<Module> <YYYY-MM MonthName>` (e.g. `Finance 2026-06 June`, `Nutrition 2026-06 June`, `Fitness 2026-06 June`) so that hub basenames are unique across modules.
2. THE Finance Month Hub SHALL be named `Finance <YYYY-MM MonthName>` (revising the earlier unprefixed name) and Finance transactions SHALL link `[[Finance <YYYY-MM MonthName>]]`.
3. THE system SHALL store each module's hubs under that module's `Months` subfolder (`Finance/Months`, `Nutrition/Months`, `Fitness/Months`).
4. THE system SHALL NOT create a global cross-module hub automatically.

### Requirement 9: Readable Nutrition Logs and Monthly Hub

**User Story:** As a user, I want my meal logs to have readable names and a monthly nutrition hub, so that I can browse them and see how my month went nutritionally in the Graph View.

#### Acceptance Criteria

1. WHEN a meal is logged, THE system SHALL name the log file `<Meal>-<kcal>cal-<YYYY-MM-DD>` (e.g. `Lunch-620cal-2026-06-30`), sanitizing the meal name per the shared rules and rounding calories to an integer.
2. THE system SHALL resolve the meal display name from a `meal_name` frontmatter field, else a meals lookup by id, else the body heading, else the meal id.
3. WHEN a meal is logged, THE system SHALL write a `meal_name` frontmatter field so future naming is stable.
4. WHEN a meal is logged, THE system SHALL add a `[[Nutrition <YYYY-MM MonthName>]]` wikilink to the log body.
5. WHEN a meal log is created or deleted, THE Month Hub Generator SHALL regenerate the Nutrition Month Hub for the affected month.
6. THE Nutrition Month Hub SHALL summarize total calories, average calories per day, number of days logged, and total protein and carbs, plus a linked list of that month's logs.
7. IF a month has zero meal logs, THEN THE Month Hub Generator SHALL remove that month's Nutrition Month Hub.
8. WHEN a meal log file is renamed, THE system SHALL load its data (`id`, `date`, `meal`, `calories`, `protein`, `carbs`, `items`) unchanged from before the rename.

### Requirement 10: Readable Fitness Workouts and Monthly Hub

**User Story:** As a user, I want my workouts to have readable names and a monthly fitness hub, so that I can browse them and see how my training month went in the Graph View.

#### Acceptance Criteria

1. WHEN a workout is logged, THE system SHALL name the workout file `<Split>-<duration>min-<YYYY-MM-DD>` (e.g. `PushDay-45min-2026-06-30`), sanitizing the split name per the shared rules and rounding duration to an integer minute value.
2. THE system SHALL resolve the split display name from the configured split names, else the split id.
3. WHEN a workout is logged, THE system SHALL add a `[[Fitness <YYYY-MM MonthName>]]` wikilink to the workout body.
4. WHEN a workout is created or deleted, THE Month Hub Generator SHALL regenerate the Fitness Month Hub for the affected month.
5. THE Fitness Month Hub SHALL summarize the number of workouts, total minutes, and a per-split breakdown, plus a linked list of that month's sessions.
6. IF a month has zero workouts, THEN THE Month Hub Generator SHALL remove that month's Fitness Month Hub.
7. WHEN a workout file is renamed, THE system SHALL load its data (`id`, `date`, `split`, `duration`, `exercises`) unchanged from before the rename.

### Requirement 11: Multi-Module Migration

**User Story:** As a user, I want the retroactive migration to cover finances, nutrition, and fitness, so that my whole history becomes readable and graph-navigable in one go.

#### Acceptance Criteria

1. WHEN the migration runs, THE Migration SHALL apply the readable-name + hub-link + month-hub generation to Finance transactions, Nutrition logs, and Fitness workouts.
2. THE Migration SHALL be guarded by a single versioned schema flag (`readableNotesSchema`) covering all three modules.
3. THE Migration SHALL preserve user-added body lines and add each module's hub link at most once, for all three modules.
4. THE explicit migration command SHALL be module-agnostic (e.g. "Momentum: migrate notes to readable names") and its report SHALL aggregate per-module counts and warnings.
