import { findSameUnitStock, mergeCheckInQuantity } from "@/lib/check-in"
import { formatISODate } from "@/lib/dates"
import { createId } from "@/lib/id"
import type { InventoryItem, Location } from "@/lib/types"

export type InventoryAddLine = {
  ingredientId: string
  quantity: number
  unit: string
  location: Location
  expiresAt: string | null
  notes?: string
}

export function mergeInventoryAdds(
  inventory: InventoryItem[],
  lines: InventoryAddLine[],
  timestamp: string,
  createIdFn: (prefix: string) => string = createId
): InventoryItem[] {
  const next = inventory.map((row) => ({ ...row }))
  const touched: InventoryItem[] = []
  const purchasedAt = formatISODate()

  for (const line of lines) {
    if (!line.ingredientId || !(line.quantity > 0)) continue
    const existing = findSameUnitStock(
      next,
      line.ingredientId,
      line.unit,
      line.location
    )
    if (existing) {
      const merged = mergeCheckInQuantity(existing, line.quantity, timestamp)
      const index = next.findIndex((row) => row.id === existing.id)
      if (index >= 0) next[index] = merged
      const touchedIndex = touched.findIndex((row) => row.id === merged.id)
      if (touchedIndex >= 0) touched[touchedIndex] = merged
      else touched.push(merged)
      continue
    }

    const created: InventoryItem = {
      id: createIdFn("inv"),
      ingredientId: line.ingredientId,
      quantity: line.quantity,
      unit: line.unit,
      location: line.location,
      purchasedAt,
      expiresAt: line.expiresAt,
      notes: line.notes ?? "",
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    next.push(created)
    touched.push(created)
  }

  return touched
}
