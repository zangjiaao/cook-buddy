import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import {
  catalogById,
  catalogForIngredient,
  conversionFactors,
  matchCatalog,
  sameStockPool,
  stockPoolId,
  withIngredientFactors,
  type CatalogEntry,
  type FactorSource,
} from "@/lib/ingredient-catalog"
import type { Ingredient, InventoryItem, Recipe, RecipeItem } from "@/lib/types"
import {
  convertUnits,
  isApproximateUnit,
  isFuzzyUnit,
  roundQty,
} from "@/lib/unit-convert"

const GENERIC_NAMES = new Set(["鸡", "肉", "鱼", "虾", "菜"])

export type AlignInputLine = {
  key?: string
  rawName: string
  quantity: number
  unit: string
  catalogId?: string | null
  ingredientId?: string | null
}

export type AlignConfidence = "high" | "low"

export type AlignResultLine = {
  key: string
  recipeItemId?: string
  rawName: string
  sourceText: string
  sourceQuantity: number
  sourceUnit: string
  ingredientId: string | null
  catalogId: string | null
  name: string
  quantity: number
  unit: string
  approximate: boolean
  confidence: AlignConfidence
  needsAi: boolean
}

export type AlignRecipeInput = {
  sourceText?: string
  lines: AlignInputLine[]
  ingredients: Ingredient[]
  inventory: InventoryItem[]
}

function sourceLabel(rawName: string, quantity: number, unit: string): string {
  const text = unit.trim()
  if (text.startsWith("半") && (quantity === 0 || quantity === 1)) {
    return `${rawName} ${text}`.trim()
  }
  return `${rawName} ${quantity}${text}`.trim()
}

export function normalizeCookAmount(
  quantity: number,
  unit: string
): { quantity: number; unit: string } {
  const text = unit.trim()
  if (text === "半") {
    return { quantity: roundQty(0.5 * (quantity || 1)), unit: "" }
  }
  if (text.startsWith("半") && text.length > 1) {
    return {
      quantity: roundQty(0.5 * (quantity || 1)),
      unit: text.slice(1),
    }
  }
  return { quantity, unit: text }
}

function nameHit(ingredient: Ingredient, rawName: string): boolean {
  const key = normalizeIngredientName(rawName)
  if (!key) return false
  if (normalizeIngredientName(ingredient.name) === key) return true
  const rawCatalog = matchCatalog(rawName)
  const own = catalogForIngredient(ingredient)
  if (rawCatalog && own && rawCatalog.id !== own.id) return false
  return ingredient.aliases.some(
    (label) => normalizeIngredientName(label) === key
  )
}

function hasStock(ingredientId: string, inventory: InventoryItem[]): boolean {
  return inventory.some(
    (row) => row.ingredientId === ingredientId && row.quantity > 0
  )
}

export function accountUnitFor(
  ingredient: Ingredient | null,
  catalog: CatalogEntry | null,
  inventory: InventoryItem[]
): string {
  const positive = ingredient
    ? inventory.filter(
        (row) => row.ingredientId === ingredient.id && row.quantity > 0
      )
    : []
  const units = [...new Set(positive.map((row) => row.unit))]
  if (units.length === 1 && units[0]) return units[0]
  if (ingredient?.defaultUnit && units.includes(ingredient.defaultUnit)) {
    return ingredient.defaultUnit
  }
  if (catalog) return catalog.accountUnit
  return ingredient?.defaultUnit || units[0] || ""
}

function factorSource(
  ingredient: Ingredient | null,
  catalog: CatalogEntry | null
): FactorSource | null {
  if (catalog) return withIngredientFactors(catalog, ingredient)
  if (!ingredient) return null
  return {
    accountUnit: ingredient.defaultUnit,
    conversions: ingredient.conversions ?? {},
    approximateUnits: ingredient.approximateUnits,
  }
}

function pickIngredient(
  rawName: string,
  catalog: CatalogEntry | null,
  preferredId: string | null | undefined,
  ingredients: Ingredient[],
  inventory: InventoryItem[]
): Ingredient | null {
  const hits = ingredients.filter((ingredient) => {
    if (nameHit(ingredient, rawName)) return true
    if (catalog && ingredient.catalogId === catalog.id) return true
    if (catalog && catalogForIngredient(ingredient)?.id === catalog.id)
      return true
    return false
  })
  if (hits.length === 0) return null
  const ranked = [...hits].sort((left, right) => {
    const stock =
      Number(hasStock(right.id, inventory)) -
      Number(hasStock(left.id, inventory))
    if (stock !== 0) return stock
    const exact =
      Number(nameHit(right, rawName)) - Number(nameHit(left, rawName))
    if (exact !== 0) return exact
    if (preferredId) {
      if (left.id === preferredId) return -1
      if (right.id === preferredId) return 1
    }
    return left.id < right.id ? -1 : 1
  })
  return ranked[0] ?? null
}

export function alignRecipeLines(input: AlignRecipeInput): AlignResultLine[] {
  return input.lines.map((line, index) => {
    const rawName = line.rawName.trim()
    const originalUnit = line.unit.trim()
    const normalized = normalizeCookAmount(line.quantity, originalUnit)
    const generic = GENERIC_NAMES.has(normalizeIngredientName(rawName))
    const catalog =
      (line.catalogId ? catalogById(line.catalogId) : null) ??
      matchCatalog(rawName)
    const ingredient = pickIngredient(
      rawName,
      catalog,
      line.ingredientId,
      input.ingredients,
      input.inventory
    )
    const resolvedCatalog =
      catalog ?? (ingredient ? catalogForIngredient(ingredient) : null)
    const mode = resolvedCatalog?.quantityMode ?? ingredient?.quantityMode
    const base = {
      key: line.key || `align-${index}`,
      rawName,
      sourceText: sourceLabel(rawName, line.quantity, originalUnit),
      sourceQuantity: normalized.quantity,
      sourceUnit: normalized.unit,
      ingredientId: ingredient?.id ?? null,
      catalogId: resolvedCatalog?.id ?? null,
      name: ingredient?.name || resolvedCatalog?.name || rawName,
    }
    if (!rawName) {
      return {
        ...base,
        quantity: normalized.quantity,
        unit: normalized.unit,
        approximate: false,
        confidence: "low",
        needsAi: false,
      }
    }
    if (mode === "presence" || mode === "ignore" || isFuzzyUnit(originalUnit)) {
      return {
        ...base,
        quantity: line.quantity,
        unit: originalUnit,
        sourceQuantity: line.quantity,
        sourceUnit: originalUnit,
        approximate: false,
        confidence: ingredient || resolvedCatalog ? "high" : "low",
        needsAi: false,
      }
    }
    const target = accountUnitFor(ingredient, resolvedCatalog, input.inventory)
    const source = factorSource(ingredient, resolvedCatalog)
    const converted =
      source && target
        ? convertUnits(source, normalized.quantity, normalized.unit, target)
        : null
    const matched = Boolean(ingredient || resolvedCatalog)
    const ok = Boolean(converted?.ok)
    const approximate = Boolean(converted?.approximate)
    const needsAi = !ok && !isFuzzyUnit(normalized.unit)
    const specific =
      !generic &&
      ((ingredient && nameHit(ingredient, rawName)) ||
        Boolean(
          resolvedCatalog && matchCatalog(rawName)?.id === resolvedCatalog.id
        ))
    const confidence: AlignConfidence =
      needsAi || !matched || generic || approximate || !specific
        ? "low"
        : "high"
    return {
      ...base,
      quantity: ok && converted ? converted.quantity : normalized.quantity,
      unit: ok && converted ? converted.unit : normalized.unit || originalUnit,
      approximate,
      confidence,
      needsAi,
    }
  })
}

export function alignLineLabel(line: AlignResultLine): string {
  const approx = line.approximate ? "（约）" : ""
  return `${line.name} · ${line.quantity} ${line.unit}${approx}`.trim()
}

export function editAlignQuantity(
  lines: AlignResultLine[],
  key: string,
  quantity: number
): AlignResultLine[] {
  return lines.map((line) => {
    if (line.key !== key || !Number.isFinite(quantity)) return line
    const next = Math.max(0, roundQty(quantity))
    return {
      ...line,
      quantity: next,
      approximate: line.approximate || next !== line.quantity,
    }
  })
}

export function withLearnedConversion(
  ingredient: Ingredient,
  sourceUnit: string,
  factor: number
): Ingredient {
  const unit = sourceUnit.trim()
  if (!unit || !Number.isFinite(factor) || factor <= 0) return ingredient
  const approximateUnits = [...(ingredient.approximateUnits ?? [])]
  if (!approximateUnits.includes(unit)) approximateUnits.push(unit)
  return {
    ...ingredient,
    conversions: { ...(ingredient.conversions ?? {}), [unit]: factor },
    approximateUnits,
  }
}

export function learnedFactor(
  accountQuantity: number,
  sourceQuantity: number
): number | null {
  if (!(sourceQuantity > 0) || !(accountQuantity > 0)) return null
  const factor = accountQuantity / sourceQuantity
  if (!Number.isFinite(factor) || factor <= 0) return null
  return factor
}

export function ingredientUpdatesFromAlign(
  lines: AlignResultLine[],
  ingredients: Ingredient[]
): Ingredient[] {
  const byId = new Map(
    ingredients.map((ingredient) => [ingredient.id, ingredient])
  )
  const changed: Ingredient[] = []
  for (const line of lines) {
    if (!line.ingredientId || !line.approximate) continue
    if (!line.sourceUnit || line.sourceUnit === line.unit) continue
    const factor = learnedFactor(line.quantity, line.sourceQuantity)
    if (factor == null) continue
    const current = byId.get(line.ingredientId)
    if (!current) continue
    const catalog = catalogForIngredient(current)
    const catalogFactor = catalog
      ? conversionFactors(catalog)[line.sourceUnit]
      : undefined
    if (
      catalogFactor != null &&
      Math.abs(catalogFactor - factor) < 1e-9 &&
      current.conversions?.[line.sourceUnit] == null
    ) {
      continue
    }
    if (current.conversions?.[line.sourceUnit] === factor) continue
    const next = withLearnedConversion(current, line.sourceUnit, factor)
    byId.set(current.id, next)
    changed.push(next)
  }
  return changed
}

export function alignItemWrites(
  lines: AlignResultLine[],
  byRawName: Map<string, Ingredient>
): Array<{
  ingredientId: string | null
  rawName: string
  quantity: number
  unit: string
  matchStatus: "linked" | "unlinked"
  sourceQuantity: number
  sourceUnit: string
  approximate?: true
  catalogId?: string
  unitUnconverted?: true
}> {
  return lines.map((line) => {
    const resolved =
      byRawName.get(normalizeIngredientName(line.rawName)) ??
      byRawName.get(normalizeIngredientName(line.name))
    const ingredientId = line.ingredientId ?? resolved?.id ?? null
    const catalogId = line.catalogId ?? resolved?.catalogId
    return {
      ingredientId,
      rawName: line.rawName,
      quantity: line.quantity,
      unit: line.unit || "个",
      matchStatus: ingredientId ? "linked" : "unlinked",
      sourceQuantity: line.sourceQuantity,
      sourceUnit: line.sourceUnit,
      ...(line.approximate ? { approximate: true as const } : {}),
      ...(catalogId ? { catalogId } : {}),
      ...(line.needsAi ? { unitUnconverted: true as const } : {}),
    }
  })
}

export function recipeItemsFromAlign(
  lines: AlignResultLine[],
  recipeId: string
): RecipeItem[] {
  return lines.map((line) => ({
    id: line.recipeItemId || line.key,
    recipeId,
    ingredientId: line.ingredientId,
    rawName: line.rawName,
    quantity: line.quantity,
    unit: line.unit,
    matchStatus: line.ingredientId ? "linked" : "unlinked",
    sourceQuantity: line.sourceQuantity,
    sourceUnit: line.sourceUnit,
    ...(line.approximate ? { approximate: true } : {}),
    ...(line.catalogId ? { catalogId: line.catalogId } : {}),
    ...(line.needsAi ? { unitUnconverted: true } : {}),
  }))
}

export type AlignSuggestion = {
  recipeId: string
  recipeName: string
  sourceText: string
  lines: AlignResultLine[]
}

export function suggestRecipeAlignments(input: {
  recipes: Array<Pick<Recipe, "id" | "name" | "sourceText">>
  items: RecipeItem[]
  ingredients: Ingredient[]
  inventory: InventoryItem[]
}): AlignSuggestion[] {
  const suggestions: AlignSuggestion[] = []
  for (const recipe of input.recipes) {
    const items = input.items.filter((item) => item.recipeId === recipe.id)
    if (items.length === 0) continue
    const aligned = alignRecipeLines({
      sourceText: recipe.sourceText,
      lines: items.map((item) => ({
        key: item.id,
        rawName: item.rawName,
        quantity: item.sourceQuantity ?? item.quantity,
        unit: item.sourceUnit ?? item.unit,
        catalogId: item.catalogId,
        ingredientId: item.ingredientId,
      })),
      ingredients: input.ingredients,
      inventory: input.inventory,
    }).map((line, index) => ({
      ...line,
      recipeItemId: items[index]?.id,
    }))
    const lines = aligned.filter((line, index) => {
      const item = items[index]
      if (!item) return false
      return (
        item.unit !== line.unit ||
        item.quantity !== line.quantity ||
        (item.ingredientId ?? null) !== line.ingredientId ||
        line.confidence === "low"
      )
    })
    if (lines.length === 0) continue
    suggestions.push({
      recipeId: recipe.id,
      recipeName: recipe.name,
      sourceText: recipe.sourceText ?? "",
      lines,
    })
  }
  return suggestions
}

export function poolSubstitutes(
  ingredient: Ingredient,
  quantity: number,
  unit: string,
  ingredients: Ingredient[],
  inventory: InventoryItem[]
): {
  ingredientId: string
  name: string
  quantity: number
  unit: string
  stockQty: number
} | null {
  const catalog = catalogForIngredient(ingredient)
  if (!catalog || !stockPoolId(catalog.id) || quantity <= 0) return null
  const from = withIngredientFactors(catalog, ingredient)
  let best: {
    ingredientId: string
    name: string
    quantity: number
    unit: string
    stockQty: number
  } | null = null
  for (const other of ingredients) {
    if (other.id === ingredient.id) continue
    if (!sameStockPool(catalog.id, other.catalogId)) continue
    const otherCatalog = catalogById(other.catalogId)
    if (!otherCatalog) continue
    const lots = inventory.filter(
      (row) => row.ingredientId === other.id && row.quantity > 0
    )
    if (lots.length === 0) continue
    const otherSource = withIngredientFactors(otherCatalog, other)
    const bridged = convertUnits(from, quantity, unit, from.accountUnit)
    if (!bridged.ok) continue
    const across =
      from.accountUnit === otherSource.accountUnit
        ? bridged
        : convertAcrossAccount(from, bridged.quantity, otherSource)
    if (!across) continue
    let stockQty = 0
    for (const lot of lots) {
      const converted = convertUnits(
        otherSource,
        lot.quantity,
        lot.unit,
        otherSource.accountUnit
      )
      if (converted.ok) stockQty = roundQty(stockQty + converted.quantity)
    }
    if (stockQty <= 0) continue
    if (!best || stockQty > best.stockQty) {
      best = {
        ingredientId: other.id,
        name: other.name,
        quantity: across.quantity,
        unit: across.unit,
        stockQty,
      }
    }
  }
  return best
}

function convertAcrossAccount(
  from: FactorSource,
  accountQuantity: number,
  to: FactorSource
): { quantity: number; unit: string } | null {
  const perGram = gramsPerAccount(from)
  const toPerGram = gramsPerAccount(to)
  if (perGram == null || toPerGram == null || toPerGram === 0) return null
  return {
    quantity: roundQty((accountQuantity * perGram) / toPerGram),
    unit: to.accountUnit,
  }
}

function gramsPerAccount(source: FactorSource): number | null {
  if (source.accountUnit === "g" || source.accountUnit === "克") return 1
  const perGram = conversionFactors(source).g ?? conversionFactors(source)["克"]
  if (perGram == null || perGram === 0) return null
  if (!isApproximateUnit(source, "g") && !isApproximateUnit(source, "克")) {
    return 1 / perGram
  }
  return 1 / perGram
}

export function isGenericIngredientName(rawName: string): boolean {
  return GENERIC_NAMES.has(normalizeIngredientName(rawName))
}
