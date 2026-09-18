import type { Recipe } from "@/lib/types"

export const RECIPE_TAGS = ["hun", "su", "tang", "zhushi"] as const
export type RecipeTag = (typeof RECIPE_TAGS)[number]

export const RECIPE_TAG_FILTERS = ["all", ...RECIPE_TAGS] as const
export type RecipeTagFilter = (typeof RECIPE_TAG_FILTERS)[number]

export const recipeTagLabel: Record<RecipeTag, string> = {
  hun: "荤菜",
  su: "素菜",
  tang: "汤羹",
  zhushi: "主食",
}

export const RECIPE_TAG_HINT = "按桌上怎么摆：荤菜、素菜、汤羹、主食。可多选。"

export function recipeTagFilterLabel(filter: RecipeTagFilter): string {
  return filter === "all" ? "全部" : recipeTagLabel[filter]
}

export function isRecipeTag(value: unknown): value is RecipeTag {
  return (
    typeof value === "string" &&
    (RECIPE_TAGS as readonly string[]).includes(value)
  )
}

export function isRecipeTagFilter(value: string): value is RecipeTagFilter {
  return (RECIPE_TAG_FILTERS as readonly string[]).includes(value)
}

export function sanitizeRecipeTags(tags: unknown): RecipeTag[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<RecipeTag>()
  for (const tag of tags) {
    if (isRecipeTag(tag)) seen.add(tag)
  }
  return RECIPE_TAGS.filter((tag) => seen.has(tag))
}

export function toggleRecipeTag(
  tags: readonly string[],
  tag: RecipeTag
): RecipeTag[] {
  const current = sanitizeRecipeTags(tags)
  return current.includes(tag)
    ? current.filter((item) => item !== tag)
    : sanitizeRecipeTags([...current, tag])
}

export function recipeFavoriteFields(
  favorited: boolean,
  existing: Pick<Recipe, "favorited" | "favoritedAt"> | undefined,
  at: string
): { favorited: boolean; favoritedAt: string | null } {
  if (!favorited) return { favorited: false, favoritedAt: null }
  if (existing?.favorited && existing.favoritedAt) {
    return { favorited: true, favoritedAt: existing.favoritedAt }
  }
  return { favorited: true, favoritedAt: at }
}

export function normalizeRecipe<T extends Recipe>(recipe: T): T {
  const favorited = Boolean(recipe.favorited)
  const favoritedAt =
    favorited &&
    typeof recipe.favoritedAt === "string" &&
    recipe.favoritedAt.length > 0
      ? recipe.favoritedAt
      : favorited
        ? recipe.updatedAt
        : null
  return {
    ...recipe,
    favorited,
    favoritedAt,
    tags: sanitizeRecipeTags(recipe.tags),
  }
}

export function recipeNeedsMigrate(recipe: Recipe): boolean {
  if (recipe.favorited == null) return true
  if (recipe.favorited && !recipe.favoritedAt) return true
  if (!recipe.favorited && recipe.favoritedAt) return true
  if (!Array.isArray(recipe.tags)) return true
  if (recipe.tags.some((tag) => !isRecipeTag(tag))) return true
  if (new Set(recipe.tags).size !== recipe.tags.length) return true
  const ordered = sanitizeRecipeTags(recipe.tags)
  return ordered.some((tag, index) => recipe.tags?.[index] !== tag)
}

export function applyRecipeFavorite(
  recipe: Recipe,
  favorited: boolean,
  at: string
): Recipe {
  const fields = recipeFavoriteFields(favorited, recipe, at)
  return normalizeRecipe({
    ...recipe,
    ...fields,
    updatedAt: at,
  })
}

export function applyRecipeTags(
  recipe: Recipe,
  tags: readonly string[],
  at: string
): Recipe {
  return normalizeRecipe({
    ...recipe,
    tags: sanitizeRecipeTags(tags),
    updatedAt: at,
  })
}

export function sortRecipesForList<
  T extends Pick<Recipe, "favorited" | "favoritedAt" | "name" | "updatedAt">,
>(recipes: T[]): T[] {
  return [...recipes].sort((a, b) => {
    const aFav = Boolean(a.favorited)
    const bFav = Boolean(b.favorited)
    if (aFav !== bFav) return aFav ? -1 : 1
    if (aFav && bFav) {
      const pinned = (b.favoritedAt ?? "").localeCompare(a.favoritedAt ?? "")
      if (pinned !== 0) return pinned
    }
    const updated = b.updatedAt.localeCompare(a.updatedAt)
    if (updated !== 0) return updated
    return a.name.localeCompare(b.name, "zh")
  })
}

export function filterRecipesByTag<T extends Pick<Recipe, "tags">>(
  recipes: T[],
  filter: RecipeTagFilter
): T[] {
  if (filter === "all") return recipes
  return recipes.filter((recipe) =>
    sanitizeRecipeTags(recipe.tags).includes(filter)
  )
}

export function partitionFavoriteRecipes<T extends Pick<Recipe, "favorited">>(
  recipes: T[]
): { favorites: T[]; rest: T[] } {
  const favorites: T[] = []
  const rest: T[] = []
  for (const recipe of recipes) {
    if (recipe.favorited) favorites.push(recipe)
    else rest.push(recipe)
  }
  return { favorites, rest }
}

export function visibleRecipeGroups<
  T extends Pick<
    Recipe,
    "favorited" | "favoritedAt" | "name" | "updatedAt" | "tags"
  >,
>(recipes: T[], filter: RecipeTagFilter): { favorites: T[]; rest: T[] } {
  return partitionFavoriteRecipes(
    sortRecipesForList(filterRecipesByTag(recipes, filter))
  )
}
