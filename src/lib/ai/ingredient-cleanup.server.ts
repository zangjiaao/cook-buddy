import { isAiEnabled, requestDeepSeekJson } from "@/lib/ai/deepseek"
import type { DeepSeekRequestOptions } from "@/lib/ai/deepseek"
import { extractJsonObject } from "@/lib/ai/parse-recipe"
import { parseCleanupAdvice } from "@/lib/ingredient-cleanup"
import type { AiCleanupAdvice } from "@/lib/ingredient-cleanup"
import type { Ingredient } from "@/lib/types"

export const INGREDIENT_CLEANUP_SYSTEM_PROMPT = `你是中文厨房食材档案整理员。只输出一个 JSON 对象，不要解释。

根据现有档案，找出同一种买菜物的重复条目，并补大类和单位。

JSON 形状：
{
  "merges": [{"keepId":"ing-a","dropIds":["ing-b"]}],
  "families": [{"id":"ing-a","family":"牛肉"}],
  "units": [{"id":"ing-a","defaultUnit":"斤","purchaseUnit":"斤"}],
  "removeAliases": [{"id":"ing-a","aliases":["猪肉"]}]
}

规则：
- merges 只合并俗称：番茄=西红柿、青菜=小白菜、干紫菜=紫菜。keepId 留库存更多或名字更常用的那条
- 不要合并大类和部位：牛肉≠牛腩≠牛排，猪肉≠五花肉≠猪肉馅，辣椒≠青椒≠小米辣。这种关系写 families，不要写 merges，也不要写进别名
- removeAliases 删掉「大类被当成别名」的情况，例如五花肉的别名里有「猪肉」
- families 用牛肉、猪肉、羊肉、鸡肉、鱼、虾、辣椒这种买菜大类。没有就不要写
- units：肉和鱼用斤（牛排、排骨用块，肉馅用袋），西红柿、洋葱、土豆、鸡蛋用个，盐、糖、淀粉用袋，老抽、生抽、醋、料酒用瓶。只在现在单位明显不合理（例如把）时给出
- 水、开水、清水不用买，不要为它们建议合并成别的食材
- 不确定就不要合并`

export type IngredientCleanupAiResult = {
  enabled: boolean
  advice: AiCleanupAdvice | null
}

export function buildCleanupUserPayload(ingredients: Ingredient[]): string {
  return JSON.stringify({
    ingredients: ingredients.map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      aliases: ingredient.aliases,
      category: ingredient.category,
      family: ingredient.family ?? "",
      defaultUnit: ingredient.defaultUnit,
      purchaseUnit: ingredient.purchaseUnit ?? "",
      kind: ingredient.kind ?? "",
    })),
  })
}

export async function suggestIngredientCleanupWithAi(
  ingredients: Ingredient[],
  options: DeepSeekRequestOptions = {}
): Promise<IngredientCleanupAiResult> {
  if (!isAiEnabled(options.env) || ingredients.length === 0) {
    return { enabled: false, advice: null }
  }
  const content = await requestDeepSeekJson(
    INGREDIENT_CLEANUP_SYSTEM_PROMPT,
    buildCleanupUserPayload(ingredients),
    { ...options, temperature: 0 }
  )
  const advice = parseCleanupAdvice(extractJsonObject(content), ingredients)
  return { enabled: true, advice }
}
