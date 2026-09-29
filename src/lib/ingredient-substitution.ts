import {
  familyMemberRank,
  ingredientFamily,
  isNonPurchasableName,
} from "@/lib/ingredient-identity"
import type {
  Ingredient,
  InventoryItem,
  RecipeItem,
  RecipeSubstitution,
  SubstituteCandidate,
} from "@/lib/types"

function roundQty(value: number): number {
  return Number(value.toFixed(2))
}

function positiveStock(
  ingredientId: string,
  inventory: Array<Pick<InventoryItem, "ingredientId" | "quantity" | "unit">>
) {
  return inventory.filter(
    (row) => row.ingredientId === ingredientId && row.quantity > 0
  )
}

function summarizeStock(
  rows: Array<Pick<InventoryItem, "quantity" | "unit">>
): { quantity: number; unit: string } {
  const byUnit = new Map<string, number>()
  for (const row of rows) {
    byUnit.set(row.unit, roundQty((byUnit.get(row.unit) ?? 0) + row.quantity))
  }
  const [unit, quantity] = [...byUnit.entries()].sort(
    (a, b) => b[1] - a[1]
  )[0] ?? ["", 0]
  return { quantity, unit }
}

export function substituteCandidates(input: {
  needed: Pick<Ingredient, "id" | "name" | "family" | "buyable">
  ingredients: Array<Pick<Ingredient, "id" | "name" | "family" | "buyable">>
  inventory: Array<Pick<InventoryItem, "ingredientId" | "quantity" | "unit">>
}): SubstituteCandidate[] {
  if (input.needed.buyable === false) return []
  if (isNonPurchasableName(input.needed.name)) return []
  if (positiveStock(input.needed.id, input.inventory).length > 0) return []
  const family = ingredientFamily(input.needed)
  if (!family) return []

  const found: Array<SubstituteCandidate & { rank: number }> = []
  for (const other of input.ingredients) {
    if (other.id === input.needed.id) continue
    if (other.buyable === false || isNonPurchasableName(other.name)) continue
    if (ingredientFamily(other) !== family) continue
    const stock = positiveStock(other.id, input.inventory)
    if (stock.length === 0) continue
    const summary = summarizeStock(stock)
    found.push({
      ingredientId: other.id,
      name: other.name,
      quantity: summary.quantity,
      unit: summary.unit,
      rank: familyMemberRank(family, other.name),
    })
  }

  return found
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "zh-CN"))
    .slice(0, 3)
    .map(({ rank: _rank, ...candidate }) => candidate)
}

export function substituteOfferText(candidates: SubstituteCandidate[]): string {
  const parts = candidates.map(
    (candidate) =>
      `${candidate.name} ${formatQty(candidate.quantity)} ${candidate.unit}`
  )
  return `家里有${parts.join("、")}，可以替代`
}

function formatQty(value: number): string {
  return String(roundQty(value))
}

export function isPurchasableLine(
  item: Pick<RecipeItem, "rawName">,
  ingredient: Pick<Ingredient, "name" | "buyable"> | undefined
): boolean {
  if (isNonPurchasableName(item.rawName)) return false
  if (!ingredient) return true
  if (ingredient.buyable === false) return false
  if (isNonPurchasableName(ingredient.name)) return false
  return true
}

export function applyRecipeSubstitution(
  items: RecipeItem[],
  recipeItemIds: string[],
  substitution: RecipeSubstitution
): RecipeItem[] {
  const ids = new Set(recipeItemIds)
  return items.map((item) =>
    ids.has(item.id) ? { ...item, substitution } : item
  )
}
