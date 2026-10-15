import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
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

/** 去掉首尾和中间空白并忽略大小写，供库存搜索做包含匹配。 */
export function inventorySearchQuery(query: string): string {
  return normalizeIngredientName(query)
}

export function filterInventoryBySearch<
  T extends Pick<InventoryItem, "ingredientId">,
>(
  items: T[],
  ingredientsById: ReadonlyMap<string, Pick<Ingredient, "name" | "aliases">>,
  query: string
): T[] {
  const needle = inventorySearchQuery(query)
  if (!needle) return items
  return items.filter((item) => {
    const ingredient = ingredientsById.get(item.ingredientId)
    if (!ingredient) return false
    if (normalizeIngredientName(ingredient.name).includes(needle)) return true
    return (ingredient.aliases ?? []).some((alias) =>
      normalizeIngredientName(alias).includes(needle)
    )
  })
}
