import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import {
  catalogById,
  catalogDraft,
  kindForQuantityMode,
  matchCatalog,
  shelfByLocation,
  type CatalogEntry,
} from "@/lib/ingredient-catalog"
import { isBlockedAlias } from "@/lib/ingredient-identity"
import { stallFromCategory } from "@/lib/shopping-from-plan"
import { convertToAccount, isFuzzyUnit, roundQty } from "@/lib/unit-convert"
import type {
  Ingredient,
  InventoryItem,
  PlanEntry,
  RecipeItem,
  ShoppingItem,
} from "@/lib/types"

type Stamp = {
  id: string
  updatedAt?: string
  deletedAt?: string | null
}

export type MigratableIngredient = Ingredient & Stamp
export type MigratableInventory = InventoryItem & Stamp
export type MigratableRecipeItem = RecipeItem & Stamp
export type MigratableShopping = ShoppingItem & Stamp
export type MigratablePlan = PlanEntry & Stamp

export type CatalogMigrationInput = {
  ingredients: MigratableIngredient[]
  inventory: MigratableInventory[]
  recipeItems: MigratableRecipeItem[]
  shopping: MigratableShopping[]
  plan: MigratablePlan[]
  now: string
}

export type CatalogMigrationResult = CatalogMigrationInput & {
  changed: boolean
}

function deleted(record: { deletedAt?: string | null }): boolean {
  return typeof record.deletedAt === "string" && record.deletedAt.length > 0
}

function canon(value: unknown): string {
  return JSON.stringify(value)
}

function withStamp<T extends Stamp>(previous: T, next: T, now: string): T {
  if (canon(previous) === canon(next)) return previous
  return { ...next, updatedAt: now }
}

function resolveCatalog(ingredient: MigratableIngredient): CatalogEntry | null {
  const linked = catalogById(ingredient.catalogId)
  if (linked) return linked
  const named = matchCatalog(ingredient.name)
  if (named) return named
  let found: CatalogEntry | null = null
  for (const alias of ingredient.aliases ?? []) {
    const hit = matchCatalog(alias)
    if (!hit) continue
    if (found && found.id !== hit.id) return null
    found = hit
  }
  return found
}

function unique(values: string[]): string[] {
  return values.filter(
    (value, index) => value && values.indexOf(value) === index
  )
}

function aliasesForSurvivor(
  entry: CatalogEntry,
  group: MigratableIngredient[],
  survivor: MigratableIngredient
): string[] {
  const labels = unique([
    ...entry.aliases,
    ...group.flatMap((ingredient) => [
      ingredient.name,
      ...(ingredient.aliases ?? []),
    ]),
  ])
  return labels.filter((alias) => {
    if (
      normalizeIngredientName(alias) === normalizeIngredientName(entry.name)
    ) {
      return false
    }
    const other = matchCatalog(alias)
    if (other && other.id !== entry.id) return false
    return !isBlockedAlias(
      {
        ...survivor,
        name: entry.name,
        family: entry.family || survivor.family,
      },
      alias
    )
  })
}

function applyCatalogFields(
  survivor: MigratableIngredient,
  entry: CatalogEntry,
  group: MigratableIngredient[]
): MigratableIngredient {
  const draft = catalogDraft(entry)
  const firstLink = !survivor.catalogId
  const merging = group.length > 1
  if (!firstLink && !merging) {
    return {
      ...survivor,
      catalogId: entry.id,
      catalogGroup: survivor.catalogGroup ?? entry.group,
      quantityMode: survivor.quantityMode ?? entry.quantityMode,
      shelfLifeByLocation:
        survivor.shelfLifeByLocation ?? shelfByLocation(entry),
    }
  }
  const nameIsCatalog =
    normalizeIngredientName(survivor.name) ===
      normalizeIngredientName(entry.name) ||
    entry.aliases.some(
      (alias) =>
        normalizeIngredientName(alias) ===
        normalizeIngredientName(survivor.name)
    )
  const name = nameIsCatalog || merging ? entry.name : survivor.name
  return {
    ...survivor,
    name,
    aliases: aliasesForSurvivor(entry, group, survivor),
    category: draft.category,
    defaultUnit: draft.defaultUnit,
    stallHint: stallFromCategory(draft.category),
    defaultShelfLifeDays: draft.defaultShelfLifeDays,
    purchaseUnit: draft.purchaseUnit,
    kind: kindForQuantityMode(entry.quantityMode),
    ...(entry.family ? { family: entry.family } : {}),
    ...(entry.quantityMode === "ignore" ? { buyable: false as const } : {}),
    catalogId: entry.id,
    catalogGroup: entry.group,
    quantityMode: entry.quantityMode,
    shelfLifeByLocation: shelfByLocation(entry),
  }
}

function stampSample(
  ingredient: MigratableIngredient,
  entry: CatalogEntry
): MigratableIngredient {
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

type QuantityScale = { factor: number }

function convertAmount<
  T extends {
    quantity: number
    unit: string
    sourceQuantity?: number
    sourceUnit?: string
    unitUnconverted?: boolean
  },
>(row: T, entry: CatalogEntry): { next: T; scale: QuantityScale | null } {
  if (entry.quantityMode !== "amount") {
    if (!row.unitUnconverted) return { next: row, scale: null }
    const cleared = { ...row }
    delete cleared.unitUnconverted
    return { next: cleared, scale: null }
  }
  const converted = convertToAccount(entry, row.quantity, row.unit)
  if (!converted.ok) {
    if (isFuzzyUnit(row.unit)) {
      if (!row.unitUnconverted) return { next: row, scale: null }
      const cleared = { ...row }
      delete cleared.unitUnconverted
      return { next: cleared, scale: null }
    }
    if (row.unitUnconverted) return { next: row, scale: null }
    return { next: { ...row, unitUnconverted: true }, scale: null }
  }
  if (converted.unit === row.unit && converted.quantity === row.quantity) {
    if (!row.unitUnconverted) return { next: row, scale: null }
    const cleared = { ...row }
    delete cleared.unitUnconverted
    return { next: cleared, scale: null }
  }
  const one = convertToAccount(entry, 1, row.unit)
  const cleared = { ...row }
  delete cleared.unitUnconverted
  return {
    next: {
      ...cleared,
      quantity: converted.quantity,
      unit: converted.unit,
      sourceQuantity: row.sourceQuantity ?? row.quantity,
      sourceUnit: row.sourceUnit ?? row.unit,
    },
    scale: one.ok ? { factor: one.quantity } : null,
  }
}

function stripUndefined<T extends object>(value: T): T {
  const next = { ...value }
  for (const key of Object.keys(next) as Array<keyof T>) {
    if (next[key] === undefined) delete next[key]
  }
  return next
}

export function migrateCatalogData(
  input: CatalogMigrationInput
): CatalogMigrationResult {
  const ingredients = input.ingredients.map((ingredient) => ({ ...ingredient }))
  const visible = ingredients.filter((ingredient) => !deleted(ingredient))
  const redirect = new Map<string, string>()
  const scales = new Map<string, QuantityScale>()

  const samples = visible.filter((ingredient) => ingredient.sample)
  const users = visible.filter((ingredient) => !ingredient.sample)
  const groups = new Map<string, MigratableIngredient[]>()
  for (const ingredient of users) {
    const entry = resolveCatalog(ingredient)
    const key = entry ? `cat:${entry.id}` : `self:${ingredient.id}`
    const list = groups.get(key) ?? []
    list.push(ingredient)
    groups.set(key, list)
  }

  const byIngredientId = new Map(
    ingredients.map((ingredient) => [ingredient.id, ingredient])
  )

  for (const ingredient of samples) {
    const entry = resolveCatalog(ingredient)
    if (!entry) continue
    const next = stampSample(ingredient, entry)
    byIngredientId.set(ingredient.id, withStamp(ingredient, next, input.now))
  }

  for (const [key, group] of groups) {
    if (!key.startsWith("cat:")) continue
    const entry = catalogById(key.slice(4))
    if (!entry || group.length === 0) continue
    const canonical = group.filter(
      (ingredient) =>
        normalizeIngredientName(ingredient.name) ===
        normalizeIngredientName(entry.name)
    )
    const pool = canonical.length > 0 ? canonical : group
    const survivor = [...pool].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    )[0]
    if (!survivor) continue
    const nextSurvivor = applyCatalogFields(survivor, entry, group)
    byIngredientId.set(
      survivor.id,
      withStamp(survivor, nextSurvivor, input.now)
    )
    for (const loser of group) {
      if (loser.id === survivor.id) continue
      redirect.set(loser.id, survivor.id)
      const tombstone: MigratableIngredient = {
        ...loser,
        deletedAt: input.now,
        mergedInto: survivor.id,
      }
      byIngredientId.set(loser.id, withStamp(loser, tombstone, input.now))
    }
  }

  function targetId(id: string | null): string | null {
    if (!id) return id
    return redirect.get(id) ?? id
  }

  function entryForIngredient(id: string | null): CatalogEntry | null {
    if (!id) return null
    const ingredient = byIngredientId.get(id)
    if (!ingredient || ingredient.sample || deleted(ingredient)) return null
    return resolveCatalog(ingredient)
  }

  const inventory = input.inventory.map((row) => {
    const ingredientId = targetId(row.ingredientId) ?? row.ingredientId
    let next: MigratableInventory =
      row.ingredientId === ingredientId ? row : { ...row, ingredientId }
    const entry = entryForIngredient(ingredientId)
    if (entry && !deleted(row)) {
      const converted = convertAmount(next, entry)
      next = stripUndefined(converted.next)
      if (converted.scale && row.unit !== next.unit)
        scales.set(row.id, converted.scale)
    }
    return withStamp(row, next, input.now)
  })

  const recipeItems = input.recipeItems.map((row) => {
    const ingredientId = targetId(row.ingredientId)
    const substituteId = row.substitution
      ? targetId(row.substitution.substituteIngredientId)
      : null
    let next: MigratableRecipeItem = row
    if (
      ingredientId !== row.ingredientId ||
      (row.substitution &&
        substituteId !== row.substitution.substituteIngredientId)
    ) {
      next = {
        ...row,
        ingredientId,
        ...(row.substitution && substituteId
          ? {
              substitution: {
                ...row.substitution,
                substituteIngredientId: substituteId,
              },
            }
          : {}),
      }
    }
    const entry = entryForIngredient(ingredientId)
    if (entry && !deleted(row)) {
      const converted = convertAmount(next, entry)
      next = stripUndefined(converted.next)
    }
    return withStamp(row, next, input.now)
  })

  const survivorName = (id: string | null, fallback: string) => {
    if (!id) return fallback
    return byIngredientId.get(id)?.name || fallback
  }

  const shopping = input.shopping.map((row) => {
    const ingredientId = targetId(row.ingredientId)
    let next: MigratableShopping =
      ingredientId === row.ingredientId
        ? row
        : {
            ...row,
            ingredientId,
            name: survivorName(ingredientId, row.name),
          }
    const entry = entryForIngredient(ingredientId)
    if (entry && !deleted(row) && entry.quantityMode === "amount") {
      const parsed = Number.parseFloat(row.quantityHint)
      if (Number.isFinite(parsed)) {
        const converted = convertToAccount(entry, parsed, row.unit)
        if (
          converted.ok &&
          (converted.unit !== row.unit || converted.quantity !== parsed)
        ) {
          next = {
            ...next,
            quantityHint: String(roundQty(converted.quantity)),
            unit: converted.unit,
            buyQty:
              row.buyQty == null
                ? row.buyQty
                : roundQty(
                    convertToAccount(entry, row.buyQty, row.unit).ok
                      ? convertToAccount(entry, row.buyQty, row.unit).quantity
                      : row.buyQty
                  ),
            neededQty:
              row.neededQty == null
                ? row.neededQty
                : roundQty(
                    convertToAccount(entry, row.neededQty, row.unit).ok
                      ? convertToAccount(entry, row.neededQty, row.unit)
                          .quantity
                      : row.neededQty
                  ),
          }
        } else if (
          !converted.ok &&
          !isFuzzyUnit(row.unit) &&
          !row.unitUnconverted
        ) {
          next = { ...next, unitUnconverted: true }
        }
      }
    }
    return withStamp(row, next, input.now)
  })

  const plan = input.plan.map((row) => {
    if (!row.lastDeduct || scales.size === 0) return row
    let touched = false
    const changes = row.lastDeduct.changes.map((change) => {
      const scale = scales.get(change.inventoryItemId)
      if (!scale) return change
      touched = true
      return {
        ...change,
        previousQuantity: roundQty(change.previousQuantity * scale.factor),
        nextQuantity: roundQty(change.nextQuantity * scale.factor),
      }
    })
    if (!touched) return row
    return withStamp(
      row,
      { ...row, lastDeduct: { ...row.lastDeduct, changes } },
      input.now
    )
  })

  const nextIngredients = ingredients.map(
    (ingredient) => byIngredientId.get(ingredient.id) ?? ingredient
  )
  const changed =
    canon(nextIngredients) !== canon(input.ingredients) ||
    canon(inventory) !== canon(input.inventory) ||
    canon(recipeItems) !== canon(input.recipeItems) ||
    canon(shopping) !== canon(input.shopping) ||
    canon(plan) !== canon(input.plan)

  return {
    ingredients: nextIngredients,
    inventory,
    recipeItems,
    shopping,
    plan,
    now: input.now,
    changed,
  }
}
