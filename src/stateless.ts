import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { ResolvedOptions } from "./options"

const WELL_KNOWN_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
  ollama: "http://127.0.0.1:11434/v1",
  perplexity: "https://api.perplexity.ai",
  xai: "https://api.x.ai/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  cerebras: "https://api.cerebras.ai/v1",
}

const WELL_KNOWN_ENV_KEYS: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  groq: ["GROQ_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  perplexity: ["PERPLEXITY_API_KEY"],
  xai: ["XAI_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
}

export function resolveApiKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (trimmed.startsWith("{file:") && trimmed.endsWith("}")) {
    const filePath = trimmed.slice(6, -1).trim()
    try {
      const resolved = filePath.startsWith("~/")
        ? path.join(os.homedir(), filePath.slice(2))
        : filePath
      return fs.readFileSync(resolved, "utf8").trim()
    } catch {
      return undefined
    }
  }
  if (trimmed.startsWith("{env:") && trimmed.endsWith("}")) {
    const envVar = trimmed.slice(5, -1).trim()
    return process.env[envVar]
  }
  return trimmed
}

function resolveProviderApiKey(
  opts: ResolvedOptions,
  providerID: string | undefined,
  providerConfig: any,
  providerState: any,
): string | undefined {
  if (opts.apiKey) return resolveApiKey(opts.apiKey)

  const configKey = resolveApiKey(providerConfig?.options?.apiKey)
  if (configKey) return configKey

  const stateOptionKey = resolveApiKey(providerState?.options?.apiKey)
  if (stateOptionKey) return stateOptionKey

  const stateKey = resolveApiKey(providerState?.key)
  if (stateKey) return stateKey

  if (Array.isArray(providerState?.env)) {
    for (const envName of providerState.env) {
      if (typeof envName === "string" && process.env[envName]) {
        return process.env[envName]
      }
    }
  }

  if (providerID && WELL_KNOWN_ENV_KEYS[providerID]) {
    for (const envName of WELL_KNOWN_ENV_KEYS[providerID]) {
      if (process.env[envName]) {
        return process.env[envName]
      }
    }
  }

  if (process.env.LITELLM_API_KEY) return process.env.LITELLM_API_KEY
  if (!providerID || providerID === "openai" || providerID === "custom") {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  }

  return undefined
}

export async function fetchStatelessSuggestion(
  transcript: string,
  opts: ResolvedOptions,
  modelRef: { providerID: string; modelID: string } | undefined,
  config: any,
  providers?: readonly any[],
): Promise<string | undefined> {
  const providerID = modelRef?.providerID
  const providerConfig = providerID ? config?.provider?.[providerID] : undefined
  const providerState = providerID && Array.isArray(providers)
    ? providers.find((p) => p?.id === providerID)
    : undefined

  const apiKey = resolveProviderApiKey(opts, providerID, providerConfig, providerState)
  const isAnthropic = providerID === "anthropic"

  const baseURL =
    opts.endpoint ||
    providerConfig?.options?.baseURL ||
    providerState?.options?.baseURL ||
    (!isAnthropic && providerID ? WELL_KNOWN_BASE_URLS[providerID] : undefined) ||
    process.env.LITELLM_BASE_URL ||
    process.env.OPENAI_BASE_URL

  const controller = new AbortController()
  const timeoutMs = 4000
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    if (baseURL) {
      const url = baseURL.endsWith("/chat/completions")
        ? baseURL
        : `${baseURL.replace(/\/+$/, "")}/chat/completions`

      const rawModel = modelRef?.modelID || "default"
      const keepSlash = providerID === "openrouter" || providerID === "together"
      const model = !keepSlash && rawModel.includes("/")
        ? rawModel.slice(rawModel.lastIndexOf("/") + 1)
        : rawModel

      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

      const res = await fetch(url, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: transcript },
          ],
          max_tokens: 120,
          temperature: 0.2,
        }),
      })

      if (!res.ok) return undefined
      const data = (await res.json()) as any
      return data?.choices?.[0]?.message?.content
    }

    if (modelRef?.providerID === "anthropic") {
      const antKey = apiKey || process.env.ANTHROPIC_API_KEY
      if (!antKey) return undefined
      const antBase = (
        providerConfig?.options?.baseURL ||
        providerState?.options?.baseURL ||
        "https://api.anthropic.com"
      ).replace(/\/+$/, "")
      const url = antBase.endsWith("/v1/messages") ? antBase : `${antBase}/v1/messages`
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": antKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: modelRef.modelID,
          max_tokens: 120,
          system: opts.system,
          messages: [{ role: "user", content: transcript }],
        }),
      })

      if (!res.ok) return undefined
      const data = (await res.json()) as any
      return data?.content?.[0]?.text
    }
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }

  return undefined
}
