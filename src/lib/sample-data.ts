import { normalizePlanEntry } from "@/lib/cook-complete"
import { addDays, formatISODate, parseISODate } from "@/lib/dates"
import { normalizeIngredient } from "@/lib/ingredient-kind"
import { normalizeRecipe } from "@/lib/recipe-organize"
import {
  buildShoppingFromPlan,
  isProtectedShoppingSource,
} from "@/lib/shopping-from-plan"
import type {
  Ingredient,
  InventoryItem,
  PlanEntry,
  Recipe,
  RecipeItem,
  ShoppingItem,
} from "@/lib/types"

export type SampleSnapshot = {
  ingredients: Ingredient[]
  inventory: InventoryItem[]
  recipes: Recipe[]
  recipeItems: RecipeItem[]
  plan: PlanEntry[]
  shopping: ShoppingItem[]
}

export type SampleClearance = {
  ingredientIds: string[]
  inventoryIds: string[]
  recipeIds: string[]
  recipeItemIds: string[]
  planIds: string[]
  shoppingIds: string[]
}

const INVENTORY_DAY_OFFSET: Record<
  string,
  { purchased: number; expires: number }
> = {
  "inv-pork": { purchased: 0, expires: 4 },
  "inv-bokchoy": { purchased: 0, expires: 1 },
  "inv-cilantro": { purchased: -5, expires: -1 },
  "inv-garlic": { purchased: 0, expires: 20 },
  "inv-soy": { purchased: 0, expires: 180 },
}

const PLAN_DAY_OFFSET: Record<string, number> = {
  "plan-today": 0,
  "plan-tomorrow": 1,
}

function shiftDay(day: string, days: number): string {
  return formatISODate(addDays(parseISODate(day), days))
}

function localDay(iso: string): string | null {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return null
  return formatISODate(new Date(time))
}

function sameList(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
) {
  const a = left ?? []
  const b = right ?? []
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function marked<T extends object>(value: T): T & { sample: true } {
  return { ...value, sample: true }
}

export function createSampleDataset(now = new Date()): SampleSnapshot {
  const today = formatISODate(now)
  const timestamp = now.toISOString()
  const ingredientRows: Ingredient[] = [
    {
      id: "ing-pork",
      name: "五花肉",
      aliases: ["肥肉"],
      category: "meat",
      defaultUnit: "斤",
      stallHint: "meat",
      defaultShelfLifeDays: 4,
      kind: "fresh",
      purchaseUnit: "斤",
      family: "猪肉",
    },
    {
      id: "ing-bokchoy",
      name: "小白菜",
      aliases: ["青菜"],
      category: "veg",
      defaultUnit: "把",
      stallHint: "veg",
      defaultShelfLifeDays: 3,
      kind: "fresh",
      purchaseUnit: "把",
    },
    {
      id: "ing-scallion",
      name: "小葱",
      aliases: ["青葱"],
      category: "veg",
      defaultUnit: "把",
      stallHint: "veg",
      defaultShelfLifeDays: 3,
      kind: "fresh",
      purchaseUnit: "把",
    },
    {
      id: "ing-cilantro",
      name: "香菜",
      aliases: [],
      category: "veg",
      defaultUnit: "把",
      stallHint: "veg",
      defaultShelfLifeDays: 3,
      kind: "fresh",
      purchaseUnit: "把",
    },
    {
      id: "ing-garlic",
      name: "蒜",
      aliases: ["大蒜", "蒜瓣"],
      category: "seasoning",
      defaultUnit: "头",
      stallHint: null,
      defaultShelfLifeDays: 21,
      kind: "staple",
      purchaseUnit: "头",
    },
    {
      id: "ing-soy",
      name: "生抽",
      aliases: ["酱油"],
      category: "seasoning",
      defaultUnit: "瓶",
      stallHint: null,
      defaultShelfLifeDays: 180,
      kind: "staple",
      purchaseUnit: "瓶",
    },
    {
      id: "ing-tofu",
      name: "豆腐",
      aliases: ["嫩豆腐"],
      category: "veg",
      defaultUnit: "盒",
      stallHint: "veg",
      defaultShelfLifeDays: 4,
      kind: "fresh",
      purchaseUnit: "盒",
    },
    {
      id: "ing-vermicelli",
      name: "粉丝",
      aliases: ["粉条"],
      category: "dry",
      defaultUnit: "把",
      stallHint: "dry",
      defaultShelfLifeDays: 180,
      kind: "fresh",
      purchaseUnit: "把",
    },
  ]
  const ingredients = ingredientRows.map((ingredient) =>
    marked(normalizeIngredient(ingredient))
  )

  const inventoryRows: InventoryItem[] = [
    {
      id: "inv-pork",
      ingredientId: "ing-pork",
      quantity: 1,
      unit: "斤",
      location: "fridge",
      purchasedAt: today,
      expiresAt: shiftDay(today, 4),
      notes: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "inv-bokchoy",
      ingredientId: "ing-bokchoy",
      quantity: 2,
      unit: "把",
      location: "fridge",
      purchasedAt: today,
      expiresAt: shiftDay(today, 1),
      notes: "优先消化",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "inv-cilantro",
      ingredientId: "ing-cilantro",
      quantity: 1,
      unit: "把",
      location: "fridge",
      purchasedAt: shiftDay(today, -5),
      expiresAt: shiftDay(today, -1),
      notes: "已经黄了",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "inv-garlic",
      ingredientId: "ing-garlic",
      quantity: 3,
      unit: "头",
      location: "pantry",
      purchasedAt: today,
      expiresAt: shiftDay(today, 20),
      notes: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "inv-soy",
      ingredientId: "ing-soy",
      quantity: 1,
      unit: "瓶",
      location: "pantry",
      purchasedAt: today,
      expiresAt: shiftDay(today, 180),
      notes: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]
  const inventory = inventoryRows.map((item) => marked(item))

  const recipes = [
    normalizeRecipe({
      id: "rec-stirfry",
      name: "小白菜炒肉",
      servings: 2,
      approxMinutes: 20,
      steps: [
        "五花肉切片，加一勺生抽腌 10 分钟。",
        "热锅下肉片炒出油。",
        "下蒜末和小白菜，大火炒到菜帮变软。",
        "补一勺生抽，起锅。",
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
      favorited: true,
      favoritedAt: timestamp,
      tags: ["hun"],
    }),
    normalizeRecipe({
      id: "rec-soup",
      name: "豆腐粉丝汤",
      servings: 2,
      approxMinutes: 15,
      steps: [
        "粉丝用温水泡软。",
        "锅里烧开水，下豆腐块煮 3 分钟。",
        "下粉丝再煮 2 分钟，加盐和生抽。",
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
      favorited: false,
      favoritedAt: null,
      tags: ["su", "tang"],
    }),
  ].map((recipe) => marked(recipe))

  const recipeItemRows: RecipeItem[] = [
    {
      id: "ri-stirfry-pork",
      recipeId: "rec-stirfry",
      ingredientId: "ing-pork",
      rawName: "五花肉",
      quantity: 0.4,
      unit: "斤",
      matchStatus: "linked",
    },
    {
      id: "ri-stirfry-bokchoy",
      recipeId: "rec-stirfry",
      ingredientId: "ing-bokchoy",
      rawName: "小白菜",
      quantity: 1,
      unit: "把",
      matchStatus: "linked",
    },
    {
      id: "ri-stirfry-garlic",
      recipeId: "rec-stirfry",
      ingredientId: "ing-garlic",
      rawName: "蒜",
      quantity: 3,
      unit: "瓣",
      matchStatus: "fuzzy",
    },
    {
      id: "ri-stirfry-soy",
      recipeId: "rec-stirfry",
      ingredientId: "ing-soy",
      rawName: "生抽",
      quantity: 2,
      unit: "勺",
      matchStatus: "fuzzy",
    },
    {
      id: "ri-soup-tofu",
      recipeId: "rec-soup",
      ingredientId: "ing-tofu",
      rawName: "豆腐",
      quantity: 1,
      unit: "盒",
      matchStatus: "linked",
    },
    {
      id: "ri-soup-vermicelli",
      recipeId: "rec-soup",
      ingredientId: "ing-vermicelli",
      rawName: "粉丝",
      quantity: 1,
      unit: "把",
      matchStatus: "linked",
    },
    {
      id: "ri-soup-soy",
      recipeId: "rec-soup",
      ingredientId: "ing-soy",
      rawName: "生抽",
      quantity: 1,
      unit: "勺",
      matchStatus: "fuzzy",
    },
  ]
  const recipeItems = recipeItemRows.map((item) => marked(item))

  const plan = [
    marked(
      normalizePlanEntry({
        id: "plan-today",
        date: today,
        rangeKey: null,
        recipeId: "rec-stirfry",
        servings: 2,
        sortOrder: 0,
      })
    ),
    marked(
      normalizePlanEntry({
        id: "plan-tomorrow",
        date: shiftDay(today, 1),
        rangeKey: null,
        recipeId: "rec-soup",
        servings: 2,
        sortOrder: 0,
      })
    ),
  ]

  let shopIndex = 0
  const shopping = buildShoppingFromPlan(
    {
      planEntries: plan,
      recipes,
      recipeItems,
      ingredients,
      inventory,
      existing: [],
    },
    () => `shop-seed-${++shopIndex}`
  ).map((item) => marked(item))

  return { ingredients, inventory, recipes, recipeItems, plan, shopping }
}

export function emptySampleSnapshot(): SampleSnapshot {
  return {
    ingredients: [],
    inventory: [],
    recipes: [],
    recipeItems: [],
    plan: [],
    shopping: [],
  }
}

function idsOf(rows: Array<{ id: string }>): Set<string> {
  return new Set(rows.map((row) => row.id))
}

export function missingSampleRecords(
  current: SampleSnapshot,
  dataset = createSampleDataset()
): SampleSnapshot {
  const have = {
    ingredients: idsOf(current.ingredients),
    inventory: idsOf(current.inventory),
    recipes: idsOf(current.recipes),
    recipeItems: idsOf(current.recipeItems),
    plan: idsOf(current.plan),
    shopping: idsOf(current.shopping),
  }
  return {
    ingredients: dataset.ingredients.filter(
      (row) => !have.ingredients.has(row.id)
    ),
    inventory: dataset.inventory.filter((row) => !have.inventory.has(row.id)),
    recipes: dataset.recipes.filter((row) => !have.recipes.has(row.id)),
    recipeItems: dataset.recipeItems.filter(
      (row) => !have.recipeItems.has(row.id)
    ),
    plan: dataset.plan.filter((row) => !have.plan.has(row.id)),
    shopping: dataset.shopping.filter((row) => !have.shopping.has(row.id)),
  }
}

export function sampleRecordCount(snapshot: SampleSnapshot): number {
  return (
    snapshot.ingredients.length +
    snapshot.inventory.length +
    snapshot.recipes.length +
    snapshot.recipeItems.length +
    snapshot.plan.length +
    snapshot.shopping.length
  )
}

function sameIngredient(left: Ingredient, right: Ingredient): boolean {
  const a = normalizeIngredient(left)
  const b = normalizeIngredient(right)
  return (
    a.name === b.name &&
    sameList(a.aliases, b.aliases) &&
    a.category === b.category &&
    a.defaultUnit === b.defaultUnit &&
    a.stallHint === b.stallHint &&
    a.defaultShelfLifeDays === b.defaultShelfLifeDays &&
    a.kind === b.kind &&
    a.purchaseUnit === b.purchaseUnit &&
    (a.family ?? "") === (b.family ?? "") &&
    (a.buyable !== false) === (b.buyable !== false)
  )
}

function sameRecipe(left: Recipe, right: Recipe): boolean {
  const a = normalizeRecipe(left)
  const b = normalizeRecipe(right)
  return (
    a.name === b.name &&
    a.servings === b.servings &&
    (a.approxMinutes ?? null) === (b.approxMinutes ?? null) &&
    sameList(a.steps, b.steps) &&
    sameList(a.stepTips, b.stepTips) &&
    Boolean(a.favorited) === Boolean(b.favorited) &&
    sameList(a.tags, b.tags)
  )
}

function sameRecipeItem(left: RecipeItem, right: RecipeItem): boolean {
  return (
    left.recipeId === right.recipeId &&
    left.ingredientId === right.ingredientId &&
    left.rawName === right.rawName &&
    left.quantity === right.quantity &&
    left.unit === right.unit &&
    left.matchStatus === right.matchStatus &&
    (left.substitution ?? null) === (right.substitution ?? null)
  )
}

function inventoryUntouched(
  item: InventoryItem,
  template: InventoryItem
): boolean {
  if (
    item.ingredientId !== template.ingredientId ||
    item.quantity !== template.quantity ||
    item.unit !== template.unit ||
    item.location !== template.location ||
    item.notes !== template.notes
  ) {
    return false
  }
  const anchor = localDay(item.createdAt)
  if (!anchor || !Object.hasOwn(INVENTORY_DAY_OFFSET, item.id)) return true
  const offsets = INVENTORY_DAY_OFFSET[item.id]
  return (
    item.purchasedAt === shiftDay(anchor, offsets.purchased) &&
    item.expiresAt === shiftDay(anchor, offsets.expires)
  )
}

function planUntouched(
  entry: PlanEntry,
  template: PlanEntry,
  anchor: string | null
): boolean {
  if (
    entry.recipeId !== template.recipeId ||
    entry.servings !== template.servings ||
    entry.sortOrder !== template.sortOrder ||
    (entry.rangeKey ?? null) !== (template.rangeKey ?? null) ||
    entry.status !== "planned" ||
    entry.cookedAt != null ||
    entry.lastDeduct != null
  ) {
    return false
  }
  if (!anchor || !Object.hasOwn(PLAN_DAY_OFFSET, entry.id)) return true
  return entry.date === shiftDay(anchor, PLAN_DAY_OFFSET[entry.id])
}

function sampleAnchor(current: SampleSnapshot): string | null {
  const preferred =
    current.inventory.find((item) => item.id === "inv-pork") ??
    current.inventory.find((item) => item.id in INVENTORY_DAY_OFFSET)
  return preferred ? localDay(preferred.createdAt) : null
}

function recipeKept(
  recipeId: string,
  current: SampleSnapshot,
  dataset: SampleSnapshot
): boolean {
  const template = dataset.recipes.find((recipe) => recipe.id === recipeId)
  const recipe = current.recipes.find((row) => row.id === recipeId)
  if (!template || !recipe) return true
  if (!sameRecipe(recipe, template)) return true
  const currentItems = current.recipeItems.filter(
    (item) => item.recipeId === recipeId
  )
  const templateItems = dataset.recipeItems.filter(
    (item) => item.recipeId === recipeId
  )
  if (currentItems.length !== templateItems.length) return true
  return templateItems.some((templateItem) => {
    const found = currentItems.find((item) => item.id === templateItem.id)
    return !found || !sameRecipeItem(found, templateItem)
  })
}

function shoppingClearsWithPlan(
  item: ShoppingItem,
  deletedPlanIds: Set<string>
): boolean {
  if (isProtectedShoppingSource(item.source) || item.status === "bought") {
    return false
  }
  const fromPlan = item.fromPlanEntryIds
  if (fromPlan.length > 0) {
    return fromPlan.every((id) => deletedPlanIds.has(id))
  }
  return item.id.startsWith("shop-seed-")
}

export function planSampleClearance(
  current: SampleSnapshot,
  dataset = createSampleDataset()
): SampleClearance {
  const keptRecipes = new Set(
    dataset.recipes
      .map((recipe) => recipe.id)
      .filter((id) => recipeKept(id, current, dataset))
  )
  const recipeIds = dataset.recipes
    .map((recipe) => recipe.id)
    .filter(
      (id) =>
        current.recipes.some((recipe) => recipe.id === id) &&
        !keptRecipes.has(id)
    )
  const deletedRecipes = new Set(recipeIds)
  const recipeItemIds = current.recipeItems
    .filter((item) => deletedRecipes.has(item.recipeId))
    .map((item) => item.id)

  const inventoryByTemplate = new Map(
    dataset.inventory.map((item) => [item.id, item])
  )
  const inventoryIds = current.inventory
    .filter((item) => {
      const template = inventoryByTemplate.get(item.id)
      return template ? inventoryUntouched(item, template) : false
    })
    .map((item) => item.id)

  const anchor = sampleAnchor(current)
  const planByTemplate = new Map(dataset.plan.map((entry) => [entry.id, entry]))
  const planIds = current.plan
    .filter((entry) => {
      const template = planByTemplate.get(entry.id)
      return template ? planUntouched(entry, template, anchor) : false
    })
    .map((entry) => entry.id)
  const deletedPlans = new Set(planIds)
  const shoppingIds = current.shopping
    .filter((item) => shoppingClearsWithPlan(item, deletedPlans))
    .map((item) => item.id)

  const deletedItems = new Set(recipeItemIds)
  const deletedInventory = new Set(inventoryIds)
  const deletedShopping = new Set(shoppingIds)
  const referenced = new Set<string>()
  for (const item of current.recipeItems) {
    if (!deletedItems.has(item.id) && item.ingredientId) {
      referenced.add(item.ingredientId)
    }
  }
  for (const item of current.inventory) {
    if (!deletedInventory.has(item.id)) referenced.add(item.ingredientId)
  }
  for (const item of current.shopping) {
    if (!deletedShopping.has(item.id) && item.ingredientId) {
      referenced.add(item.ingredientId)
    }
  }

  const ingredientByTemplate = new Map(
    dataset.ingredients.map((ingredient) => [ingredient.id, ingredient])
  )
  const ingredientIds = current.ingredients
    .filter((ingredient) => {
      const template = ingredientByTemplate.get(ingredient.id)
      if (!template || referenced.has(ingredient.id)) return false
      return sameIngredient(ingredient, template)
    })
    .map((ingredient) => ingredient.id)

  return {
    ingredientIds,
    inventoryIds,
    recipeIds,
    recipeItemIds,
    planIds,
    shoppingIds,
  }
}

/** Live, unmodified sample rows. Sync must not upload these; tombstones still go up. */
export function unmodifiedSampleIds(current: SampleSnapshot): Set<string> {
  const clearance = planSampleClearance(current)
  return new Set([
    ...clearance.ingredientIds,
    ...clearance.inventoryIds,
    ...clearance.recipeIds,
    ...clearance.recipeItemIds,
    ...clearance.planIds,
    ...clearance.shoppingIds,
  ])
}

export function sampleClearanceCount(clearance: SampleClearance): number {
  return (
    clearance.ingredientIds.length +
    clearance.inventoryIds.length +
    clearance.recipeIds.length +
    clearance.recipeItemIds.length +
    clearance.planIds.length +
    clearance.shoppingIds.length
  )
}
