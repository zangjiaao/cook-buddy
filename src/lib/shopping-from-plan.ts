// 按计划生成清单：份数缩放后按食材+单位合并，只减同单位库存。
// 已买勾选：同一 ingredientId+单位（未对齐则同一名称+单位）仍需要时保留。
import { createId } from "@/lib/id"
import type {
  Category,
  Ingredient,
  InventoryItem,
  PlanEntry,
  Recipe,
  RecipeItem,
  ShoppingItem,
  Shortage,
  StallHint,
} from "@/lib/types"

const STALL_ORDER: StallHint[] = ["meat", "veg", "dry", null]
const FUZZY_QUANTITY = /少许|适量|若干/

export type ShortageInput = {
  ingredientId: string | null
  needed: number
  unit: string
  stock: Array<Pick<InventoryItem, "ingredientId" | "unit" | "quantity">>
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

export function decideShortage(input: ShortageInput): Shortage {
  if (!input.ingredientId) return "unsure"
  if (isFuzzyQuantity(input.needed, input.unit)) return "unsure"

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
}): string {
  if (input.shortage === "unsure") {
    if (!input.ingredientId) return "食材还没对齐，买到再填数量"
    if (input.fuzzy) return `${input.unit}，份量含糊，买到再填`
    return "家里只有别的单位，对不上"
  }
  return `计划要 ${formatQuantityHint(input.needed)} ${input.unit}，家里有 ${formatQuantityHint(input.stockQty)} ${input.unit}`
}

export function shoppingPrimaryText(item: ShoppingItem): string {
  if (item.shortage === "enough") return "不用买"
  if (item.shortage === "unsure") return "买到再填"
  const buy = item.buyQty ?? Number.parseFloat(item.quantityHint)
  if (!Number.isFinite(buy)) return `还差 ${item.quantityHint} ${item.unit}`
  return `还差 ${formatQuantityHint(buy)} ${item.unit}`
}

export function shoppingSecondaryText(item: ShoppingItem): string {
  return item.contextHint ?? ""
}

function scaleFactor(recipe: Recipe | undefined, servings: number): number {
  return recipe && recipe.servings > 0 ? servings / recipe.servings : 1
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

  for (const entry of input.planEntries) {
    const recipe = recipeById.get(entry.recipeId)
    const factor = scaleFactor(recipe, entry.servings)
    const items = itemsByRecipe.get(entry.recipeId) ?? []

    for (const item of items) {
      const fuzzy = isFuzzyQuantity(item.quantity, item.unit)
      const needed = fuzzy ? item.quantity : roundQty(item.quantity * factor)
      if (!fuzzy && (!Number.isFinite(needed) || needed <= 0)) continue

      const ingredient = item.ingredientId
        ? ingredientById.get(item.ingredientId)
        : undefined
      const line: NeedLine = {
        ingredientId: item.ingredientId,
        name: lineName(item, ingredient),
        needed,
        unit: item.unit,
        stallHint: lineStall(ingredient),
        fromPlanEntryIds: [entry.id],
        fuzzy,
      }
      const key = shoppingMatchKey(line)
      const existing = needs.get(key)
      if (!existing) {
        needs.set(key, line)
        continue
      }
      existing.needed = roundQty(existing.needed + line.needed)
      existing.fuzzy = existing.fuzzy || line.fuzzy
      if (!existing.fromPlanEntryIds.includes(entry.id)) {
        existing.fromPlanEntryIds.push(entry.id)
      }
    }
  }

  const previousByKey = new Map(
    input.existing.map((item) => [shoppingMatchKey(item), item])
  )

  const next = [...needs.values()].map((line) => {
    const shortage = decideShortage({
      ingredientId: line.ingredientId,
      needed: line.needed,
      unit: line.unit,
      stock: input.inventory,
    })
    const previous = previousByKey.get(shoppingMatchKey(line))
    const bought = previous?.status === "bought"
    const stockQty = sameUnitStockQty(
      line.ingredientId,
      line.unit,
      input.inventory
    )
    const buyQty =
      shortage === "unsure" || line.fuzzy
        ? null
        : buyQuantity(line.needed, stockQty)
    const quantityHint = buyQty == null ? "" : formatQuantityHint(buyQty)
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
      neededQty: line.fuzzy ? null : line.needed,
      stockQty: line.ingredientId ? stockQty : null,
      buyQty,
      contextHint: shoppingContextHint({
        shortage,
        needed: line.needed,
        stockQty,
        unit: line.unit,
        ingredientId: line.ingredientId,
        fuzzy: line.fuzzy,
      }),
    } satisfies ShoppingItem
  })

  return next.sort((a, b) => {
    const stallDiff =
      STALL_ORDER.indexOf(a.stallHint) - STALL_ORDER.indexOf(b.stallHint)
    if (stallDiff !== 0) return stallDiff
    return a.name.localeCompare(b.name, "zh-CN")
  })
}
