import { Badge } from "@/components/ui/badge"
import { inventoryStatusLabel, shortageLabel } from "@/lib/labels"
import type { InventoryStatus, Shortage } from "@/lib/types"

const inventoryVariant: Record<
  InventoryStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  fresh: "secondary",
  soon: "default",
  expired: "destructive",
}

const shortageVariant: Record<
  Shortage,
  "default" | "secondary" | "destructive" | "outline"
> = {
  enough: "secondary",
  short: "destructive",
  unsure: "outline",
}

export function InventoryStatusBadge({ status }: { status: InventoryStatus }) {
  return (
    <Badge variant={inventoryVariant[status]} className="h-6 px-2 text-xs">
      {inventoryStatusLabel[status]}
    </Badge>
  )
}

export function ShortageBadge({ shortage }: { shortage: Shortage }) {
  return (
    <Badge variant={shortageVariant[shortage]} className="h-6 px-2 text-xs">
      {shortageLabel[shortage]}
    </Badge>
  )
}
