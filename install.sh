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

for target_cfg in ${unique_targets+"${unique_targets[@]}"}; do
  dest="$target_cfg/plugins/opencode-ghost"
  entry="$dest"
  cli="$target_cfg/cli.json"
  old_tui="$target_cfg/tui.json"

  if ! command -v node >/dev/null 2>&1; then
    echo "error: node is required to validate configuration before installing; no files were changed" >&2
    exit 1
  fi

  node -e '
    const fs = require("fs")
    const path = require("path")
    const [cliFile, tuiFile, destination, configDir, source] = process.argv.slice(1)
    const entry = path.resolve(destination)
    const resolvesTo = (spec) => {
      if (typeof spec !== "string") return false
      if (/^opencode-ghost(?:@[^/]+)?$/.test(spec)) return true
      const expanded = spec.startsWith("~/") ? path.join(process.env.HOME, spec.slice(2)) : spec
      let resolved
      try {
        resolved = expanded.startsWith("file://") ? require("url").fileURLToPath(expanded) : path.resolve(configDir, expanded)
      } catch {
        return false
      }
      return [entry, path.join(entry, "tui.tsx"), path.join(entry, "src"), path.join(entry, "src", "tui.tsx")].includes(resolved)
    }
    const readConfig = (file, key, legacy = false) => {
      if (!fs.existsSync(file)) return {}
      const raw = fs.readFileSync(file, "utf8")
      try {
        const config = JSON.parse(raw)
        if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error()
        if (key in config && !Array.isArray(config[key])) throw new Error()
        return config
      } catch {
        if (legacy && !raw.includes("opencode-ghost")) {
          console.error(`Warning: skipping unrelated legacy config ${file}; cannot parse it as JSON`)
          return {}
        }
        console.error(`Cannot safely parse ${file} as a JSON object; no files were changed. For JSONC, register manually: "plugins": ["${entry}"]`)
        process.exit(1)
      }
    }
    const cleanOptions = (options) => {
      if (!options || typeof options !== "object" || Array.isArray(options)) return undefined
      const { apiKey, endpoint, internalSessionMarkerDir, argHints, ...kept } = options
      return kept
    }
    const cli = readConfig(cliFile, "plugins")
    const legacyConfigs = [tuiFile, `${tuiFile}c`].map((file) => ({ file, config: readConfig(file, "plugin", true) }))

    let carriedOptions
    const migrated = []
    for (const { file, config: tui } of legacyConfigs) {
      const list = Array.isArray(tui.plugin) ? tui.plugin : []
      const remaining = list.filter((item) => {
        const spec = Array.isArray(item) ? item[0] : item && typeof item === "object" ? item.package : item
        if (!resolvesTo(spec)) return true
        const options = cleanOptions(Array.isArray(item) ? item[1] : item.options)
        if (options) carriedOptions = { ...carriedOptions, ...options }
        return false
      })
      if (remaining.length !== list.length) {
        tui.plugin = remaining
        migrated.push({ file, config: tui })
      }
    }

    const plugins = []
    let position
    let registration = {}
    let options = carriedOptions
    for (const item of cli.plugins ?? []) {
      const spec = Array.isArray(item) ? item[0] : item && typeof item === "object" ? item.package : item
      if (!resolvesTo(spec)) {
        plugins.push(item)
        continue
      }
      if (position === undefined) {
        position = plugins.length
        plugins.push(entry)
      }
      if (item && typeof item === "object") {
        if (!Array.isArray(item)) {
          const { package: ignoredPackage, options: ignoredOptions, ...fields } = item
          registration = { ...registration, ...fields }
        }
        options = { ...options, ...cleanOptions(Array.isArray(item) ? item[1] : item.options) }
      }
    }
    const normalized = options || Object.keys(registration).length ? { ...registration, package: entry, ...(options ? { options } : {}) } : entry
    if (position === undefined) plugins.push(normalized)
    else plugins[position] = normalized
    cli.plugins = plugins
    fs.mkdirSync(entry, { recursive: true })
    for (const name of fs.readdirSync(source).filter((name) => /\.tsx?$/.test(name))) fs.copyFileSync(path.join(source, name), path.join(entry, name))
    for (const name of ["builtins.ts", "completion.ts"]) fs.rmSync(path.join(entry, name), { force: true })
    fs.writeFileSync(cliFile, JSON.stringify(cli, null, 2) + "\n")
    for (const { file, config } of migrated) fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n")
  ' "$cli" "$old_tui" "$entry" "$target_cfg" "$src"

  echo "installed -> $entry"
  echo "registered in $cli"
done
echo
echo "Restart opencode to load it."
