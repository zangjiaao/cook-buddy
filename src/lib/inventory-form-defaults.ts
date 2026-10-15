import { ingredientPurchaseUnit } from "@/lib/ingredient-kind"
import { matchesIngredientName } from "@/lib/ingredient-resolve-apply"
import { stockPlacementDefaults } from "@/lib/stock-placement"
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
    | "name"
    | "category"
    | "defaultUnit"
    | "defaultShelfLifeDays"
    | "purchaseUnit"
    | "kind"
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
  const placement = stockPlacementDefaults({
    name: input.ingredient.name,
    ingredient: input.ingredient,
    purchasedAt: input.purchasedAt,
    locationHint:
      input.locationTouched && input.currentLocation
        ? input.currentLocation
        : input.locationHint,
  })
  const location =
    input.locationTouched && input.currentLocation
      ? input.currentLocation
      : placement.location
  const unit =
    input.unitTouched && input.currentUnit
      ? input.currentUnit
      : ingredientPurchaseUnit(input.ingredient) ||
        input.ingredient.defaultUnit ||
        input.currentUnit ||
        "把"
  const expiresAt = input.expiresTouched
    ? (input.currentExpiresAt ?? "")
    : placement.expiresAt
  return { unit, location, expiresAt }
}
