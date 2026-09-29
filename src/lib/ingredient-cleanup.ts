import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { normalizeIngredient } from "@/lib/ingredient-kind"
import {
  guessFamily,
  isBlockedAlias,
  sameFamilyDifferentThing,
  synonymGroupKey,
} from "@/lib/ingredient-identity"
import { MARKET_UNITS } from "@/lib/labels"
import type {
  Ingredient,
  InventoryItem,
  RecipeItem,
  ShoppingItem,
} from "@/lib/types"

export type CleanupStores = {
  ingredients: Ingredient[]
  inventory: InventoryItem[]
  recipeItems: RecipeItem[]
  shoppingItems: ShoppingItem[]
}

export type AiCleanupAdvice = {
  merges: Array<{ keepId: string; dropIds: string[] }>
  families: Array<{ id: string; family: string }>
  units: Array<{ id: string; defaultUnit?: string; purchaseUnit?: string }>
  removeAliases: Array<{ id: string; aliases: string[] }>
}

export type CleanupResult = {
  stores: CleanupStores
  removedIds: string[]
  changed: boolean
}

function cloneStores(stores: CleanupStores): CleanupStores {
  return {
    ingredients: stores.ingredients.map((row) => ({
      ...row,
      aliases: [...row.aliases],
    })),
    inventory: stores.inventory.map((row) => ({ ...row })),
    recipeItems: stores.recipeItems.map((row) => ({
      ...row,
      substitution: row.substitution
        ? { ...row.substitution }
        : row.substitution,
    })),
    shoppingItems: stores.shoppingItems.map((row) => ({
      ...row,
      fromPlanEntryIds: [...row.fromPlanEntryIds],
    })),
  }
}

function asIngredient(row: Ingredient): Ingredient {
  return normalizeIngredient(row)
}

function mergeAllowed(keepName: string, dropName: string): boolean {
  if (normalizeIngredientName(keepName) === normalizeIngredientName(dropName)) {
    return true
  }
  if (sameFamilyDifferentThing(keepName, dropName)) return false
  const familyA = guessFamily(keepName)
  const familyB = guessFamily(dropName)
  if (familyA && familyB && familyA !== familyB) return false
  return true
}

function hasStock(ingredientId: string, inventory: InventoryItem[]): boolean {
  return inventory.some(
    (row) => row.ingredientId === ingredientId && row.quantity > 0
  )
}

function pickKeeper(
  group: Ingredient[],
  inventory: InventoryItem[]
): Ingredient {
  const stocked = group.filter((ingredient) =>
    hasStock(ingredient.id, inventory)
  )
  if (stocked.length === 1) return stocked[0]
  const canonical = group.find(
    (ingredient) =>
      synonymGroupKey(ingredient.name) ===
      normalizeIngredientName(ingredient.name)
  )
  if (
    canonical &&
    (stocked.length === 0 || stocked.some((row) => row.id === canonical.id))
  ) {
    return canonical
  }
  const pool = stocked.length > 0 ? stocked : group
  return [...pool].sort((a, b) => a.id.localeCompare(b.id))[0]
}

function absorb(
  ingredients: Ingredient[],
  keep: Ingredient,
  drop: Ingredient,
  remap: Map<string, string>
): void {
  const aliases = new Set(keep.aliases)
  aliases.add(drop.name)
  for (const alias of drop.aliases) aliases.add(alias)
  keep.aliases = [...aliases].filter((alias) => {
    if (normalizeIngredientName(alias) === normalizeIngredientName(keep.name)) {
      return false
    }
    return !isBlockedAlias(keep, alias)
  })
  remap.set(drop.id, keep.id)
  const index = ingredients.findIndex((row) => row.id === drop.id)
  if (index >= 0) ingredients.splice(index, 1)
}

function follow(remap: Map<string, string>, id: string): string {
  let next = id
  const seen = new Set<string>()
  while (remap.has(next) && !seen.has(next)) {
    seen.add(next)
    next = remap.get(next) ?? next
  }
  return next
}

function synonymClusters(ingredients: Ingredient[]): Ingredient[][] {
  const buckets = new Map<string, Ingredient[]>()
  for (const ingredient of ingredients) {
    const key =
      synonymGroupKey(ingredient.name) ??
      ingredient.aliases.map((alias) => synonymGroupKey(alias)).find(Boolean)
    if (!key) continue
    const list = buckets.get(key) ?? []
    list.push(ingredient)
    buckets.set(key, list)
  }
  return [...buckets.values()].filter((group) => group.length > 1)
}

function applyMerges(
  ingredients: Ingredient[],
  inventory: InventoryItem[],
  pairs: Array<{ keepId: string; dropIds: string[] }>,
  remap: Map<string, string>
): void {
  for (const pair of pairs) {
    const keep = ingredients.find((row) => row.id === pair.keepId)
    if (!keep) continue
    for (const dropId of pair.dropIds) {
      if (dropId === keep.id) continue
      const drop = ingredients.find((row) => row.id === dropId)
      if (!drop) continue
      if (!mergeAllowed(keep.name, drop.name)) continue
      absorb(ingredients, keep, drop, remap)
    }
  }
  for (const group of synonymClusters(ingredients)) {
    const keep = pickKeeper(group, inventory)
    for (const drop of group) {
      if (drop.id === keep.id) continue
      if (!mergeAllowed(keep.name, drop.name)) continue
      absorb(ingredients, keep, drop, remap)
    }
  }
}

function applyAdviceFields(
  ingredients: Ingredient[],
  advice: AiCleanupAdvice | null | undefined
): void {
  if (!advice) return
  const byId = new Map(ingredients.map((row) => [row.id, row]))
  for (const row of advice.families) {
    const ingredient = byId.get(row.id)
    const family = row.family.trim()
    if (!ingredient || !family || family.length > 8) continue
    if (ingredient.family?.trim()) continue
    ingredient.family = family
  }
  for (const row of advice.units) {
    const ingredient = byId.get(row.id)
    if (!ingredient) continue
    for (const key of ["defaultUnit", "purchaseUnit"] as const) {
      const next = row[key]?.trim()
      if (!next || !MARKET_UNITS.includes(next)) continue
      if (ingredient[key] !== "把" || next === "把") continue
      ingredient[key] = next
    }
  }
  for (const row of advice.removeAliases) {
    const ingredient = byId.get(row.id)
    if (!ingredient) continue
    const blocked = new Set(
      row.aliases.map((alias) => normalizeIngredientName(alias))
    )
    ingredient.aliases = ingredient.aliases.filter(
      (alias) => !blocked.has(normalizeIngredientName(alias))
    )
  }
}

function remapStores(stores: CleanupStores, remap: Map<string, string>): void {
  if (remap.size === 0) return
  const names = new Map(stores.ingredients.map((row) => [row.id, row.name]))
  for (const row of stores.inventory) {
    row.ingredientId = follow(remap, row.ingredientId)
  }
  for (const row of stores.recipeItems) {
    if (row.ingredientId) row.ingredientId = follow(remap, row.ingredientId)
    if (row.substitution?.substituteIngredientId) {
      row.substitution = {
        ...row.substitution,
        substituteIngredientId: follow(
          remap,
          row.substitution.substituteIngredientId
        ),
      }
    }
  }
  for (const row of stores.shoppingItems) {
    if (!row.ingredientId) continue
    const nextId = follow(remap, row.ingredientId)
    if (nextId !== row.ingredientId) {
      row.ingredientId = nextId
      const name = names.get(nextId)
      if (name) row.name = name
    }
  }
}

function snapshot(stores: CleanupStores): string {
  return JSON.stringify(stores)
}

export function cleanupIngredientData(
  input: CleanupStores,
  advice?: AiCleanupAdvice | null
): CleanupResult {
  const before = snapshot(input)
  const stores = cloneStores(input)
  const remap = new Map<string, string>()
  applyMerges(stores.ingredients, stores.inventory, advice?.merges ?? [], remap)
  stores.ingredients = stores.ingredients.map((row) => asIngredient(row))
  applyAdviceFields(stores.ingredients, advice)
  stores.ingredients = stores.ingredients.map((row) => asIngredient(row))
  remapStores(stores, remap)
  const removedIds = [...remap.keys()]
  return {
    stores,
    removedIds,
    changed: snapshot(stores) !== before,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => String(entry).trim()).filter(Boolean)
}

export function parseCleanupAdvice(
  raw: unknown,
  ingredients: Array<Pick<Ingredient, "id">>
): AiCleanupAdvice | null {
  const record = asRecord(raw)
  if (!record) return null
  const known = new Set(ingredients.map((row) => row.id))
  const merges = Array.isArray(record.merges)
    ? record.merges.flatMap((entry) => {
        const row = asRecord(entry)
        const keepId = String(row?.keepId ?? "").trim()
        const dropIds = readIdList(row?.dropIds).filter(
          (id) => id !== keepId && known.has(id)
        )
        if (!known.has(keepId) || dropIds.length === 0) return []
        return [{ keepId, dropIds }]
      })
    : []
  const families = Array.isArray(record.families)
    ? record.families.flatMap((entry) => {
        const row = asRecord(entry)
        const id = String(row?.id ?? "").trim()
        const family = String(row?.family ?? "").trim()
        if (!known.has(id) || !family) return []
        return [{ id, family }]
      })
    : []
  const units = Array.isArray(record.units)
    ? record.units.flatMap((entry) => {
        const row = asRecord(entry)
        const id = String(row?.id ?? "").trim()
        if (!known.has(id)) return []
        const defaultUnit = String(row?.defaultUnit ?? "").trim()
        const purchaseUnit = String(row?.purchaseUnit ?? "").trim()
        return [
          {
            id,
            defaultUnit: defaultUnit || undefined,
            purchaseUnit: purchaseUnit || undefined,
          },
        ]
      })
    : []
  const removeAliases = Array.isArray(record.removeAliases)
    ? record.removeAliases.flatMap((entry) => {
        const row = asRecord(entry)
        const id = String(row?.id ?? "").trim()
        const aliases = readIdList(row?.aliases)
        if (!known.has(id) || aliases.length === 0) return []
        return [{ id, aliases }]
      })
    : []
  if (
    merges.length === 0 &&
    families.length === 0 &&
    units.length === 0 &&
    removeAliases.length === 0
  ) {
    return null
  }
  return { merges, families, units, removeAliases }
}

export function ingredientCleanupFingerprint(
  ingredients: Array<
    Pick<
      Ingredient,
      | "id"
      | "name"
      | "aliases"
      | "family"
      | "defaultUnit"
      | "purchaseUnit"
      | "buyable"
    >
  >
): string {
  return ingredients
    .map((ingredient) =>
      [
        ingredient.id,
        ingredient.name,
        ingredient.aliases.join("|"),
        ingredient.family ?? "",
        ingredient.defaultUnit,
        ingredient.purchaseUnit ?? "",
        ingredient.buyable === false ? "0" : "1",
      ].join("~")
    )
    .sort()
    .join("\n")
}
