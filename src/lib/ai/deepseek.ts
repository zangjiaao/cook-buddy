export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat"
export const DEEPSEEK_TIMEOUT_MS = 12_000

export type EnvLike = Record<string, string | undefined>

export const DEEPSEEK_ENV_KEYS = [
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
] as const

export type DeepSeekConfig = {
  apiKey: string | null
  baseUrl: string
  model: string
}

export type DeepSeekRequestOptions = {
  env?: EnvLike
  fetchFn?: typeof fetch
  timeoutMs?: number
  temperature?: number
  maxTokens?: number
}

function readStringField(source: unknown, key: string): string | undefined {
  if (!source || typeof source !== "object") return undefined
  const value = (source as Record<string, unknown>)[key]
  return typeof value === "string" ? value : undefined
}

/**
 * Pick DEEPSEEK_* from one or more env-like objects. Earlier sources win.
 * Call this per request — do not cache the result at module scope.
 */
export function pickDeepSeekEnv(
  ...sources: Array<unknown | undefined | null>
): EnvLike {
  const out: EnvLike = {}
  for (const source of sources) {
    if (!source) continue
    for (const key of DEEPSEEK_ENV_KEYS) {
      if (out[key] != null) continue
      const value = readStringField(source, key)
      if (value != null) out[key] = value
    }
  }
  return out
}

/**
 * Workers-safe DeepSeek env.
 * Prefer an explicit Cloudflare `env` binding, then per-request `process.env`
 * (Vite `.env.local` locally; `nodejs_compat` populate on Workers).
 */
export function resolveDeepSeekEnv(cloudflareEnv?: unknown): EnvLike {
  return pickDeepSeekEnv(
    cloudflareEnv,
    typeof process !== "undefined" ? process.env : undefined
  )
}

export function getDeepSeekConfig(env?: EnvLike): DeepSeekConfig {
  // Default is resolved at call time, not module load (Workers inject env per request).
  const source = env ?? resolveDeepSeekEnv()
  const apiKey = source.DEEPSEEK_API_KEY?.trim() || null
  return {
    apiKey,
    baseUrl: source.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL,
    model: source.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
  }
}

export function isAiEnabled(env?: EnvLike): boolean {
  return Boolean(getDeepSeekConfig(env).apiKey)
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "")
  if (trimmed.endsWith("/chat/completions")) return trimmed
  return `${trimmed}/chat/completions`
}

export function readMessageContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("DeepSeek invalid payload")
  }
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("DeepSeek empty choices")
  }
  const message = (choices[0] as { message?: { content?: unknown } }).message
  const content = message?.content
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("DeepSeek empty content")
  }
  return content
}

export const RECIPE_AGENT_ENV_KEYS = [
  "TAVILY_API_KEY",
  "BRAVE_SEARCH_API_KEY",
] as const

export function pickRecipeAgentEnv(
  ...sources: Array<unknown | undefined | null>
): EnvLike {
  const out = pickDeepSeekEnv(...sources)
  for (const source of sources) {
    if (!source || typeof source !== "object") continue
    const record = source as Record<string, unknown>
    for (const key of RECIPE_AGENT_ENV_KEYS) {
      if (out[key] != null) continue
      const value = record[key]
      if (typeof value === "string") out[key] = value
    }
  }
  return out
}

export type DeepSeekToolSpec = {
  type: "function"
  function: {
    name: string
    description: string
    parameters: {
      type: "object"
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export type DeepSeekToolCall = {
  id: string
  name: string
  arguments: string
}

export type DeepSeekChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant"
      content: string
      tool_calls?: Array<{
        id: string
        type: "function"
        function: { name: string; arguments: string }
      }>
    }
  | { role: "tool"; tool_call_id: string; content: string }

export type DeepSeekChatTurn = {
  content: string
  toolCalls: DeepSeekToolCall[]
  assistant: Extract<DeepSeekChatMessage, { role: "assistant" }>
}

function readToolArguments(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object") return JSON.stringify(value)
  return ""
}

export function readChatTurn(payload: unknown): DeepSeekChatTurn {
  if (!payload || typeof payload !== "object") {
    throw new Error("DeepSeek invalid payload")
  }
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("DeepSeek empty choices")
  }
  const message = (choices[0] as { message?: unknown }).message
  if (!message || typeof message !== "object") {
    throw new Error("DeepSeek empty content")
  }
  const record = message as {
    content?: unknown
    tool_calls?: unknown
  }
  const content = typeof record.content === "string" ? record.content : ""
  const toolCalls: DeepSeekToolCall[] = []
  if (Array.isArray(record.tool_calls)) {
    record.tool_calls.forEach((call, index) => {
      if (!call || typeof call !== "object") return
      const row = call as {
        id?: unknown
        function?: { name?: unknown; arguments?: unknown }
      }
      const name = row.function?.name
      if (typeof name !== "string" || !name) return
      toolCalls.push({
        id: typeof row.id === "string" && row.id ? row.id : `call_${index}`,
        name,
        arguments: readToolArguments(row.function?.arguments),
      })
    })
  }
  if (!content.trim() && toolCalls.length === 0) {
    throw new Error("DeepSeek empty content")
  }
  return {
    content,
    toolCalls,
    assistant: {
      role: "assistant",
      content,
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    },
  }
}

export async function requestDeepSeekChat(
  messages: DeepSeekChatMessage[],
  options: DeepSeekRequestOptions & {
    tools?: DeepSeekToolSpec[]
    jsonMode?: boolean
  } = {}
): Promise<DeepSeekChatTurn> {
  const config = getDeepSeekConfig(options.env)
  if (!config.apiKey) {
    throw new Error("DEEPSEEK_API_KEY missing")
  }

  const fetchFn = options.fetchFn ?? fetch
  const timeoutMs = options.timeoutMs ?? DEEPSEEK_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const tools = options.tools ?? []
  const payload: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 4096,
    stream: false,
  }
  if (tools.length > 0) {
    payload.tools = tools
  } else if (options.jsonMode !== false) {
    payload.response_format = { type: "json_object" }
  }

  try {
    const response = await fetchFn(chatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`DeepSeek HTTP ${response.status}`)
    }
    return readChatTurn(await response.json())
  } finally {
    clearTimeout(timer)
  }
}

export async function requestDeepSeekJson(
  system: string,
  user: string,
  options: DeepSeekRequestOptions = {}
): Promise<string> {
  const config = getDeepSeekConfig(options.env)
  if (!config.apiKey) {
    throw new Error("DEEPSEEK_API_KEY missing")
  }

  const fetchFn = options.fetchFn ?? fetch
  const timeoutMs = options.timeoutMs ?? DEEPSEEK_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchFn(chatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 4096,
        stream: false,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`DeepSeek HTTP ${response.status}`)
    }

    return readMessageContent(await response.json())
  } finally {
    clearTimeout(timer)
  }
}
