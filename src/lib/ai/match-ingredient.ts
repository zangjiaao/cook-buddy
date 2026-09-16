import type { Ingredient, MatchStatus } from "@/lib/types"

export type IngredientMatch = {
  ingredientId: string | null
  matchStatus: MatchStatus
}

export type RankedIngredient = {
  ingredient: Ingredient
  score: number
  matchStatus: MatchStatus
  matchedOn: "name" | "alias" | "fuzzy"
}

/** 词干相同（小葱 ↔ 葱）视为足够近，创建前应提示，入库时可自动对齐。 */
export const AUTO_LINK_MIN_SCORE = 80
export const CLOSE_MATCH_MIN_SCORE = 50

const STRIP_PREFIXES = ["小", "大", "鲜", "嫩", "老", "新"]

export function normalizeIngredientName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "")
}

export function stemIngredientName(value: string): string {
  let next = normalizeIngredientName(value)
  let changed = true
  while (changed && next.length > 1) {
    changed = false
    for (const prefix of STRIP_PREFIXES) {
      if (next.startsWith(prefix) && next.length > prefix.length) {
        next = next.slice(prefix.length)
        changed = true
        break
      }
    }
  }
  return next
}

function namesOf(
  ingredient: Ingredient
): Array<{ value: string; source: "name" | "alias" }> {
  return [
    { value: ingredient.name, source: "name" },
    ...ingredient.aliases.map((alias) => ({
      value: alias,
      source: "alias" as const,
    })),
  ]
}

export function rankIngredients(
  query: string,
  ingredients: Ingredient[]
): RankedIngredient[] {
  const needle = normalizeIngredientName(query)
  if (!needle) return []
  const needleStem = stemIngredientName(needle)
  const ranked: RankedIngredient[] = []

  for (const ingredient of ingredients) {
    let best: RankedIngredient | null = null
    for (const entry of namesOf(ingredient)) {
      const value = normalizeIngredientName(entry.value)
      if (!value) continue
      const valueStem = stemIngredientName(value)
      let score = 0
      let matchStatus: MatchStatus = "unlinked"
      let matchedOn: RankedIngredient["matchedOn"] = "fuzzy"

      if (value === needle) {
        score = entry.source === "name" ? 100 : 95
        matchStatus = "linked"
        matchedOn = entry.source
      } else if (valueStem && needleStem && valueStem === needleStem) {
        score = AUTO_LINK_MIN_SCORE
        matchStatus = "fuzzy"
      } else if (value.includes(needle) || needle.includes(value)) {
        score = 60 + Math.min(10, Math.min(value.length, needle.length))
        matchStatus = "fuzzy"
      } else if (
        valueStem &&
        needleStem &&
        (valueStem.includes(needleStem) || needleStem.includes(valueStem))
      ) {
        score = CLOSE_MATCH_MIN_SCORE
        matchStatus = "fuzzy"
      }

      if (score > 0 && (!best || score > best.score)) {
        best = { ingredient, score, matchStatus, matchedOn }
      }
    }
    if (best) ranked.push(best)
  }

  return ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.ingredient.name.localeCompare(b.ingredient.name, "zh")
  )
}

export function searchIngredients(
  query: string,
  ingredients: Ingredient[],
  limit = 8
): RankedIngredient[] {
  const trimmed = query.trim()
  if (!trimmed) {
    return [...ingredients]
      .sort((a, b) => a.name.localeCompare(b.name, "zh"))
      .slice(0, limit)
      .map((ingredient) => ({
        ingredient,
        score: 0,
        matchStatus: "unlinked" as const,
        matchedOn: "name" as const,
      }))
  }
  return rankIngredients(query, ingredients).slice(0, limit)
}

export function closeMatchesForCreate(
  name: string,
  ingredients: Ingredient[]
): RankedIngredient[] {
  return rankIngredients(name, ingredients).filter(
    (row) => row.score >= CLOSE_MATCH_MIN_SCORE
  )
}

export function matchIngredient(
  rawName: string,
  ingredients: Ingredient[]
): IngredientMatch {
  const ranked = rankIngredients(rawName, ingredients)
  if (ranked.length === 0) {
    return { ingredientId: null, matchStatus: "unlinked" }
  }
  const best = ranked[0]
  return { ingredientId: best.ingredient.id, matchStatus: best.matchStatus }
}

export function withTypedAlias(
  ingredient: Ingredient,
  typedName: string
): Ingredient {
  const typed = typedName.trim()
  if (!typed) return ingredient
  const needle = normalizeIngredientName(typed)
  if (normalizeIngredientName(ingredient.name) === needle) return ingredient
  if (
    ingredient.aliases.some(
      (alias) => normalizeIngredientName(alias) === needle
    )
  ) {
    return ingredient
  }
  return { ...ingredient, aliases: [...ingredient.aliases, typed] }
}

export function pickAutoLink(
  query: string,
  ingredients: Ingredient[]
): RankedIngredient | undefined {
  return rankIngredients(query, ingredients).find(
    (row) => row.score >= AUTO_LINK_MIN_SCORE
  )
}
