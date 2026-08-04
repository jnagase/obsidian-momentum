# Momentum Life — MCP server

A local [MCP](https://modelcontextprotocol.io) server that lets an AI assistant
(Amazon Q, Claude Desktop, kiro, etc.) read and write your **Momentum Life**
Obsidian vault directly on disk. It writes the *exact same* Markdown files the
plugin does (same frontmatter format, readable filenames, month hubs, task-list
mirrors, board validation), so the plugin and the assistant stay in sync.

Runs **locally, on demand** (stdio): the client starts the process when a chat
opens and stops it when the chat closes. No network server, no open ports.
Your data never leaves the machine because of this server.

## Install

```bash
cd mcp
npm install
```

Requires Node 18+.

## Run (manual test)

```bash
node src/server.mjs --vault "/Users/jnagase/Documents/Obsidian_jnagase"
```

Optional: `--data-root "Momentum Life"` (defaults to `Momentum Life`).
You can also use env vars: `MOMENTUM_VAULT`, `MOMENTUM_DATA_ROOT`.

## Configure your MCP client

Add to your client's `mcp.json` (e.g. `~/.kiro/settings/mcp.json` or the
equivalent for your assistant):

```json
{
  "mcpServers": {
    "momentum-life": {
      "command": "node",
      "args": [
        "/Users/jnagase/Library/CloudStorage/OneDrive-amazon.com/My Documents/Coding Projects/obsidian-momentum/mcp/src/server.mjs",
        "--vault",
        "/Users/jnagase/Documents/Obsidian_jnagase"
      ],
      "disabled": false,
      "autoApprove": [
        "get_config", "list_boards", "list_tasks", "list_recurring_tasks",
        "list_notes", "list_habits", "list_splits", "list_exercises",
        "list_workouts", "list_meals", "list_meal_logs", "get_water",
        "list_study_cards", "list_transactions", "list_recurring_costs",
        "finance_month_summary"
      ]
    }
  }
}
```

`autoApprove` above lists only the **read-only** tools, so writes always ask for
confirmation. Remove it to confirm everything, or add write tools once you trust it.

## Tools

### Read (safe)
- `get_config`
- `list_boards`, `list_tasks {board?, status?}`, `list_recurring_tasks`
- `list_transactions {month?, type?}`, `finance_month_summary {month}`, `list_recurring_costs`
- `list_meals`, `list_meal_logs {month?}`, `get_water`
- `list_splits`, `list_exercises`, `list_workouts {month?}`
- `list_study_cards {topic?, status?}`
- `list_habits`, `list_notes`

### Write
- **Tasks**: `create_task`, `update_task`, `complete_task`, `delete_task`, `create_board`
- **Finance**: `add_transaction`, `delete_transaction`, `add_recurring_cost`
- **Nutrition**: `log_meal`, `delete_meal_log`, `add_water`
- **Fitness**: `log_workout`, `delete_workout`
- **Habits**: `create_habit`, `toggle_habit`
- **Studies**: `create_study_card`
- **Notes**: `create_note`
- **Config**: `update_config`

## Safety / invariants (why writes stay consistent)
- **Task columns are validated** against your config; an invalid status falls back to the first column (avoids the `status: todo` problem).
- **Boards are auto-registered**: creating a task on a new board name adds it to `Tasks/boards.md` (avoids orphan boards like the earlier "Path to L8").
- **Readable filenames** for transactions/meals/workouts (same scheme as the plugin).
- **Month hubs** (Finance/Nutrition/Fitness) are regenerated after each write, and **task-list mirrors** (`Tasks/Lists/<board>/tasks.md`) are rebuilt — so the vault stays correct even when Obsidian isn't open.
- It writes the **source notes**, never fights the generated mirrors, so there's no risk of the earlier runaway loop.

## Notes
- Best to run writes while Obsidian is closed *or* open — both are fine; the plugin re-reads on change. If Obsidian is open, its own sync/regeneration is harmless (idempotent).
- Keep this in sync with `src/readablenotes.ts` and `src/data.ts` if the plugin's formats change (`mcp/src/naming.mjs` mirrors the naming module).
