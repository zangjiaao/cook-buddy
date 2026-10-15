import { findSameUnitStock } from "@/lib/check-in"
import { formatISODate } from "@/lib/dates"
import { ingredientPurchaseUnit } from "@/lib/ingredient-kind"
import { formatQuantityHint } from "@/lib/shopping-from-plan"
import { stockPlacementDefaults } from "@/lib/stock-placement"
import type { Ingredient, InventoryItem, Location, ShoppingItem } from "@/lib/types"

/** 家里有的默认数量：计划需要的量。没有计划量时先填 1，面板里可改。 */
export function homeStockQuantity(item: ShoppingItem): string {
  if (
    item.neededQty != null &&
    Number.isFinite(item.neededQty) &&
    item.neededQty > 0
  ) {
    return formatQuantityHint(item.neededQty)
  }
  const parsed = Number.parseFloat(item.quantityHint)
  if (Number.isFinite(parsed) && parsed > 0) return formatQuantityHint(parsed)
  return "1"
}

/** 补库存用采购单位，不用食谱里的勺、少许。 */
export function homeStockUnit(
  item: ShoppingItem,
  ingredient?: Pick<
    Ingredient,
    "name" | "category" | "defaultUnit" | "purchaseUnit" | "kind"
  > | null
): string {
  if (ingredient) {
    const purchase = ingredientPurchaseUnit(ingredient).trim()
    if (purchase) return purchase
  }
  return item.unit
}

export function homeStockDefaults(input: {
  item: ShoppingItem
  ingredient?: Pick<
    Ingredient,
    "name" | "category" | "defaultUnit" | "purchaseUnit" | "kind" | "defaultShelfLifeDays"
  > | null
  inventory?: readonly InventoryItem[]
  purchasedAt?: string
  unit?: string
  locationHint?: Location | null
}): {
  quantity: string
  unit: string
  location: Location
  expiresAt: string
} {
  const purchasedAt = input.purchasedAt ?? formatISODate()
  const unit = input.unit?.trim() || homeStockUnit(input.item, input.ingredient)
  const category =
    input.ingredient?.category ??
    (input.item.stallHint === "meat" ||
    input.item.stallHint === "veg" ||
    input.item.stallHint === "dry"
      ? input.item.stallHint
      : null)
  const profile = stockPlacementDefaults({
    name: input.ingredient?.name ?? input.item.name,
    ingredient: input.ingredient,
    category,
    purchasedAt,
    locationHint: input.locationHint,
  })
  const existing =
    !input.locationHint && input.item.ingredientId
      ? findSameUnitStock(
          input.inventory ?? [],
          input.item.ingredientId,
          unit,
          profile.location
        )
      : undefined
  const placement = existing
    ? stockPlacementDefaults({
        name: input.ingredient?.name ?? input.item.name,
        ingredient: input.ingredient,
        category,
        purchasedAt,
        existingLocation: existing.location,
      })
    : profile
  return {
    quantity: homeStockQuantity(input.item),
    unit,
    location: placement.location,
    expiresAt: placement.expiresAt,
  }
}
