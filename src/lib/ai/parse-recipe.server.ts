import { fallbackParse, tryParseRecipeDraftJson } from "@/lib/ai/parse-recipe"
import type { RecipeDraft } from "@/lib/ai/parse-recipe"

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat"
export const DEEPSEEK_PARSE_TIMEOUT_MS = 12_000

export type EnvLike = Record<string, string | undefined>

export type DeepSeekConfig = {
  apiKey: string | null
  baseUrl: string
  model: string
}

export type ParseRecipeAiOptions = {
  env?: EnvLike
  fetchFn?: typeof fetch
  timeoutMs?: number
}

export const RECIPE_EXTRACT_SYSTEM_PROMPT = `你是中文家常菜谱抽取器。根据用户粘贴的文本，只抽出做菜所需字段，必须输出一个 JSON 对象（不要营养、热量、社交、推荐或解释）。

JSON 形状：
{
  "name": "中文菜名",
  "servings": 2,
  "approxMinutes": 20,
  "items": [{"rawName":"五花肉","quantity":0.4,"unit":"斤"}],
  "steps": ["肉切片", "热锅炒熟"]
}

规则：
- name：中文菜名；看不出时用第一行或「未命名食谱」
- servings：正整数，缺省 2
- approxMinutes：大约分钟的整数；未知则为 null
- items：食材列表。rawName 用常见买菜名；quantity 为数字；unit 用菜市场单位，如 个/把/盒/袋/瓶/斤/克/头/瓣/勺/块/毫升
- 「少许」「适量」「若干」可作为 unit（quantity 用 1）
- steps：按烹饪顺序的字符串数组，不要编号前缀
- 不要输出上述字段以外的键`

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

function readMessageContent(payload: unknown): string {
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

export async function requestDeepSeekRecipeJson(
  text: string,
  options: ParseRecipeAiOptions = {}
): Promise<string> {
  const config = getDeepSeekConfig(options.env)
  if (!config.apiKey) {
    throw new Error("DEEPSEEK_API_KEY missing")
  }

  const fetchFn = options.fetchFn ?? fetch
  const timeoutMs = options.timeoutMs ?? DEEPSEEK_PARSE_TIMEOUT_MS
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
          { role: "system", content: RECIPE_EXTRACT_SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 4096,
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

export async function parseRecipeWithAi(
  text: string,
  options: ParseRecipeAiOptions = {}
): Promise<RecipeDraft> {
  if (!isAiEnabled(options.env)) {
    return fallbackParse(text)
  }

  try {
    const content = await requestDeepSeekRecipeJson(text, options)
    const draft = tryParseRecipeDraftJson(content, "ai")
    if (draft) return draft
  } catch {
    // missing key already handled; timeout / HTTP / bad JSON → fallback
  }

  return fallbackParse(text)
}
