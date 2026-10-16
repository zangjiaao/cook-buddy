import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { INGREDIENT_CATALOG } from "@/data/ingredient-catalog.generated"
import type {
  Category,
  Ingredient,
  IngredientKind,
  Location,
  QuantityMode,
  StallHint,
} from "@/lib/types"

export type CatalogEntry = {
  id: string
  name: string
  aliases: readonly string[]
  group: string
  family: string
  aisle: Category
  accountUnit: string
  purchaseUnit: string
  conversions: Readonly<Record<string, number>>
  /** 这些单位的换算是约数，例如 1 只鸡≈1500g。 */
  approximateUnits?: readonly string[]
  quantityMode: QuantityMode
  defaultLocation: Location
  shelfFridge: number | null
  shelfFreezer: number | null
  shelfPantry: number | null
}

export const INGREDIENT_CATALOG_ENTRIES: readonly CatalogEntry[] =
  INGREDIENT_CATALOG

const byId = new Map<string, CatalogEntry>()
const byName = new Map<string, CatalogEntry>()

for (const entry of INGREDIENT_CATALOG_ENTRIES) {
  byId.set(entry.id, entry)
  for (const label of [entry.name, ...entry.aliases]) {
    byName.set(normalizeIngredientName(label), entry)
  }
}

export function catalogById(
  id: string | null | undefined
): CatalogEntry | null {
  if (!id) return null
  return byId.get(id) ?? null
}

export function matchCatalog(rawName: string): CatalogEntry | null {
  const key = normalizeIngredientName(rawName)
  if (!key) return null
  return byName.get(key) ?? null
}

export function catalogForIngredient(
  ingredient: Pick<Ingredient, "name" | "catalogId"> | null | undefined
): CatalogEntry | null {
  if (!ingredient) return null
  return catalogById(ingredient.catalogId) ?? matchCatalog(ingredient.name)
}

/** 整鸡和鸡块算同一份库存。鸡腿、鸡翅、鸡胸这些部位不在里面。 */
const STOCK_POOLS: Record<string, string> = {
  "cat-hen": "whole-chicken",
  "cat-chicken-piece": "whole-chicken",
}

export function stockPoolId(
  catalogId: string | null | undefined
): string | null {
  if (!catalogId) return null
  return STOCK_POOLS[catalogId] ?? null
}

export function sameStockPool(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const pool = stockPoolId(left)
  return Boolean(pool && pool === stockPoolId(right))
}

export type FactorSource = {
  accountUnit: string
  conversions?: Readonly<Record<string, number>>
  approximateUnits?: readonly string[]
}

/** 食材自己记住的换算盖住基准库，同一种食材以后都用这一套。 */
export function withIngredientFactors(
  entry: Pick<CatalogEntry, "accountUnit" | "conversions" | "approximateUnits">,
  ingredient?: Pick<Ingredient, "conversions" | "approximateUnits"> | null
): FactorSource {
  const approximateUnits = [
    ...(entry.approximateUnits ?? []),
    ...(ingredient?.approximateUnits ?? []),
  ]
  return {
    accountUnit: entry.accountUnit,
    conversions: {
      ...entry.conversions,
      ...(ingredient?.conversions ?? {}),
    },
    ...(approximateUnits.length > 0 ? { approximateUnits } : {}),
  }
}

const MASS_TO_G: Record<string, number> = {
  g: 1,
  克: 1,
  kg: 1000,
  千克: 1000,
  公斤: 1000,
  斤: 500,
  两: 50,
}

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  毫升: 1,
  l: 1000,
  L: 1000,
  升: 1000,
}

/** 1 原单位 = 多少记账单位。只收精确的重量/体积，以及这条食材自己写明的换算。 */
export function conversionFactors(
  entry: Pick<FactorSource, "accountUnit" | "conversions">
): Record<string, number> {
  const factors: Record<string, number> = {}
  if (entry.accountUnit === "g" || entry.accountUnit === "克") {
    Object.assign(factors, MASS_TO_G)
  }
  if (entry.accountUnit === "ml" || entry.accountUnit === "毫升") {
    Object.assign(factors, VOLUME_TO_ML)
  }
  factors[entry.accountUnit] = factors[entry.accountUnit] ?? 1
  for (const [unit, factor] of Object.entries(entry.conversions ?? {})) {
    factors[unit] = factor
  }
  if (factors.g != null && factors["克"] == null) factors["克"] = factors.g
  if (factors["克"] != null && factors.g == null) factors.g = factors["克"]
  if (factors.ml != null && factors["毫升"] == null)
    factors["毫升"] = factors.ml
  if (factors["毫升"] != null && factors.ml == null)
    factors.ml = factors["毫升"]
  return factors
}

export function shelfByLocation(
  entry: Pick<CatalogEntry, "shelfFridge" | "shelfFreezer" | "shelfPantry">
): Partial<Record<Location, number>> {
  const shelf: Partial<Record<Location, number>> = {}
  if (entry.shelfFridge != null) shelf.fridge = entry.shelfFridge
  if (entry.shelfFreezer != null) shelf.freezer = entry.shelfFreezer
  if (entry.shelfPantry != null) shelf.pantry = entry.shelfPantry
  return shelf
}

export function defaultShelfFor(
  entry: CatalogEntry,
  location: Location = entry.defaultLocation
): number | null {
  return (
    shelfByLocation(entry)[location] ??
    shelfByLocation(entry)[entry.defaultLocation] ??
    null
  )
}

export function kindForQuantityMode(mode: QuantityMode): IngredientKind {
  return mode === "amount" ? "fresh" : "staple"
}

export function catalogDraft(entry: CatalogEntry): {
  name: string
  aliases: string[]
  category: Category
  defaultUnit: string
  stallHint: StallHint
  defaultShelfLifeDays: number | null
  defaultLocation: Location
  purchaseUnit: string
  kind: IngredientKind
  family?: string
  buyable?: false
  catalogId: string
  catalogGroup: string
  quantityMode: QuantityMode
  shelfLifeByLocation: Partial<Record<Location, number>>
} {
  const tracked = entry.quantityMode === "amount"
  return {
    name: entry.name,
    aliases: [...entry.aliases],
    category: entry.aisle,
    defaultUnit: tracked ? entry.accountUnit : entry.purchaseUnit,
    stallHint:
      entry.aisle === "meat" || entry.aisle === "veg" || entry.aisle === "dry"
        ? entry.aisle
        : null,
    defaultShelfLifeDays: defaultShelfFor(entry),
    defaultLocation: entry.defaultLocation,
    purchaseUnit: entry.purchaseUnit,
    kind: kindForQuantityMode(entry.quantityMode),
    ...(entry.family ? { family: entry.family } : {}),
    ...(entry.quantityMode === "ignore" ? { buyable: false as const } : {}),
    catalogId: entry.id,
    catalogGroup: entry.group,
    quantityMode: entry.quantityMode,
    shelfLifeByLocation: shelfByLocation(entry),
  }
}

/** 只补基准库指针，不改用户已经在用的单位和别名。 */
export function withCatalogLink<T extends Ingredient>(ingredient: T): T {
  const entry = catalogForIngredient(ingredient)
  if (!entry) return ingredient
  if (
    ingredient.catalogId === entry.id &&
    ingredient.quantityMode === entry.quantityMode &&
    ingredient.catalogGroup === entry.group
  ) {
    return ingredient
  }
  return {
    ...ingredient,
    catalogId: entry.id,
    catalogGroup: entry.group,
    quantityMode: entry.quantityMode,
    shelfLifeByLocation:
      ingredient.shelfLifeByLocation ?? shelfByLocation(entry),
  }
}
