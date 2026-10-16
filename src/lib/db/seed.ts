import { migrateCatalogData } from "@/lib/catalog-migrate"
import type {
  MigratableIngredient,
  MigratableInventory,
  MigratablePlan,
  MigratableRecipeItem,
  MigratableShopping,
} from "@/lib/catalog-migrate"
import { normalizePlanEntry, planEntryNeedsMigrate } from "@/lib/cook-complete"
import { nowIso } from "@/lib/dates"
import { bulkPut, getAll, listRecordsIncludingDeleted } from "@/lib/db/database"
import {
  ingredientNeedsMigrate,
  normalizeIngredient,
} from "@/lib/ingredient-kind"
import { normalizeRecipe, recipeNeedsMigrate } from "@/lib/recipe-organize"
import { normalizeShoppingItem } from "@/lib/shopping-from-plan"
import type { Ingredient, PlanEntry, Recipe, ShoppingItem } from "@/lib/types"

export async function migratePlanEntries(): Promise<number> {
  const entries = await getAll<PlanEntry>("plan_entries")
  const changed = entries.filter(planEntryNeedsMigrate)
  if (changed.length === 0) return 0
  await bulkPut(
    "plan_entries",
    entries.map((entry) => {
      const next = normalizePlanEntry(entry)
      const updatedAt = (entry as { updatedAt?: unknown }).updatedAt
      return typeof updatedAt === "string" && updatedAt
        ? { ...next, updatedAt }
        : next
    })
  )
  return changed.length
}

export async function migrateIngredientMasterData(): Promise<number> {
  const ingredients = await getAll<Ingredient>("ingredients")
  const changed = ingredients.filter(ingredientNeedsMigrate)
  if (changed.length === 0) return 0
  await bulkPut("ingredients", ingredients.map(normalizeIngredient))
  return changed.length
}

export async function migrateShoppingSources(): Promise<number> {
  const items = await getAll<ShoppingItem>("shopping_items")
  const changed = items.filter((item) => item.source == null)
  if (changed.length === 0) return 0
  await bulkPut("shopping_items", items.map(normalizeShoppingItem))
  return changed.length
}

export async function migrateStoredCatalog(now = nowIso()): Promise<boolean> {
  const [ingredients, inventory, recipeItems, shopping, plan] =
    await Promise.all([
      listRecordsIncludingDeleted<MigratableIngredient>("ingredients"),
      listRecordsIncludingDeleted<MigratableInventory>("inventory_items"),
      listRecordsIncludingDeleted<MigratableRecipeItem>("recipe_items"),
      listRecordsIncludingDeleted<MigratableShopping>("shopping_items"),
      listRecordsIncludingDeleted<MigratablePlan>("plan_entries"),
    ])
  const result = migrateCatalogData({
    ingredients,
    inventory,
    recipeItems,
    shopping,
    plan,
    now,
  })
  if (!result.changed) return false
  await bulkPut("ingredients", result.ingredients)
  await bulkPut("inventory_items", result.inventory)
  await bulkPut("recipe_items", result.recipeItems)
  await bulkPut("shopping_items", result.shopping)
  await bulkPut("plan_entries", result.plan)
  return true
}

export async function migrateRecipes(): Promise<number> {
  const recipes = await getAll<Recipe>("recipes")
  const changed = recipes.filter(recipeNeedsMigrate)
  if (changed.length === 0) return 0
  await bulkPut("recipes", recipes.map(normalizeRecipe))
  return changed.length
}
