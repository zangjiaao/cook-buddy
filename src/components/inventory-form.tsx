import { useMemo, useRef, useState } from "react"
import type { FormEvent } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { IngredientConfirmList } from "@/components/ingredient-confirm"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, fieldControlClass } from "@/components/field"
import { useDb } from "@/hooks/use-db"
import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import {
  applyConfirmChoice,
  guessDefaultLocation,
} from "@/lib/ai/resolve-ingredients"
import { resolveIngredients } from "@/lib/ai/resolve-ingredients.functions"
import type {
  ConfirmChoice,
  IngredientResolveResult,
} from "@/lib/ai/resolve-ingredients"
import { formatISODate, nowIso } from "@/lib/dates"
import { ingredientsRepo, inventoryRepo } from "@/lib/db/repos"
import { createId } from "@/lib/id"
import {
  persistIngredientResolutions,
  resolveAndPersistQuiet,
} from "@/lib/ingredient-resolve-persist"
import {
  inventoryNameAlreadyLinked,
  inventoryStockDefaults,
} from "@/lib/inventory-form-defaults"
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
  const resolveOnServer = useServerFn(resolveIngredients)
  const [form, setForm] = useState<FormState>(toState(item))
  const [typedName, setTypedName] = useState("")
  const [nameEdited, setNameEdited] = useState(false)
  const [unitTouched, setUnitTouched] = useState(Boolean(item))
  const [locationTouched, setLocationTouched] = useState(Boolean(item))
  const [expiresTouched, setExpiresTouched] = useState(Boolean(item?.expiresAt))
  const [saving, setSaving] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState("")
  const [resolvedNote, setResolvedNote] = useState("")
  const [saveAfterConfirm, setSaveAfterConfirm] = useState(false)
  const [pendingResults, setPendingResults] = useState<
    IngredientResolveResult[] | null
  >(null)
  const unitTouchedRef = useRef(unitTouched)
  const locationTouchedRef = useRef(locationTouched)
  const expiresTouchedRef = useRef(expiresTouched)
  const resolveLock = useRef<Promise<{
    ingredient: Ingredient
    location: Location
  } | null> | null>(null)
  unitTouchedRef.current = unitTouched
  locationTouchedRef.current = locationTouched
  expiresTouchedRef.current = expiresTouched

  const selected = useMemo(
    () => ingredients.find((ingredient) => ingredient.id === form.ingredientId),
    [form.ingredientId, ingredients]
  )
  const rawName = (nameEdited ? typedName : (selected?.name ?? "")).trim()

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
      if (!expiresTouchedRef.current) {
        next.expiresAt =
          suggestExpiresAt(next.purchasedAt, days) ?? next.expiresAt
      }
      return next
    })
  }

  function formFromIngredient(
    current: FormState,
    ingredient: Ingredient,
    locationHint?: Location
  ): FormState {
    const defaults = inventoryStockDefaults({
      ingredient,
      purchasedAt: current.purchasedAt,
      locationHint,
      currentUnit: current.unit,
      currentLocation: current.location,
      currentExpiresAt: current.expiresAt,
      unitTouched: unitTouchedRef.current,
      locationTouched: locationTouchedRef.current,
      expiresTouched: expiresTouchedRef.current,
    })
    return {
      ...current,
      ingredientId: ingredient.id,
      unit: defaults.unit,
      location: defaults.location,
      expiresAt: defaults.expiresAt,
    }
  }

  function applyIngredient(ingredient: Ingredient, locationHint?: Location) {
    let next: FormState | undefined
    setForm((current) => {
      next = formFromIngredient(current, ingredient, locationHint)
      return next
    })
    setTypedName(ingredient.name)
    setNameEdited(true)
    setPendingResults(null)
    setError("")
    if (!item) {
      setResolvedNote(`已按「${ingredient.name}」常用放法填好，可改。`)
    }
    refresh()
    return next ?? formFromIngredient(form, ingredient, locationHint)
  }

  function handleNameChange(value: string) {
    setNameEdited(true)
    setTypedName(value)
    setPendingResults(null)
    setResolvedNote("")
    setError("")
    setSaveAfterConfirm(false)
  }

  async function writeInventory(state: FormState) {
    const timestamp = nowIso()
    const next: InventoryItem = {
      id: item?.id ?? createId("inv"),
      ingredientId: state.ingredientId,
      quantity: Number(state.quantity) || 0,
      unit: state.unit,
      location: state.location,
      purchasedAt: state.purchasedAt,
      expiresAt: state.expiresAt || null,
      notes: state.notes,
      createdAt: item?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    await inventoryRepo.put(next)
    refresh()
    void navigate({ to: "/inventory" })
  }

  async function resolveTypedName(): Promise<{
    ingredient: Ingredient
    location: Location
  } | null> {
    if (resolveLock.current) return resolveLock.current
    if (!rawName) {
      setError("先写食材名。")
      return null
    }
    if (inventoryNameAlreadyLinked(rawName, form.ingredientId, selected)) {
      return selected ? { ingredient: selected, location: form.location } : null
    }
    const run = (async () => {
      setResolving(true)
      try {
        const currentIngredients = await ingredientsRepo.list()
        const { results, pending, byRawName } = await resolveAndPersistQuiet(
          [{ rawName, unit: form.unit }],
          currentIngredients,
          (payload) => resolveOnServer({ data: payload })
        )
        if (pending.length > 0) {
          setPendingResults(results)
          return null
        }
        const ingredient = byRawName.get(normalizeIngredientName(rawName))
        if (!ingredient) {
          setError("没能记下这个食材，请再试一次。")
          return null
        }
        const location =
          results[0]?.createDraft?.defaultLocation ??
          guessDefaultLocation(ingredient.category)
        applyIngredient(ingredient, location)
        return { ingredient, location }
      } finally {
        setResolving(false)
      }
    })()
    resolveLock.current = run
    try {
      return await run
    } finally {
      resolveLock.current = null
    }
  }

  async function onNameBlur() {
    if (!rawName) return
    if (inventoryNameAlreadyLinked(rawName, form.ingredientId, selected)) return
    if (pendingResults?.some((result) => result.action === "needs_confirm")) {
      return
    }
    setSaveAfterConfirm(false)
    try {
      await resolveTypedName()
    } catch (resolveError) {
      console.error("识别食材失败", resolveError)
      setError("没能记下这个食材，请再试一次。")
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError("")
    setSaveAfterConfirm(true)
    try {
      if (inventoryNameAlreadyLinked(rawName, form.ingredientId, selected)) {
        await writeInventory(form)
        return
      }
      const resolved = await resolveTypedName()
      if (!resolved) {
        setSaving(false)
        return
      }
      await writeInventory(
        formFromIngredient(form, resolved.ingredient, resolved.location)
      )
    } catch (submitError) {
      console.error("保存库存失败", submitError)
      setError("保存失败，请再试一次。")
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirm(
    rawNameToConfirm: string,
    choice: ConfirmChoice
  ) {
    if (!pendingResults) return
    const next = pendingResults.map((result) =>
      result.rawName === rawNameToConfirm
        ? applyConfirmChoice(result, choice)
        : result
    )
    setPendingResults(next)
    if (next.some((result) => result.action === "needs_confirm")) return
    setSaving(true)
    try {
      const currentIngredients = await ingredientsRepo.list()
      const { byRawName } = await persistIngredientResolutions(
        next,
        currentIngredients
      )
      const decided = next.find((result) => result.action !== "needs_confirm")
      const ingredient = decided
        ? byRawName.get(normalizeIngredientName(decided.rawName))
        : undefined
      if (!decided || !ingredient) {
        setError("没能记下这个食材，请再试一次。")
        return
      }
      const location =
        decided.createDraft?.defaultLocation ??
        guessDefaultLocation(ingredient.category)
      const nextForm = applyIngredient(ingredient, location)
      if (saveAfterConfirm) {
        await writeInventory(nextForm)
      }
    } catch (confirmError) {
      console.error("保存库存失败", confirmError)
      setError("保存失败，请再试一次。")
    } finally {
      setSaving(false)
    }
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
        <Input
          className="h-12 text-base"
          placeholder="例如 小白菜"
          value={nameEdited ? typedName : (selected?.name ?? "")}
          autoComplete="off"
          onChange={(event) => handleNameChange(event.target.value)}
          onBlur={() => void onNameBlur()}
        />
      </Field>
      {resolvedNote && !pendingResults ? (
        <p className="text-sm leading-6 text-muted-foreground">
          {resolvedNote}
        </p>
      ) : null}
      {pendingResults ? (
        <IngredientConfirmList
          results={pendingResults}
          onChoose={(nextRawName, choice) =>
            void handleConfirm(nextRawName, choice)
          }
        />
      ) : null}
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
            onChange={(event) => {
              setUnitTouched(true)
              update("unit", event.target.value)
            }}
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
          onChange={(event) => {
            setLocationTouched(true)
            applyDefaults({
              ingredientId: form.ingredientId,
              location: event.target.value as Location,
            })
          }}
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
      <Button
        type="submit"
        className="h-12 text-base"
        disabled={
          saving ||
          resolving ||
          Boolean(
            pendingResults?.some((result) => result.action === "needs_confirm")
          )
        }
      >
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
