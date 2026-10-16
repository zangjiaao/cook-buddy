import { createId } from "@/lib/id"
import { ingredientsRepo, recipeItemsRepo, recipesRepo } from "@/lib/db/repos"
import { nowIso } from "@/lib/dates"
import { resolveAndPersistQuiet } from "@/lib/ingredient-resolve-persist"
import type { ResolveIngredientsInput } from "@/lib/ai/resolve-ingredients"
import type { IngredientResolveResult } from "@/lib/ai/resolve-ingredients"
import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { recipeStepsFromHelp } from "@/lib/recipe-help"
import type { RecipeHelpSnapshot } from "@/lib/recipe-help"
import {
  alignItemWrites,
  ingredientUpdatesFromAlign,
  type AlignResultLine,
} from "@/lib/recipe-align"
import type { Recipe, RecipeItem } from "@/lib/types"

export async function materializeSharedRecipe(
  input: {
    recipeId: string
    snapshot: RecipeHelpSnapshot
    sourceLabel: string
    aligned?: AlignResultLine[]
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
    ...(input.snapshot.sourceText
      ? { sourceText: input.snapshot.sourceText }
      : {}),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  const ingredients = await ingredientsRepo.list()
  const resolved = await resolveAndPersistQuiet(
    input.snapshot.ingredients.map((item) => ({
      rawName: item.rawName,
      unit: item.unit,
    })),
    ingredients,
    resolveOnServer,
    { treatConfirmAsCreate: true }
  )
  const writes: RecipeItem[] = input.aligned
    ? alignItemWrites(
        input.aligned.map((line) => ({
          ...line,
          ingredientId:
            line.ingredientId ??
            resolved.byRawName.get(normalizeIngredientName(line.rawName))?.id ??
            resolved.byRawName.get(normalizeIngredientName(line.name))?.id ??
            null,
        })),
        resolved.byRawName
      ).map((item) => ({
        id: createId("ri"),
        recipeId: input.recipeId,
        ...item,
      }))
    : input.snapshot.ingredients.map((item) => {
        const ingredient = resolved.byRawName.get(
          normalizeIngredientName(item.rawName)
        )
        return {
          id: createId("ri"),
          recipeId: input.recipeId,
          rawName: item.rawName,
          quantity: item.quantity,
          unit: item.unit,
          ingredientId: ingredient?.id ?? null,
          matchStatus: ingredient ? "linked" : "unlinked",
          ...(item.catalogId ? { catalogId: item.catalogId } : {}),
        }
      })
  const known = [...ingredients]
  for (const ingredient of resolved.byRawName.values()) {
    if (!known.some((row) => row.id === ingredient.id)) known.push(ingredient)
  }
  if (input.aligned) {
    for (const ingredient of ingredientUpdatesFromAlign(input.aligned, known)) {
      await ingredientsRepo.put(ingredient)
    }
  }
  await recipesRepo.put(recipe)
  await Promise.all(writes.map((item) => recipeItemsRepo.put(item)))
  return { created: true }
}
