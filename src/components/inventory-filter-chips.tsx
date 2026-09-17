import { cn } from "cn"
import {
  INVENTORY_CATEGORY_FILTERS,
  inventoryCategoryFilterLabel,
} from "@/lib/inventory-filter"
import type { InventoryCategoryFilter } from "@/lib/inventory-filter"

export function InventoryFilterChips({
  value,
  onChange,
}: {
  value: InventoryCategoryFilter
  onChange: (next: InventoryCategoryFilter) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="按分类筛选"
      className="flex flex-wrap gap-2"
    >
      {INVENTORY_CATEGORY_FILTERS.map((filter) => {
        const selected = filter === value
        return (
          <button
            key={filter}
            type="button"
            role="radio"
            aria-checked={selected}
            className={cn(
              "inline-flex h-11 min-w-14 items-center justify-center rounded-full px-4 text-sm font-medium",
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            )}
            onClick={() => onChange(filter)}
          >
            {inventoryCategoryFilterLabel(filter)}
          </button>
        )
      })}
    </div>
  )
}
