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
`Fitness/Workouts`, `Nutrition/Plan`, `Nutrition/Logs`, `Studies/`, `Habits/`,
`Finance/Transactions/`, `Config/settings.md`.

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
