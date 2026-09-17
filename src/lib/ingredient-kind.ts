import type { Category, Ingredient, IngredientKind } from "@/lib/types"

const FUZZY_UNITS = /^(少许|适量|若干)$/
const USAGE_ONLY_UNITS = /^(勺|茶匙|汤匙|毫升|ml|g|克)$/i
const STAPLE_NAME_RE =
  /抽|酱油|醋|盐|糖|料酒|蚝油|酱|食用油|花椒|胡椒|味精|鸡精|八角|桂皮|香叶|豆瓣|油/
const STAPLE_BOTTLE_RE = /抽|油|酱|醋|料酒|蚝油/

export function guessIngredientKind(
  name: string,
  category?: Category
): IngredientKind {
  if (category === "seasoning" || STAPLE_NAME_RE.test(name)) return "staple"
  return "fresh"
}

export function guessPurchaseUnit(input: {
  name: string
  category?: Category
  defaultUnit?: string
  kind?: IngredientKind
  unitHint?: string
}): string {
  const kind = input.kind ?? guessIngredientKind(input.name, input.category)
  const defaultUnit = input.defaultUnit?.trim() ?? ""
  const hint = input.unitHint?.trim() ?? ""

  if (kind === "fresh") {
    if (hint && !FUZZY_UNITS.test(hint) && !USAGE_ONLY_UNITS.test(hint)) {
      return hint
    }
    if (defaultUnit && !FUZZY_UNITS.test(defaultUnit)) return defaultUnit
    return hint && !FUZZY_UNITS.test(hint) ? hint : "把"
  }

  if (
    defaultUnit &&
    !FUZZY_UNITS.test(defaultUnit) &&
    !USAGE_ONLY_UNITS.test(defaultUnit)
  ) {
    return defaultUnit
  }
  if (hint && !FUZZY_UNITS.test(hint) && !USAGE_ONLY_UNITS.test(hint)) {
    return hint
  }
  if (STAPLE_BOTTLE_RE.test(input.name) || input.category === "seasoning") {
    return "瓶"
  }
  if (input.category === "dry") return "袋"
  return "瓶"
}

export function ingredientKind(
  ingredient: Pick<Ingredient, "name" | "category" | "kind">
): IngredientKind {
  return (
    ingredient.kind ?? guessIngredientKind(ingredient.name, ingredient.category)
  )
}

export function ingredientPurchaseUnit(
  ingredient: Pick<
    Ingredient,
    "name" | "category" | "defaultUnit" | "purchaseUnit" | "kind"
  >
): string {
  const trimmed = ingredient.purchaseUnit?.trim()
  if (trimmed) return trimmed
  return guessPurchaseUnit({
    name: ingredient.name,
    category: ingredient.category,
    defaultUnit: ingredient.defaultUnit,
    kind: ingredientKind(ingredient),
  })
}

export function isStapleIngredient(
  ingredient: Pick<Ingredient, "name" | "category" | "kind"> | undefined
): boolean {
  if (!ingredient) return false
  return ingredientKind(ingredient) === "staple"
}

export function isUsageOnlyUnit(unit: string): boolean {
  return USAGE_ONLY_UNITS.test(unit.trim())
}

export function normalizeIngredient<T extends Ingredient>(ingredient: T): T {
  const kind = ingredientKind(ingredient)
  const purchaseUnit = ingredientPurchaseUnit({ ...ingredient, kind })
  return { ...ingredient, kind, purchaseUnit }
}

export function ingredientNeedsMigrate(ingredient: Ingredient): boolean {
  return ingredient.kind == null || !ingredient.purchaseUnit?.trim()
}
