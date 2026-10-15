import { readCategoryValue } from "@/lib/ai/classify-ingredients"
import { extractJsonObject } from "@/lib/ai/parse-recipe"
import {
  classifyByRules,
  guessCategory,
  placementForName,
} from "@/lib/ingredient-category"
import { guessDefaultUnit } from "@/lib/ai/resolve-ingredients"
import type { Category, Location } from "@/lib/types"

export type InventoryUtteranceItem = {
  name: string
  quantity: number
  unit: string
  category: Category
  defaultShelfLifeDays: number
  defaultLocation: Location
}

export type InventoryUtteranceDraft = {
  items: InventoryUtteranceItem[]
  source: "ai" | "rule"
}

const UNITS = [
  "公斤",
  "千克",
  "毫升",
  "斤",
  "克",
  "两",
  "袋",
  "瓶",
  "盒",
  "罐",
  "桶",
  "把",
  "个",
  "只",
  "头",
  "瓣",
  "块",
  "包",
  "提",
  "条",
  "根",
  "颗",
  "片",
  "勺",
  "升",
] as const

const CN_DIGIT: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function parseChineseNumber(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text)
  if (text === "半") return 0.5
  let total = 0
  let current = 0
  for (const char of text) {
    if (char === "十") {
      total += (current || 1) * 10
      current = 0
      continue
    }
    if (char === "百") {
      total += (current || 1) * 100
      current = 0
      continue
    }
    if (!Object.hasOwn(CN_DIGIT, char)) return null
    current = CN_DIGIT[char]
  }
  const value = total + current
  return value > 0 ? value : null
}

function normalizeChunk(raw: string): string {
  return raw
    .trim()
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xff10 + 0x30)
    )
    .replace(/\s+/g, "")
}

export function splitUtterance(text: string): string[] {
  return text
    .split(/[、,，;；\n]+/g)
    .flatMap((piece) =>
      piece.split(/和(?=(?:[零〇一二两三四五六七八九十半]|\d))/)
    )
    .map((piece) => piece.trim())
    .filter(Boolean)
}

function matchUnitPrefix(text: string): string | null {
  return UNITS.find((unit) => text.startsWith(unit)) ?? null
}

function matchUnitSuffix(text: string): string | null {
  return UNITS.find((unit) => text.endsWith(unit)) ?? null
}

function finishItem(
  name: string,
  quantity: number,
  unit: string | null
): InventoryUtteranceItem | null {
  const cleaned = name.replace(/^[的了]/, "").trim()
  if (!cleaned || !Number.isFinite(quantity) || quantity <= 0) return null
  const category = guessCategory(cleaned)
  const placement = placementForName(cleaned, category)
  const resolvedUnit =
    unit ||
    guessDefaultUnit(cleaned, category) ||
    (category === "other" ? "个" : "把")
  return {
    name: cleaned,
    quantity,
    unit: resolvedUnit,
    category,
    defaultShelfLifeDays: placement.shelfLifeDays,
    defaultLocation: placement.location,
  }
}

function parseLeading(text: string): InventoryUtteranceItem | null {
  const arabic = text.match(/^(\d+(?:\.\d+)?)(.*)$/)
  if (arabic) {
    const unit = matchUnitPrefix(arabic[2])
    if (!unit) return null
    let rest = arabic[2].slice(unit.length)
    let quantity = Number(arabic[1])
    if (rest.startsWith("半")) {
      quantity += 0.5
      rest = rest.slice(1)
    }
    return finishItem(rest, quantity, unit)
  }

  const max = Math.min(text.length, 8)
  for (let length = max; length >= 1; length -= 1) {
    const value = parseChineseNumber(text.slice(0, length))
    if (value == null) continue
    const restStart = text.slice(length)
    const unit = matchUnitPrefix(restStart)
    if (!unit) continue
    let rest = restStart.slice(unit.length)
    let quantity = value
    if (rest.startsWith("半")) {
      quantity += 0.5
      rest = rest.slice(1)
    }
    const item = finishItem(rest, quantity, unit)
    if (item) return item
  }
  return null
}

function parseTrailing(text: string): InventoryUtteranceItem | null {
  const unit = matchUnitSuffix(text)
  if (!unit) return null
  const body = text.slice(0, -unit.length)
  const arabic = body.match(/^(.*?)(\d+(?:\.\d+)?)$/)
  if (arabic?.[1]) {
    return finishItem(arabic[1], Number(arabic[2]), unit)
  }
  const max = Math.min(body.length, 8)
  for (let length = max; length >= 1; length -= 1) {
    const value = parseChineseNumber(body.slice(body.length - length))
    if (value == null) continue
    const name = body.slice(0, body.length - length)
    const item = finishItem(name, value, unit)
    if (item) return item
  }
  return null
}

export function parseUtteranceChunk(
  raw: string
): InventoryUtteranceItem | null {
  const text = normalizeChunk(raw)
  if (!text) return null
  return parseLeading(text) ?? parseTrailing(text) ?? finishItem(text, 1, null)
}

export function parseInventoryUtteranceByRules(
  text: string
): InventoryUtteranceDraft {
  const items = splitUtterance(text)
    .map(parseUtteranceChunk)
    .filter((item): item is InventoryUtteranceItem => item != null)
  return { items, source: "rule" }
}

function readQuantity(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value === "string") return parseChineseNumber(value)
  return null
}

export function normalizeUtteranceItem(
  raw: unknown
): InventoryUtteranceItem | null {
  const record = asRecord(raw)
  if (!record) return null
  const name = String(record.name ?? record.rawName ?? "")
    .replace(/\s+/g, "")
    .trim()
  if (!name) return null
  const quantity = readQuantity(record.quantity) ?? 1
  const unitText = String(record.unit ?? "").trim()
  const ruled = classifyByRules(name)
  const category = ruled ?? readCategoryValue(record.category) ?? "other"
  const placement = placementForName(name, category)
  const unit = unitText || guessDefaultUnit(name, category)
  return {
    name,
    quantity,
    unit,
    category,
    defaultShelfLifeDays: placement.shelfLifeDays,
    defaultLocation: placement.location,
  }
}

export function tryParseInventoryUtteranceJson(
  text: string
): InventoryUtteranceDraft | null {
  try {
    const parsed = extractJsonObject(text)
    const record = asRecord(parsed)
    const list = Array.isArray(record?.items)
      ? record.items
      : Array.isArray(parsed)
        ? parsed
        : null
    if (!list) return null
    const items = list
      .map(normalizeUtteranceItem)
      .filter((item): item is InventoryUtteranceItem => item != null)
    if (items.length === 0) return null
    return { items, source: "ai" }
  } catch {
    return null
  }
}

export function applyRuleCategories(
  draft: InventoryUtteranceDraft
): InventoryUtteranceDraft {
  return {
    ...draft,
    items: draft.items.map((item) => {
      const ruled = classifyByRules(item.name)
      if (!ruled || ruled === item.category) return item
      const placement = placementForName(item.name, ruled)
      return {
        ...item,
        category: ruled,
        defaultShelfLifeDays: placement.shelfLifeDays,
        defaultLocation: placement.location,
      }
    }),
  }
}
