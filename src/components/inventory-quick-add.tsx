import { useMemo, useState } from "react"
import { useServerFn } from "@tanstack/react-start"
import { IngredientConfirmList } from "@/components/ingredient-confirm"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, fieldControlClass } from "@/components/field"
import { useDb } from "@/hooks/use-db"
import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { parseInventoryUtterance } from "@/lib/ai/parse-inventory.functions"
import {
  applyConfirmChoice,
  findExactIngredient,
  findSynonymIngredient,
  guessDefaultLocation,
  resolveIngredientsLocal,
  toIngredientSnapshot,
} from "@/lib/ai/resolve-ingredients"
import type {
  ConfirmChoice,
  IngredientResolveResult,
} from "@/lib/ai/resolve-ingredients"
import { resolveIngredients } from "@/lib/ai/resolve-ingredients.functions"
import { findSameUnitStock } from "@/lib/check-in"
import { formatISODate, nowIso } from "@/lib/dates"
import { ingredientsRepo, inventoryRepo } from "@/lib/db/repos"
import { createId } from "@/lib/id"
import { mergeInventoryAdds } from "@/lib/inventory-add"
import type { InventoryAddLine } from "@/lib/inventory-add"
import {
  patchIngredientCategory,
  placementForName,
} from "@/lib/ingredient-category"
import { parseInventoryUtteranceByRules } from "@/lib/inventory-utterance"
import type { InventoryUtteranceItem } from "@/lib/inventory-utterance"
import {
  persistIngredientResolutions,
  resolveAndPersistQuiet,
} from "@/lib/ingredient-resolve-persist"
import { categoryLabel, locationLabel, MARKET_UNITS } from "@/lib/labels"
import { defaultShelfLifeDays, suggestExpiresAt } from "@/lib/shelf-life"
import { CATEGORIES, LOCATIONS } from "@/lib/types"
import type { Category, Ingredient, InventoryItem, Location } from "@/lib/types"

type Line = {
  key: string
  name: string
  quantity: string
  unit: string
  category: Category
  location: Location
  expiresAt: string
}

const EXTRA_UNITS = [
  "两",
  "公斤",
  "千克",
  "克",
  "毫升",
  "升",
  "只",
  "条",
  "根",
  "包",
]

function lineFromItem(
  item: InventoryUtteranceItem,
  ingredients: Ingredient[]
): Line {
  const snapshots = ingredients.map(toIngredientSnapshot)
  const [resolved] = resolveIngredientsLocal({
    items: [{ rawName: item.name, unit: item.unit }],
    ingredients: snapshots,
  })
  const linked =
    resolved.action === "link"
      ? ingredients.find((row) => row.id === resolved.ingredientId)
      : undefined
  const category = linked?.category ?? item.category
  const location = linked
    ? guessDefaultLocation(linked.category)
    : item.defaultLocation
  const days = defaultShelfLifeDays({ ingredient: linked, category, location })
  return {
    key: createId("line"),
    name: item.name,
    quantity: String(item.quantity),
    unit: item.unit,
    category,
    location,
    expiresAt: suggestExpiresAt(formatISODate(), days) ?? "",
  }
}

function unitsFor(unit: string): string[] {
  return [unit, ...MARKET_UNITS, ...EXTRA_UNITS].filter(
    (value, index, all) => Boolean(value) && all.indexOf(value) === index
  )
}

export function InventoryQuickAdd({
  ingredients,
  inventory,
  onAdded,
}: {
  ingredients: Ingredient[]
  inventory: InventoryItem[]
  onAdded: (message: string) => void
}) {
  const { refresh } = useDb()
  const parseOnServer = useServerFn(parseInventoryUtterance)
  const resolveOnServer = useServerFn(resolveIngredients)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [lines, setLines] = useState<Line[] | null>(null)
  const [source, setSource] = useState<"ai" | "rule" | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [pendingResults, setPendingResults] = useState<
    IngredientResolveResult[] | null
  >(null)

  const ingredientById = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])),
    [ingredients]
  )

  function resetPreview() {
    setLines(null)
    setSource(null)
    setPendingResults(null)
    setError("")
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines(
      (current) =>
        current?.map((line) => {
          if (line.key !== key) return line
          const next = { ...line, ...patch }
          if (patch.category && patch.category !== line.category) {
            const placement = placementForName(next.name, next.category)
            next.location = placement.location
            next.expiresAt =
              suggestExpiresAt(formatISODate(), placement.shelfLifeDays) ?? ""
          }
          return next
        }) ?? null
    )
  }

  function mergeNote(line: Line): string | null {
    const snapshots = ingredients.map(toIngredientSnapshot)
    const found =
      findExactIngredient(line.name, snapshots) ??
      findSynonymIngredient(line.name, snapshots)
    if (!found) return null
    const existing = findSameUnitStock(inventory, found.id, line.unit)
    if (!existing) return null
    const name = ingredientById.get(found.id)?.name ?? line.name
    return `已有 ${name} ${existing.quantity} ${existing.unit}，确认后会加在一起`
  }

  async function recognize() {
    const trimmed = text.trim()
    if (!trimmed) {
      setError("先写一句，比如两斤五花肉、一瓶生抽。")
      return
    }
    setBusy(true)
    setError("")
    setPendingResults(null)
    try {
      let draft = parseInventoryUtteranceByRules(trimmed)
      try {
        draft = await parseOnServer({ data: { text: trimmed } })
      } catch (parseError) {
        console.error("一句话识别失败", parseError)
      }
      if (draft.items.length === 0) {
        setLines(null)
        setSource(null)
        setError("没认出食材，用顿号或逗号分开试试。")
        return
      }
      setSource(draft.source)
      setLines(draft.items.map((item) => lineFromItem(item, ingredients)))
    } finally {
      setBusy(false)
    }
  }

  async function writeResolved(
    results: IngredientResolveResult[],
    draftLines: Line[]
  ) {
    const currentIngredients = await ingredientsRepo.list()
    const { byRawName } = await persistIngredientResolutions(
      results,
      currentIngredients
    )
    const prepared: InventoryAddLine[] = []
    for (const line of draftLines) {
      const quantity = Number(line.quantity)
      if (!line.name.trim() || !Number.isFinite(quantity) || quantity <= 0) {
        continue
      }
      const key = normalizeIngredientName(line.name)
      let ingredient = byRawName.get(key)
      if (!ingredient) continue
      if (ingredient.category !== line.category) {
        ingredient = patchIngredientCategory(ingredient, line.category)
        await ingredientsRepo.put(ingredient)
        byRawName.set(key, ingredient)
      }
      prepared.push({
        ingredientId: ingredient.id,
        quantity,
        unit: line.unit,
        location: line.location,
        expiresAt: line.expiresAt || null,
      })
    }
    if (prepared.length === 0) {
      setError("没有可以写入的食材。")
      return
    }
    const currentInventory = await inventoryRepo.list()
    const touched = mergeInventoryAdds(currentInventory, prepared, nowIso())
    for (const row of touched) {
      await inventoryRepo.put(row)
    }
    refresh()
    setOpen(false)
    setText("")
    resetPreview()
    onAdded(`已加入 ${prepared.length} 样。同单位的已有库存会加在一起。`)
  }

  async function confirm() {
    if (!lines || lines.length === 0) return
    const usable = lines.filter((line) => line.name.trim())
    if (usable.length === 0) {
      setError("先写上食材名。")
      return
    }
    if (
      usable.some((line) => {
        const quantity = Number(line.quantity)
        return !Number.isFinite(quantity) || quantity <= 0
      })
    ) {
      setError("数量要是大于 0 的数字。")
      return
    }
    setBusy(true)
    setError("")
    try {
      const currentIngredients = await ingredientsRepo.list()
      const { results, pending } = await resolveAndPersistQuiet(
        usable.map((line) => ({ rawName: line.name.trim(), unit: line.unit })),
        currentIngredients,
        (payload) => resolveOnServer({ data: payload })
      )
      if (pending.length > 0) {
        setPendingResults(results)
        return
      }
      await writeResolved(results, usable)
    } catch (confirmError) {
      console.error("一句话加入库存失败", confirmError)
      setError("没能写入，请再试一次。")
    } finally {
      setBusy(false)
    }
  }

  async function handleChoice(rawName: string, choice: ConfirmChoice) {
    if (!pendingResults || !lines) return
    const next = pendingResults.map((result) =>
      result.rawName === rawName ? applyConfirmChoice(result, choice) : result
    )
    setPendingResults(next)
    if (next.some((result) => result.action === "needs_confirm")) return
    setBusy(true)
    try {
      await writeResolved(
        next,
        lines.filter((line) => line.name.trim())
      )
    } catch (choiceError) {
      console.error("一句话加入库存失败", choiceError)
      setError("没能写入，请再试一次。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant={open ? "secondary" : "outline"}
        className="h-11 text-base"
        onClick={() => {
          setOpen((value) => !value)
          if (open) resetPreview()
        }}
      >
        一句话添加
      </Button>
      {open ? (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <Field label="一句话">
            <Textarea
              className="min-h-20 text-base"
              placeholder="例如：两斤五花肉、一瓶生抽、五香粉一袋、鸡蛋10个"
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                setError("")
              }}
            />
          </Field>
          <Button
            type="button"
            className="h-11"
            disabled={busy}
            onClick={() => void recognize()}
          >
            {busy && !lines ? "正在识别…" : "识别"}
          </Button>
          {source ? (
            <p className="text-sm leading-6 text-muted-foreground">
              {source === "ai"
                ? "AI 识别的，可以改。"
                : "按规则拆开的，可以改。"}
              确认后才写入。
            </p>
          ) : null}
          {lines?.map((line) => {
            const note = mergeNote(line)
            return (
              <div
                key={line.key}
                className="flex flex-col gap-2 rounded-md bg-muted/50 p-3"
              >
                <div className="flex items-start gap-2">
                  <Input
                    className="h-11 flex-1 text-base"
                    aria-label="食材名"
                    value={line.name}
                    onChange={(event) =>
                      updateLine(line.key, { name: event.target.value })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 px-3"
                    onClick={() =>
                      setLines(
                        (current) =>
                          current?.filter((row) => row.key !== line.key) ?? null
                      )
                    }
                  >
                    去掉
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    className="h-11 text-base"
                    aria-label="数量"
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(event) =>
                      updateLine(line.key, { quantity: event.target.value })
                    }
                  />
                  <select
                    className={fieldControlClass}
                    aria-label="单位"
                    value={line.unit}
                    onChange={(event) =>
                      updateLine(line.key, { unit: event.target.value })
                    }
                  >
                    {unitsFor(line.unit).map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className={fieldControlClass}
                    aria-label="分类"
                    value={line.category}
                    onChange={(event) =>
                      updateLine(line.key, {
                        category: event.target.value as Category,
                      })
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
                    aria-label="位置"
                    value={line.location}
                    onChange={(event) =>
                      updateLine(line.key, {
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
                </div>
                <Field label="大约能放到">
                  <Input
                    type="date"
                    className="h-11 text-base"
                    value={line.expiresAt}
                    onChange={(event) =>
                      updateLine(line.key, { expiresAt: event.target.value })
                    }
                  />
                </Field>
                {note ? (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {note}
                  </p>
                ) : null}
              </div>
            )
          })}
          {pendingResults ? (
            <IngredientConfirmList
              results={pendingResults}
              onChoose={(rawName, choice) => void handleChoice(rawName, choice)}
            />
          ) : null}
          {error ? (
            <p className="text-sm leading-6 text-destructive">{error}</p>
          ) : null}
          {lines && lines.length > 0 ? (
            <Button
              type="button"
              className="h-11 text-base"
              disabled={
                busy ||
                Boolean(
                  pendingResults?.some(
                    (result) => result.action === "needs_confirm"
                  )
                )
              }
              onClick={() => void confirm()}
            >
              {busy ? "正在写入…" : "加入库存"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
