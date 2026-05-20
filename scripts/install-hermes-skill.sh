#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${HERMES_SKILLS_DIR:-$HOME/.hermes/skills}/aether"

mkdir -p "$DEST"
cp "$ROOT/hermes/SKILL.md" "$DEST/SKILL.md"
printf '%s\n' "$ROOT" > "$DEST/aether-hud-root.txt"

echo "Installed Aether skill to $DEST"
echo "Repo path recorded in $DEST/aether-hud-root.txt"
echo ""
echo "Next steps:"
echo "  1. Start a new Hermes session, or run /reload-skills in chat"
echo "  2. Run: hermes"
echo "  3. Type: /aether"
