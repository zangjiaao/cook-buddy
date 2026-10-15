import {
  classifyNamesLocal,
  mergeClassifications,
  namesNeedingAi,
  parseClassifyResponse,
} from "@/lib/ai/classify-ingredients"
import type { ClassifiedName } from "@/lib/ai/classify-ingredients"
import {
  DEEPSEEK_TIMEOUT_MS,
  isAiEnabled,
  requestDeepSeekJson,
} from "@/lib/ai/deepseek"
import type { DeepSeekRequestOptions } from "@/lib/ai/deepseek"

export const INGREDIENT_CLASSIFY_SYSTEM_PROMPT = `你是中文厨房食材分类器。只输出一个 JSON 对象，不要解释。

{
  "results": [
    {"name":"五香粉","category":"seasoning"}
  ]
}

category 只能是 meat / veg / dry / seasoning / other：
- meat：猪牛羊鸡鸭鱼虾蟹等荤菜，以及鸡蛋、鸭蛋、皮蛋
- veg：蔬菜、水果、豆腐等鲜货
- dry：干货、米面粮、粉丝、木耳香菇干品、奶粉
- seasoning：调味料、酱醋、盐糖、香料、食用油和各种植物油
- other：奶制品，或拿不准的东西

拿不准就用 other，不要猜成 veg。每条输入都要有结果。不要输出上述以外的键。`

export async function classifyIngredientsWithAi(
  names: string[],
  options: DeepSeekRequestOptions = {}
): Promise<ClassifiedName[]> {
  const local = classifyNamesLocal(names)
  const pending = namesNeedingAi(local)
  if (pending.length === 0 || !isAiEnabled(options.env)) return local

  try {
    const content = await requestDeepSeekJson(
      INGREDIENT_CLASSIFY_SYSTEM_PROMPT,
      JSON.stringify({ names: pending }),
      { ...options, timeoutMs: options.timeoutMs ?? DEEPSEEK_TIMEOUT_MS }
    )
    return mergeClassifications(local, parseClassifyResponse(content))
  } catch {
    return local
  }
}
