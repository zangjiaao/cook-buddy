import type { Ingredient, MatchStatus } from "@/lib/types"

export type IngredientMatch = {
  ingredientId: string | null
  matchStatus: MatchStatus
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "")
}

export function matchIngredient(
  rawName: string,
  ingredients: Ingredient[]
): IngredientMatch {
  const needle = normalize(rawName)
  if (!needle) return { ingredientId: null, matchStatus: "unlinked" }

  const exact = ingredients.find(
    (ingredient) =>
      normalize(ingredient.name) === needle ||
      ingredient.aliases.some((alias) => normalize(alias) === needle)
  )
  if (exact) return { ingredientId: exact.id, matchStatus: "linked" }

  const fuzzy = ingredients.find((ingredient) => {
    const names = [ingredient.name, ...ingredient.aliases].map(normalize)
    return names.some(
      (name) => name.includes(needle) || needle.includes(name)
    )
  })
  if (fuzzy) return { ingredientId: fuzzy.id, matchStatus: "fuzzy" }

  return { ingredientId: null, matchStatus: "unlinked" }
}
