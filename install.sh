#!/usr/bin/env bash
# Install the ghost plugin into opencode's global tui.json.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/src"

if [ ! -f "$src/tui.tsx" ]; then
  echo "error: missing $src/tui.tsx" >&2
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "error: 'opencode' is not on PATH" >&2
  exit 1
fi

# Prefer opencode's own reported config path; fall back to the XDG default.
cfg="$(opencode debug paths 2>/dev/null | awk '$1 == "config" { print $2; exit }')"
if [ -z "$cfg" ]; then
  cfg="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
fi

dest="$cfg/plugins/opencode-ghost"
mkdir -p "$dest"
cp "$src"/*.tsx "$src"/*.ts "$dest"/

entry="$dest/tui.tsx"
tui="$cfg/tui.json"

if ! command -v node >/dev/null 2>&1; then
  echo "installed plugin files -> $dest"
  echo
  echo "Add this to $tui yourself (node was not found):"
  echo "  \"plugin\": [\"$entry\"]"
  exit 0
fi

node -e '
  const fs = require("fs")
  const [file, entry] = process.argv.slice(1)
  let config = {}
  try { config = JSON.parse(fs.readFileSync(file, "utf8")) } catch {}
  const list = Array.isArray(config.plugin) ? config.plugin : []
  const has = list.some((item) => (Array.isArray(item) ? item[0] : item) === entry)
  if (!has) list.push(entry)
  config.plugin = list
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n")
' "$tui" "$entry"

echo "installed -> $entry"
echo "registered in $tui"
echo
echo "Restart opencode to load it."
