import {
  DEEPSEEK_TIMEOUT_MS,
  isAiEnabled,
  requestDeepSeekJson,
} from "@/lib/ai/deepseek"
import type { DeepSeekRequestOptions } from "@/lib/ai/deepseek"
import {
  applyRuleCategories,
  parseInventoryUtteranceByRules,
  tryParseInventoryUtteranceJson,
} from "@/lib/inventory-utterance"
import type { InventoryUtteranceDraft } from "@/lib/inventory-utterance"

export const INVENTORY_UTTERANCE_SYSTEM_PROMPT = `你是中文厨房库存录入解析器。把用户的一句话拆成多条库存。只输出一个 JSON 对象，不要解释。

{
  "items": [
    {"name":"五花肉","quantity":2,"unit":"斤","category":"meat"}
  ]
}

规则：
- 按顿号、逗号、分号、换行拆开。像「两斤五花肉和一瓶生抽」也要拆成两条
- name 用常见买菜名，去掉数量和单位
- quantity 必须是数字。中文数字要换算：一=1，两=2，十=10，十二=12，半=0.5，两斤半=2.5
- unit 用斤、两、克、公斤、个、只、把、袋、瓶、盒、罐、桶、头、瓣、块、包、条、根
- category 只能是 meat / veg / dry / seasoning / other
- 调料、香料、食用油是 seasoning；干货和米面是 dry；蛋和肉是 meat；蔬菜水果是 veg；奶制品或拿不准是 other
- 拿不准分类用 other，不要猜成 veg
- 不要输出上述以外的键`

export async function parseInventoryUtteranceWithAi(
  text: string,
  options: DeepSeekRequestOptions = {}
): Promise<InventoryUtteranceDraft> {
  const fallback = parseInventoryUtteranceByRules(text)
  const trimmed = text.trim()
  if (!trimmed || !isAiEnabled(options.env)) return fallback

  try {
    const content = await requestDeepSeekJson(
      INVENTORY_UTTERANCE_SYSTEM_PROMPT,
      trimmed,
      { ...options, timeoutMs: options.timeoutMs ?? DEEPSEEK_TIMEOUT_MS }
    )
    const draft = tryParseInventoryUtteranceJson(content)
    if (draft && draft.items.length > 0) return applyRuleCategories(draft)
  } catch {
    // 没 key / 超时 / 坏 JSON → 规则切分
  }

  return fallback
}
