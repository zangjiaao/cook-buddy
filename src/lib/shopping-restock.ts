import { createId } from "@/lib/id"
import { ingredientPurchaseUnit } from "@/lib/ingredient-kind"
import {
  formatQuantityHint,
  shoppingIngredientKey,
  shoppingMatchKey,
  stallFromCategory,
} from "@/lib/shopping-from-plan"
import { shoppingListSection } from "@/lib/shopping-list"
import type { Ingredient, ShoppingItem, ShoppingSource } from "@/lib/types"

export const DEFAULT_RESTOCK_QTY = 1

export function restockUnitFor(ingredient: Ingredient): string {
  return ingredientPurchaseUnit(ingredient)
}

export function restockAlreadyListed(
  existing: ShoppingItem[],
  ingredient: Ingredient
): boolean {
  const line = findRestockLine(existing, ingredient, restockUnitFor(ingredient))
  if (!line) return false
  return shoppingListSection(line) !== "hidden"
}

export function findRestockLine(
  existing: ShoppingItem[],
  ingredient: Pick<Ingredient, "id" | "name">,
  unit?: string
): ShoppingItem | undefined {
  const key = shoppingIngredientKey({
    ingredientId: ingredient.id,
    name: ingredient.name,
  })
  const matches = existing.filter(
    (item) =>
      shoppingIngredientKey(item) === key ||
      (unit != null &&
        shoppingMatchKey(item) ===
          shoppingMatchKey({
            ingredientId: ingredient.id,
            name: ingredient.name,
            unit,
          }))
  )
  return (
    matches.find((item) => unit != null && item.unit === unit) ??
    matches.find(
      (item) => item.source === "running_low" || item.source === "manual"
    ) ??
    matches[0]
  )
}

export function restockShoppingLine(input: {
  ingredient: Ingredient
  source: Exclude<ShoppingSource, "plan">
  existing?: ShoppingItem
  quantity?: number
  createItemId?: () => string
}): ShoppingItem {
  const unit = restockUnitFor(input.ingredient)
  const quantity = input.quantity ?? DEFAULT_RESTOCK_QTY
  const previous = input.existing
  const keepQty =
    previous &&
    previous.unit === unit &&
    previous.buyQty != null &&
    previous.buyQty > quantity
      ? previous.buyQty
      : quantity
  return {
    id: previous?.id ?? (input.createItemId ?? (() => createId("shop")))(),
    ingredientId: input.ingredient.id,
    name: input.ingredient.name,
    quantityHint: formatQuantityHint(keepQty),
    unit,
    stallHint:
      input.ingredient.stallHint ??
      stallFromCategory(input.ingredient.category),
    status: "needed",
    shortage: "short",
    fromPlanEntryIds: previous?.fromPlanEntryIds ?? [],
    checkedAt: null,
    neededQty: keepQty,
    stockQty: previous?.stockQty ?? null,
    buyQty: keepQty,
    source: input.source,
    contextHint:
      input.source === "running_low"
        ? `快没了，补 ${formatQuantityHint(keepQty)} ${unit}`
        : `手加，补 ${formatQuantityHint(keepQty)} ${unit}`,
  }
}

export function upsertRestockShoppingLine(input: {
  existing: ShoppingItem[]
  ingredient: Ingredient
  source: Exclude<ShoppingSource, "plan">
  quantity?: number
  createItemId?: () => string
}): { line: ShoppingItem; items: ShoppingItem[]; created: boolean } {
  const unit = restockUnitFor(input.ingredient)
  const found = findRestockLine(input.existing, input.ingredient, unit)
  const line = restockShoppingLine({
    ingredient: input.ingredient,
    source: input.source,
    existing: found,
    quantity: input.quantity,
    createItemId: input.createItemId,
  })
  if (!found) {
    return { line, items: [...input.existing, line], created: true }
  }
  return {
    line,
    items: input.existing.map((item) => (item.id === found.id ? line : item)),
    created: false,
  }
}

export const RESTOCK_ON_LIST_LABEL = "在清单里"

export function clearProtectedSource(item: ShoppingItem): ShoppingItem {
  return { ...item, source: "plan" }
}

/** 入库之后这条不再算已买，手改的数量和「要买」判断也清掉，交给重算。 */
export function shoppingItemAfterCheckIn(
  item: ShoppingItem,
  ingredientId: string
): ShoppingItem {
  return {
    ...clearProtectedSource(item),
    ingredientId,
    status: "needed",
    checkedAt: null,
    pickedQty: null,
    pickedUnit: null,
    presenceChoice: null,
  }
}
