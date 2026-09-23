# Journaling — Requirements

Status: **DRAFT for review.** Nothing is implemented yet. The decisions below are proposed
defaults so we can move; change any of them and the design/tasks follow.

## Summary

A new **Journaling** page in Momentum Life where a person keeps a daily journal guided by
**templates** (e.g. the 5-Minute Journal), can drop in **images** for a nice-looking entry, and
sees their history at a glance (calendar/heatmap + recent entries). Entries are plain Markdown
notes in the vault — the folder is the source of truth, consistent with the rest of the plugin.

## Proposed decisions (confirm or change)

1. **MVP scope** — ship a flagship + two more, then grow:
   - Flagship: **5-Minute Journal** (morning + evening prompt loop).
   - Also: **Gratitude** and **Free-form** (blank page).
   - (Later: Evening reflection, Bullet/quick, prompt-of-the-day bank.)
2. **Templates** — start with **built-in templates** AND support **user-custom templates**
   (a Markdown file with prompt placeholders) from day one, because it's cheap and it's the
   main way people make journaling their own.
3. **"Bonito" vs mechanics** — mechanics first (pick template → create today's entry → write →
   save), but with a **clean, theme-native layout** from the start (prompt cards, mood, image
   slot). Heavy visual polish is a fast-follow, not the MVP gate.
4. **Free vs Pro** — **Journaling core is FREE** (it's a core life-dashboard pillar like Habits
   and Nutrition). Pro gating, if ever, would be an *advanced* lever later (e.g. unlimited custom
   templates or an insights view) — not in the MVP.

## User stories & acceptance criteria (EARS)

### 1. Create today's entry from a template
- WHEN the user opens the Journaling page and picks a template, THE SYSTEM SHALL create (or open)
  today's entry pre-filled with that template's prompts, stored as a Markdown note.
- IF today's entry already exists, THE SYSTEM SHALL open it instead of overwriting it.
- WHERE the entry is created, THE SYSTEM SHALL store it under `Journal/` with a readable,
  date-based filename and `type: journal` frontmatter (template, date, mood).

### 2. Write and save guided by prompts
- THE SYSTEM SHALL render each template prompt as a labelled section the user fills in.
- WHEN the user edits an entry, THE SYSTEM SHALL persist changes to the Markdown note (no data
  loss; the note remains a normal, editable Obsidian file).

### 3. Add images
- THE SYSTEM SHALL let the user attach/embed an image into an entry using Obsidian's native
  embed (`![[image]]`), so the file stays portable and vault-native.
- THE SYSTEM SHALL present images in the entry layout without breaking the Markdown.

### 4. Built-in templates
- THE SYSTEM SHALL ship at least: 5-Minute Journal (AM/PM), Gratitude, Free-form.
- Each built-in template SHALL define its prompt sections (and, for AM/PM, the two time-of-day
  blocks).

### 5. Custom templates
- WHERE a user adds a template file under `Journal/Templates/`, THE SYSTEM SHALL list it as a
  selectable template alongside the built-ins.
- THE SYSTEM SHALL define a simple, documented template format (prompt lines + optional AM/PM
  blocks) that a non-developer can author by hand.

### 6. History at a glance
- THE SYSTEM SHALL show a calendar/heatmap of which days have an entry (streak-friendly).
- THE SYSTEM SHALL list recent entries with quick open.

### 7. Consistency with the plugin
- THE SYSTEM SHALL render Journaling as a standard center page (same tab behavior as Habits,
  Nutrition, etc.), reachable from the nav.
- THE SYSTEM SHALL store data under the configured data root (`Momentum Life/Journal/`), folders
  as the source of truth, and survive upgrades transparently.

## Out of scope (MVP)
- Cloud sync specifics (entries are normal notes → covered by Obsidian Sync / the Drive feature).
- AI-generated prompts or insights.
- Reminders/notifications (possible fast-follow).
- Rich WYSIWYG editing beyond Obsidian's own note editing.
