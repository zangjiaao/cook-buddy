import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import type { ClassifiedName } from "@/lib/ai/classify-ingredients"
import { bulkPut, getAll } from "@/lib/db/database"
import {
  classifyByRules,
  correctMisfiledVegetable,
  patchIngredientCategory,
} from "@/lib/ingredient-category"
import type { Category, Ingredient } from "@/lib/types"

const FINGERPRINT_KEY = "cookbuddy.category-fix.ai"

export type CategoryClassify = (names: string[]) => Promise<ClassifiedName[]>

function fingerprintStorage(): Storage | null {
  if (typeof localStorage === "undefined") return null
  return localStorage
}

export function misfiledVegetableCandidates(
  ingredients: Ingredient[]
): Ingredient[] {
  return ingredients.filter(
    (ingredient) =>
      ingredient.category === "veg" && classifyByRules(ingredient.name) == null
  )
}

export function categoryFixFingerprint(ingredients: Ingredient[]): string {
  return ingredients
    .map((ingredient) => `${ingredient.id}:${ingredient.name}`)
    .sort()
    .join("|")
}

export function applyRuleCategoryFixes(
  ingredients: Ingredient[]
): Ingredient[] {
  return ingredients.map(correctMisfiledVegetable)
}

export function applyAiCategoryFixes(
  ingredients: Ingredient[],
  judged: ClassifiedName[]
): Ingredient[] {
  const byName = new Map<string, Category>()
  for (const row of judged) {
    if (row.source !== "ai") continue
    byName.set(normalizeIngredientName(row.name), row.category)
  }
  if (byName.size === 0) return ingredients

  return ingredients.map((ingredient) => {
    if (ingredient.category !== "veg") return ingredient
    if (classifyByRules(ingredient.name) != null) return ingredient
    const category = byName.get(normalizeIngredientName(ingredient.name))
    if (!category || category === "veg") return ingredient
    return patchIngredientCategory(ingredient, category)
  })
}

function changedIngredients(
  before: Ingredient[],
  after: Ingredient[]
): Ingredient[] {
  const previous = new Map(
    before.map((ingredient) => [ingredient.id, ingredient])
  )
  return after.filter((ingredient) => {
    const prior = previous.get(ingredient.id)
    return prior != null && prior.category !== ingredient.category
  })
}

export async function migrateMisclassifiedVegetables(options?: {
  classify?: CategoryClassify
}): Promise<number> {
  const ingredients = await getAll<Ingredient>("ingredients")
  const ruled = applyRuleCategoryFixes(ingredients)
  const unknown = misfiledVegetableCandidates(ruled)
  let next = ruled
  const storage = fingerprintStorage()
  const fingerprint = categoryFixFingerprint(unknown)
  const seen = storage?.getItem(FINGERPRINT_KEY)
  if (options?.classify && unknown.length > 0 && seen !== fingerprint) {
    try {
      const judged = await options.classify(unknown.map((row) => row.name))
      const aiAnswered = judged.some((row) => row.source === "ai")
      next = applyAiCategoryFixes(ruled, judged)
      if (aiAnswered) storage?.setItem(FINGERPRINT_KEY, fingerprint)
    } catch {
      next = ruled
    }
  }

  const changed = changedIngredients(ingredients, next)
  if (changed.length === 0) return 0
  await bulkPut("ingredients", next)
  return changed.length
}
