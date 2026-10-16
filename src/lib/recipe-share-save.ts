import { createId } from "@/lib/id"
import { ingredientsRepo, recipeItemsRepo, recipesRepo } from "@/lib/db/repos"
import { nowIso } from "@/lib/dates"
import { resolveAndPersistQuiet } from "@/lib/ingredient-resolve-persist"
import type { ResolveIngredientsInput } from "@/lib/ai/resolve-ingredients"
import type { IngredientResolveResult } from "@/lib/ai/resolve-ingredients"
import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { recipeStepsFromHelp } from "@/lib/recipe-help"
import type { RecipeHelpSnapshot } from "@/lib/recipe-help"
import type { Recipe, RecipeItem } from "@/lib/types"

export async function materializeSharedRecipe(
  input: {
    recipeId: string
    snapshot: RecipeHelpSnapshot
    sourceLabel: string
  },
  resolveOnServer?: (
    payload: ResolveIngredientsInput
  ) => Promise<IngredientResolveResult[]>
): Promise<{ created: boolean }> {
  const existing = await recipesRepo.get(input.recipeId)
  if (existing) return { created: false }
  const fields = recipeStepsFromHelp(input.snapshot.steps)
  const recipe: Recipe = {
    id: input.recipeId,
    name: input.snapshot.name,
    servings: input.snapshot.servings,
    approxMinutes: null,
    ...fields,
    sourceLabel: input.sourceLabel,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  const drafts: RecipeItem[] = input.snapshot.ingredients.map((item) => ({
    id: createId("ri"),
    recipeId: input.recipeId,
    rawName: item.rawName,
    quantity: item.quantity,
    unit: item.unit,
    ingredientId: null,
    matchStatus: "unlinked",
  }))
  const ingredients = await ingredientsRepo.list()
  const resolved = await resolveAndPersistQuiet(
    drafts.map((item) => ({ rawName: item.rawName, unit: item.unit })),
    ingredients,
    resolveOnServer,
    { treatConfirmAsCreate: true }
  )
  const writes = drafts.map((item) => {
    const ingredient = resolved.byRawName.get(
      normalizeIngredientName(item.rawName)
    )
    if (!ingredient) return item
    return {
      ...item,
      ingredientId: ingredient.id,
      matchStatus: "linked" as const,
    }
  })
  await recipesRepo.put(recipe)
  await Promise.all(writes.map((item) => recipeItemsRepo.put(item)))
  return { created: true }
}
