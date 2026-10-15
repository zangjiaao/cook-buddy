import { recipesRepo, recipeItemsRepo, planRepo } from "@/lib/db/repos"
import { shouldRegenShoppingForRecipe } from "@/lib/recipe-draft-items"
import { normalizeRecipe } from "@/lib/recipe-organize"
import { shoppingRegen } from "@/lib/shopping-sync"
import type { Recipe, RecipeItem } from "@/lib/types"

export async function commitHelpWrite(input: {
  recipeId: string
  steps: string[]
  stepTips?: string[]
  removeIds: string[]
  writes: RecipeItem[]
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const recipe = await recipesRepo.get(input.recipeId)
  if (!recipe) return { ok: false, reason: "这道菜不在这台设备上。" }
  const next: Recipe = {
    ...recipe,
    steps: input.steps,
  }
  if (input.stepTips) next.stepTips = input.stepTips
  else delete next.stepTips
  await recipesRepo.put(normalizeRecipe(next))
  await Promise.all(input.removeIds.map((id) => recipeItemsRepo.remove(id)))
  await Promise.all(input.writes.map((item) => recipeItemsRepo.put(item)))
  const planEntries = await planRepo.list()
  if (shouldRegenShoppingForRecipe(input.recipeId, planEntries)) {
    await shoppingRegen.flush()
  }
  return { ok: true }
}
