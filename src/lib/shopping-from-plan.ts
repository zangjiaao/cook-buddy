// 按计划生成清单：份数缩放后按食材+单位合并，只减同单位库存。
// 已买勾选：同一 ingredientId+单位（未关联则同一名称+单位）仍需要时保留。
import { uncookedPlanEntries } from "@/lib/cook-complete"
import { createId } from "@/lib/id"
import { catalogById } from "@/lib/ingredient-catalog"
import { ingredientKind, ingredientPurchaseUnit } from "@/lib/ingredient-kind"
import {
  isPurchasableLine,
  substituteCandidates,
  substituteOfferText,
} from "@/lib/ingredient-substitution"
import { convertToAccount, purchaseHint } from "@/lib/unit-convert"
import type { CatalogEntry } from "@/lib/ingredient-catalog"
import type {
  Category,
  Ingredient,
  IngredientKind,
  InventoryItem,
  PlanEntry,
  Recipe,
  RecipeItem,
  ShoppingItem,
  ShoppingSource,
  Shortage,
  StallHint,
  SubstituteCandidate,
} from "@/lib/types"

const STALL_ORDER: StallHint[] = ["meat", "veg", "dry", null]
const FUZZY_QUANTITY = /少许|适量|若干/

export type ShortageInput = {
  ingredientId: string | null
  needed: number
  unit: string
  stock: Array<Pick<InventoryItem, "ingredientId" | "unit" | "quantity">>
  kind?: IngredientKind
  purchaseUnit?: string
}

export type ShoppingFromPlanInput = {
  planEntries: PlanEntry[]
  recipes: Recipe[]
  recipeItems: RecipeItem[]
  ingredients: Ingredient[]
  inventory: InventoryItem[]
  existing: ShoppingItem[]
}

type NeedLine = {
  ingredientId: string | null
  name: string
  needed: number
  unit: string
  stallHint: StallHint
  fromPlanEntryIds: string[]
  fuzzy: boolean
  kind?: IngredientKind
  purchaseUnit?: string
  usageUnit: string
  offerCandidates: SubstituteCandidate[] | null
  offerRecipeItemIds: string[]
  unitUnconverted?: boolean
  originals: string[]
  unconvertedStock: string
  catalogTracked?: boolean
  purchaseHint?: string
}

export function roundQty(value: number): number {
  return Number(value.toFixed(2))
}

export function formatQuantityHint(value: number): string {
  return String(roundQty(value))
}

export function isFuzzyQuantity(quantity: number, unit: string): boolean {
  if (FUZZY_QUANTITY.test(unit.trim())) return true
  return !Number.isFinite(quantity)
}

export function stallFromCategory(category: Category): StallHint {
  if (category === "meat" || category === "veg" || category === "dry") {
    return category
  }
  return null
}

export function shoppingMatchKey(item: {
  ingredientId: string | null
  name: string
  unit: string
}): string {
  if (item.ingredientId) return `${item.ingredientId}::${item.unit}`
  return `name:${item.name}::${item.unit}`
}

export function shoppingIngredientKey(item: {
  ingredientId: string | null
  name: string
}): string {
  if (item.ingredientId) return `ing:${item.ingredientId}`
  return `name:${item.name}`
}

export function isProtectedShoppingSource(
  source: ShoppingSource | undefined
): boolean {
  return source === "manual" || source === "running_low"
}

export function normalizeShoppingItem(item: ShoppingItem): ShoppingItem {
  return { ...item, source: item.source ?? "plan" }
}

export function sameUnitStockQty(
  ingredientId: string | null,
  unit: string,
  stock: ShortageInput["stock"]
): number {
  if (!ingredientId) return 0
  return roundQty(
    stock
      .filter((row) => row.ingredientId === ingredientId && row.unit === unit)
      .reduce((sum, row) => sum + row.quantity, 0)
  )
}

export function buyQuantity(needed: number, stockQty: number): number {
  return Math.max(0, roundQty(needed - stockQty))
}

export function hasPositiveStock(
  ingredientId: string | null,
  stock: ShortageInput["stock"],
  unit?: string
): boolean {
  if (!ingredientId) return false
  return stock.some(
    (row) =>
      row.ingredientId === ingredientId &&
      row.quantity > 0 &&
      (unit == null || row.unit === unit)
  )
}

export function isPurchaseUnitOnlyStock(input: ShortageInput): boolean {
  const purchaseUnit = input.purchaseUnit?.trim()
  if (!input.ingredientId || !purchaseUnit || purchaseUnit === input.unit) {
    return false
  }
  const aligned = input.stock.filter(
    (row) => row.ingredientId === input.ingredientId && row.quantity > 0
  )
  if (aligned.length === 0) return false
  const sameUnit = aligned.some((row) => row.unit === input.unit)
  const purchaseStock = aligned.some((row) => row.unit === purchaseUnit)
  return !sameUnit && purchaseStock
}

export function blocksUsageUnitBuy(input: ShortageInput): boolean {
  return input.kind === "staple" || isPurchaseUnitOnlyStock(input)
}

export function decideShortage(input: ShortageInput): Shortage {
  if (!input.ingredientId) return "unsure"

  // 少许/适量，或常备、只按采购单位计的货：不换算。
  // 任意单位数量 > 0 就算够；没有货才进不确定。快没了是另一条清单来源。
  const fuzzy = isFuzzyQuantity(input.needed, input.unit)
  if (fuzzy || blocksUsageUnitBuy(input)) {
    return hasPositiveStock(input.ingredientId, input.stock)
      ? "enough"
      : "unsure"
  }

  const aligned = input.stock.filter(
    (row) => row.ingredientId === input.ingredientId
  )
  const sameUnit = aligned.filter((row) => row.unit === input.unit)
  const sameUnitQty = sameUnit.reduce((sum, row) => sum + row.quantity, 0)
  const hasOtherUnit = aligned.some(
    (row) => row.unit !== input.unit && row.quantity > 0
  )

  if (sameUnit.length === 0 && hasOtherUnit) return "unsure"
  if (roundQty(sameUnitQty) >= roundQty(input.needed)) return "enough"
  return "short"
}

export function shoppingContextHint(input: {
  shortage: Shortage
  needed: number
  stockQty: number
  unit: string
  ingredientId: string | null
  fuzzy: boolean
  otherUnits?: string[]
  staple?: boolean
  purchaseUnit?: string
  blockedUsageUnit?: boolean
}): string {
  if (input.staple || input.blockedUsageUnit) {
    const purchase = input.purchaseUnit || input.unit
    if (input.shortage === "enough") {
      return `家里有货（${purchase}），按需标记快没了`
    }
    return `常备（${purchase}），按需标记快没了`
  }
  if (input.shortage === "unsure") {
    if (!input.ingredientId) return "买到再填数量"
    if (input.fuzzy) return `${input.unit}，份量含糊，买到再填`
    const other = input.otherUnits?.find((unit) => unit && unit !== input.unit)
    if (other) return `有货，但单位是${other}不是${input.unit}`
    return "有货，但单位对不上"
  }
  return `计划要 ${formatQuantityHint(input.needed)} ${input.unit}，家里有 ${formatQuantityHint(input.stockQty)} ${input.unit}`
}

export function otherStockUnits(
  ingredientId: string | null,
  unit: string,
  stock: ShortageInput["stock"]
): string[] {
  if (!ingredientId) return []
  return [
    ...new Set(
      stock
        .filter(
          (row) =>
            row.ingredientId === ingredientId &&
            row.unit !== unit &&
            row.quantity > 0
        )
        .map((row) => row.unit)
    ),
  ]
}

export function hasPickedPurchase(item: ShoppingItem): boolean {
  return (
    item.pickedQty != null &&
    Number.isFinite(item.pickedQty) &&
    item.pickedQty >= 0
  )
}

/** 清单上显示、入库默认用的数量：手改过的优先。 */
export function shoppingPurchaseQty(item: ShoppingItem): number | null {
  if (hasPickedPurchase(item) && item.pickedQty != null) {
    return roundQty(item.pickedQty)
  }
  if (item.buyQty != null && Number.isFinite(item.buyQty)) {
    return roundQty(item.buyQty)
  }
  const parsed = Number.parseFloat(item.quantityHint)
  return Number.isFinite(parsed) ? roundQty(parsed) : null
}

export function shoppingPurchaseUnit(item: ShoppingItem): string {
  const picked = item.pickedUnit?.trim()
  return picked || item.unit
}

/** 清单行右侧的紧凑数量，例如「1 把」。 */
export function shoppingQtyLabel(item: ShoppingItem): string {
  const qty = shoppingPurchaseQty(item)
  const unit = shoppingPurchaseUnit(item)
  if (qty == null) return "填数量"
  return `${formatQuantityHint(qty)} ${unit}`.trim()
}

export function withPickedPurchase(
  item: ShoppingItem,
  quantity: number,
  unit: string
): ShoppingItem {
  return {
    ...item,
    pickedQty: roundQty(quantity),
    pickedUnit: unit.trim() || item.unit,
  }
}

/** 重算时留下采购现场改过的判断和数量。 */
export function carriedTripEdits(
  previous: ShoppingItem | undefined
): Partial<ShoppingItem> {
  if (!previous) return {}
  const carried: Partial<ShoppingItem> = {}
  if (previous.presenceChoice === "have" || previous.presenceChoice === "buy") {
    carried.presenceChoice = previous.presenceChoice
  }
  if (hasPickedPurchase(previous) && previous.pickedQty != null) {
    carried.pickedQty = roundQty(previous.pickedQty)
  }
  const unit = previous.pickedUnit?.trim()
  if (unit) carried.pickedUnit = unit
  return carried
}

export function shoppingPrimaryText(item: ShoppingItem): string {
  const offer = item.substituteOffer
  if (offer && offer.candidates.length > 0) {
    return substituteOfferText(offer.candidates)
  }
  if (hasPickedPurchase(item) && item.pickedQty != null) {
    return `买 ${formatQuantityHint(item.pickedQty)} ${shoppingPurchaseUnit(item)}`
  }
  if (item.shortage === "enough") return "不用买"
  if (item.shortage === "unsure" && !item.unitUnconverted) return "买到再填"
  const buy = item.buyQty ?? Number.parseFloat(item.quantityHint)
  if (item.unitUnconverted && !Number.isFinite(buy)) return "单位未换算"
  const amount = Number.isFinite(buy)
    ? `还差 ${formatQuantityHint(buy)} ${item.unit}`
    : `还差 ${item.quantityHint} ${item.unit}`.trim()
  const marks = [
    item.purchaseHint,
    item.unitUnconverted ? "单位未换算" : "",
  ].filter(Boolean)
  return marks.length > 0 ? `${amount}（${marks.join("，")}）` : amount
}

export function shoppingSecondaryText(item: ShoppingItem): string {
  return item.contextHint ?? ""
}

function scaleFactor(recipe: Recipe | undefined, servings: number): number {
  return recipe && recipe.servings > 0 ? servings / recipe.servings : 1
}

function projectAccountStock(
  entry: CatalogEntry,
  inventory: ShoppingFromPlanInput["inventory"],
  ingredientId: string | null
): {
  rows: ShortageInput["stock"]
  note: string
} {
  if (!ingredientId) return { rows: [], note: "" }
  const rows: ShortageInput["stock"] = []
  const skipped: string[] = []
  for (const row of inventory) {
    if (row.ingredientId !== ingredientId || row.quantity <= 0) continue
    const converted = convertToAccount(entry, row.quantity, row.unit)
    if (!converted.ok) {
      skipped.push(`${formatQuantityHint(row.quantity)} ${row.unit}`)
      continue
    }
    rows.push({
      ingredientId,
      unit: converted.unit,
      quantity: converted.quantity,
    })
  }
  return {
    rows,
    note: skipped.length > 0 ? `家里另有 ${skipped.join("、")} 未换算` : "",
  }
}

function foldCatalogLines(items: ShoppingItem[]): ShoppingItem[] {
  const tracked = items.filter(
    (item) => item.catalogTracked && item.ingredientId
  )
  if (tracked.length === 0) return items
  const groups = new Map<string, ShoppingItem[]>()
  for (const item of tracked) {
    const id = item.ingredientId ?? ""
    const list = groups.get(id) ?? []
    list.push(item)
    groups.set(id, list)
  }
  const folded = new Map<string, ShoppingItem>()
  for (const [id, list] of groups) {
    if (list.length === 1) {
      folded.set(id, list[0])
      continue
    }
    const primary = list.find((item) => !item.unitUnconverted) ?? list[0]
    const rest = list.filter((item) => item !== primary)
    const extra = rest
      .map((item) => `${item.quantityHint || "?"} ${item.unit}`.trim())
      .join("、")
    const allRaw = list.every((item) => item.unitUnconverted)
    folded.set(id, {
      ...primary,
      ...(allRaw
        ? {
            quantityHint: "",
            buyQty: null,
            neededQty: null,
            shortage: "unsure" as const,
            unitUnconverted: true,
          }
        : {}),
      contextHint: [
        primary.contextHint,
        extra ? `另有 ${extra} 未能换算，未合并` : "",
      ]
        .filter(Boolean)
        .join("；"),
    })
  }
  const seen = new Set<string>()
  const result: ShoppingItem[] = []
  for (const item of items) {
    if (!item.catalogTracked || !item.ingredientId) {
      result.push(item)
      continue
    }
    if (seen.has(item.ingredientId)) continue
    seen.add(item.ingredientId)
    const line = folded.get(item.ingredientId)
    if (line) result.push(line)
  }
  return result
}

function lineName(
  item: RecipeItem,
  ingredient: Ingredient | undefined
): string {
  return ingredient?.name || item.rawName
}

function lineStall(ingredient: Ingredient | undefined): StallHint {
  if (ingredient?.stallHint) return ingredient.stallHint
  if (ingredient) return stallFromCategory(ingredient.category)
  return null
}

export function buildShoppingFromPlan(
  input: ShoppingFromPlanInput,
  createItemId: () => string = () => createId("shop")
): ShoppingItem[] {
  const recipeById = new Map(input.recipes.map((recipe) => [recipe.id, recipe]))
  const ingredientById = new Map(
    input.ingredients.map((ingredient) => [ingredient.id, ingredient])
  )
  const itemsByRecipe = new Map<string, RecipeItem[]>()
  for (const item of input.recipeItems) {
    const list = itemsByRecipe.get(item.recipeId) ?? []
    list.push(item)
    itemsByRecipe.set(item.recipeId, list)
  }

  const needs = new Map<string, NeedLine>()

  for (const entry of uncookedPlanEntries(input.planEntries)) {
    const recipe = recipeById.get(entry.recipeId)
    const factor = scaleFactor(recipe, entry.servings)
    const items = itemsByRecipe.get(entry.recipeId) ?? []

    for (const item of items) {
      const ingredient = item.ingredientId
        ? ingredientById.get(item.ingredientId)
        : undefined
      if (!isPurchasableLine(item, ingredient)) continue
      if (item.substitution?.choice === "use") continue

      const catalog = ingredient?.catalogId
        ? catalogById(ingredient.catalogId)
        : null
      if (catalog?.quantityMode === "ignore") continue

      const fuzzy = isFuzzyQuantity(item.quantity, item.unit)
      let needed = fuzzy ? item.quantity : roundQty(item.quantity * factor)
      if (!fuzzy && (!Number.isFinite(needed) || needed <= 0)) continue

      let purchaseUnit = ingredient
        ? ingredientPurchaseUnit(ingredient)
        : undefined
      let kind = ingredient ? ingredientKind(ingredient) : undefined
      let usageUnit = item.unit
      let unitUnconverted = false
      let catalogTracked = false
      let hint = ""
      let unconvertedStock = ""
      if (catalog?.quantityMode === "presence") {
        kind = "staple"
        purchaseUnit = catalog.purchaseUnit
      }
      if (catalog?.quantityMode === "amount") {
        kind = "fresh"
      }
      if (catalog?.quantityMode === "amount" && !fuzzy) {
        catalogTracked = true
        const converted = convertToAccount(catalog, needed, item.unit)
        if (converted.ok) {
          needed = converted.quantity
          usageUnit = converted.unit
          hint = purchaseHint(catalog, needed)
          unconvertedStock = projectAccountStock(
            catalog,
            input.inventory,
            item.ingredientId
          ).note
        } else {
          unitUnconverted = true
        }
      }
      const blocked = blocksUsageUnitBuy({
        ingredientId: item.ingredientId,
        needed,
        unit: item.unit,
        stock: input.inventory,
        kind,
        purchaseUnit,
      })
      const offer =
        ingredient && item.substitution?.choice !== "buy"
          ? substituteCandidates({
              needed: ingredient,
              ingredients: input.ingredients,
              inventory: input.inventory,
            })
          : []
      const line: NeedLine = {
        ingredientId: item.ingredientId,
        name: lineName(item, ingredient),
        needed,
        unit: blocked && purchaseUnit ? purchaseUnit : usageUnit,
        stallHint: lineStall(ingredient),
        fromPlanEntryIds: [entry.id],
        fuzzy,
        kind,
        purchaseUnit,
        usageUnit,
        offerCandidates: offer.length > 0 ? offer : null,
        offerRecipeItemIds: offer.length > 0 ? [item.id] : [],
        unitUnconverted,
        originals: [
          `${formatQuantityHint(fuzzy ? item.quantity : roundQty(item.quantity * factor))} ${item.unit}`,
        ],
        unconvertedStock,
        catalogTracked,
        purchaseHint: hint,
      }
      const key = shoppingMatchKey(line)
      const existing = needs.get(key)
      if (!existing) {
        needs.set(key, line)
        continue
      }
      existing.needed = roundQty(existing.needed + line.needed)
      existing.fuzzy = existing.fuzzy || line.fuzzy
      existing.unitUnconverted =
        existing.unitUnconverted || line.unitUnconverted
      existing.originals.push(...line.originals)
      if (line.unconvertedStock)
        existing.unconvertedStock = line.unconvertedStock
      if (line.purchaseHint) {
        const catalog = ingredient?.catalogId
          ? catalogById(ingredient.catalogId)
          : null
        existing.purchaseHint = catalog
          ? purchaseHint(catalog, existing.needed)
          : line.purchaseHint
      }
      if (!existing.fromPlanEntryIds.includes(entry.id)) {
        existing.fromPlanEntryIds.push(entry.id)
      }
      if (line.offerCandidates && line.offerRecipeItemIds.length > 0) {
        existing.offerCandidates = line.offerCandidates
        for (const recipeItemId of line.offerRecipeItemIds) {
          if (!existing.offerRecipeItemIds.includes(recipeItemId)) {
            existing.offerRecipeItemIds.push(recipeItemId)
          }
        }
      }
    }
  }

  const existingNormalized = input.existing.map(normalizeShoppingItem)
  const previousByKey = new Map(
    existingNormalized.map((item) => [shoppingMatchKey(item), item])
  )

  const next = [...needs.values()].map((line) => {
    const ingredient = line.ingredientId
      ? ingredientById.get(line.ingredientId)
      : undefined
    const catalog = ingredient?.catalogId
      ? catalogById(ingredient.catalogId)
      : null
    const projected =
      catalog && line.catalogTracked && !line.unitUnconverted
        ? projectAccountStock(catalog, input.inventory, line.ingredientId)
        : null
    const stock = projected ? projected.rows : input.inventory
    const blocked = blocksUsageUnitBuy({
      ingredientId: line.ingredientId,
      needed: line.needed,
      unit: line.usageUnit,
      stock,
      kind: line.kind,
      purchaseUnit: line.purchaseUnit,
    })
    let shortage = decideShortage({
      ingredientId: line.ingredientId,
      needed: line.needed,
      unit: line.usageUnit,
      stock,
      kind: line.kind,
      purchaseUnit: line.purchaseUnit,
    })
    if (projected?.note && shortage === "short") {
      shortage = "unsure"
    }
    const previous = previousByKey.get(shoppingMatchKey(line))
    const bought = previous?.status === "bought"
    const stockQty = sameUnitStockQty(line.ingredientId, line.unit, stock)
    const buyQty = blocked
      ? shortage === "enough"
        ? 0
        : null
      : shortage === "unsure" || line.fuzzy
        ? null
        : buyQuantity(line.needed, stockQty)
    const quantityHint = buyQty == null ? "" : formatQuantityHint(buyQty)
    const hint =
      catalog && buyQty != null && buyQty > 0 && !line.unitUnconverted
        ? purchaseHint(catalog, buyQty)
        : undefined
    const origin =
      line.originals.length > 0 &&
      (line.originals.length > 1 ||
        line.originals[0] !== `${formatQuantityHint(line.needed)} ${line.unit}`)
        ? `食谱按 ${line.originals.join(" + ")}`
        : ""
    const baseHint =
      line.offerCandidates && line.offerRecipeItemIds.length > 0
        ? ""
        : shoppingContextHint({
            shortage,
            needed: line.needed,
            stockQty,
            unit: line.unit,
            ingredientId: line.ingredientId,
            fuzzy: line.fuzzy,
            otherUnits: line.catalogTracked
              ? []
              : otherStockUnits(
                  line.ingredientId,
                  line.usageUnit,
                  input.inventory
                ),
            staple: line.kind === "staple",
            purchaseUnit: line.purchaseUnit,
            blockedUsageUnit: blocked,
          })
    return {
      id: previous?.id ?? createItemId(),
      ingredientId: line.ingredientId,
      name: line.name,
      quantityHint,
      unit: line.unit,
      stallHint: line.stallHint,
      status: bought ? "bought" : "needed",
      shortage,
      fromPlanEntryIds: line.fromPlanEntryIds,
      checkedAt: bought ? (previous.checkedAt ?? null) : null,
      neededQty: blocked || line.fuzzy ? null : line.needed,
      stockQty: line.ingredientId ? stockQty : null,
      buyQty,
      source: "plan" as const,
      ...(line.offerCandidates && line.offerRecipeItemIds.length > 0
        ? {
            substituteOffer: {
              candidates: line.offerCandidates,
              recipeItemIds: line.offerRecipeItemIds,
            },
          }
        : {}),
      ...(hint ? { purchaseHint: hint } : {}),
      ...(line.unitUnconverted ? { unitUnconverted: true } : {}),
      ...(line.catalogTracked ? { catalogTracked: true } : {}),
      contextHint: [baseHint, origin, projected?.note || line.unconvertedStock]
        .filter(Boolean)
        .join("；"),
      ...carriedTripEdits(previous),
    } satisfies ShoppingItem
  })

  return mergeProtectedShoppingLines(
    foldCatalogLines(next),
    existingNormalized
  ).sort((a, b) => {
    const stallDiff =
      STALL_ORDER.indexOf(a.stallHint) - STALL_ORDER.indexOf(b.stallHint)
    if (stallDiff !== 0) return stallDiff
    return a.name.localeCompare(b.name, "zh-CN")
  })
}

export function mergeProtectedShoppingLines(
  planLines: ShoppingItem[],
  existing: ShoppingItem[]
): ShoppingItem[] {
  const protectedItems = existing
    .map(normalizeShoppingItem)
    .filter((item) => isProtectedShoppingSource(item.source))
  const used = new Set<string>()

  const merged = planLines.map((line) => {
    const preserved =
      protectedItems.find(
        (item) => shoppingMatchKey(item) === shoppingMatchKey(line)
      ) ??
      protectedItems.find(
        (item) => shoppingIngredientKey(item) === shoppingIngredientKey(line)
      )
    if (!preserved) return line
    used.add(preserved.id)
    return {
      ...preserved,
      name: line.name || preserved.name,
      stallHint: line.stallHint ?? preserved.stallHint,
      fromPlanEntryIds: line.fromPlanEntryIds,
      ingredientId: preserved.ingredientId ?? line.ingredientId,
    } satisfies ShoppingItem
  })

  for (const item of protectedItems) {
    if (!used.has(item.id)) merged.push(item)
  }
  return merged
}
