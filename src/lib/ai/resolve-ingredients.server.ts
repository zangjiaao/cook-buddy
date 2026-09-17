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
      "rawName": "葱",
      "action": "link",
      "ingredientId": "ing-scallion",
      "createDraft": {
        "name": "小葱",
        "aliases": ["葱"],
        "category": "veg",
        "defaultUnit": "把",
        "stallHint": "veg",
        "defaultShelfLifeDays": 3,
        "defaultLocation": "fridge",
        "kind": "fresh",
        "purchaseUnit": "把"
      },
      "candidates": [{"ingredientId":"ing-scallion","name":"小葱","reason":"大小葱是同一种"}]
    }
  ]
}

action 只能是 link / create / needs_confirm：
- link：同一买菜物的俗称或大小修饰，如 小葱/葱、青菜/小白菜。必须带已有 ingredientId
- create：清单里没有的新食材。给出 createDraft（分类、默认单位、摊位、保质天数、存放位置、常备/鲜货、购买单位）
- needs_confirm：拿不准、不要乱合并。例如 生抽≠酱油、老抽≠生抽、小白菜≠大白菜。带上 candidates，并仍给 createDraft 以便单独记下

分类 category：meat / veg / dry / seasoning
存放 defaultLocation：fridge / freezer / pantry
摊位 stallHint：meat / veg / dry / null（调味用 null）
kind：staple（油、酱油、醋等常备调料）/ fresh（蔬菜肉类鲜货）
purchaseUnit：购买单位。油/酱油用瓶，袋装干货用袋；不要用勺。鲜货跟食谱单位走。
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
