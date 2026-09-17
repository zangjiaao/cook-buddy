export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat"
export const DEEPSEEK_TIMEOUT_MS = 12_000

export type EnvLike = Record<string, string | undefined>

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

export function getDeepSeekConfig(env: EnvLike = process.env): DeepSeekConfig {
  const apiKey = env.DEEPSEEK_API_KEY?.trim() || null
  return {
    apiKey,
    baseUrl: env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL,
    model: env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
  }
}

export function isAiEnabled(env: EnvLike = process.env): boolean {
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
