import { pickAutoLink } from "@/lib/ai/match-ingredient"
import { formatISODate } from "@/lib/dates"
import { categoryFromStall } from "@/lib/shelf-life"
import { stockPlacementDefaults } from "@/lib/stock-placement"
import {
  ingredientPurchaseUnit,
  isStapleIngredient,
} from "@/lib/ingredient-kind"
import {
  formatQuantityHint,
  hasPickedPurchase,
  roundQty,
} from "@/lib/shopping-from-plan"
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
  /** 确认页改过位置才搬家；没改则合并时沿用已有行。 */
  locationTouched?: boolean
  expiresAt: string | null
  stallHint: StallHint
}

export type CheckInEditRow = {
  name: string
  shortage: Shortage
  quantity: string
}

export function defaultCheckInQuantity(item: ShoppingItem): string {
  if (hasPickedPurchase(item) && item.pickedQty != null) {
    return formatQuantityHint(item.pickedQty)
  }
  if (item.shortage === "enough") return "0"
  if (item.shortage === "unsure") return ""
  if (item.buyQty != null) return formatQuantityHint(item.buyQty)
  const parsed = Number.parseFloat(item.quantityHint)
  return Number.isFinite(parsed) ? formatQuantityHint(parsed) : ""
}

export function defaultCheckInUnit(
  item: ShoppingItem,
  ingredient?: Ingredient | null
): string {
  const picked = item.pickedUnit?.trim()
  if (picked) return picked
  if (item.source === "running_low" || item.source === "manual") {
    return item.unit
  }
  if (ingredient && isStapleIngredient(ingredient)) {
    return ingredientPurchaseUnit(ingredient)
  }
  return item.unit
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
    locationTouched?: boolean
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
      locationTouched: row.locationTouched,
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
  return stockPlacementDefaults({
    name: ingredient?.name ?? item.name,
    ingredient,
    category,
    purchasedAt,
    locationHint: location,
  }).expiresAt
}

/** 确认页的默认位置和保质期：已有同单位库存优先，否则按食材档案。 */
export function defaultCheckInPlacement(
  item: ShoppingItem,
  ingredients: readonly Ingredient[],
  inventory: readonly InventoryItem[] = [],
  purchasedAt = formatISODate()
): { location: Location; expiresAt: string } {
  const ingredient = item.ingredientId
    ? (ingredients.find((row) => row.id === item.ingredientId) ?? null)
    : null
  const category = ingredient?.category ?? categoryFromStall(item.stallHint)
  const profile = stockPlacementDefaults({
    name: ingredient?.name ?? item.name,
    ingredient,
    category,
    purchasedAt,
  })
  const unit = defaultCheckInUnit(item, ingredient)
  const existing = item.ingredientId
    ? findSameUnitStock(inventory, item.ingredientId, unit, profile.location)
    : undefined
  if (!existing) return profile
  return stockPlacementDefaults({
    name: ingredient?.name ?? item.name,
    ingredient,
    category,
    purchasedAt,
    existingLocation: existing.location,
  })
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
  inventory: readonly InventoryItem[],
  ingredientId: string,
  unit: string,
  preferredLocation?: Location
): InventoryItem | undefined {
  const matches = inventory.filter(
    (row) => row.ingredientId === ingredientId && row.unit === unit
  )
  if (matches.length === 0) return undefined
  if (preferredLocation) {
    const preferred = matches.find((row) => row.location === preferredLocation)
    if (preferred) return preferred
  }
  return matches[0]
}

/** 合并到同食材同单位的已有行；没改位置就沿用那一行，否则按确认页。 */
export function applyCheckInStock(
  draft: CheckInDraft & { ingredientId: string },
  inventory: readonly InventoryItem[],
  timestamp: string,
  newId: string
): InventoryItem {
  const existing = findSameUnitStock(
    inventory,
    draft.ingredientId,
    draft.unit,
    draft.location
  )
  if (existing) {
    const merged = mergeCheckInQuantity(existing, draft.quantity, timestamp)
    if (draft.locationTouched && draft.location !== existing.location) {
      return { ...merged, location: draft.location }
    }
    return merged
  }
  return {
    id: newId,
    ingredientId: draft.ingredientId,
    quantity: draft.quantity,
    unit: draft.unit,
    location: draft.location,
    purchasedAt: timestamp.slice(0, 10),
    expiresAt: draft.expiresAt,
    notes: "从购买清单入库",
    createdAt: timestamp,
    updatedAt: timestamp,
  }
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
