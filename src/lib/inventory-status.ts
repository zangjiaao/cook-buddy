import { daysUntil, formatISODate } from "@/lib/dates"
import type { InventoryItem, InventoryStatus } from "@/lib/types"

export const SOON_WITHIN_DAYS = 3

export function deriveInventoryStatus(
  item: Pick<InventoryItem, "expiresAt">,
  today = formatISODate()
): InventoryStatus {
  if (!item.expiresAt) return "fresh"
  const remaining = daysUntil(item.expiresAt, today)
  if (remaining < 0) return "expired"
  if (remaining <= SOON_WITHIN_DAYS) return "soon"
  return "fresh"
}

export function sortInventoryByExpiry<
  T extends Pick<InventoryItem, "expiresAt">,
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (!a.expiresAt && !b.expiresAt) return 0
    if (!a.expiresAt) return 1
    if (!b.expiresAt) return -1
    return a.expiresAt.localeCompare(b.expiresAt)
  })
}

export function expiredInventoryIds<
  T extends Pick<InventoryItem, "id" | "expiresAt">,
>(items: T[], today = formatISODate()): string[] {
  return items
    .filter((item) => deriveInventoryStatus(item, today) === "expired")
    .map((item) => item.id)
}
