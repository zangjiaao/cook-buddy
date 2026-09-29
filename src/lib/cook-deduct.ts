import type { DeductSnapshot, InventoryItem, RecipeItem } from "@/lib/types"

function targetIngredientId(item: RecipeItem): string | null {
  if (
    item.substitution?.choice === "use" &&
    item.substitution.substituteIngredientId
  ) {
    return item.substitution.substituteIngredientId
  }
  return item.ingredientId
}

export function planInventoryDeduction(input: {
  items: RecipeItem[]
  inventory: InventoryItem[]
  factor: number
}): DeductSnapshot["changes"] {
  const stock = input.inventory.map((row) => ({ ...row }))
  const collapsed = new Map<string, DeductSnapshot["changes"][number]>()

  for (const item of input.items) {
    const targetId = targetIngredientId(item)
    if (!targetId) continue
    const usingSubstitute = item.substitution?.choice === "use"
    const rows = stock.filter(
      (row) => row.ingredientId === targetId && row.quantity > 0
    )
    const sameUnit = rows.find((row) => row.unit === item.unit)
    const row = sameUnit ?? (usingSubstitute ? rows[0] : undefined)
    if (!row) continue
    const need = sameUnit ? item.quantity * input.factor : 1
    const previousQuantity = row.quantity
    const nextQuantity = Math.max(
      0,
      Number((previousQuantity - need).toFixed(2))
    )
    row.quantity = nextQuantity
    const prior = collapsed.get(row.id)
    collapsed.set(row.id, {
      inventoryItemId: row.id,
      previousQuantity: prior?.previousQuantity ?? previousQuantity,
      nextQuantity,
    })
  }

  return [...collapsed.values()]
}
