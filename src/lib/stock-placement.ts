import { guessCategory, placementForName } from "@/lib/ingredient-category"
import { defaultShelfLifeDays, suggestExpiresAt } from "@/lib/shelf-life"
import type { Category, Ingredient, Location } from "@/lib/types"

/**
 * 库存新增和清单入库共用的默认位置、保质期。
 * 调味、干货、粮油和其他常温；鲜奶放冰箱；肉、菜沿用分类默认（冷藏）。
 * 已有同食材库存的位置优先，确认页仍可改。
 */
export function stockPlacementDefaults(input: {
  name?: string
  ingredient?: Pick<
    Ingredient,
    "name" | "category" | "defaultShelfLifeDays"
  > | null
  category?: Category | null
  purchasedAt: string
  locationHint?: Location | null
  existingLocation?: Location | null
}): { location: Location; expiresAt: string } {
  const name = (input.ingredient?.name ?? input.name ?? "").trim()
  const category =
    input.ingredient?.category ?? input.category ?? guessCategory(name)
  const placement = placementForName(name, category)
  const location =
    input.existingLocation ?? input.locationHint ?? placement.location
  const stored = input.ingredient?.defaultShelfLifeDays
  const days =
    stored != null
      ? defaultShelfLifeDays({
          ingredient: input.ingredient,
          category,
          location,
        })
      : location === "freezer"
        ? defaultShelfLifeDays({ category, location })
        : location === placement.location
          ? placement.shelfLifeDays
          : defaultShelfLifeDays({ category, location })
  return {
    location,
    expiresAt: suggestExpiresAt(input.purchasedAt, days) ?? "",
  }
}
