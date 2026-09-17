import { Badge } from "@/components/ui/badge"
import {
  inventoryStatusLabel,
  planEntryStatusLabel,
  shortageLabel,
} from "@/lib/labels"
import type { InventoryStatus, PlanEntryStatus, Shortage } from "@/lib/types"

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

const planEntryVariant: Record<
  PlanEntryStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  planned: "outline",
  cooked: "secondary",
}

export function PlanEntryStatusBadge({ status }: { status: PlanEntryStatus }) {
  return (
    <Badge variant={planEntryVariant[status]} className="h-6 px-2 text-xs">
      {planEntryStatusLabel[status]}
    </Badge>
  )
}
