import { ingredientKind } from "@/lib/ingredient-kind"
import {
  catalogById,
  withIngredientFactors,
  type CatalogEntry,
  type FactorSource,
} from "@/lib/ingredient-catalog"
import {
  learnedFactor,
  poolSubstitutes,
  withLearnedConversion,
} from "@/lib/recipe-align"
import type {
  Ingredient,
  InventoryItem,
  QuantityMode,
  RecipeItem,
} from "@/lib/types"
import { convertToAccount, isFuzzyUnit, roundQty } from "@/lib/unit-convert"

export type CookDeductLine = {
  key: string
  ingredientId: string
  name: string
  quantityMode: QuantityMode
  usingSubstitute: boolean
  note: string
  quantity: number
  unit: string
  converted: boolean
  stockQty: number
  skip: boolean
  runningLow: boolean
  /** 做完时家里没有，但同一份库存里还有别的，例如整鸡没有、鸡块还有。 */
  poolSubstitute?: {
    ingredientId: string
    name: string
    quantity: number
    unit: string
    stockQty: number
  } | null
  sourceQuantity?: number
  sourceUnit?: string
  quantityEdited?: boolean
}

export type CookDeductEdit = {
  key: string
  skip?: boolean
  quantity?: number
  runningLow?: boolean
  useSubstitute?: boolean
}

export type PlannedDeduction = {
  inventoryItemId: string
  previousQuantity: number
  nextQuantity: number
  previousUnit?: string
  nextUnit?: string
}

function targetOf(item: RecipeItem): {
  ingredientId: string | null
  usingSubstitute: boolean
} {
  if (
    item.substitution?.choice === "use" &&
    item.substitution.substituteIngredientId
  ) {
    return {
      ingredientId: item.substitution.substituteIngredientId,
      usingSubstitute: true,
    }
  }
  return { ingredientId: item.ingredientId, usingSubstitute: false }
}

function modeFor(
  ingredient: Ingredient | undefined,
  entry: CatalogEntry | null
): QuantityMode {
  if (entry) return entry.quantityMode
  if (!ingredient || ingredient.buyable === false) return "ignore"
  if (ingredientKind(ingredient) === "staple") return "presence"
  return "amount"
}

function sortLots(lots: InventoryItem[]): InventoryItem[] {
  return [...lots].sort((left, right) => {
    const leftExpires = left.expiresAt ?? "9999-99-99"
    const rightExpires = right.expiresAt ?? "9999-99-99"
    if (leftExpires !== rightExpires) return leftExpires < rightExpires ? -1 : 1
    return left.createdAt < right.createdAt ? -1 : 1
  })
}

function stockInUnit(
  lots: InventoryItem[],
  entry: FactorSource | null,
  unit: string
): { quantity: number; unconverted: string[] } {
  let quantity = 0
  const unconverted: string[] = []
  for (const lot of lots) {
    if (lot.quantity <= 0) continue
    if (entry) {
      const converted = convertToAccount(entry, lot.quantity, lot.unit)
      if (!converted.ok || converted.unit !== unit) {
        unconverted.push(`${lot.quantity}${lot.unit}`)
        continue
      }
      quantity = roundQty(quantity + converted.quantity)
      continue
    }
    if (lot.unit !== unit) {
      unconverted.push(`${lot.quantity}${lot.unit}`)
      continue
    }
    quantity = roundQty(quantity + lot.quantity)
  }
  return { quantity, unconverted }
}

export function planCookDeduction(input: {
  items: RecipeItem[]
  ingredients: Ingredient[]
  inventory: InventoryItem[]
  factor: number
}): CookDeductLine[] {
  const ingredientById = new Map(
    input.ingredients.map((ingredient) => [ingredient.id, ingredient])
  )
  const grouped = new Map<
    string,
    {
      ingredientId: string
      usingSubstitute: boolean
      sourceName: string
      parts: Array<{
        quantity: number
        unit: string
        fuzzy: boolean
        sourceQuantity: number
        sourceUnit: string
      }>
    }
  >()

  for (const item of input.items) {
    const target = targetOf(item)
    if (!target.ingredientId) continue
    const fuzzy = isFuzzyUnit(item.unit)
    const quantity = fuzzy
      ? item.quantity
      : roundQty(item.quantity * input.factor)
    if (!fuzzy && (!Number.isFinite(quantity) || quantity <= 0)) continue
    const source = ingredientById.get(item.ingredientId ?? "")
    const key = `${target.ingredientId}:${target.usingSubstitute ? "sub" : "own"}`
    const existing = grouped.get(key)
    const part = {
      quantity,
      unit: item.unit,
      fuzzy,
      sourceQuantity: roundQty(
        (item.sourceQuantity ?? item.quantity) * (fuzzy ? 1 : input.factor)
      ),
      sourceUnit: item.sourceUnit || item.unit,
    }
    if (existing) {
      existing.parts.push(part)
      continue
    }
    grouped.set(key, {
      ingredientId: target.ingredientId,
      usingSubstitute: target.usingSubstitute,
      sourceName: source?.name || item.rawName,
      parts: [part],
    })
  }

  const lines: CookDeductLine[] = []
  for (const [key, group] of grouped) {
    const ingredient = ingredientById.get(group.ingredientId)
    const entry = catalogById(ingredient?.catalogId)
    const factors =
      entry && ingredient ? withIngredientFactors(entry, ingredient) : entry
    const quantityMode = modeFor(ingredient, entry)
    if (quantityMode === "ignore") continue
    const name = ingredient?.name || group.sourceName
    const displayName = group.usingSubstitute
      ? `${name}（替代 ${group.sourceName}）`
      : name
    const lots = input.inventory.filter(
      (row) => row.ingredientId === group.ingredientId
    )

    if (quantityMode === "presence") {
      lines.push({
        key,
        ingredientId: group.ingredientId,
        name: displayName,
        quantityMode,
        usingSubstitute: group.usingSubstitute,
        note: "常备，不扣数量",
        quantity: 0,
        unit:
          entry?.purchaseUnit ||
          ingredient?.purchaseUnit ||
          ingredient?.defaultUnit ||
          "",
        converted: true,
        stockQty: lots.reduce((sum, row) => sum + Math.max(0, row.quantity), 0),
        skip: false,
        runningLow: false,
      })
      continue
    }

    let quantity = 0
    let unit = entry?.accountUnit || group.parts[0]?.unit || ""
    let converted = Boolean(entry)
    const unconvertedParts: string[] = []
    for (const part of group.parts) {
      if (part.fuzzy) {
        unconvertedParts.push(part.unit)
        continue
      }
      if (!entry) {
        if (part.unit === unit) quantity = roundQty(quantity + part.quantity)
        else unconvertedParts.push(`${part.quantity}${part.unit}`)
        converted = false
        continue
      }
      const next = convertToAccount(factors ?? entry, part.quantity, part.unit)
      if (!next.ok) {
        converted = false
        unconvertedParts.push(`${part.quantity}${part.unit}`)
        continue
      }
      quantity = roundQty(quantity + next.quantity)
      unit = next.unit
    }
    if (!entry) {
      const same = group.parts.find((part) => !part.fuzzy)
      unit = same?.unit ?? unit
      converted = false
    } else if (quantity === 0 && unconvertedParts.length > 0) {
      const raw = group.parts.filter((part) => !part.fuzzy)
      const units = new Set(raw.map((part) => part.unit))
      if (units.size === 1 && raw[0]) {
        quantity = roundQty(raw.reduce((sum, part) => sum + part.quantity, 0))
        unit = raw[0].unit
      }
      unconvertedParts.length = 0
      converted = false
    }
    const stock = stockInUnit(lots, factors, unit)
    const sourceUnits = [
      ...new Set(
        group.parts.filter((part) => !part.fuzzy).map((part) => part.sourceUnit)
      ),
    ]
    const sourceQuantity =
      sourceUnits.length === 1
        ? roundQty(
            group.parts
              .filter((part) => !part.fuzzy)
              .reduce((sum, part) => sum + part.sourceQuantity, 0)
          )
        : undefined
    const poolSubstitute =
      quantityMode === "amount" &&
      stock.quantity <= 0 &&
      ingredient &&
      quantity > 0
        ? poolSubstitutes(
            ingredient,
            quantity,
            unit,
            input.ingredients,
            input.inventory
          )
        : null
    const notes = [
      unconvertedParts.length > 0
        ? `${unconvertedParts.join("、")} 未能换算`
        : "",
      stock.unconverted.length > 0
        ? `家里另有 ${stock.unconverted.join("、")} 未计入`
        : "",
    ].filter(Boolean)
    lines.push({
      key,
      ingredientId: group.ingredientId,
      name: displayName,
      quantityMode,
      usingSubstitute: group.usingSubstitute,
      note: notes.join("；"),
      quantity,
      unit,
      converted: converted && unconvertedParts.length === 0,
      stockQty: stock.quantity,
      skip: false,
      runningLow: false,
      poolSubstitute,
      ...(sourceQuantity != null && sourceUnits[0]
        ? { sourceQuantity, sourceUnit: sourceUnits[0] }
        : {}),
    })
  }

  return lines
}

export function applyCookDeductionEdits(
  lines: CookDeductLine[],
  edits: CookDeductEdit[]
): CookDeductLine[] {
  const byKey = new Map(edits.map((edit) => [edit.key, edit]))
  return lines.map((line) => {
    const edit = byKey.get(line.key)
    if (!edit) return line
    const substitute =
      edit.useSubstitute && line.poolSubstitute ? line.poolSubstitute : null
    const startQuantity = substitute ? substitute.quantity : line.quantity
    const quantity =
      edit.quantity == null || !Number.isFinite(edit.quantity)
        ? startQuantity
        : Math.max(0, roundQty(edit.quantity))
    return {
      ...line,
      skip: edit.skip ?? line.skip,
      runningLow: edit.runningLow ?? line.runningLow,
      quantity,
      quantityEdited: quantity !== startQuantity,
      ...(substitute
        ? {
            ingredientId: substitute.ingredientId,
            name: substitute.name,
            unit: substitute.unit,
            stockQty: substitute.stockQty,
            converted: true,
            usingSubstitute: true,
            poolSubstitute: null,
          }
        : {}),
    }
  })
}

export function compileCookDeduction(input: {
  lines: CookDeductLine[]
  inventory: InventoryItem[]
  ingredients: Ingredient[]
}): { changes: PlannedDeduction[]; runningLowIngredientIds: string[] } {
  const ingredientById = new Map(
    input.ingredients.map((ingredient) => [ingredient.id, ingredient])
  )
  const stock = input.inventory.map((row) => ({ ...row }))
  const changes: PlannedDeduction[] = []
  const runningLowIngredientIds: string[] = []

  for (const line of input.lines) {
    if (line.quantityMode === "presence") {
      if (line.runningLow && !line.skip)
        runningLowIngredientIds.push(line.ingredientId)
      continue
    }
    if (line.skip || line.quantity <= 0) continue
    const ingredient = ingredientById.get(line.ingredientId)
    const catalog = catalogById(ingredient?.catalogId)
    const entry = catalog ? withIngredientFactors(catalog, ingredient) : null
    const lots = sortLots(
      stock.filter(
        (row) => row.ingredientId === line.ingredientId && row.quantity > 0
      )
    )
    let remaining = line.quantity
    for (const lot of lots) {
      if (remaining <= 0) break
      const originalQuantity = lot.quantity
      const originalUnit = lot.unit
      let available = lot.quantity
      let unit = lot.unit
      if (entry) {
        const converted = convertToAccount(entry, lot.quantity, lot.unit)
        if (!converted.ok || converted.unit !== line.unit) continue
        available = converted.quantity
        unit = converted.unit
      } else if (lot.unit !== line.unit) {
        continue
      }
      const take = Math.min(available, remaining)
      const nextQuantity = roundQty(available - take)
      remaining = roundQty(remaining - take)
      if (nextQuantity === available && unit === originalUnit) continue
      lot.quantity = nextQuantity
      lot.unit = unit
      changes.push({
        inventoryItemId: lot.id,
        previousQuantity: originalQuantity,
        nextQuantity,
        ...(unit !== originalUnit
          ? { previousUnit: originalUnit, nextUnit: unit }
          : {}),
      })
    }
  }

  return { changes, runningLowIngredientIds }
}

/** 预览里改过的数量，用来修正「1 个来源单位 = 多少记账单位」。 */
export function learnedIngredientsFromCook(
  lines: CookDeductLine[],
  ingredients: Ingredient[]
): Ingredient[] {
  const byId = new Map(
    ingredients.map((ingredient) => [ingredient.id, ingredient])
  )
  const changed: Ingredient[] = []
  for (const line of lines) {
    if (
      !line.quantityEdited ||
      !line.sourceUnit ||
      line.sourceUnit === line.unit
    ) {
      continue
    }
    const factor = learnedFactor(line.quantity, line.sourceQuantity ?? 0)
    if (factor == null) continue
    const ingredient = byId.get(line.ingredientId)
    if (!ingredient) continue
    const next = withLearnedConversion(ingredient, line.sourceUnit, factor)
    if (next === ingredient) continue
    byId.set(ingredient.id, next)
    changed.push(next)
  }
  return changed
}
