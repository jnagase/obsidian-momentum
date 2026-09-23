# Journaling — Tasks

Status: **DRAFT.** Phased so we can ship a usable MVP early, then polish. Check off as we go.

## Phase 0 — Confirm the shape (no code)
- [ ] Confirm the 4 decisions in requirements.md (MVP scope, custom templates from day 1,
      mechanics-first + clean layout, free).
- [ ] Confirm data layout (`Journal/YYYY/YYYY-MM-DD.md`, one entry per day).

## Phase 1 — Data + templates (engine)
- [ ] `src/journal.ts`: `JournalTemplate`/`JournalBlock` types + built-in templates
      (five-minute, gratitude, free).
- [ ] `renderTemplateToMarkdown(template)` → entry body.
- [ ] `data.ts`: `createOrOpenTodayEntry(templateId)`, `listEntries()`, `getEntry(date)`,
      readable filename + frontmatter (`type: journal`, date, template, mood), non-destructive.
- [ ] Confirm `Journal/` is excluded from the Tasks inbox/adopt listeners.

## Phase 2 — Page + basic UI (mechanics)
- [ ] Register `journal` page in the page/nav registry + router.
- [ ] Template picker + "Today" (create/open today's entry).
- [ ] Prompt-card editor bound to the entry note (edit → save, no data loss).
- [ ] Mood picker.
- [ ] "Add image" → insert native `![[...]]` embed.

## Phase 3 — History
- [ ] Calendar/heatmap of days-with-entry (reuse chart helpers).
- [ ] Recent-entries list with quick open.

## Phase 4 — Custom templates
- [ ] Documented template format under `Journal/Templates/`.
- [ ] Parse custom template files into `JournalTemplate` and list them in the picker.

## Phase 5 — Polish (fast-follow)
- [ ] Entry cards with cover image, per-template accent, softer typography.
- [ ] Prompt-of-the-day bank for gratitude/reflection.
- [ ] (Optional) reminder setting.

## Phase 6 — Ship
- [ ] MCP store parity if journal is exposed there (+ config field sync).
- [ ] `whatsnew.ts` entry for the release version (release-coherence requires it).
- [ ] Verify (tsc/eslint/vitest) → build → deploy local → review → release.

## Cross-cutting rules (from project steering)
- Entries are user writing: any migration is move-only, never rewrites content.
- Sentence-case for UI text; `createDiv`/`createEl` (never `document.createElement`).
- Ask before building; commit/push only when told.
