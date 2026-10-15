import {
  cleanupIngredientData,
  ingredientCleanupFingerprint,
} from "@/lib/ingredient-cleanup"
import type { AiCleanupAdvice } from "@/lib/ingredient-cleanup"
import { bulkPut, getAll, removeRecord } from "@/lib/db/database"
import type {
  Ingredient,
  InventoryItem,
  RecipeItem,
  ShoppingItem,
} from "@/lib/types"

const FINGERPRINT_KEY = "cookbuddy.ingredient-cleanup.ai"

export type CleanupSuggest = (ingredients: Ingredient[]) => Promise<{
  enabled: boolean
  advice: AiCleanupAdvice | null
}>

function fingerprintStorage(): Storage | null {
  if (typeof localStorage === "undefined") return null
  return localStorage
}

export async function runStoredIngredientCleanup(options?: {
  suggest?: CleanupSuggest
}): Promise<boolean> {
  const [ingredients, inventory, recipeItems, shoppingItems] =
    await Promise.all([
      getAll<Ingredient>("ingredients"),
      getAll<InventoryItem>("inventory_items"),
      getAll<RecipeItem>("recipe_items"),
      getAll<ShoppingItem>("shopping_items"),
    ])

  let advice: AiCleanupAdvice | null = null
  let aiSettled = false
  const storage = fingerprintStorage()
  const ruledPreview = cleanupIngredientData({
    ingredients,
    inventory,
    recipeItems,
    shoppingItems,
  })
  const seen = storage?.getItem(FINGERPRINT_KEY)
  const previewFingerprint = ingredientCleanupFingerprint(
    ruledPreview.stores.ingredients
  )
  if (options?.suggest && seen !== previewFingerprint) {
    try {
      const suggested = await options.suggest(ruledPreview.stores.ingredients)
      if (suggested.enabled) {
        advice = suggested.advice
        aiSettled = true
      }
    } catch {
      advice = null
    }
  }

  const result = cleanupIngredientData(
    { ingredients, inventory, recipeItems, shoppingItems },
    advice
  )
  if (aiSettled) {
    storage?.setItem(
      FINGERPRINT_KEY,
      ingredientCleanupFingerprint(result.stores.ingredients)
    )
  }
  if (!result.changed) return false

  const live = new Set(result.stores.ingredients.map((row) => row.id))
  await bulkPut("ingredients", result.stores.ingredients)
  await bulkPut("inventory_items", result.stores.inventory)
  await bulkPut("recipe_items", result.stores.recipeItems)
  await bulkPut("shopping_items", result.stores.shoppingItems)
  await Promise.all(
    result.removedIds
      .filter((id) => !live.has(id))
      .map((id) => removeRecord("ingredients", id))
  )
  return true
}

export function clearIngredientCleanupFingerprint(): void {
  fingerprintStorage()?.removeItem(FINGERPRINT_KEY)
}
