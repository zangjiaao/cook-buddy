import { pickAutoLink } from "@/lib/ai/match-ingredient"
import { formatISODate } from "@/lib/dates"
import {
  categoryFromStall,
  defaultShelfLifeDays,
  suggestExpiresAt,
} from "@/lib/shelf-life"
import { formatQuantityHint, roundQty } from "@/lib/shopping-from-plan"
import type {
  Ingredient,
  InventoryItem,
  Location,
  ShoppingItem,
  Shortage,
  StallHint,
} from "@/lib/types"

export type CheckInDraft = {
  shoppingItemId: string
  ingredientId: string | null
  name: string
  quantity: number
  unit: string
  location: Location
  expiresAt: string | null
  stallHint: StallHint
}

export type CheckInEditRow = {
  name: string
  shortage: Shortage
  quantity: string
}

export function defaultCheckInQuantity(item: ShoppingItem): string {
  if (item.shortage === "enough") return "0"
  if (item.shortage === "unsure") return ""
  if (item.buyQty != null) return formatQuantityHint(item.buyQty)
  const parsed = Number.parseFloat(item.quantityHint)
  return Number.isFinite(parsed) ? formatQuantityHint(parsed) : ""
}

export function parseCheckInQuantity(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number.parseFloat(trimmed)
  if (!Number.isFinite(value) || value < 0) return null
  return roundQty(value)
}

export function validateCheckInEdits(rows: CheckInEditRow[]): string | null {
  for (const row of rows) {
    const trimmed = row.quantity.trim()
    if (row.shortage === "unsure" && trimmed === "") {
      return `${row.name} 还不确定，请填这次买到的数量`
    }
    if (trimmed !== "" && parseCheckInQuantity(row.quantity) == null) {
      return `${row.name} 的数量看不懂`
    }
  }
  return null
}

export function draftsFromEdits(
  rows: Array<{
    item: ShoppingItem
    quantity: string
    unit: string
    location: Location
    expiresAt: string
  }>
): CheckInDraft[] {
  const drafts: CheckInDraft[] = []
  for (const row of rows) {
    const quantity = parseCheckInQuantity(row.quantity)
    if (quantity == null || quantity <= 0) continue
    drafts.push({
      shoppingItemId: row.item.id,
      ingredientId: row.item.ingredientId,
      name: row.item.name,
      quantity,
      unit: row.unit,
      location: row.location,
      expiresAt: row.expiresAt.trim() || null,
      stallHint: row.item.stallHint,
    })
  }
  return drafts
}

export function suggestedCheckInExpiresAt(
  item: ShoppingItem,
  ingredients: Ingredient[],
  location: Location,
  purchasedAt = formatISODate()
): string {
  const ingredient = item.ingredientId
    ? (ingredients.find((row) => row.id === item.ingredientId) ?? null)
    : null
  const category = ingredient?.category ?? categoryFromStall(item.stallHint)
  return (
    suggestExpiresAt(
      purchasedAt,
      defaultShelfLifeDays({ ingredient, category, location })
    ) ?? ""
  )
}

export function resolveCheckInIngredientId(
  name: string,
  ingredientId: string | null,
  ingredients: Ingredient[]
): string | null {
  if (ingredientId) return ingredientId
  return pickAutoLink(name, ingredients)?.ingredient.id ?? null
}

export function findSameUnitStock(
  inventory: InventoryItem[],
  ingredientId: string,
  unit: string
): InventoryItem | undefined {
  return inventory.find(
    (row) => row.ingredientId === ingredientId && row.unit === unit
  )
}

export function mergeCheckInQuantity(
  existing: InventoryItem,
  addQty: number,
  updatedAt: string
): InventoryItem {
  return {
    ...existing,
    quantity: roundQty(existing.quantity + addQty),
    updatedAt,
  }
}
