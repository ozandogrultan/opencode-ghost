#!/usr/bin/env bash
# Install the ghost plugin into opencode's global tui.json.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/src"

if [ ! -f "$src/tui.tsx" ]; then
  echo "error: missing $src/tui.tsx" >&2
  exit 1
fi

targets=()
install_all=false

for arg in "$@"; do
  if [ "$arg" = "--all" ]; then
    install_all=true
  else
    targets+=("$arg")
  fi
done

if [ "$install_all" = true ] || [ ${#targets[@]} -eq 0 ]; then
  if ! command -v opencode >/dev/null 2>&1; then
    echo "error: 'opencode' is not on PATH" >&2
    exit 1
  fi
  # Prefer opencode's own reported config path; fall back to the XDG default.
  cfg="$(opencode debug paths 2>/dev/null | awk '$1 == "config" { print $2; exit }')"
  if [ -z "$cfg" ]; then
    cfg="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
  fi

  if [ "$install_all" = true ]; then
    targets+=("$cfg")
    std_cfg="${HOME:-$HOME}/.config/opencode"
    if [ -d "$std_cfg" ] || [ -f "$std_cfg/tui.json" ] || [ -f "$std_cfg/opencode.json" ]; then
      targets+=("$std_cfg")
    fi
  else
    targets+=("$cfg")
  fi
fi

unique_targets=()
for t in "${targets[@]}"; do
  resolved="$(cd "$t" 2>/dev/null && pwd || echo "$t")"
  already=false
  for u in ${unique_targets+"${unique_targets[@]}"}; do
    u_res="$(cd "$u" 2>/dev/null && pwd || echo "$u")"
    if [ "$resolved" = "$u_res" ]; then
      already=true
      break
    fi
  done
  if [ "$already" = false ]; then
    unique_targets+=("$t")
  fi
done

for target_cfg in ${unique_targets+"${unique_targets[@]}"}; do
  dest="$target_cfg/plugins/opencode-ghost"
  mkdir -p "$dest"
  cp "$src"/*.tsx "$src"/*.ts "$dest"/

  entry="$dest/tui.tsx"
  tui="$target_cfg/tui.json"

  if ! command -v node >/dev/null 2>&1; then
    echo "installed plugin files -> $dest"
    echo
    echo "Add this to $tui yourself (node was not found):"
    echo "  \"plugin\": [\"$entry\"]"
    continue
  fi

  node -e '
    const fs = require("fs")
    const path = require("path")
    const [file, entry, configDir] = process.argv.slice(1)
    let config = {}
    try { config = JSON.parse(fs.readFileSync(file, "utf8")) } catch {}
    const list = Array.isArray(config.plugin) ? config.plugin : []
    const target = path.resolve(entry)
    const isEntry = (item) => {
      const spec = Array.isArray(item) ? item[0] : item
      return typeof spec === "string" && path.resolve(configDir, spec) === target
    }
    if (!list.some(isEntry)) list.push(entry)
    config.plugin = list
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n")
  ' "$tui" "$entry" "$target_cfg"

  echo "installed -> $entry"
  echo "registered in $tui"
done
echo
echo "Restart opencode to load it."
