import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { ResolvedOptions } from "./options"

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

export async function fetchStatelessSuggestion(
  transcript: string,
  opts: ResolvedOptions,
  modelRef: { providerID: string; modelID: string } | undefined,
  config: any,
): Promise<string | undefined> {
  const provider = modelRef?.providerID ? config?.provider?.[modelRef.providerID] : undefined
  const baseURL =
    opts.endpoint ||
    provider?.options?.baseURL ||
    process.env.LITELLM_BASE_URL ||
    process.env.OPENAI_BASE_URL
  const rawKey =
    opts.apiKey ||
    provider?.options?.apiKey ||
    process.env.LITELLM_API_KEY ||
    process.env.OPENAI_API_KEY
  const apiKey = resolveApiKey(rawKey)

  const controller = new AbortController()
  const timeoutMs = 4000
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    if (baseURL) {
      const url = baseURL.endsWith("/chat/completions")
        ? baseURL
        : `${baseURL.replace(/\/+$/, "")}/chat/completions`

      const rawModel = modelRef?.modelID || "default"
      const model = rawModel.includes("/")
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
      const antKey = resolveApiKey(provider?.options?.apiKey) || process.env.ANTHROPIC_API_KEY
      if (!antKey) return undefined
      const res = await fetch("https://api.anthropic.com/v1/messages", {
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
