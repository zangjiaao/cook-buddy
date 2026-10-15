import { isAiEnabled, requestDeepSeekJson } from "@/lib/ai/deepseek"
import type { DeepSeekRequestOptions } from "@/lib/ai/deepseek"
import { closeMatchesForCreate } from "@/lib/ai/match-ingredient"
import {
  itemsNeedingAi,
  resolveIngredientsLocal,
  toIngredientSnapshot,
  tryParseResolveResultsJson,
} from "@/lib/ai/resolve-ingredients"
import type {
  IngredientResolveResult,
  IngredientSnapshot,
  ResolveIngredientsInput,
} from "@/lib/ai/resolve-ingredients"
import type { Ingredient } from "@/lib/types"

export const INGREDIENT_RESOLVE_SYSTEM_PROMPT = `你是中文菜市场食材主数据对齐器。判断用户写下的生名是否等于已有主数据的同一种买菜物。只输出一个 JSON 对象，不要解释。

JSON 形状：
{
  "results": [
    {
      "rawName": "番茄",
      "action": "link",
      "ingredientId": "ing-tomato",
      "createDraft": {
        "name": "西红柿",
        "aliases": ["番茄"],
        "category": "veg",
        "defaultUnit": "个",
        "stallHint": "veg",
        "defaultShelfLifeDays": 5,
        "defaultLocation": "fridge",
        "kind": "fresh",
        "purchaseUnit": "个",
        "family": ""
      },
      "candidates": [{"ingredientId":"ing-tomato","name":"西红柿","reason":"同一种菜"}]
    }
  ]
}

action 只能是 link / create / needs_confirm：
- link：同一买菜物的俗称，如 番茄/西红柿、青菜/小白菜、干紫菜/紫菜、小葱/葱。必须带已有 ingredientId。这一步直接合并，不要改成 needs_confirm
- create：不是同一种。具体部位和大类不要合并：牛腩、牛排、牛里脊都不是「牛肉」这条本身；五花肉、猪肉馅都不是「猪肉」；青椒、小米辣都不是「辣椒」。新建时 family 填大类（牛肉/猪肉/辣椒），不要把大类写进 aliases
- needs_confirm：只用于拿不准、而且不是上面的俗称。例如 生抽≠酱油、老抽≠生抽、小白菜≠大白菜。带上 candidates，并仍给 createDraft

分类 category：meat / veg / dry / seasoning / other。拿不准用 other，不要默认成 veg
存放 defaultLocation：fridge / freezer / pantry
摊位 stallHint：meat / veg / dry / null（调味用 null）
kind：staple（油、酱油、醋、盐等常备）/ fresh（蔬菜肉类鲜货）
family：所属大类。牛肉、猪肉、羊肉、鸡肉、鱼、虾、辣椒。没有大类就空字符串
defaultUnit 和 purchaseUnit 要像菜市场：肉和鱼用斤（牛排/排骨用块，肉馅用袋），西红柿/洋葱/土豆/鸡蛋用个，盐/糖/淀粉用袋，老抽/生抽/醋/料酒/蚝油用瓶，叶菜用把。不要把肉、鱼、西红柿、盐、酱油设成「把」
水、开水、清水不用买，不要为它们创建食材
不要做克数/勺↔瓶换算，不要输出上述以外的键`

export type ResolveIngredientsAiOptions = DeepSeekRequestOptions

function snapshotsOf(ingredients: IngredientSnapshot[]): IngredientSnapshot[] {
  return ingredients.map(toIngredientSnapshot)
}

function closeMatchHints(
  rawName: string,
  ingredients: IngredientSnapshot[]
): Array<{ id: string; name: string; aliases: string[] }> {
  const asIngredients = ingredients as Ingredient[]
  return closeMatchesForCreate(rawName, asIngredients)
    .slice(0, 5)
    .map((row) => ({
      id: row.ingredient.id,
      name: row.ingredient.name,
      aliases: row.ingredient.aliases,
    }))
}

export function buildResolveUserPayload(
  input: ResolveIngredientsInput
): string {
  const unresolved = itemsNeedingAi(input, resolveIngredientsLocal(input))
  return JSON.stringify({
    items: unresolved.map((item) => ({
      rawName: item.rawName.trim(),
      unit: item.unit ?? "",
      closeMatches: closeMatchHints(item.rawName, input.ingredients),
    })),
    ingredients: snapshotsOf(input.ingredients).map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      aliases: ingredient.aliases,
      category: ingredient.category,
      defaultUnit: ingredient.defaultUnit,
      stallHint: ingredient.stallHint,
      defaultShelfLifeDays: ingredient.defaultShelfLifeDays,
      purchaseUnit: ingredient.purchaseUnit,
      kind: ingredient.kind,
      family: ingredient.family ?? "",
    })),
  })
}

export async function resolveIngredientsWithAi(
  input: ResolveIngredientsInput,
  options: ResolveIngredientsAiOptions = {}
): Promise<IngredientResolveResult[]> {
  const ruled = resolveIngredientsLocal(input)
  const unresolved = itemsNeedingAi(input, ruled)
  if (unresolved.length === 0) return ruled
  if (!isAiEnabled(options.env)) return ruled

  try {
    const content = await requestDeepSeekJson(
      INGREDIENT_RESOLVE_SYSTEM_PROMPT,
      buildResolveUserPayload(input),
      options
    )
    const merged = tryParseResolveResultsJson(content, input, ruled)
    if (merged) return merged
  } catch {
    // no key / timeout / HTTP / bad JSON → keep fallback create
  }

  return ruled
}
