# Momentum — Obsidian plugin

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-support-yellow?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/jnagase)

All-in-one life dashboard for Obsidian: **Habits, Tasks, Fitness, Nutrition and
Studies** rendered directly from your vault's Markdown files. Everything is
stored as plain Markdown under a single folder, so your data stays yours.

## Why Momentum
- Reads/writes files locally via the Vault API — no GitHub token, no CORS workarounds.
- Frontmatter parsing handled by Obsidian's metadata cache.
- Cross-device sync handled by Obsidian Sync / iCloud / git.
- Renders with Obsidian's DOM API and theme variables (no remote code, no CDN).
- One optional network call: the Nutrition food search (see [Network use & privacy](#network-use--privacy)).

## Modules
| Module | What it does |
| --- | --- |
| 🎯 Habit Tracker | Overview dashboard: KPIs, progress rings, donut charts, habit heatmaps, study progress |
| ✅ Tasks & Lists | Kanban (drag & drop, boards, priorities, columns) + list view |
| 🏋️ Fitness | Workout plans, active workout w/ timer, calendar, weight progress, logging |
| 🥗 Nutrition | Fixed meal plans, food logging, calorie calendar & trends, water, Open Food Facts search |
| 📚 Studies | Kanban by topic (drag & drop, subtopics, URLs) + list view |

All visualizations use inline SVG (no external libraries / CDN).

## Install (dev)
1. `npm install`
2. `npm run dev` (watch) or `npm run build` (production, one-off).
3. Copy/symlink this folder into your vault at
   `.obsidian/plugins/momentum/` (must contain `manifest.json`,
   `main.js`, `styles.css`).
4. In Obsidian: Settings → Community plugins → enable "Momentum".
5. Open via the command palette → "Momentum: Open" (panel in the left sidebar).

## Network use & privacy
Momentum works fully offline. The only time it reaches the internet is when you
**search for a food** in the Nutrition module. That search queries the
[Open Food Facts](https://world.openfoodfacts.org) public API
(`world.openfoodfacts.org`) over HTTPS using Obsidian's `requestUrl`, sending
only the search term you typed. No API key or account is required, and no
personal data, vault content, or telemetry is transmitted. If you never use the
food search, the plugin makes no network requests. You can always enter food
calories manually instead.

## Data location
Set the **Data root folder** in plugin settings (default: `Personal Assistant`).
Expected subfolders: `Tasks/`, `Notes/`, `Fitness/Exercises`, `Fitness/Workouts`,
`Nutrition/Plan`, `Nutrition/Logs`, `Studies/`, `Habits/`, `Config/settings.md`.

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
   `git tag 0.1.1 && git push origin 0.1.1`. The GitHub Action attaches
   `main.js`, `manifest.json` and `styles.css` to the release.
3. Submit a PR adding this plugin to
   [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases)
   (`community-plugins.json`).
