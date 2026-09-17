import { categoryLabel } from "@/lib/labels"
import { CATEGORIES } from "@/lib/types"
import type { Ingredient, InventoryItem } from "@/lib/types"

export const INVENTORY_CATEGORY_FILTERS = ["all", ...CATEGORIES] as const

export type InventoryCategoryFilter =
  (typeof INVENTORY_CATEGORY_FILTERS)[number]

export function inventoryCategoryFilterLabel(
  filter: InventoryCategoryFilter
): string {
  return filter === "all" ? "全部" : categoryLabel[filter]
}

export function isInventoryCategoryFilter(
  value: string
): value is InventoryCategoryFilter {
  return (INVENTORY_CATEGORY_FILTERS as readonly string[]).includes(value)
}

export function filterInventoryByCategory<
  T extends Pick<InventoryItem, "ingredientId">,
>(
  items: T[],
  ingredientsById: ReadonlyMap<string, Pick<Ingredient, "category">>,
  filter: InventoryCategoryFilter
): T[] {
  if (filter === "all") return items
  return items.filter(
    (item) => ingredientsById.get(item.ingredientId)?.category === filter
  )
}
