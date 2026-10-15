import {
  findExactIngredient,
  findSynonymIngredient,
  guessCategory,
  guessDefaultLocation,
  guessDefaultUnit,
  resolveIngredientsLocal,
  toIngredientSnapshot,
} from "@/lib/ai/resolve-ingredients"
import { findSameUnitStock } from "@/lib/check-in"
import { formatISODate } from "@/lib/dates"
import { createId } from "@/lib/id"
import { placementForName } from "@/lib/ingredient-category"
import { MARKET_UNITS } from "@/lib/labels"
import { defaultShelfLifeDays, suggestExpiresAt } from "@/lib/shelf-life"
import type { Category, Ingredient, InventoryItem, Location } from "@/lib/types"
import type { InventoryUtteranceItem } from "@/lib/inventory-utterance"

export const INVENTORY_ADDED_NOTICE_KEY = "cookbuddy.inventory.added-notice"

export const INVENTORY_ENTRY_SOURCES = ["ai", "rule", "manual"] as const
export type InventoryEntrySource = (typeof INVENTORY_ENTRY_SOURCES)[number]

export type InventoryEntryLine = {
  key: string
  name: string
  quantity: string
  unit: string
  category: Category
  location: Location
  expiresAt: string
  categoryTouched: boolean
  unitTouched: boolean
  locationTouched: boolean
  expiresTouched: boolean
}

export type InventoryEntryPatch = Partial<
  Pick<
    InventoryEntryLine,
    "name" | "quantity" | "unit" | "category" | "location" | "expiresAt"
  >
>

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

function fillFromCategory(
  line: InventoryEntryLine,
  category: Category,
  today: string,
  options: { unit: boolean; location: boolean; expires: boolean }
): InventoryEntryLine {
  const placement = placementForName(line.name, category)
  return {
    ...line,
    category,
    unit:
      options.unit && !line.unitTouched
        ? guessDefaultUnit(line.name, category) || "个"
        : line.unit,
    location:
      options.location && !line.locationTouched
        ? placement.location
        : line.location,
    expiresAt:
      options.expires && !line.expiresTouched
        ? (suggestExpiresAt(today, placement.shelfLifeDays) ?? "")
        : line.expiresAt,
  }
}

export function createInventoryEntryLine(
  partial: Partial<InventoryEntryLine> = {},
  today = formatISODate()
): InventoryEntryLine {
  const category = partial.category ?? "other"
  const placement = placementForName(partial.name ?? "", category)
  return {
    key: partial.key ?? createId("line"),
    name: partial.name ?? "",
    quantity: partial.quantity ?? "1",
    unit: partial.unit ?? guessDefaultUnit(partial.name ?? "", category),
    category,
    location: partial.location ?? placement.location,
    expiresAt:
      partial.expiresAt ??
      suggestExpiresAt(today, placement.shelfLifeDays) ??
      "",
    categoryTouched: partial.categoryTouched ?? false,
    unitTouched: partial.unitTouched ?? false,
    locationTouched: partial.locationTouched ?? false,
    expiresTouched: partial.expiresTouched ?? false,
  }
}

export function inventoryEntryLineFromUtterance(
  item: InventoryUtteranceItem,
  ingredients: Ingredient[],
  today = formatISODate()
): InventoryEntryLine {
  const [resolved] = resolveIngredientsLocal({
    items: [{ rawName: item.name, unit: item.unit }],
    ingredients: ingredients.map(toIngredientSnapshot),
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
  return createInventoryEntryLine(
    {
      name: item.name,
      quantity: String(item.quantity),
      unit: item.unit,
      category,
      location,
      expiresAt: suggestExpiresAt(today, days) ?? "",
    },
    today
  )
}

export function inventoryEntryLinesFromUtterance(
  items: InventoryUtteranceItem[],
  ingredients: Ingredient[],
  today = formatISODate()
): InventoryEntryLine[] {
  return items.map((item) =>
    inventoryEntryLineFromUtterance(item, ingredients, today)
  )
}

export function applyInventoryEntryPatch(
  line: InventoryEntryLine,
  patch: InventoryEntryPatch,
  today = formatISODate()
): InventoryEntryLine {
  const next: InventoryEntryLine = {
    ...line,
    ...patch,
    unitTouched: patch.unit != null ? true : line.unitTouched,
    locationTouched: patch.location != null ? true : line.locationTouched,
    expiresTouched: patch.expiresAt != null ? true : line.expiresTouched,
    categoryTouched: patch.category != null ? true : line.categoryTouched,
  }
  if (patch.category != null) {
    return fillFromCategory(next, patch.category, today, {
      unit: patch.unit == null,
      location: patch.location == null,
      expires: patch.expiresAt == null,
    })
  }
  if (patch.name != null && !line.categoryTouched) {
    const category = next.name.trim() ? guessCategory(next.name) : "other"
    return fillFromCategory({ ...next, category }, category, today, {
      unit: true,
      location: true,
      expires: true,
    })
  }
  return next
}

export function updateInventoryEntryLine(
  lines: InventoryEntryLine[],
  key: string,
  patch: InventoryEntryPatch,
  today = formatISODate()
): InventoryEntryLine[] {
  return lines.map((line) =>
    line.key === key ? applyInventoryEntryPatch(line, patch, today) : line
  )
}

export function addInventoryEntryLine(
  lines: InventoryEntryLine[],
  today = formatISODate()
): InventoryEntryLine[] {
  return [...lines, createInventoryEntryLine({}, today)]
}

export function removeInventoryEntryLine(
  lines: InventoryEntryLine[],
  key: string
): InventoryEntryLine[] {
  return lines.filter((line) => line.key !== key)
}

export function inventoryEntryError(
  lines: InventoryEntryLine[]
): string | null {
  const named = lines.filter((line) => line.name.trim())
  if (named.length === 0) return "先写上食材名，或加上一条。"
  if (
    named.some((line) => {
      const quantity = Number(line.quantity)
      return !Number.isFinite(quantity) || quantity <= 0
    })
  ) {
    return "数量要是大于 0 的数字。"
  }
  return null
}

export function inventoryEntryUnits(unit: string): string[] {
  return [unit, ...MARKET_UNITS, ...EXTRA_UNITS].filter(
    (value, index, all): value is string =>
      Boolean(value) && all.indexOf(value) === index
  )
}

export function inventoryEntrySourceLabel(
  source: InventoryEntrySource
): string {
  if (source === "ai") return "AI 识别的，可以改。确认后才写入。"
  if (source === "rule") return "按规则拆开的，可以改。确认后才写入。"
  return "直接加的。缺的可以再加一行，确认后才写入。"
}

export function inventoryEntryMergeNote(
  line: Pick<InventoryEntryLine, "name" | "unit">,
  ingredients: Ingredient[],
  inventory: InventoryItem[]
): string | null {
  const snapshots = ingredients.map(toIngredientSnapshot)
  const found =
    findExactIngredient(line.name, snapshots) ??
    findSynonymIngredient(line.name, snapshots)
  if (!found) return null
  const existing = findSameUnitStock(inventory, found.id, line.unit)
  if (!existing) return null
  const name = ingredients.find((row) => row.id === found.id)?.name ?? line.name
  return `已有 ${name} ${existing.quantity} ${existing.unit}，确认后会加在一起`
}

export function readInventoryAddedNotice(
  storage: Pick<Storage, "getItem" | "removeItem"> | null
): string {
  if (!storage) return ""
  const value = storage.getItem(INVENTORY_ADDED_NOTICE_KEY)?.trim() ?? ""
  if (value) storage.removeItem(INVENTORY_ADDED_NOTICE_KEY)
  return value
}

export function writeInventoryAddedNotice(
  storage: Pick<Storage, "setItem"> | null,
  message: string
): void {
  const text = message.trim()
  if (!text) return
  storage?.setItem(INVENTORY_ADDED_NOTICE_KEY, text)
}

export function inventoryAddedNoticeStorage(): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> | null {
  try {
    if (typeof sessionStorage === "undefined") return null
    return sessionStorage
  } catch {
    return null
  }
}
