import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, fieldControlClass } from "@/components/field"
import {
  addInventoryEntryLine,
  inventoryEntryUnits,
  removeInventoryEntryLine,
  updateInventoryEntryLine,
} from "@/lib/inventory-entry"
import type { InventoryEntryLine } from "@/lib/inventory-entry"
import { categoryLabel, locationLabel } from "@/lib/labels"
import { CATEGORIES, LOCATIONS } from "@/lib/types"
import type { Category, Location } from "@/lib/types"

export function InventoryEntryRows({
  lines,
  notes,
  onChange,
}: {
  lines: InventoryEntryLine[]
  notes?: Record<string, string>
  onChange: (lines: InventoryEntryLine[]) => void
}) {
  return (
    <div className="space-y-3">
      {lines.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">
          还没有食材。先加上一条。
        </p>
      ) : null}
      {lines.map((line, index) => (
        <div key={line.key} className="space-y-2 rounded-lg border p-3">
          <div className="flex items-start gap-2">
            <Input
              className="h-12 flex-1 text-base"
              placeholder="食材名"
              aria-label={`第 ${index + 1} 行名称`}
              value={line.name}
              onChange={(event) =>
                onChange(
                  updateInventoryEntryLine(lines, line.key, {
                    name: event.target.value,
                  })
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              className="h-12 px-3 text-sm"
              onClick={() =>
                onChange(removeInventoryEntryLine(lines, line.key))
              }
            >
              去掉
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              className="h-12 text-base"
              inputMode="decimal"
              placeholder="数量"
              aria-label={`第 ${index + 1} 行数量`}
              value={line.quantity}
              onChange={(event) =>
                onChange(
                  updateInventoryEntryLine(lines, line.key, {
                    quantity: event.target.value,
                  })
                )
              }
            />
            <select
              className={fieldControlClass}
              aria-label={`第 ${index + 1} 行单位`}
              value={line.unit}
              onChange={(event) =>
                onChange(
                  updateInventoryEntryLine(lines, line.key, {
                    unit: event.target.value,
                  })
                )
              }
            >
              {inventoryEntryUnits(line.unit).map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              className={fieldControlClass}
              aria-label={`第 ${index + 1} 行分类`}
              value={line.category}
              onChange={(event) =>
                onChange(
                  updateInventoryEntryLine(lines, line.key, {
                    category: event.target.value as Category,
                  })
                )
              }
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {categoryLabel[category]}
                </option>
              ))}
            </select>
            <select
              className={fieldControlClass}
              aria-label={`第 ${index + 1} 行位置`}
              value={line.location}
              onChange={(event) =>
                onChange(
                  updateInventoryEntryLine(lines, line.key, {
                    location: event.target.value as Location,
                  })
                )
              }
            >
              {LOCATIONS.map((location) => (
                <option key={location} value={location}>
                  {locationLabel[location]}
                </option>
              ))}
            </select>
          </div>
          <Field label="大约能放到">
            <Input
              type="date"
              className="h-12 text-base"
              aria-label={`第 ${index + 1} 行保质期`}
              value={line.expiresAt}
              onChange={(event) =>
                onChange(
                  updateInventoryEntryLine(lines, line.key, {
                    expiresAt: event.target.value,
                  })
                )
              }
            />
          </Field>
          {notes?.[line.key] ? (
            <p className="text-sm leading-6 text-muted-foreground">
              {notes[line.key]}
            </p>
          ) : null}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full text-base"
        onClick={() => onChange(addInventoryEntryLine(lines))}
      >
        加上一条
      </Button>
    </div>
  )
}
