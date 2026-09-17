import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import type { Ingredient, RecipeItem, ShoppingItem } from "@/lib/types"

export function matchesIngredientName(
  rawName: string,
  ingredient: Pick<Ingredient, "name" | "aliases">
): boolean {
  const needle = normalizeIngredientName(rawName)
  if (!needle) return false
  if (normalizeIngredientName(ingredient.name) === needle) return true
  return ingredient.aliases.some(
    (alias) => normalizeIngredientName(alias) === needle
  )
}

export function backfillRecipeItems(
  items: RecipeItem[],
  ingredient: Ingredient
): RecipeItem[] {
  return items.map((item) => {
    if (item.ingredientId) return item
    if (!matchesIngredientName(item.rawName, ingredient)) return item
    return { ...item, ingredientId: ingredient.id, matchStatus: "linked" }
  })
}

export function backfillShoppingItems(
  items: ShoppingItem[],
  ingredient: Ingredient
): ShoppingItem[] {
  return items.map((item) => {
    if (item.ingredientId) return item
    if (!matchesIngredientName(item.name, ingredient)) return item
    return { ...item, ingredientId: ingredient.id }
  })
}

export function recipeItemsFromResolved(
  items: Array<{
    rawName: string
    quantity: number
    unit: string
  }>,
  byRawName: Map<string, Ingredient>
): Array<{
  rawName: string
  quantity: number
  unit: string
  ingredientId: string | null
  matchStatus: "linked" | "unlinked"
}> {
  return items.map((item) => {
    const ingredient = byRawName.get(normalizeIngredientName(item.rawName))
    return {
      rawName: item.rawName,
      quantity: item.quantity,
      unit: item.unit,
      ingredientId: ingredient?.id ?? null,
      matchStatus: ingredient ? "linked" : "unlinked",
    }
  })
}
