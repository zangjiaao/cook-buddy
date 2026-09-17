import { normalizePlanEntry, planEntryNeedsMigrate } from "@/lib/cook-complete"
import { bulkPut, countStore, getAll } from "@/lib/db/database"
import { addDays, formatISODate, nowIso } from "@/lib/dates"
import { buildShoppingFromPlan } from "@/lib/shopping-from-plan"
import type {
  Ingredient,
  InventoryItem,
  PlanEntry,
  Recipe,
  RecipeItem,
} from "@/lib/types"

const TODAY = () => formatISODate()

export async function migratePlanEntries(): Promise<number> {
  const entries = await getAll<PlanEntry>("plan_entries")
  const changed = entries.filter(planEntryNeedsMigrate)
  if (changed.length === 0) return 0
  await bulkPut(
    "plan_entries",
    entries.map((entry) => normalizePlanEntry(entry))
  )
  return changed.length
}

export async function ensureSeed(): Promise<boolean> {
  if ((await countStore("ingredients")) > 0) return false

  const today = TODAY()
  const timestamp = nowIso()

  const ingredients: Ingredient[] = [
    {
      id: "ing-pork",
      name: "五花肉",
      aliases: ["猪肉", "肥肉"],
      category: "meat",
      defaultUnit: "斤",
      stallHint: "meat",
      defaultShelfLifeDays: 4,
    },
    {
      id: "ing-bokchoy",
      name: "小白菜",
      aliases: ["青菜"],
      category: "veg",
      defaultUnit: "把",
      stallHint: "veg",
      defaultShelfLifeDays: 3,
    },
    {
      id: "ing-scallion",
      name: "小葱",
      aliases: ["青葱"],
      category: "veg",
      defaultUnit: "把",
      stallHint: "veg",
      defaultShelfLifeDays: 3,
    },
    {
      id: "ing-cilantro",
      name: "香菜",
      aliases: [],
      category: "veg",
      defaultUnit: "把",
      stallHint: "veg",
      defaultShelfLifeDays: 3,
    },
    {
      id: "ing-garlic",
      name: "蒜",
      aliases: ["大蒜", "蒜瓣"],
      category: "seasoning",
      defaultUnit: "头",
      stallHint: null,
      defaultShelfLifeDays: 21,
    },
    {
      id: "ing-soy",
      name: "生抽",
      aliases: ["酱油"],
      category: "seasoning",
      defaultUnit: "瓶",
      stallHint: null,
      defaultShelfLifeDays: 180,
    },
    {
      id: "ing-tofu",
      name: "豆腐",
      aliases: ["嫩豆腐"],
      category: "veg",
      defaultUnit: "盒",
      stallHint: "veg",
      defaultShelfLifeDays: 4,
    },
    {
      id: "ing-vermicelli",
      name: "粉丝",
      aliases: ["粉条"],
      category: "dry",
      defaultUnit: "把",
      stallHint: "dry",
      defaultShelfLifeDays: 180,
    },
  ]

  const inventory: InventoryItem[] = [
    {
      id: "inv-pork",
      ingredientId: "ing-pork",
      quantity: 1,
      unit: "斤",
      location: "fridge",
      purchasedAt: today,
      expiresAt: formatISODate(addDays(new Date(), 4)),
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
      expiresAt: formatISODate(addDays(new Date(), 1)),
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
      purchasedAt: formatISODate(addDays(new Date(), -5)),
      expiresAt: formatISODate(addDays(new Date(), -1)),
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
      expiresAt: formatISODate(addDays(new Date(), 20)),
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
      expiresAt: formatISODate(addDays(new Date(), 180)),
      notes: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]

  const recipes: Recipe[] = [
    {
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
    },
    {
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
    },
  ]

  const recipeItems: RecipeItem[] = [
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

  const plan: PlanEntry[] = [
    normalizePlanEntry({
      id: "plan-today",
      date: today,
      rangeKey: null,
      recipeId: "rec-stirfry",
      servings: 2,
      sortOrder: 0,
    }),
    normalizePlanEntry({
      id: "plan-tomorrow",
      date: formatISODate(addDays(new Date(), 1)),
      rangeKey: null,
      recipeId: "rec-soup",
      servings: 2,
      sortOrder: 0,
    }),
  ]

  const shopping = buildShoppingFromPlan(
    {
      planEntries: plan,
      recipes,
      recipeItems,
      ingredients,
      inventory,
      existing: [],
    },
    (() => {
      let index = 0
      return () => `shop-seed-${++index}`
    })()
  )

  await bulkPut("ingredients", ingredients)
  await bulkPut("inventory_items", inventory)
  await bulkPut("recipes", recipes)
  await bulkPut("recipe_items", recipeItems)
  await bulkPut("plan_entries", plan)
  await bulkPut("shopping_items", shopping)
  return true
}
