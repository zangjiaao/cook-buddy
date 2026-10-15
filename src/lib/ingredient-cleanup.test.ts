import { readFileSync } from "node:fs"
import { describe, expect, test, vi } from "vitest"
import { suggestIngredientCleanupWithAi } from "@/lib/ai/ingredient-cleanup.server"
import { resolveIngredientsLocal } from "@/lib/ai/resolve-ingredients"
import { parseBackup } from "@/lib/backup"
import { planInventoryDeduction } from "@/lib/cook-deduct"
import {
  cleanupIngredientData,
  parseCleanupAdvice,
} from "@/lib/ingredient-cleanup"
import type { CleanupStores } from "@/lib/ingredient-cleanup"
import { applyRecipeSubstitution } from "@/lib/ingredient-substitution"
import {
  buildShoppingFromPlan,
  shoppingPrimaryText,
} from "@/lib/shopping-from-plan"
import type { Ingredient, InventoryItem, Recipe, RecipeItem } from "@/lib/types"

const BEEF = "ing-ab66cfbd-213f-4339-96d2-3cecb449ddc0"
const BRISKET = "ing-26ad0889-5bc2-42f3-904a-87832640c41b"
const BEEF_LINE = "ri-0d679656-e1c0-44a3-b1fe-faaf035312fd"
const NORI = "ing-df3e1822-b32b-4d17-b686-ef6a8c1fee1a"
const DRY_NORI = "ing-b5321dc8-6216-4c8c-a332-fd7aebfe15c4"
const TOMATO = "ing-42417bae-c1f2-467a-b889-df72aea7ba98"

function loadBackupStores(): CleanupStores {
  const raw = readFileSync(
    new URL("./fixtures/user-backup-2026-09-29.json", import.meta.url),
    "utf8"
  )
  const parsed = parseBackup(raw)
  if (!parsed.ok) throw new Error(parsed.reason)
  return {
    ingredients: parsed.backup.stores.ingredients as unknown as Ingredient[],
    inventory: parsed.backup.stores
      .inventory_items as unknown as InventoryItem[],
    recipeItems: parsed.backup.stores.recipe_items as unknown as RecipeItem[],
    shoppingItems: [],
  }
}

function stockSum(inventory: InventoryItem[]): number {
  return inventory.reduce((sum, row) => sum + row.quantity, 0)
}

describe("老备份整理", () => {
  test("同义词合并、大类、单位、别名，并且可以再跑一遍", () => {
    const original = loadBackupStores()
    const first = cleanupIngredientData(original)
    const second = cleanupIngredientData(first.stores)
    expect(second.changed).toBe(false)
    expect(second.stores).toEqual(first.stores)
    expect(stockSum(first.stores.inventory)).toBe(stockSum(original.inventory))

    const ids = new Set(first.stores.ingredients.map((row) => row.id))
    for (const row of first.stores.inventory) {
      expect(ids.has(row.ingredientId)).toBe(true)
    }
    for (const row of first.stores.recipeItems) {
      if (row.ingredientId) expect(ids.has(row.ingredientId)).toBe(true)
    }

    const pork = first.stores.ingredients.find((row) => row.id === "ing-pork")
    expect(pork?.aliases).not.toContain("猪肉")
    expect(pork?.aliases).toContain("肥肉")
    expect(pork?.family).toBe("猪肉")

    expect(ids.has(DRY_NORI)).toBe(false)
    const nori = first.stores.ingredients.find((row) => row.id === NORI)
    expect(nori?.aliases).toContain("干紫菜")
    const noriStock = first.stores.inventory.find(
      (row) => row.ingredientId === NORI
    )
    expect(noriStock).toMatchObject({ quantity: 1, unit: "瓶" })

    expect(
      first.stores.ingredients.find((row) => row.name === "水")?.buyable
    ).toBe(false)
    expect(
      first.stores.ingredients.find((row) => row.id === BRISKET)
    ).toMatchObject({
      defaultUnit: "斤",
      purchaseUnit: "斤",
      family: "牛肉",
    })
    expect(
      first.stores.ingredients.find((row) => row.name === "黑鱼")
    ).toMatchObject({ defaultUnit: "斤", purchaseUnit: "斤" })
    expect(
      first.stores.ingredients.find((row) => row.name === "西红柿")
    ).toMatchObject({ defaultUnit: "个", purchaseUnit: "个" })
    expect(
      first.stores.ingredients.find((row) => row.name === "洋葱")
    ).toMatchObject({ defaultUnit: "个", purchaseUnit: "个" })
    expect(
      first.stores.ingredients.find((row) => row.name === "盐")
    ).toMatchObject({ defaultUnit: "袋", purchaseUnit: "袋" })
    expect(
      first.stores.ingredients.find((row) => row.name === "老抽")
    ).toMatchObject({ defaultUnit: "瓶", purchaseUnit: "瓶" })
    expect(
      first.stores.ingredients.find((row) => row.id === BEEF)?.family
    ).toBe("牛肉")
  })

  test("AI 不能把牛腩并进牛肉，但可以合并番茄", () => {
    const advice = parseCleanupAdvice(
      {
        merges: [
          { keepId: BEEF, dropIds: [BRISKET] },
          { keepId: TOMATO, dropIds: ["ing-missing"] },
        ],
        families: [{ id: BEEF, family: "牛肉" }],
        units: [],
        removeAliases: [{ id: "ing-pork", aliases: ["猪肉"] }],
      },
      loadBackupStores().ingredients
    )
    const result = cleanupIngredientData(loadBackupStores(), advice)
    expect(result.stores.ingredients.some((row) => row.id === BRISKET)).toBe(
      true
    )
    expect(result.stores.ingredients.some((row) => row.id === BEEF)).toBe(true)

    const tomato: Ingredient = {
      id: "ing-tomato",
      name: "西红柿",
      aliases: [],
      category: "veg",
      defaultUnit: "把",
      stallHint: "veg",
      defaultShelfLifeDays: 3,
    }
    const fanqie: Ingredient = {
      id: "ing-fanqie",
      name: "番茄",
      aliases: [],
      category: "veg",
      defaultUnit: "个",
      stallHint: "veg",
      defaultShelfLifeDays: 3,
    }
    const merged = cleanupIngredientData(
      {
        ingredients: [tomato, fanqie],
        inventory: [
          {
            id: "inv-fanqie",
            ingredientId: "ing-fanqie",
            quantity: 2,
            unit: "个",
            location: "fridge",
            purchasedAt: "2026-09-29",
            expiresAt: null,
            notes: "",
            createdAt: "2026-09-29T00:00:00.000Z",
            updatedAt: "2026-09-29T00:00:00.000Z",
          },
        ],
        recipeItems: [
          {
            id: "ri-fanqie",
            recipeId: "rec-1",
            ingredientId: "ing-fanqie",
            rawName: "番茄",
            quantity: 1,
            unit: "个",
            matchStatus: "linked",
          },
        ],
        shoppingItems: [
          {
            id: "shop-fanqie",
            ingredientId: "ing-fanqie",
            name: "番茄",
            quantityHint: "1",
            unit: "个",
            stallHint: "veg",
            status: "needed",
            shortage: "short",
            fromPlanEntryIds: [],
            checkedAt: null,
          },
        ],
      },
      {
        merges: [{ keepId: "ing-tomato", dropIds: ["ing-fanqie"] }],
        families: [],
        units: [],
        removeAliases: [],
      }
    )
    expect(merged.stores.ingredients.map((row) => row.id)).toEqual([
      "ing-tomato",
    ])
    expect(merged.stores.ingredients[0]?.aliases).toContain("番茄")
    expect(merged.stores.inventory[0]).toMatchObject({
      ingredientId: "ing-tomato",
      quantity: 2,
    })
    expect(merged.stores.recipeItems[0]?.ingredientId).toBe("ing-tomato")
    expect(merged.stores.shoppingItems[0]).toMatchObject({
      ingredientId: "ing-tomato",
      name: "西红柿",
    })
  })
})

describe("辣椒炒牛肉的替代", () => {
  function prepared() {
    const cleaned = cleanupIngredientData(loadBackupStores()).stores
    const raw = readFileSync(
      new URL("./fixtures/user-backup-2026-09-29.json", import.meta.url),
      "utf8"
    )
    const parsed = parseBackup(raw)
    if (!parsed.ok) throw new Error(parsed.reason)
    const recipes = parsed.backup.stores.recipes as unknown as Recipe[]
    const plan = parsed.backup.stores.plan_entries
    return { cleaned, recipes, plan }
  }

  test("家里有牛腩时提示替代，水不在清单里", () => {
    const { cleaned, recipes, plan } = prepared()
    const items = buildShoppingFromPlan({
      planEntries: plan as never,
      recipes,
      recipeItems: cleaned.recipeItems,
      ingredients: cleaned.ingredients,
      inventory: cleaned.inventory,
      existing: [],
    })
    const beef = items.find((item) => item.name === "牛肉")
    expect(beef).toBeTruthy()
    expect(shoppingPrimaryText(beef!)).toContain("家里有牛腩")
    expect(shoppingPrimaryText(beef!)).toContain("可以替代")
    expect(shoppingPrimaryText(beef!)).not.toContain("还差")
    expect(beef?.substituteOffer?.candidates[0]?.name).toBe("牛腩")
    expect(beef?.substituteOffer?.candidates[0]).toMatchObject({
      quantity: 1,
      unit: "袋",
    })
    expect(items.some((item) => item.name === "水")).toBe(false)
  })

  test("用牛腩后清单去掉牛肉，做完扣的是牛腩", () => {
    const { cleaned, recipes, plan } = prepared()
    const before = buildShoppingFromPlan({
      planEntries: plan as never,
      recipes,
      recipeItems: cleaned.recipeItems,
      ingredients: cleaned.ingredients,
      inventory: cleaned.inventory,
      existing: [],
    })
    const offer = before.find((item) => item.name === "牛肉")?.substituteOffer
    expect(offer?.recipeItemIds).toContain(BEEF_LINE)
    const brisket = offer?.candidates.find((row) => row.name === "牛腩")
    expect(brisket).toBeTruthy()
    const recipeItems = applyRecipeSubstitution(
      cleaned.recipeItems,
      offer?.recipeItemIds ?? [],
      { choice: "use", substituteIngredientId: brisket!.ingredientId }
    )
    const after = buildShoppingFromPlan({
      planEntries: plan as never,
      recipes,
      recipeItems,
      ingredients: cleaned.ingredients,
      inventory: cleaned.inventory,
      existing: [],
    })
    expect(after.some((item) => item.name === "牛肉")).toBe(false)

    const changes = planInventoryDeduction({
      items: recipeItems.filter((item) => item.recipeId.includes("76c045f9")),
      inventory: cleaned.inventory,
      factor: 1,
    })
    const brisketChange = changes.find(
      (change) =>
        cleaned.inventory.find((row) => row.id === change.inventoryItemId)
          ?.ingredientId === BRISKET
    )
    expect(brisketChange).toMatchObject({
      previousQuantity: 1,
      nextQuantity: 0,
    })
    expect(
      changes.some(
        (change) =>
          cleaned.inventory.find((row) => row.id === change.inventoryItemId)
            ?.ingredientId === BEEF
      )
    ).toBe(false)
  })

  test("还是买之后这道菜不再提示", () => {
    const { cleaned, recipes, plan } = prepared()
    const recipeItems = applyRecipeSubstitution(
      cleaned.recipeItems,
      [BEEF_LINE],
      { choice: "buy", substituteIngredientId: BRISKET }
    )
    const items = buildShoppingFromPlan({
      planEntries: plan as never,
      recipes,
      recipeItems,
      ingredients: cleaned.ingredients,
      inventory: cleaned.inventory,
      existing: [],
    })
    const beef = items.find((item) => item.name === "牛肉")
    expect(beef?.substituteOffer).toBeUndefined()
    expect(shoppingPrimaryText(beef!)).toBe("还差 1 斤")
  })

  test("新录番茄会链接到已有西红柿", () => {
    const { cleaned } = prepared()
    const [result] = resolveIngredientsLocal({
      items: [{ rawName: "番茄" }],
      ingredients: cleaned.ingredients,
    })
    expect(result).toMatchObject({
      action: "link",
      ingredientId: TOMATO,
      source: "rule",
    })
  })
})

describe("大类替代方向", () => {
  test("菜谱要牛腩、家里只有牛肉时也提示", () => {
    const beef: Ingredient = {
      id: "ing-beef",
      name: "牛肉",
      aliases: [],
      category: "meat",
      defaultUnit: "斤",
      stallHint: "meat",
      defaultShelfLifeDays: 3,
      family: "牛肉",
      kind: "fresh",
      purchaseUnit: "斤",
    }
    const brisket: Ingredient = {
      ...beef,
      id: "ing-brisket",
      name: "牛腩",
    }
    const recipe: Recipe = {
      id: "rec-1",
      name: "红烧牛腩",
      servings: 2,
      approxMinutes: 60,
      steps: ["炖"],
      createdAt: "2026-09-29T00:00:00.000Z",
      updatedAt: "2026-09-29T00:00:00.000Z",
    }
    const items = buildShoppingFromPlan({
      planEntries: [
        {
          id: "plan-1",
          date: "2026-09-29",
          rangeKey: null,
          recipeId: "rec-1",
          servings: 2,
          sortOrder: 0,
          status: "planned",
          cookedAt: null,
          lastDeduct: null,
        },
      ],
      recipes: [recipe],
      recipeItems: [
        {
          id: "ri-1",
          recipeId: "rec-1",
          ingredientId: "ing-brisket",
          rawName: "牛腩",
          quantity: 1,
          unit: "斤",
          matchStatus: "linked",
        },
      ],
      ingredients: [beef, brisket],
      inventory: [
        {
          id: "inv-beef",
          ingredientId: "ing-beef",
          quantity: 1,
          unit: "斤",
          location: "fridge",
          purchasedAt: "2026-09-29",
          expiresAt: null,
          notes: "",
          createdAt: "2026-09-29T00:00:00.000Z",
          updatedAt: "2026-09-29T00:00:00.000Z",
        },
      ],
      existing: [],
    })
    expect(shoppingPrimaryText(items[0])).toBe("家里有牛肉 1 斤，可以替代")
  })
})

describe("没有 API key", () => {
  test("整理建议不请求网络", async () => {
    const fetchFn = vi.fn()
    const result = await suggestIngredientCleanupWithAi(
      loadBackupStores().ingredients,
      { env: {}, fetchFn: fetchFn as typeof fetch }
    )
    expect(result).toEqual({ enabled: false, advice: null })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
