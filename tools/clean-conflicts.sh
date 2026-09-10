#!/bin/bash
# Move Obsidian Sync conflict files (name.conflict[.conflict...].md) out of the Momentum
# Life data folder into a timestamped backup folder OUTSIDE the vault, so they are gone
# from the plugin but fully recoverable. Never hard-deletes.
#
# DRY RUN by default: prints what it would move. Pass --apply to actually move.
# Written for macOS' stock bash 3.2 (no mapfile), using NUL-safe find | while read.
#
# Usage:
#   bash tools/clean-conflicts.sh            # preview
#   bash tools/clean-conflicts.sh --apply    # move to ~/momentum-conflict-backup-<ts>/

set -u
DATA="/Users/jnagase/Documents/obsidian_1/Momentum Life"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

COUNT=$(find "$DATA" -name '*.conflict*.md' 2>/dev/null | wc -l | tr -d ' ')
echo "Found $COUNT conflict files under: $DATA"
if [ "$COUNT" -eq 0 ]; then echo "Nothing to do."; exit 0; fi

if [ "$APPLY" -eq 0 ]; then
  echo "--- DRY RUN (no changes). Pass --apply to move them. Breakdown by folder: ---"
  find "$DATA" -name '*.conflict*.md' 2>/dev/null | sed "s#$DATA/##; s#/[^/]*\$##" | sort | uniq -c
  exit 0
fi

BACKUP="$HOME/momentum-conflict-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
moved=0
find "$DATA" -name '*.conflict*.md' -print0 2>/dev/null | while IFS= read -r -d '' f; do
  rel="${f#$DATA/}"
  dest="$BACKUP/$rel"
  mkdir -p "$(dirname "$dest")"
  mv "$f" "$dest" && moved=$((moved+1)) && echo "moved: $rel"
done
echo "Backup folder: $BACKUP"
echo "Remaining conflict files: $(find "$DATA" -name '*.conflict*.md' 2>/dev/null | wc -l | tr -d ' ')"
echo "Recover any by moving them back into '$DATA'."
