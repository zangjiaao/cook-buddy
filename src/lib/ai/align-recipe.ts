import { catalogForIngredient, matchCatalog } from "@/lib/ingredient-catalog"
import { INGREDIENT_CATALOG } from "@/data/ingredient-catalog.generated"
import {
  accountUnitFor,
  type AlignInputLine,
  type AlignRecipeInput,
  type AlignResultLine,
} from "@/lib/recipe-align"
import type { Category, Ingredient, InventoryItem } from "@/lib/types"
import { roundQty } from "@/lib/unit-convert"

export type AlignStockRow = {
  id: string
  name: string
  aliases: string[]
  catalogId?: string
  defaultUnit: string
  inStock: boolean
  conversions?: Record<string, number>
  approximateUnits?: string[]
  category: Category
}

export type AlignRecipePayload = {
  sourceText?: string
  lines: AlignInputLine[]
  stock: AlignStockRow[]
}

export function alignPayload(input: AlignRecipeInput): AlignRecipePayload {
  return {
    ...(input.sourceText ? { sourceText: input.sourceText } : {}),
    lines: input.lines.map((line) => ({
      key: line.key,
      rawName: line.rawName,
      quantity: line.quantity,
      unit: line.unit,
      ...(line.catalogId ? { catalogId: line.catalogId } : {}),
    })),
    stock: input.ingredients.map((ingredient) => {
      const catalogId = ingredient.catalogId
      return {
        id: ingredient.id,
        name: ingredient.name,
        aliases: ingredient.aliases.slice(0, 8),
        ...(catalogId ? { catalogId } : {}),
        defaultUnit: accountUnitFor(
          ingredient,
          catalogForIngredient(ingredient),
          input.inventory
        ),
        inStock: input.inventory.some(
          (row) => row.ingredientId === ingredient.id && row.quantity > 0
        ),
        ...(ingredient.conversions
          ? { conversions: ingredient.conversions }
          : {}),
        ...(ingredient.approximateUnits
          ? { approximateUnits: ingredient.approximateUnits }
          : {}),
        category: ingredient.category,
      }
    }),
  }
}

export function alignInputFromPayload(
  payload: AlignRecipePayload
): AlignRecipeInput {
  const ingredients: Ingredient[] = payload.stock.map((row) => ({
    id: row.id,
    name: row.name,
    aliases: row.aliases,
    category: row.category,
    defaultUnit: row.defaultUnit,
    stallHint: null,
    defaultShelfLifeDays: null,
    ...(row.catalogId ? { catalogId: row.catalogId } : {}),
    ...(row.conversions ? { conversions: row.conversions } : {}),
    ...(row.approximateUnits ? { approximateUnits: row.approximateUnits } : {}),
  }))
  const inventory: InventoryItem[] = payload.stock
    .filter((row) => row.inStock)
    .map((row) => ({
      id: `lot-${row.id}`,
      ingredientId: row.id,
      quantity: 1,
      unit: row.defaultUnit,
      location: "fridge",
      purchasedAt: "2026-01-01",
      expiresAt: null,
      notes: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }))
  return {
    sourceText: payload.sourceText,
    lines: payload.lines,
    ingredients,
    inventory,
  }
}

export const ALIGN_SYSTEM_PROMPT = `你是家常菜用量对齐助手。把菜谱每一行对到用户家里已有的食材，或基准库条目。只输出 JSON，不要解释。

JSON 形状：
{"lines":[{"rawName":"土鸡","ingredientName":"大公鸡","catalogId":"cat-hen","quantity":0.5,"unit":"只","approximate":false,"confidence":"high"}]}

规则：
- 优先对到 inventory 里 inStock 为 true 的食材，unit 用那条食材的 defaultUnit。
- 家里没有时，用 catalog 里的 name 和 accountUnit，ingredientName 用基准库名称。
- quantity 换成记账单位后的数字。半只=0.5。重量换成只、头、瓣这类单位时 approximate 为 true。
- 整鸡和鸡块可以互相换算（1 只鸡约 1500 克）。鸡腿、鸡翅、鸡胸不要当成整鸡。
- 对不上就不要编造 catalogId。confidence 只能是 high 或 low。
- 只返回用户给出的 rawName，不要新增行。`

export function alignUserPrompt(payload: AlignRecipePayload): string {
  const pendingNames = new Set(payload.lines.map((line) => line.rawName.trim()))
  const catalogIds = new Set<string>()
  for (const line of payload.lines) {
    const hit =
      (line.catalogId
        ? INGREDIENT_CATALOG.find((entry) => entry.id === line.catalogId)
        : null) ??
      INGREDIENT_CATALOG.find((entry) =>
        [entry.name, ...entry.aliases].some(
          (label) => label === line.rawName.trim()
        )
      )
    if (!hit) continue
    catalogIds.add(hit.id)
    for (const entry of INGREDIENT_CATALOG) {
      if (entry.family && entry.family === hit.family) catalogIds.add(entry.id)
    }
  }
  for (const row of payload.stock) {
    if (row.catalogId) catalogIds.add(row.catalogId)
  }
  const catalog = INGREDIENT_CATALOG.filter((entry) => catalogIds.has(entry.id))
    .slice(0, 40)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      aliases: entry.aliases,
      accountUnit: entry.accountUnit,
      family: entry.family,
    }))
  return JSON.stringify({
    sourceText: payload.sourceText ?? "",
    lines: payload.lines.filter((line) =>
      pendingNames.has(line.rawName.trim())
    ),
    inventory: payload.stock.map((row) => ({
      name: row.name,
      unit: row.defaultUnit,
      catalogId: row.catalogId ?? null,
      inStock: row.inStock,
    })),
    catalog,
  })
}

type AiAlignRow = {
  rawName: string
  ingredientName: string
  catalogId: string | null
  quantity: number
  unit: string
  approximate: boolean
  confidence: "high" | "low"
}

function readRows(payload: unknown): AiAlignRow[] {
  const record =
    payload && typeof payload === "object"
      ? (payload as { lines?: unknown }).lines
      : null
  if (!Array.isArray(record)) return []
  const rows: AiAlignRow[] = []
  for (const entry of record) {
    if (!entry || typeof entry !== "object") continue
    const row = entry as Record<string, unknown>
    const rawName = typeof row.rawName === "string" ? row.rawName.trim() : ""
    const ingredientName =
      typeof row.ingredientName === "string" ? row.ingredientName.trim() : ""
    const unit = typeof row.unit === "string" ? row.unit.trim() : ""
    const quantity =
      typeof row.quantity === "number" ? row.quantity : Number.NaN
    if (!rawName || !ingredientName || !unit || !Number.isFinite(quantity))
      continue
    const catalogId = typeof row.catalogId === "string" ? row.catalogId : null
    rows.push({
      rawName,
      ingredientName,
      catalogId,
      quantity: roundQty(Math.max(0, quantity)),
      unit,
      approximate: row.approximate === true,
      confidence: row.confidence === "high" ? "high" : "low",
    })
  }
  return rows
}

export function mergeAiAlignments(
  local: AlignResultLine[],
  aiPayload: unknown,
  input: AlignRecipeInput
): AlignResultLine[] {
  const rows = readRows(aiPayload)
  return local.map((line) => {
    if (!line.needsAi) return line
    const row = rows.find((item) => item.rawName === line.rawName)
    if (!row) return line
    const stock = input.ingredients.find(
      (ingredient) => ingredient.name === row.ingredientName
    )
    const catalog = row.catalogId
      ? (INGREDIENT_CATALOG.find((entry) => entry.id === row.catalogId) ?? null)
      : matchCatalog(row.ingredientName)
    const allowedCatalog = Boolean(
      catalog &&
      (stock?.catalogId === catalog.id ||
        matchCatalog(line.rawName)?.id === catalog.id ||
        catalog.name === row.ingredientName)
    )
    if (!stock && !allowedCatalog) return line
    const unit = stock
      ? accountUnitFor(stock, catalog, input.inventory)
      : catalog?.accountUnit
    if (!unit || row.unit !== unit) return line
    return {
      ...line,
      ingredientId: stock?.id ?? null,
      catalogId: stock?.catalogId ?? catalog?.id ?? line.catalogId,
      name: stock?.name || catalog?.name || row.ingredientName,
      quantity: row.quantity,
      unit,
      approximate: row.approximate || row.unit !== line.sourceUnit,
      confidence: row.confidence,
      needsAi: false,
    }
  })
}

export function parseAlignModelJson(content: string): unknown {
  const start = content.indexOf("{")
  const end = content.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(content.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
}
