export const CATEGORIES = ["meat", "veg", "dry", "seasoning"] as const
export type Category = (typeof CATEGORIES)[number]

export const STALL_HINTS = ["meat", "veg", "dry"] as const
export type StallHint = (typeof STALL_HINTS)[number] | null

export const LOCATIONS = ["fridge", "freezer", "pantry"] as const
export type Location = (typeof LOCATIONS)[number]

export const INVENTORY_STATUSES = ["fresh", "soon", "expired"] as const
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number]

export const MATCH_STATUSES = ["linked", "fuzzy", "unlinked"] as const
export type MatchStatus = (typeof MATCH_STATUSES)[number]

export const SHOPPING_STATUSES = ["needed", "bought"] as const
export type ShoppingStatus = (typeof SHOPPING_STATUSES)[number]

export const SHORTAGE_STATES = ["enough", "short", "unsure"] as const
export type Shortage = (typeof SHORTAGE_STATES)[number]

export const PLAN_ENTRY_STATUSES = ["planned", "cooked"] as const
export type PlanEntryStatus = (typeof PLAN_ENTRY_STATUSES)[number]

export type Ingredient = {
  id: string
  name: string
  aliases: string[]
  category: Category
  defaultUnit: string
  stallHint: StallHint
  defaultShelfLifeDays: number | null
}

export type InventoryItem = {
  id: string
  ingredientId: string
  quantity: number
  unit: string
  location: Location
  purchasedAt: string
  expiresAt: string | null
  notes: string
  createdAt: string
  updatedAt: string
}

export type Recipe = {
  id: string
  name: string
  servings: number
  approxMinutes: number | null
  steps: string[]
  createdAt: string
  updatedAt: string
}

export type RecipeItem = {
  id: string
  recipeId: string
  ingredientId: string | null
  rawName: string
  quantity: number
  unit: string
  matchStatus: MatchStatus
}

export type PlanEntry = {
  id: string
  date: string
  rangeKey: string | null
  recipeId: string
  servings: number
  sortOrder: number
  status: PlanEntryStatus
  cookedAt: string | null
  lastDeduct: DeductSnapshot | null
}

export type ShoppingItem = {
  id: string
  ingredientId: string | null
  name: string
  quantityHint: string
  unit: string
  stallHint: StallHint
  status: ShoppingStatus
  shortage: Shortage
  fromPlanEntryIds: string[]
  checkedAt: string | null
  neededQty?: number | null
  stockQty?: number | null
  buyQty?: number | null
  contextHint?: string
}

export type DeductSnapshot = {
  at: string
  recipeId: string
  servings: number
  planEntryId: string
  changes: Array<{
    inventoryItemId: string
    previousQuantity: number
    nextQuantity: number
  }>
}

export type DeductOutcome =
  | { ok: true; snapshot: DeductSnapshot }
  | { ok: false; reason: "already_cooked" | "in_progress" | "missing_entry" }

export const STORE_NAMES = [
  "ingredients",
  "inventory_items",
  "recipes",
  "recipe_items",
  "plan_entries",
  "shopping_items",
] as const

export type StoreName = (typeof STORE_NAMES)[number]
