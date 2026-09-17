import { addDays, formatISODate, parseISODate } from "@/lib/dates"
import type { Category, Ingredient, Location, StallHint } from "@/lib/types"

/** 中国菜市场常见默认：叶菜冷藏约 3 天，冻肉约 1 个月，干货更长，调味从宽。 */
export const CATEGORY_SHELF_LIFE_DAYS: Record<Category, number> = {
  veg: 3,
  meat: 3,
  dry: 180,
  seasoning: 365,
}

export const FREEZER_SHELF_LIFE_DAYS: Record<Category, number> = {
  veg: 30,
  meat: 30,
  dry: 180,
  seasoning: 365,
}

export function categoryFromStall(stall: StallHint): Category {
  if (stall === "meat" || stall === "veg" || stall === "dry") return stall
  return "seasoning"
}

export function defaultShelfLifeDays(input: {
  ingredient?: Pick<Ingredient, "category" | "defaultShelfLifeDays"> | null
  category?: Category | null
  location?: Location | null
}): number | null {
  const category = input.ingredient?.category ?? input.category ?? null
  const stored = input.ingredient?.defaultShelfLifeDays
  if (category == null && stored == null) return null

  const base = stored ?? (category ? CATEGORY_SHELF_LIFE_DAYS[category] : null)
  if (base == null) return null

  const location = input.location ?? "fridge"
  if (location === "freezer" && category) {
    return Math.max(base, FREEZER_SHELF_LIFE_DAYS[category])
  }
  return base
}

export function suggestExpiresAt(
  purchasedAt: string,
  shelfLifeDays: number | null | undefined
): string | null {
  if (!purchasedAt || shelfLifeDays == null || shelfLifeDays < 0) return null
  return formatISODate(addDays(parseISODate(purchasedAt), shelfLifeDays))
}

export function shelfLifeHint(
  days: number,
  location: Location = "fridge"
): string {
  if (location === "freezer") return `冷冻默认约 ${days} 天`
  if (days >= 180) return `常温默认约 ${days} 天`
  return `冷藏默认约 ${days} 天`
}
