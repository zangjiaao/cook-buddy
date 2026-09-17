import { withTypedAlias } from "@/lib/ai/match-ingredient"
import {
  findSameUnitStock,
  mergeCheckInQuantity,
  resolveCheckInIngredientId,
} from "@/lib/check-in"
import {
  backfillRecipeItems,
  backfillShoppingItems,
} from "@/lib/ingredient-resolve-apply"
import type { CheckInDraft } from "@/lib/check-in"
import {
  bulkPut,
  getAll,
  getById,
  getByIndex,
  putRecord,
  removeRecord,
} from "@/lib/db/database"
import {
  applyCookedState,
  canDeduct,
  canUndoDeduct,
  clearCookedState,
  isSameDeductSnapshot,
  normalizePlanEntry,
} from "@/lib/cook-complete"
import { createId } from "@/lib/id"
import { nowIso } from "@/lib/dates"
import { buildIngredient } from "@/lib/ingredient-record"
import {
  normalizeRecipeFields,
  recipeItemReplacement,
  shouldRegenShoppingForRecipe,
  type RecipeFieldsInput,
  type RecipeItemWrite,
} from "@/lib/recipe-draft-items"
import { categoryFromStall } from "@/lib/shelf-life"
import { buildShoppingFromPlan } from "@/lib/shopping-from-plan"
import { afterWriteAffectingShopping, shoppingRegen } from "@/lib/shopping-sync"
import type {
  DeductOutcome,
  DeductSnapshot,
  Ingredient,
  InventoryItem,
  PlanEntry,
  Recipe,
  RecipeItem,
  ShoppingItem,
} from "@/lib/types"

export const ingredientsRepo = {
  list: () => getAll<Ingredient>("ingredients"),
  get: (id: string) => getById<Ingredient>("ingredients", id),
  put: (value: Ingredient) => putRecord("ingredients", value),
  remove: (id: string) => removeRecord("ingredients", id),
}

export const inventoryRepo = {
  list: () => getAll<InventoryItem>("inventory_items"),
  get: (id: string) => getById<InventoryItem>("inventory_items", id),
  byIngredient: (ingredientId: string) =>
    getByIndex<InventoryItem>("inventory_items", "ingredientId", ingredientId),
  put: (value: InventoryItem) =>
    afterWriteAffectingShopping(putRecord("inventory_items", value)),
  remove: (id: string) =>
    afterWriteAffectingShopping(removeRecord("inventory_items", id)),
  removeMany: async (ids: string[]) => {
    if (ids.length === 0) return
    await afterWriteAffectingShopping(
      Promise.all(ids.map((id) => removeRecord("inventory_items", id)))
    )
  },
}

export const recipesRepo = {
  list: () => getAll<Recipe>("recipes"),
  get: (id: string) => getById<Recipe>("recipes", id),
  put: (value: Recipe) =>
    afterWriteAffectingShopping(putRecord("recipes", value)),
  remove: (id: string) =>
    afterWriteAffectingShopping(removeRecord("recipes", id)),
}

export const recipeItemsRepo = {
  list: () => getAll<RecipeItem>("recipe_items"),
  get: (id: string) => getById<RecipeItem>("recipe_items", id),
  byRecipe: (recipeId: string) =>
    getByIndex<RecipeItem>("recipe_items", "recipeId", recipeId),
  put: (value: RecipeItem) =>
    afterWriteAffectingShopping(putRecord("recipe_items", value)),
  remove: (id: string) =>
    afterWriteAffectingShopping(removeRecord("recipe_items", id)),
}

export const planRepo = {
  list: async () =>
    (await getAll<PlanEntry>("plan_entries")).map(normalizePlanEntry),
  get: async (id: string) => {
    const row = await getById<PlanEntry>("plan_entries", id)
    return row ? normalizePlanEntry(row) : undefined
  },
  byDate: async (date: string) =>
    (await getByIndex<PlanEntry>("plan_entries", "date", date)).map(
      normalizePlanEntry
    ),
  put: (value: PlanEntry) =>
    afterWriteAffectingShopping(
      putRecord("plan_entries", normalizePlanEntry(value))
    ),
  remove: (id: string) =>
    afterWriteAffectingShopping(removeRecord("plan_entries", id)),
}

export const shoppingRepo = {
  list: () => getAll<ShoppingItem>("shopping_items"),
  get: (id: string) => getById<ShoppingItem>("shopping_items", id),
  put: (value: ShoppingItem) => putRecord("shopping_items", value),
  remove: (id: string) => removeRecord("shopping_items", id),
}

type ReviewedRecipeInput = {
  name: string
  servings: string | number
  minutes?: string | number | null
  approxMinutes?: number | null
  steps: string | string[]
  items: RecipeItemWrite[]
}

function recipeFromFields(
  input: ReviewedRecipeInput,
  existing?: Recipe
): Recipe {
  const fields: RecipeFieldsInput = {
    name: input.name,
    servings: input.servings,
    minutes: input.minutes ?? input.approxMinutes,
    steps: input.steps,
  }
  const normalized = normalizeRecipeFields(fields)
  const timestamp = nowIso()
  return {
    id: existing?.id ?? createId("rec"),
    name: normalized.name,
    servings: normalized.servings,
    approxMinutes: normalized.approxMinutes,
    steps: normalized.steps,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
}

export async function saveReviewedRecipe(
  input: ReviewedRecipeInput
): Promise<Recipe> {
  const recipe = recipeFromFields(input)
  await recipesRepo.put(recipe)
  await Promise.all(
    input.items.map((item) =>
      recipeItemsRepo.put({
        id: createId("ri"),
        recipeId: recipe.id,
        ...item,
      })
    )
  )
  return recipe
}

export async function updateReviewedRecipe(
  recipeId: string,
  input: ReviewedRecipeInput
): Promise<Recipe> {
  const existing = await recipesRepo.get(recipeId)
  if (!existing) {
    throw new Error("食谱不在了")
  }
  const recipe = recipeFromFields(input, existing)
  const currentItems = await recipeItemsRepo.byRecipe(recipeId)
  const replacement = recipeItemReplacement(recipeId, currentItems, input.items)
  await recipesRepo.put(recipe)
  await Promise.all(
    replacement.removeIds.map((id) => recipeItemsRepo.remove(id))
  )
  await Promise.all(replacement.writes.map((item) => recipeItemsRepo.put(item)))
  const planEntries = await planRepo.list()
  if (shouldRegenShoppingForRecipe(recipeId, planEntries)) {
    await shoppingRegen.flush()
  }
  return recipe
}

export async function deleteRecipe(recipeId: string): Promise<void> {
  const [items, planEntries] = await Promise.all([
    recipeItemsRepo.byRecipe(recipeId),
    planRepo.list(),
  ])
  const onPlan = shouldRegenShoppingForRecipe(recipeId, planEntries)
  await Promise.all(items.map((item) => recipeItemsRepo.remove(item.id)))
  await recipesRepo.remove(recipeId)
  await Promise.all(
    planEntries
      .filter((entry) => entry.recipeId === recipeId)
      .map((entry) => planRepo.remove(entry.id))
  )
  if (onPlan) await shoppingRegen.flush()
}

export async function checkInBoughtItems(
  drafts: CheckInDraft[]
): Promise<InventoryItem[]> {
  const written: InventoryItem[] = []
  const timestamp = nowIso()
  const linkedIngredients: Ingredient[] = []
  const [inventory, ingredients] = await Promise.all([
    inventoryRepo.list(),
    ingredientsRepo.list(),
  ])

  for (const draft of drafts) {
    if (draft.quantity <= 0) continue
    const item = await shoppingRepo.get(draft.shoppingItemId)
    if (!item || item.status !== "bought") continue

    let ingredientId = resolveCheckInIngredientId(
      draft.name,
      draft.ingredientId,
      ingredients
    )
    if (!ingredientId) {
      const ingredient = buildIngredient({
        name: draft.name,
        category: categoryFromStall(draft.stallHint),
        defaultUnit: draft.unit,
        stallHint: draft.stallHint,
      })
      await ingredientsRepo.put(ingredient)
      ingredients.push(ingredient)
      linkedIngredients.push(ingredient)
      ingredientId = ingredient.id
    } else {
      const current = ingredients.find((row) => row.id === ingredientId)
      if (current) {
        const aliased = withTypedAlias(current, draft.name)
        if (aliased.aliases.length !== current.aliases.length) {
          await ingredientsRepo.put(aliased)
          const index = ingredients.findIndex((row) => row.id === current.id)
          if (index >= 0) ingredients[index] = aliased
          linkedIngredients.push(aliased)
        } else {
          linkedIngredients.push(current)
        }
      }
    }

    const existing = findSameUnitStock(inventory, ingredientId, draft.unit)
    const next = existing
      ? mergeCheckInQuantity(existing, draft.quantity, timestamp)
      : {
          id: createId("inv"),
          ingredientId,
          quantity: draft.quantity,
          unit: draft.unit,
          location: draft.location,
          purchasedAt: timestamp.slice(0, 10),
          expiresAt: draft.expiresAt,
          notes: "从购买清单入库",
          createdAt: timestamp,
          updatedAt: timestamp,
        }

    await inventoryRepo.put(next)
    const existingIndex = inventory.findIndex((row) => row.id === next.id)
    if (existingIndex >= 0) inventory[existingIndex] = next
    else inventory.push(next)
    written.push(next)

    await shoppingRepo.put({
      ...item,
      ingredientId,
      status: "needed",
      checkedAt: null,
    })
  }

  await backfillUnlinkedByIngredients(linkedIngredients)
  await shoppingRegen.flush()
  return written
}

export async function backfillUnlinkedByIngredients(
  updated: Ingredient[]
): Promise<void> {
  if (updated.length === 0) return
  const [recipeItems, shoppingItems] = await Promise.all([
    recipeItemsRepo.list(),
    shoppingRepo.list(),
  ])

  for (const ingredient of updated) {
    const nextRecipes = backfillRecipeItems(recipeItems, ingredient)
    for (const item of nextRecipes) {
      const prev = recipeItems.find((row) => row.id === item.id)
      if (!prev) continue
      if (
        prev.ingredientId !== item.ingredientId ||
        prev.matchStatus !== item.matchStatus
      ) {
        await recipeItemsRepo.put(item)
        const index = recipeItems.findIndex((row) => row.id === item.id)
        if (index >= 0) recipeItems[index] = item
      }
    }

    const nextShopping = backfillShoppingItems(shoppingItems, ingredient)
    for (const item of nextShopping) {
      const prev = shoppingItems.find((row) => row.id === item.id)
      if (!prev) continue
      if (prev.ingredientId !== item.ingredientId) {
        await shoppingRepo.put(item)
        const index = shoppingItems.findIndex((row) => row.id === item.id)
        if (index >= 0) shoppingItems[index] = item
      }
    }
  }
}

const cookLocks = new Set<string>()

export async function deductForCook(
  planEntryId: string
): Promise<DeductOutcome> {
  if (cookLocks.has(planEntryId)) {
    return { ok: false, reason: "in_progress" }
  }
  cookLocks.add(planEntryId)
  try {
    const entry = await planRepo.get(planEntryId)
    if (!entry) return { ok: false, reason: "missing_entry" }
    if (!canDeduct(entry)) return { ok: false, reason: "already_cooked" }

    const recipe = await recipesRepo.get(entry.recipeId)
    const items = await recipeItemsRepo.byRecipe(entry.recipeId)
    const factor =
      recipe && recipe.servings > 0 ? entry.servings / recipe.servings : 1
    const changes: DeductSnapshot["changes"] = []

    for (const item of items) {
      if (!item.ingredientId) continue
      const stock = await inventoryRepo.byIngredient(item.ingredientId)
      const sameUnit = stock.find(
        (row) => row.unit === item.unit && row.quantity > 0
      )
      if (!sameUnit) continue
      const need = item.quantity * factor
      const previousQuantity = sameUnit.quantity
      const nextQuantity = Math.max(
        0,
        Number((previousQuantity - need).toFixed(2))
      )
      await inventoryRepo.put({
        ...sameUnit,
        quantity: nextQuantity,
        updatedAt: nowIso(),
      })
      changes.push({
        inventoryItemId: sameUnit.id,
        previousQuantity,
        nextQuantity,
      })
    }

    const snapshot: DeductSnapshot = {
      at: nowIso(),
      recipeId: entry.recipeId,
      servings: entry.servings,
      planEntryId,
      changes,
    }
    await planRepo.put(applyCookedState(entry, snapshot))
    await shoppingRegen.flush()
    return { ok: true, snapshot }
  } finally {
    cookLocks.delete(planEntryId)
  }
}

export async function undoDeduct(snapshot: DeductSnapshot): Promise<boolean> {
  const entryId = snapshot.planEntryId
  if (entryId && cookLocks.has(entryId)) return false
  if (entryId) cookLocks.add(entryId)
  try {
    if (entryId) {
      const entry = await planRepo.get(entryId)
      if (!canUndoDeduct(entry, snapshot)) return false
      if (
        entry?.lastDeduct &&
        !isSameDeductSnapshot(entry.lastDeduct, snapshot)
      ) {
        return false
      }
    }

    for (const change of snapshot.changes) {
      const item = await inventoryRepo.get(change.inventoryItemId)
      if (!item) continue
      await inventoryRepo.put({
        ...item,
        quantity: change.previousQuantity,
        updatedAt: nowIso(),
      })
    }

    if (entryId) {
      const entry = await planRepo.get(entryId)
      if (entry) await planRepo.put(clearCookedState(entry))
    }
    await shoppingRegen.flush()
    return true
  } finally {
    if (entryId) cookLocks.delete(entryId)
  }
}

export async function replaceShopping(items: ShoppingItem[]): Promise<void> {
  const existing = await shoppingRepo.list()
  await Promise.all(existing.map((item) => shoppingRepo.remove(item.id)))
  await bulkPut("shopping_items", items)
}

export async function regenerateShoppingFromPlan(): Promise<ShoppingItem[]> {
  const [planEntries, recipes, recipeItems, ingredients, inventory, existing] =
    await Promise.all([
      planRepo.list(),
      recipesRepo.list(),
      recipeItemsRepo.list(),
      ingredientsRepo.list(),
      inventoryRepo.list(),
      shoppingRepo.list(),
    ])
  const items = buildShoppingFromPlan({
    planEntries,
    recipes,
    recipeItems,
    ingredients,
    inventory,
    existing,
  })
  await replaceShopping(items)
  return items
}

shoppingRegen.setRegenerate(regenerateShoppingFromPlan)
