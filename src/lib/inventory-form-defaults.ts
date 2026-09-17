import { guessDefaultLocation } from "@/lib/ai/resolve-ingredients"
import { matchesIngredientName } from "@/lib/ingredient-resolve-apply"
import { defaultShelfLifeDays, suggestExpiresAt } from "@/lib/shelf-life"
import type { Ingredient, Location } from "@/lib/types"

export function inventoryNameAlreadyLinked(
  typedName: string,
  ingredientId: string,
  ingredient?: Pick<Ingredient, "name" | "aliases"> | null
): boolean {
  if (!ingredientId || !ingredient) return false
  const name = typedName.trim()
  if (!name) return true
  return matchesIngredientName(name, ingredient)
}

export function inventoryStockDefaults(input: {
  ingredient: Pick<
    Ingredient,
    "category" | "defaultUnit" | "defaultShelfLifeDays"
  >
  purchasedAt: string
  locationHint?: Location
  currentUnit?: string
  currentLocation?: Location
  currentExpiresAt?: string
  unitTouched?: boolean
  locationTouched?: boolean
  expiresTouched?: boolean
}): {
  unit: string
  location: Location
  expiresAt: string
} {
  const location =
    input.locationTouched && input.currentLocation
      ? input.currentLocation
      : (input.locationHint ?? guessDefaultLocation(input.ingredient.category))
  const unit =
    input.unitTouched && input.currentUnit
      ? input.currentUnit
      : input.ingredient.defaultUnit || input.currentUnit || "把"
  const days = defaultShelfLifeDays({
    ingredient: input.ingredient,
    location,
  })
  const suggested = suggestExpiresAt(input.purchasedAt, days)
  const expiresAt = input.expiresTouched
    ? (input.currentExpiresAt ?? "")
    : (suggested ?? input.currentExpiresAt ?? "")
  return { unit, location, expiresAt }
}
