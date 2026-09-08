#!/bin/bash
# Capture one screenshot per Momentum Life tab from the DEMO vault.
#
# Targets the demo window explicitly via `vault=momentum-demo` on EVERY call, so it works
# regardless of which Obsidian window happens to be focused. HARD-GUARDS on the resolved
# vault name being "momentum-demo": if that target can't be reached (demo not open), it
# aborts and captures nothing — so it can never screenshot the real vault.
#
# Uses Obsidian's own dev:screenshot (captures the Obsidian renderer window via CDP), NOT
# the OS screencapture — so whatever else is on screen (WhatsApp, etc.) is never included.

set -u
H=/Applications/Obsidian.app/Contents/MacOS/obsidian-cli
V=momentum-demo
DEST="$(cd "$(dirname "$0")/.." && pwd)/docs/screenshots"
OUT=/tmp/capture.log
: > "$OUT"
mkdir -p "$DEST"

# 1) Guard: resolve the demo vault explicitly.
NAME="$("$H" eval vault="$V" code="app.vault.getName()" 2>>"$OUT" | sed 's/^=> //; s/^"//; s/"$//')"
echo "resolved vault: [$NAME]" >> "$OUT"
if [ "$NAME" != "$V" ]; then
  echo "ABORT: could not target $V (got '$NAME') — is the demo vault open?" >> "$OUT"
  echo "ABORT_NOT_DEMO"
  exit 3
fi

# 2) Make sure the Momentum view is open in that vault.
"$H" command vault="$V" id="momentum-life:open" >> "$OUT" 2>&1
sleep 2

# 3) Each tab: switch page, let it render, screenshot to the README's expected filename.
declare -a PAGES=(cockpit habit-tracker tasks fitness nutrition studies finances)
declare -a FILES=(cockpit-life habit-tracker tasks fitness nutrition studies finances)

for i in "${!PAGES[@]}"; do
  P="${PAGES[$i]}"
  F="${FILES[$i]}"
  "$H" eval vault="$V" code="(()=>{const l=app.workspace.getLeavesOfType('personal-assistant-view')[0]; if(!l) return 'no-leaf'; app.workspace.setActiveLeaf(l,{focus:true}); l.view.setPage('$P'); return l.view.getCurrentPage();})()" >> "$OUT" 2>&1
  sleep 3
  "$H" dev:screenshot vault="$V" path="$DEST/$F.png" >> "$OUT" 2>&1
  echo "captured $P -> $DEST/$F.png" >> "$OUT"
  sleep 1
done

echo "DONE_CAPTURE"
