import { Field, fieldControlClass } from "@/components/field"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  shoppingPrimaryText,
  shoppingSecondaryText,
} from "@/lib/shopping-from-plan"
import { locationLabel, MARKET_UNITS } from "@/lib/labels"
import { LOCATIONS } from "@/lib/types"
import type { Location, ShoppingItem } from "@/lib/types"

export type CheckInFormRow = {
  item: ShoppingItem
  quantity: string
  unit: string
  location: Location
  expiresAt: string
}

export function CheckInConfirm({
  rows,
  error,
  busy,
  onChange,
  onCancel,
  onConfirm,
}: {
  rows: CheckInFormRow[]
  error: string
  busy: boolean
  onChange: (index: number, patch: Partial<CheckInFormRow>) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="flex flex-col gap-4 px-4 pb-8">
      <p className="text-sm leading-6 text-muted-foreground">
        核对买到的差额再入库。够的默认 0，不确定的请手填。
      </p>
      {rows.map((row, index) => (
        <Card key={row.item.id}>
          <CardContent className="space-y-3">
            <div>
              <p className="text-lg font-medium">{row.item.name}</p>
              <p className="text-sm text-muted-foreground">
                {shoppingPrimaryText(row.item)}
              </p>
              {shoppingSecondaryText(row.item) ? (
                <p className="text-sm text-muted-foreground">
                  {shoppingSecondaryText(row.item)}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="这次入库">
                <Input
                  inputMode="decimal"
                  className="h-12 text-base"
                  placeholder={
                    row.item.shortage === "unsure" ? "买到多少" : "0"
                  }
                  value={row.quantity}
                  onChange={(event) =>
                    onChange(index, { quantity: event.target.value })
                  }
                />
              </Field>
              <Field label="单位">
                <select
                  className={fieldControlClass}
                  value={row.unit}
                  onChange={(event) =>
                    onChange(index, { unit: event.target.value })
                  }
                >
                  {[row.unit, row.item.unit, ...MARKET_UNITS]
                    .filter(
                      (unit, unitIndex, all) =>
                        Boolean(unit) && all.indexOf(unit) === unitIndex
                    )
                    .map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="放到">
                <select
                  className={fieldControlClass}
                  value={row.location}
                  onChange={(event) =>
                    onChange(index, {
                      location: event.target.value as Location,
                    })
                  }
                >
                  {LOCATIONS.map((location) => (
                    <option key={location} value={location}>
                      {locationLabel[location]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="大约能放到">
                <Input
                  type="date"
                  className="h-12 text-base"
                  value={row.expiresAt}
                  onChange={(event) =>
                    onChange(index, { expiresAt: event.target.value })
                  }
                />
              </Field>
            </div>
          </CardContent>
        </Card>
      ))}
      {error ? (
        <p className="text-sm leading-6 text-destructive">{error}</p>
      ) : null}
      <Button
        className="h-12 text-base"
        disabled={busy}
        onClick={() => onConfirm()}
      >
        {busy ? "正在入库…" : "确认入库"}
      </Button>
      <Button
        variant="ghost"
        className="h-12 text-base"
        disabled={busy}
        onClick={() => onCancel()}
      >
        返回清单
      </Button>
    </div>
  )
}
