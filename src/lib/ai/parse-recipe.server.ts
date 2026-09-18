import {
  DEEPSEEK_TIMEOUT_MS,
  isAiEnabled,
  requestDeepSeekJson,
} from "@/lib/ai/deepseek"
import { fallbackParse, tryParseRecipeDraftJson } from "@/lib/ai/parse-recipe"
import type { RecipeDraft } from "@/lib/ai/parse-recipe"
import type { DeepSeekRequestOptions } from "@/lib/ai/deepseek"

export {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  chatCompletionsUrl,
  getDeepSeekConfig,
  isAiEnabled,
  pickDeepSeekEnv,
  resolveDeepSeekEnv,
} from "@/lib/ai/deepseek"
export type { DeepSeekConfig, EnvLike } from "@/lib/ai/deepseek"

export const DEEPSEEK_PARSE_TIMEOUT_MS = DEEPSEEK_TIMEOUT_MS

export type ParseRecipeAiOptions = DeepSeekRequestOptions

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

export async function requestDeepSeekRecipeJson(
  text: string,
  options: ParseRecipeAiOptions = {}
): Promise<string> {
  return requestDeepSeekJson(RECIPE_EXTRACT_SYSTEM_PROMPT, text, {
    ...options,
    timeoutMs: options.timeoutMs ?? DEEPSEEK_PARSE_TIMEOUT_MS,
  })
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
