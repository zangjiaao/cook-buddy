import { bulkPut, removeRecord } from "@/lib/db/database"
import { migrateStoredCatalog } from "@/lib/db/seed"
import { readAllStores, regenerateShoppingFromPlan } from "@/lib/db/repos"
import {
  createSampleDataset,
  missingSampleRecords,
  planSampleClearance,
  sampleClearanceCount,
  sampleRecordCount,
} from "@/lib/sample-data"
import type { SampleSnapshot } from "@/lib/sample-data"
import type {
  Ingredient,
  InventoryItem,
  PlanEntry,
  Recipe,
  RecipeItem,
  ShoppingItem,
} from "@/lib/types"

function snapshotFromStores(
  stores: Awaited<ReturnType<typeof readAllStores>>
): SampleSnapshot {
  return {
    ingredients: stores.ingredients as Ingredient[],
    inventory: stores.inventory_items as InventoryItem[],
    recipes: stores.recipes as Recipe[],
    recipeItems: stores.recipe_items as RecipeItem[],
    plan: stores.plan_entries as PlanEntry[],
    shopping: stores.shopping_items as ShoppingItem[],
  }
}

async function deleteIds(
  store: Parameters<typeof removeRecord>[0],
  ids: string[]
): Promise<void> {
  await Promise.all(ids.map((id) => removeRecord(store, id)))
}

export async function loadSampleData(now = new Date()): Promise<number> {
  const current = snapshotFromStores(await readAllStores())
  const missing = missingSampleRecords(current, createSampleDataset(now))
  const added = sampleRecordCount(missing)
  if (added === 0) return 0
  await bulkPut("ingredients", missing.ingredients)
  await bulkPut("inventory_items", missing.inventory)
  await bulkPut("recipes", missing.recipes)
  await bulkPut("recipe_items", missing.recipeItems)
  await bulkPut("plan_entries", missing.plan)
  await bulkPut("shopping_items", missing.shopping)
  await migrateStoredCatalog(now.toISOString())
  await regenerateShoppingFromPlan()
  return added
}

export async function clearUnmodifiedSampleData(): Promise<number> {
  const current = snapshotFromStores(await readAllStores())
  const clearance = planSampleClearance(current)
  const removed = sampleClearanceCount(clearance)
  if (removed === 0) return 0
  await deleteIds("recipe_items", clearance.recipeItemIds)
  await deleteIds("recipes", clearance.recipeIds)
  await deleteIds("inventory_items", clearance.inventoryIds)
  await deleteIds("plan_entries", clearance.planIds)
  await deleteIds("shopping_items", clearance.shoppingIds)
  await deleteIds("ingredients", clearance.ingredientIds)
  await regenerateShoppingFromPlan()
  return removed
}
