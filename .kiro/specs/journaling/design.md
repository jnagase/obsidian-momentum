# Journaling — Design

Status: **DRAFT for review.** Grounded in the existing plugin patterns; integration points marked
"(verify at impl)" are to be confirmed against the code when we build.

## 1. Where it lives in the app

Journaling is a **standard center page** (a PAView page, like Habits / Nutrition / Studies), NOT a
separate ItemView. This gives it, for free:
- the nav entry + active-highlight,
- the same center-tab behavior every other page has (the tab fix we just shipped),
- rerender/refresh plumbing.

New page id: `journal`. Registered in the page/nav registry alongside the existing pages (verify
at impl: the page list + the `renderPage`/router in `ui.ts`, and the nav definitions).

## 2. Data model (folders = source of truth)

Root: `<dataRoot>/Journal/` (dataRoot defaults to `Momentum Life`).

```
Momentum Life/Journal/
  2026/
    2026-09-23.md            # one entry per day (readable, date-based name)
    2026-09-24.md
  Templates/
    My Evening Review.md      # user-authored custom templates (optional)
  _attachments/               # (optional) images pasted into entries
```

- **One entry per day** keyed by date. Filename is the date (readable, sortable). If a person
  wants two entries in a day, we still keep one note per day and append (MVP); multiple-per-day is
  a later option.
- Entry frontmatter:
  ```yaml
  ---
  type: journal
  date: 2026-09-23
  template: five-minute        # which template produced it
  mood: 🙂                      # optional
  created: <iso>
  modified: <iso>
  ---
  ```
- Entry body = the template's prompts rendered as Markdown headings + space to write, e.g.:
  ```markdown
  ## Morning
  ### Grateful for
  - 
  ### Today's affirmation
  ### What would make today great
  - 

  ## Evening
  ### Highlights / wins
  - 
  ### What could be better
  ```
- Because entries are normal notes, images use native `![[...]]` embeds and Obsidian Sync / the
  Drive feature already cover them. No new storage layer.

### Reuse "readable notes" + folder conventions
Follow the same conventions the Tasks/other modules use (readable filenames, folder-as-truth,
frontmatter repair on load). Entries under `Journal/` must NOT be adopted by the Tasks inbox
listener (verify at impl: the create/adopt guards are scoped to `Tasks/`, so `Journal/` is already
outside their scope — confirm).

## 3. Templates

### Built-in (defined in code, e.g. `src/journal.ts`)
A template is a small structure:
```ts
interface JournalTemplate {
  id: string;                 // "five-minute"
  name: string;               // "5-Minute Journal"
  emoji?: string;
  blocks: JournalBlock[];     // ordered sections
}
interface JournalBlock {
  heading: string;            // "Morning" / "Grateful for"
  kind: "list" | "text" | "affirmation";
  prompt?: string;            // helper text shown under the heading
  timeOfDay?: "am" | "pm";    // for AM/PM templates
}
```
MVP built-ins:
- **five-minute**: AM (grateful ×3 list, affirmation, "what would make today great" list) +
  PM (highlights list, "what could be better" text).
- **gratitude**: 3 things grateful for + one deeper prompt (prompt bank rotates the deeper one).
- **free**: a single free-form block.

### Custom (authored by the user)
- A Markdown file in `Journal/Templates/<name>.md` whose headings define the blocks. Documented,
  hand-authorable format (headings = blocks; a leading `> prompt` line = helper text; an
  `<!-- am -->` / `<!-- pm -->` marker splits time-of-day). Kept deliberately simple.
- Custom templates are listed next to the built-ins in the picker.

### Rendering an entry from a template
`renderTemplateToMarkdown(template)` → the Markdown body written into a new entry. Idempotent:
opening an existing entry never regenerates it.

## 4. Config (settings)

Add to `Config/settings.md` (and mirror in the MCP `loadConfig`/`saveConfig` — remember: a field
the MCP `saveConfig` doesn't know is dropped, per project rule):
- `journalDefaultTemplate` (e.g. "five-minute")
- `journalMoodEmojis` (optional palette)
- (later) `journalReminder`

## 5. UI (the Journaling page)

Top: **template picker** (built-ins + custom) + a "Today" button that creates/opens today's entry.

Main area (MVP, clean + theme-native — reuse `pa-*` styles/conventions):
- **Today's entry**: prompt cards (one per block) with an editable area; a **mood** picker; an
  **"Add image"** action that inserts a native embed; a "open as note" affordance.
- **History**:
  - a **calendar/heatmap** of days-with-entry (reuse the existing calendar/chart helpers used by
    Habits/Fitness — verify at impl: `drawCalendar`/chart utils in `charts.ts`),
  - a **recent entries** list (title = date + template, click to open).

Visual polish (fast-follow, not MVP gate): entry "cards" with cover image, softer typography,
per-template accent color.

Accessibility: labelled sections, keyboard-reachable controls, respects `prefers-reduced-motion`
(same bar as the rest of the plugin).

## 6. Integration points to confirm at implementation
- Page registry + nav (`ui.ts`, nav definitions, `openPage` router) — add `journal`.
- Calendar/heatmap helper reuse (`charts.ts`).
- Data store methods (`data.ts`): add journal read/write/list mirroring the module conventions.
- MCP store parity (`mcp/src/store.mjs`): if we expose journal read/write there, mirror it +
  keep `loadConfig`/`saveConfig` in sync for any new config field.
- Tasks inbox listener scope excludes `Journal/` (should already be true).

## 7. Free/Pro
Journaling core = **free**. No gating in the MVP. (If we ever gate, it would be an advanced view
or unlimited custom templates — a later lever, designed not to block the core loop.)

## 8. Risks / notes
- **User data**: entries are the user's writing — migrations touching them must be non-destructive
  (move, never rewrite content), same rule as Tasks.
- **Don't double-adopt**: ensure `Journal/` is never treated as tasks.
- **Whatsnew + release**: any release needs a top CHANGELOG entry matching the version (learned
  from the release-coherence test).
