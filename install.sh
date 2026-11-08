#!/usr/bin/env bash
# Install the ghost plugin into opencode's global cli.json.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/src"

if [ ! -f "$src/tui.tsx" ]; then
  echo "error: missing $src/tui.tsx" >&2
  exit 1
fi

targets=()
install_all=false

usage() {
  echo "Usage: $(basename "$0") [--all] [config-dir ...]"
}

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    --all)
      install_all=true
      ;;
    -*)
      echo "error: unknown option: $arg" >&2
      usage >&2
      exit 1
      ;;
    *)
      targets+=("$arg")
      ;;
  esac
done

if [ "$install_all" = true ] || [ ${#targets[@]} -eq 0 ]; then
  if ! command -v opencode >/dev/null 2>&1; then
    echo "error: 'opencode' is not on PATH" >&2
    exit 1
  fi
  # Prefer opencode's own reported config path; fall back to the XDG default.
  cfg="$(opencode debug paths 2>/dev/null | awk '$1 == "config" { sub(/^[[:space:]]*config[[:space:]]+/, ""); print; exit }')"
  if [ -z "$cfg" ]; then
    cfg="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
  fi

  if [ "$install_all" = true ]; then
    targets+=("$cfg")
    std_cfg="$HOME/.config/opencode"
    if [ -d "$std_cfg" ] || [ -f "$std_cfg/cli.json" ] || [ -f "$std_cfg/opencode.json" ]; then
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

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required to validate configuration before installing; no files were changed" >&2
  exit 1
fi

node "$here/scripts/install.mjs" "$src" ${unique_targets+"${unique_targets[@]}"}
echo
echo "Restart opencode to load it."
