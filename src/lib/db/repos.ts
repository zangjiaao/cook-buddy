import {
  bulkPut,
  getAll,
  getById,
  getByIndex,
  putRecord,
  removeRecord,
} from "@/lib/db/database"
import { createId } from "@/lib/id"
import { nowIso } from "@/lib/dates"
import { findSameUnitStock, mergeCheckInQuantity } from "@/lib/check-in"
import type { CheckInDraft } from "@/lib/check-in"
import { buildShoppingFromPlan } from "@/lib/shopping-from-plan"
import { afterWriteAffectingShopping, shoppingRegen } from "@/lib/shopping-sync"
import type {
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
}

export const recipesRepo = {
  list: () => getAll<Recipe>("recipes"),
  get: (id: string) => getById<Recipe>("recipes", id),
  put: (value: Recipe) => putRecord("recipes", value),
  remove: (id: string) => removeRecord("recipes", id),
}

export const recipeItemsRepo = {
  list: () => getAll<RecipeItem>("recipe_items"),
  get: (id: string) => getById<RecipeItem>("recipe_items", id),
  byRecipe: (recipeId: string) =>
    getByIndex<RecipeItem>("recipe_items", "recipeId", recipeId),
  put: (value: RecipeItem) => putRecord("recipe_items", value),
  remove: (id: string) => removeRecord("recipe_items", id),
}

export const planRepo = {
  list: () => getAll<PlanEntry>("plan_entries"),
  get: (id: string) => getById<PlanEntry>("plan_entries", id),
  byDate: (date: string) => getByIndex<PlanEntry>("plan_entries", "date", date),
  put: (value: PlanEntry) =>
    afterWriteAffectingShopping(putRecord("plan_entries", value)),
  remove: (id: string) =>
    afterWriteAffectingShopping(removeRecord("plan_entries", id)),
}

export const shoppingRepo = {
  list: () => getAll<ShoppingItem>("shopping_items"),
  get: (id: string) => getById<ShoppingItem>("shopping_items", id),
  put: (value: ShoppingItem) => putRecord("shopping_items", value),
  remove: (id: string) => removeRecord("shopping_items", id),
}

export async function saveReviewedRecipe(input: {
  name: string
  servings: number
  approxMinutes: number | null
  steps: string[]
  items: Array<
    Pick<
      RecipeItem,
      "ingredientId" | "rawName" | "quantity" | "unit" | "matchStatus"
    >
  >
}): Promise<Recipe> {
  const timestamp = nowIso()
  const recipe: Recipe = {
    id: createId("rec"),
    name: input.name.trim() || "未命名食谱",
    servings: input.servings,
    approxMinutes: input.approxMinutes,
    steps: input.steps.filter((step) => step.trim().length > 0),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
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

export async function checkInBoughtItems(
  drafts: CheckInDraft[]
): Promise<InventoryItem[]> {
  const written: InventoryItem[] = []
  const timestamp = nowIso()
  const inventory = await inventoryRepo.list()

  for (const draft of drafts) {
    if (draft.quantity <= 0) continue
    const item = await shoppingRepo.get(draft.shoppingItemId)
    if (!item || item.status !== "bought") continue

    let ingredientId = draft.ingredientId
    if (!ingredientId) {
      const ingredient: Ingredient = {
        id: createId("ing"),
        name: draft.name,
        aliases: [],
        category: "veg",
        defaultUnit: draft.unit,
        stallHint: draft.stallHint,
        defaultShelfLifeDays: null,
      }
      await ingredientsRepo.put(ingredient)
      ingredientId = ingredient.id
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
      status: "needed",
      checkedAt: null,
    })
  }

  await shoppingRegen.flush()
  return written
}

export async function deductForCook(
  recipeId: string,
  servings: number
): Promise<DeductSnapshot> {
  const recipe = await recipesRepo.get(recipeId)
  const items = await recipeItemsRepo.byRecipe(recipeId)
  const factor = recipe && recipe.servings > 0 ? servings / recipe.servings : 1
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

  await shoppingRegen.flush()
  return {
    at: nowIso(),
    recipeId,
    servings,
    changes,
  }
}

export async function undoDeduct(snapshot: DeductSnapshot): Promise<void> {
  for (const change of snapshot.changes) {
    const item = await inventoryRepo.get(change.inventoryItemId)
    if (!item) continue
    await inventoryRepo.put({
      ...item,
      quantity: change.previousQuantity,
      updatedAt: nowIso(),
    })
  }
  await shoppingRegen.flush()
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
