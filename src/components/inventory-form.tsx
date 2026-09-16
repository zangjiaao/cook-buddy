import { useMemo, useState } from "react"
import type { FormEvent } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, fieldControlClass } from "@/components/field"
import { useDb } from "@/hooks/use-db"
import { addDays, formatISODate, nowIso } from "@/lib/dates"
import { inventoryRepo } from "@/lib/db/repos"
import { createId } from "@/lib/id"
import { LOCATIONS } from "@/lib/types"
import type { Ingredient, InventoryItem, Location } from "@/lib/types"
import { locationLabel, MARKET_UNITS } from "@/lib/labels"

type FormState = {
  ingredientId: string
  quantity: string
  unit: string
  location: Location
  purchasedAt: string
  expiresAt: string
  notes: string
}

function toState(item?: InventoryItem): FormState {
  return {
    ingredientId: item?.ingredientId ?? "",
    quantity: item ? String(item.quantity) : "1",
    unit: item?.unit ?? "把",
    location: item?.location ?? "fridge",
    purchasedAt: item?.purchasedAt ?? formatISODate(),
    expiresAt: item?.expiresAt ?? "",
    notes: item?.notes ?? "",
  }
}

export function InventoryForm({
  ingredients,
  item,
}: {
  ingredients: Ingredient[]
  item?: InventoryItem
}) {
  const navigate = useNavigate()
  const { refresh } = useDb()
  const [form, setForm] = useState<FormState>(toState(item))
  const [saving, setSaving] = useState(false)

  const selected = useMemo(
    () => ingredients.find((ingredient) => ingredient.id === form.ingredientId),
    [form.ingredientId, ingredients]
  )

  function update<TKey extends keyof FormState>(key: TKey, value: FormState[TKey]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function applyIngredient(ingredientId: string) {
    const ingredient = ingredients.find((row) => row.id === ingredientId)
    setForm((current) => ({
      ...current,
      ingredientId,
      unit: ingredient?.defaultUnit ?? current.unit,
      expiresAt:
        ingredient?.defaultShelfLifeDays != null
          ? formatISODate(addDays(new Date(), ingredient.defaultShelfLifeDays))
          : current.expiresAt,
    }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.ingredientId) return
    setSaving(true)
    const timestamp = nowIso()
    const next: InventoryItem = {
      id: item?.id ?? createId("inv"),
      ingredientId: form.ingredientId,
      quantity: Number(form.quantity) || 0,
      unit: form.unit,
      location: form.location,
      purchasedAt: form.purchasedAt,
      expiresAt: form.expiresAt || null,
      notes: form.notes,
      createdAt: item?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    await inventoryRepo.put(next)
    refresh()
    setSaving(false)
    void navigate({ to: "/inventory" })
  }

  async function onDelete() {
    if (!item) return
    await inventoryRepo.remove(item.id)
    refresh()
    void navigate({ to: "/inventory" })
  }

  return (
    <form className="flex flex-col gap-4 px-4 pb-8" onSubmit={onSubmit}>
      <Field label="食材">
        <select
          required
          className={fieldControlClass}
          value={form.ingredientId}
          onChange={(event) => applyIngredient(event.target.value)}
        >
          <option value="">选择库存主数据</option>
          {ingredients.map((ingredient) => (
            <option key={ingredient.id} value={ingredient.id}>
              {ingredient.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="数量">
          <Input
            inputMode="decimal"
            className="h-12 text-base"
            value={form.quantity}
            onChange={(event) => update("quantity", event.target.value)}
          />
        </Field>
        <Field label="单位">
          <select
            className={fieldControlClass}
            value={form.unit}
            onChange={(event) => update("unit", event.target.value)}
          >
            {[form.unit, selected?.defaultUnit, ...MARKET_UNITS]
              .filter((unit, index, all): unit is string => Boolean(unit) && all.indexOf(unit) === index)
              .map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <Field label="位置">
        <select
          className={fieldControlClass}
          value={form.location}
          onChange={(event) => update("location", event.target.value as Location)}
        >
          {LOCATIONS.map((location) => (
            <option key={location} value={location}>
              {locationLabel[location]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="购入日">
        <Input
          type="date"
          className="h-12 text-base"
          value={form.purchasedAt}
          onChange={(event) => update("purchasedAt", event.target.value)}
        />
      </Field>
      <Field label="大约能放到">
        <Input
          type="date"
          className="h-12 text-base"
          value={form.expiresAt}
          onChange={(event) => update("expiresAt", event.target.value)}
        />
      </Field>
      <Field label="备注">
        <Textarea
          className="min-h-20 text-base"
          value={form.notes}
          onChange={(event) => update("notes", event.target.value)}
        />
      </Field>
      <Button type="submit" className="h-12 text-base" disabled={saving}>
        {item ? "保存" : "加入库存"}
      </Button>
      {item ? (
        <Button
          type="button"
          variant="destructive"
          className="h-12 text-base"
          onClick={() => void onDelete()}
        >
          删除这条
        </Button>
      ) : null}
    </form>
  )
}
