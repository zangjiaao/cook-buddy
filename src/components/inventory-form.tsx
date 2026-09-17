import { useMemo, useState } from "react"
import type { FormEvent } from "react"
import { useNavigate } from "@tanstack/react-router"
import { IngredientPicker } from "@/components/ingredient-picker"
import type { NewIngredientDraft } from "@/components/ingredient-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, fieldControlClass } from "@/components/field"
import { useDb } from "@/hooks/use-db"
import { withTypedAlias } from "@/lib/ai/match-ingredient"
import { formatISODate, nowIso } from "@/lib/dates"
import { ingredientsRepo, inventoryRepo } from "@/lib/db/repos"
import { createId } from "@/lib/id"
import { buildIngredient } from "@/lib/ingredient-record"
import { locationLabel, MARKET_UNITS } from "@/lib/labels"
import {
  defaultShelfLifeDays,
  shelfLifeHint,
  suggestExpiresAt,
} from "@/lib/shelf-life"
import { LOCATIONS } from "@/lib/types"
import type { Ingredient, InventoryItem, Location } from "@/lib/types"

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
  const [expiresTouched, setExpiresTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const selected = useMemo(
    () => ingredients.find((ingredient) => ingredient.id === form.ingredientId),
    [form.ingredientId, ingredients]
  )

  const suggestedDays = defaultShelfLifeDays({
    ingredient: selected,
    location: form.location,
  })
  const suggestedExpiry = suggestExpiresAt(form.purchasedAt, suggestedDays)

  function update<TKey extends keyof FormState>(
    key: TKey,
    value: FormState[TKey]
  ) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function applyDefaults(
    patch: Partial<FormState> & Pick<FormState, "ingredientId">,
    ingredient?: Ingredient
  ) {
    setForm((current) => {
      const next = { ...current, ...patch }
      const days = defaultShelfLifeDays({
        ingredient: ingredient ?? selected,
        location: next.location,
      })
      if (!expiresTouched) {
        next.expiresAt =
          suggestExpiresAt(next.purchasedAt, days) ?? next.expiresAt
      }
      return next
    })
  }

  async function handleSelect(ingredient: Ingredient, typedName: string) {
    const aliased = withTypedAlias(ingredient, typedName)
    if (aliased.aliases.length !== ingredient.aliases.length) {
      await ingredientsRepo.put(aliased)
      refresh()
    }
    applyDefaults(
      {
        ingredientId: ingredient.id,
        unit: ingredient.defaultUnit || form.unit,
      },
      aliased
    )
    setError("")
  }

  async function handleCreate(draft: NewIngredientDraft) {
    const created = buildIngredient(draft)
    await ingredientsRepo.put(created)
    refresh()
    return created
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.ingredientId) {
      setError("先对齐一个食材，或确认新建。")
      return
    }
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
      <IngredientPicker
        ingredients={ingredients}
        valueId={form.ingredientId}
        allowCreate
        onSelect={(ingredient, typedName) =>
          void handleSelect(ingredient, typedName)
        }
        onCreate={handleCreate}
      />
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
              .filter(
                (unit, index, all): unit is string =>
                  Boolean(unit) && all.indexOf(unit) === index
              )
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
          onChange={(event) =>
            applyDefaults({
              ingredientId: form.ingredientId,
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
      <Field label="购入日">
        <Input
          type="date"
          className="h-12 text-base"
          value={form.purchasedAt}
          onChange={(event) =>
            applyDefaults({
              ingredientId: form.ingredientId,
              purchasedAt: event.target.value,
            })
          }
        />
      </Field>
      <Field label="大约能放到">
        <Input
          type="date"
          className="h-12 text-base"
          value={form.expiresAt}
          onChange={(event) => {
            setExpiresTouched(true)
            update("expiresAt", event.target.value)
          }}
        />
      </Field>
      {suggestedDays != null && suggestedExpiry ? (
        <p className="text-sm leading-6 text-muted-foreground">
          {shelfLifeHint(suggestedDays, form.location)}，建议 {suggestedExpiry}
          。可改，不用填生产日期。
        </p>
      ) : null}
      <Field label="备注">
        <Textarea
          className="min-h-20 text-base"
          value={form.notes}
          onChange={(event) => update("notes", event.target.value)}
        />
      </Field>
      {error ? (
        <p className="text-sm leading-6 text-destructive">{error}</p>
      ) : null}
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
