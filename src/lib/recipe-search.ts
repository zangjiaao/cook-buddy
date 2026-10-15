import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { recipeTagLabel, sanitizeRecipeTags } from "@/lib/recipe-organize"
import type { Ingredient, Recipe, RecipeItem } from "@/lib/types"

export type RecipeSearchItem = Pick<
  RecipeItem,
  "recipeId" | "rawName" | "ingredientId"
>

type RecipeSearchFields = Pick<Recipe, "id" | "name" | "tags">

/** 去掉首尾和中间空白并忽略大小写，供食谱搜索做包含匹配。 */
export function recipeSearchQuery(query: string): string {
  return normalizeIngredientName(query)
}

function includesQuery(value: string, needle: string): boolean {
  return normalizeIngredientName(value).includes(needle)
}

function nameMatches(recipe: RecipeSearchFields, needle: string): boolean {
  return includesQuery(recipe.name, needle)
}

function tagMatches(recipe: RecipeSearchFields, needle: string): boolean {
  return sanitizeRecipeTags(recipe.tags).some((tag) =>
    includesQuery(recipeTagLabel[tag], needle)
  )
}

function ingredientMatches(
  item: RecipeSearchItem,
  ingredientsById: ReadonlyMap<string, Pick<Ingredient, "name" | "aliases">>,
  needle: string
): boolean {
  if (includesQuery(item.rawName, needle)) return true
  if (!item.ingredientId) return false
  const ingredient = ingredientsById.get(item.ingredientId)
  if (!ingredient) return false
  if (includesQuery(ingredient.name, needle)) return true
  return (ingredient.aliases ?? []).some((alias) =>
    includesQuery(alias, needle)
  )
}

function matchedByIngredient(
  recipe: RecipeSearchFields,
  items: readonly RecipeSearchItem[],
  ingredientsById: ReadonlyMap<string, Pick<Ingredient, "name" | "aliases">>,
  needle: string
): boolean {
  return items.some(
    (item) =>
      item.recipeId === recipe.id &&
      ingredientMatches(item, ingredientsById, needle)
  )
}

export function filterRecipesBySearch<T extends RecipeSearchFields>(
  recipes: T[],
  items: readonly RecipeSearchItem[],
  ingredientsById: ReadonlyMap<string, Pick<Ingredient, "name" | "aliases">>,
  query: string
): T[] {
  const needle = recipeSearchQuery(query)
  if (!needle) return recipes
  return recipes.filter(
    (recipe) =>
      nameMatches(recipe, needle) ||
      tagMatches(recipe, needle) ||
      matchedByIngredient(recipe, items, ingredientsById, needle)
  )
}

/**
 * 菜名或标签已经命中时不提示。只有食材把这道菜带进结果时，返回去掉首尾空白的搜索词。
 */
export function recipeIngredientHint<T extends RecipeSearchFields>(
  recipe: T,
  items: readonly RecipeSearchItem[],
  ingredientsById: ReadonlyMap<string, Pick<Ingredient, "name" | "aliases">>,
  query: string
): string | null {
  const needle = recipeSearchQuery(query)
  if (!needle) return null
  if (nameMatches(recipe, needle) || tagMatches(recipe, needle)) return null
  if (!matchedByIngredient(recipe, items, ingredientsById, needle)) return null
  return query.trim()
}
