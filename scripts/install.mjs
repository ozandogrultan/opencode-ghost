// Installs the ghost plugin: node scripts/install.mjs <source-dir> <config-dir>...
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
const [source, ...targetDirs] = process.argv.slice(2)
const repoSrc = path.resolve(source)
const sourceFiles = fs.readdirSync(source).filter((name) => /\.tsx?$/.test(name))
const ownedFiles = new Set(sourceFiles)

const readConfig = (file, key, entry, legacy = false) => {
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

const plans = targetDirs.map((configDir) => {
  const destination = `${configDir}/plugins/opencode-ghost`
  const entry = path.resolve(destination)
  const cliFile = `${configDir}/cli.json`
  const tuiFile = `${configDir}/tui.json`
  const resolvesTo = (spec) => {
    if (typeof spec !== "string") return false
    if (/^opencode-ghost(?:@[^/]+)?$/.test(spec)) return true
    const expanded = spec.startsWith("~/") ? path.join(process.env.HOME, spec.slice(2)) : spec
    let resolved
    try {
      resolved = expanded.startsWith("file://") ? fileURLToPath(expanded) : path.resolve(configDir, expanded)
    } catch {
      return false
    }
    return [entry, path.join(entry, "tui.tsx"), path.join(entry, "src"), path.join(entry, "src", "tui.tsx"), repoSrc, path.join(repoSrc, "tui.tsx")].includes(resolved)
  }

  const cli = readConfig(cliFile, "plugins", entry)
  const legacyConfigs = [tuiFile, `${tuiFile}c`].map((file) => ({ file, config: readConfig(file, "plugin", entry, true) }))

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
  return { destination, entry, cliFile, cli, migrated }
})

// Writes through symlinks so a linked config keeps its link.
const resolveLink = (file) => {
  try {
    return fs.realpathSync(file)
  } catch {
    try {
      return fs.lstatSync(file).isSymbolicLink() ? path.resolve(path.dirname(file), fs.readlinkSync(file)) : file
    } catch {
      return file
    }
  }
}

const writeAtomic = (requested, data) => {
  const file = resolveLink(requested)
  const temp = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temp, data)
    fs.renameSync(temp, file)
  } catch (error) {
    fs.rmSync(temp, { force: true })
    throw error
  }
}

const json = (config) => JSON.stringify(config, null, 2) + "\n"

for (const { destination, entry, cliFile, cli, migrated } of plans) {
  fs.mkdirSync(entry, { recursive: true })
  for (const name of sourceFiles) writeAtomic(path.join(entry, name), fs.readFileSync(path.join(source, name)))
  for (const name of fs.readdirSync(entry)) {
    if (/\.tsx?$/.test(name) && !ownedFiles.has(name)) fs.rmSync(path.join(entry, name), { force: true })
  }
  writeAtomic(cliFile, json(cli))
  for (const { file, config } of migrated) writeAtomic(file, json(config))
  console.log(`installed -> ${destination}`)
  console.log(`registered in ${cliFile}`)
}
