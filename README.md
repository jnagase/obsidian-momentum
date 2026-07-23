# Momentum Life — Obsidian plugin

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-support-yellow?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/jnagase)

All-in-one life dashboard for Obsidian: **Habits, Tasks, Fitness, Nutrition and
Studies** rendered directly from your vault's Markdown files. Everything is
stored as plain Markdown under a single folder, so your data stays yours.

## Why Momentum Life
- Reads/writes files locally via the Vault API — no GitHub token, no CORS workarounds.
- Frontmatter parsing handled by Obsidian's metadata cache.
- Cross-device sync handled by Obsidian Sync / iCloud / git.
- Renders with Obsidian's DOM API and theme variables (no remote code, no CDN).
- Optional network use only: the Nutrition food search and the AI assistant (see [Network use & privacy](#network-use--privacy)).

## Modules
| Module | What it does |
| --- | --- |
| 🎯 Habit Tracker | Overview dashboard: KPIs, progress rings, donut charts, habit heatmaps, study progress |
| ✅ Tasks & Lists | Kanban (drag & drop, boards, priorities, columns) + list view |
| 🏋️ Fitness | Workout plans, active workout w/ timer, calendar, weight progress, logging |
| 🥗 Nutrition | Fixed meal plans, food logging, calorie calendar & trends, water, Open Food Facts search |
| 📚 Studies | Kanban by topic (drag & drop, subtopics, URLs) + list view |
| 💰 Finances | Income/expense ledger, monthly summaries, category breakdown, recurring templates (monthly & weekly) |
| 🤖 AI assistant | Optional chat panel that answers about your data — bring your own API key or local tool |

All visualizations use inline SVG (no external libraries / CDN).

## Install (dev)
1. `npm install`
2. `npm run dev` (watch) or `npm run build` (production, one-off).
3. Copy/symlink this folder into your vault at
   `.obsidian/plugins/momentum-life/` (must contain `manifest.json`,
   `main.js`, `styles.css`).
4. In Obsidian: Settings → Community plugins → enable "Momentum Life".
5. Open via the command palette → "Momentum Life: Open" (panel in the left sidebar).

## AI assistant
Momentum Life ships an optional chat panel (open it from the ribbon 🤖 or the
command "Open AI assistant") that answers questions about your dashboard data.
You bring your own key — nothing is bundled.

**Cloud providers (desktop + mobile).** Pick a provider and paste your own API
key in Settings → Momentum Life → AI assistant. Supported: Gemini (Google),
Claude (Anthropic), Grok (xAI), and any OpenAI-compatible endpoint (custom base
URL — e.g. OpenRouter, a gateway, or a local server). Requests go over HTTPS
using Obsidian's `requestUrl`.

The plugin sends your message plus a short summary of your Momentum data (open
tasks, today's calories, this month's balance, etc.) only when you send a chat
message. No telemetry is collected. The plugin never runs local programs; it only
talks to the cloud provider you configure, over HTTPS.

## Network use & privacy
Momentum works offline by default. It only reaches the network in two optional
cases, and only when you actively use them:

- **Nutrition food search** — queries the
  [Open Food Facts](https://world.openfoodfacts.org) public API
  (`world.openfoodfacts.org`) over HTTPS, sending only the search term you typed.
  No API key or account required.
- **AI assistant (cloud mode)** — when you send a chat message, it contacts the
  provider you configured with your own API key, sending your message and a short
  summary of your dashboard data. The local-command mode runs a CLI on your machine
  instead and makes no direct network request from the plugin.

No personal data, vault content, or telemetry is transmitted otherwise. If you use
neither feature, the plugin makes no network requests.

## Data location
Set the **Data root folder** in plugin settings (default: `Momentum Life`).
Expected subfolders: `Tasks/`, `Tasks/Lists/`, `Notes/`, `Fitness/Exercises`,
`Fitness/Workouts`, `Fitness/Months`, `Nutrition/Plan`, `Nutrition/Logs`,
`Nutrition/Months`, `Studies/`, `Habits/`, `Finance/Transactions/`,
`Finance/Months`, `Config/settings.md`.

## Readable notes & monthly hubs
Finance transactions, Nutrition logs and Fitness workouts are saved with
human-readable filenames, and each month gets a hub note so the file list and
Graph View stay legible. Frontmatter is still the source of truth — filenames
and hub notes are derived, regenerable views, so renaming or regenerating them
never changes your data or totals.

**Readable per-item names.** Each item is one Markdown file named from its own
fields (invalid filename characters are sanitized, accents preserved):

| Item | Filename pattern | Example |
| --- | --- | --- |
| 💰 Transaction | `<category>-<note>-<amount>-<YYYY-MM-DD>` | `Groceries-Market-84.20-2026-06-30` |
| 🥗 Meal log | `<Meal>-<kcal>cal-<YYYY-MM-DD>` | `Lunch-620cal-2026-06-30` |
| 🏋️ Workout | `<Split>-<duration>min-<YYYY-MM-DD>` | `PushDay-45min-2026-06-30` |

The transaction `note` segment is dropped when empty, amounts always use two
decimals with a `.` separator (no income/expense marker in the name), and if two
items would share a name the plugin appends the smallest ` 2`, ` 3`, … suffix —
never a random string.

**Module-prefixed monthly hubs.** Each module keeps one hub per month under its
own `Months` subfolder, named `<Module> <YYYY-MM MonthName>` so basenames never
collide across modules:

- `Finance/Months/Finance 2026-06 June` — Income, Expenses and Balance in your
  configured currency, plus a linked, date-sorted list of that month's transactions.
- `Nutrition/Months/Nutrition 2026-06 June` — total calories, average per day,
  days logged, total protein/carbs, and the month's logs.
- `Fitness/Months/Fitness 2026-06 June` — workout count, total minutes, a
  per-split breakdown, and the month's sessions.

Every item body gets a wikilink to its hub (for example `[[Finance 2026-06 June]]`),
and hubs are regenerated whenever you add or delete an item. A month with no
items has its hub removed automatically. There is no global cross-module hub.

**Graph View tip.** Because each item links to its `<Module> <YYYY-MM MonthName>`
hub, the Graph View naturally clusters your notes into one group per module per
month. Open the Graph View and the hubs become the center of each monthly
cluster — a quick visual timeline of your finances, nutrition and training.

### Migrating an existing vault
If you already have legacy-named notes, run the command palette command
**"Momentum: migrate notes to readable names"**. It renames Finance, Nutrition
and Fitness notes to the readable scheme, adds each hub wikilink at most once,
and regenerates the month hubs — for all three modules in one pass. The rename is
backlink-aware (existing wikilinks keep resolving) and body-preserving (manual
lines you added, such as `Hub: [[Hub - Personal]]`, are kept). It is idempotent
and guarded, so running it again does nothing and reports zero renames. A
one-time guarded auto-run also fires the first time you open a vault on a new
schema version; the explicit command is always available to re-run it.

**Backup, dry-run & rollback.** Before migrating a large vault:

- **Back up first** — commit your vault to git or copy the data folder. This is
  the simplest full rollback.
- **Dry-run preview** — the migration supports a dry-run mode that computes the
  full report (renames, skips, hubs, warnings) without writing anything, so you
  can preview the impact before committing to it.
- **Trash recovery** — hub notes removed for empty months (and any file the
  migration replaces) go to Obsidian's trash, so you can restore them from
  Settings → Files & Links → recover deleted files.

Migration only touches filenames and hub notes; your transaction, meal and
workout data lives in frontmatter and is never modified, so totals stay identical
across renames.

## Markdown schema
Each module reads and writes plain Markdown notes with YAML frontmatter. Examples:

```yaml
# Tasks/<title>.md
task_id: "uuid"
title: "Close the deal"
status: "in progress"      # one of the task columns
priority: "high"
kanban_name: "Side Projects"
group: "KCD 26"
type: "task"
```

```yaml
# Tasks/boards.md
type: boards-config
boards:
  - id: aws
    name: AWS
    emoji: ☁️
```

```yaml
# Notes/<title>.md
title: "Idea"
color: yellow
type: note
```

## Project structure
- `src/main.ts` — plugin entry (view registration, command, settings).
- `src/view.ts` — dashboard `ItemView` (sidebar + page router).
- `src/context.ts` — shared context (store + config + refresh).
- `src/data.ts` — Vault data layer (read/write/list + per-module loaders).
- `src/types.ts` — domain model + defaults.
- `src/ui.ts` — reusable Modal/Notice helpers.
- `src/modules/*.ts` — one renderer per page.
- `styles.css` — UI styles mapped to Obsidian theme variables.

## Publishing to the community store
1. Push to a public GitHub repo.
2. Tag a release matching `manifest.json` `version` (no `v` prefix), e.g.
   `git tag 0.1.2 && git push origin 0.1.2`. The GitHub Action attaches
   `main.js`, `manifest.json` and `styles.css` to the release.
3. Submit the plugin at the
   [Obsidian Community directory](https://community.obsidian.md) (sign in, link
   your GitHub account, then Plugins → New plugin).
