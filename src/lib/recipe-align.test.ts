import { describe, expect, test, vi } from "vitest"
import { alignRecipeWithAi } from "@/lib/ai/align-recipe.server"
import { alignPayload } from "@/lib/ai/align-recipe"
import { compileCookDeduction, planCookDeduction } from "@/lib/cook-deduct-plan"
import {
  alignRecipeLines,
  ingredientUpdatesFromAlign,
  withLearnedConversion,
} from "@/lib/recipe-align"
import { buildShoppingFromPlan } from "@/lib/shopping-from-plan"
import type {
  Ingredient,
  InventoryItem,
  PlanEntry,
  Recipe,
  RecipeItem,
} from "@/lib/types"

function ingredient(
  partial: Partial<Ingredient> & Pick<Ingredient, "id" | "name">
): Ingredient {
  return {
    aliases: [],
    category: "meat",
    defaultUnit: "只",
    stallHint: "meat",
    defaultShelfLifeDays: 2,
    quantityMode: "amount",
    ...partial,
  }
}

function lot(
  partial: Pick<InventoryItem, "id" | "ingredientId" | "quantity" | "unit">
): InventoryItem {
  return {
    location: "fridge",
    purchasedAt: "2026-10-15",
    expiresAt: "2026-10-20",
    notes: "",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    ...partial,
  }
}

const hen = ingredient({
  id: "ing-hen",
  name: "大公鸡",
  catalogId: "cat-hen",
  defaultUnit: "只",
  purchaseUnit: "只",
})

const piece = ingredient({
  id: "ing-piece",
  name: "鸡块",
  catalogId: "cat-chicken-piece",
  defaultUnit: "g",
  purchaseUnit: "斤",
})

const drum = ingredient({
  id: "ing-drum",
  name: "鸡腿",
  catalogId: "cat-drum",
  defaultUnit: "g",
})

describe("菜谱用量对齐", () => {
  test("土鸡半只和鸡 750 克都对到家里的大公鸡，记成约 0.5 只", () => {
    const inventory = [
      lot({ id: "inv-hen", ingredientId: "ing-hen", quantity: 1, unit: "只" }),
    ]
    const [half] = alignRecipeLines({
      lines: [{ rawName: "土鸡", quantity: 1, unit: "半只" }],
      ingredients: [hen, piece, drum],
      inventory,
    })
    expect(half).toMatchObject({
      ingredientId: "ing-hen",
      catalogId: "cat-hen",
      name: "大公鸡",
      quantity: 0.5,
      unit: "只",
      approximate: false,
      confidence: "high",
      needsAi: false,
    })

    const [grams] = alignRecipeLines({
      lines: [{ rawName: "鸡", quantity: 750, unit: "g" }],
      ingredients: [hen, piece, drum],
      inventory,
    })
    expect(grams).toMatchObject({
      ingredientId: "ing-hen",
      name: "大公鸡",
      quantity: 0.5,
      unit: "只",
      approximate: true,
      confidence: "low",
      needsAi: false,
    })
    expect(grams?.sourceText).toContain("鸡")

    const [ke] = alignRecipeLines({
      lines: [{ rawName: "鸡", quantity: 750, unit: "克" }],
      ingredients: [hen],
      inventory,
    })
    expect(ke).toMatchObject({ quantity: 0.5, unit: "只", approximate: true })
  })

  test("记住的换算下次直接用，不再靠另一套比例", () => {
    const learned = withLearnedConversion(hen, "g", 0.4 / 750)
    const [line] = alignRecipeLines({
      lines: [{ rawName: "鸡", quantity: 750, unit: "g" }],
      ingredients: [learned],
      inventory: [
        lot({
          id: "inv-hen",
          ingredientId: "ing-hen",
          quantity: 1,
          unit: "只",
        }),
      ],
    })
    expect(line?.quantity).toBe(0.4)
    expect(line?.unit).toBe("只")
    expect(line?.needsAi).toBe(false)
  })

  test("用户改过的约数写回这种食材", () => {
    const [line] = alignRecipeLines({
      lines: [{ rawName: "鸡", quantity: 750, unit: "g" }],
      ingredients: [hen],
      inventory: [
        lot({
          id: "inv-hen",
          ingredientId: "ing-hen",
          quantity: 1,
          unit: "只",
        }),
      ],
    })
    const edited = { ...line!, quantity: 0.4, approximate: true }
    const [next] = ingredientUpdatesFromAlign([edited], [hen])
    expect(next?.conversions?.g).toBeCloseTo(0.4 / 750)
    expect(next?.approximateUnits).toContain("g")
  })

  test("做完扣 0.5 只后还剩 0.5 只，清单不再让买鸡", () => {
    const recipeItem: RecipeItem = {
      id: "ri-hen",
      recipeId: "rec-hen",
      ingredientId: "ing-hen",
      rawName: "土鸡",
      quantity: 0.5,
      unit: "只",
      matchStatus: "linked",
      sourceQuantity: 0.5,
      sourceUnit: "只",
      catalogId: "cat-hen",
    }
    const inventory = [
      lot({ id: "inv-hen", ingredientId: "ing-hen", quantity: 1, unit: "只" }),
    ]
    const lines = planCookDeduction({
      items: [recipeItem],
      ingredients: [hen],
      inventory,
      factor: 1,
    })
    expect(lines[0]).toMatchObject({ quantity: 0.5, unit: "只", stockQty: 1 })
    const compiled = compileCookDeduction({
      lines,
      inventory,
      ingredients: [hen],
    })
    expect(compiled.changes[0]).toMatchObject({
      inventoryItemId: "inv-hen",
      previousQuantity: 1,
      nextQuantity: 0.5,
    })

    const recipe: Recipe = {
      id: "rec-hen",
      name: "土鸡汤",
      servings: 2,
      approxMinutes: null,
      steps: [],
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
    }
    const plan: PlanEntry = {
      id: "plan-hen",
      recipeId: "rec-hen",
      date: "2026-10-16",
      rangeKey: null,
      servings: 2,
      sortOrder: 0,
      status: "planned",
      cookedAt: null,
      lastDeduct: null,
    }
    const shopping = buildShoppingFromPlan({
      planEntries: [plan],
      recipes: [recipe],
      recipeItems: [recipeItem],
      ingredients: [hen],
      inventory,
      existing: [],
    })
    expect(shopping.find((item) => item.name === "大公鸡")?.shortage).toBe(
      "enough"
    )
  })

  test("整鸡没有时，做完预览改扣同一份库存里的鸡块", () => {
    const lines = planCookDeduction({
      items: [
        {
          id: "ri-hen",
          recipeId: "rec-hen",
          ingredientId: "ing-hen",
          rawName: "土鸡",
          quantity: 0.5,
          unit: "只",
          matchStatus: "linked",
          catalogId: "cat-hen",
        },
      ],
      ingredients: [hen, piece, drum],
      inventory: [
        lot({
          id: "inv-piece",
          ingredientId: "ing-piece",
          quantity: 800,
          unit: "g",
        }),
        lot({
          id: "inv-drum",
          ingredientId: "ing-drum",
          quantity: 2,
          unit: "只",
        }),
      ],
      factor: 1,
    })
    expect(lines[0]?.stockQty).toBe(0)
    expect(lines[0]?.poolSubstitute).toMatchObject({
      ingredientId: "ing-piece",
      name: "鸡块",
      quantity: 750,
      unit: "g",
    })
    const [leg] = alignRecipeLines({
      lines: [{ rawName: "鸡腿", quantity: 2, unit: "只" }],
      ingredients: [hen, piece, drum],
      inventory: [
        lot({
          id: "inv-hen",
          ingredientId: "ing-hen",
          quantity: 1,
          unit: "只",
        }),
      ],
    })
    expect(leg?.ingredientId).toBe("ing-drum")
    expect(leg?.unit).toBe("g")
  })

  test("没有 AI 密钥时不请求模型", async () => {
    const fetchFn = vi.fn()
    const payload = alignPayload({
      lines: [{ rawName: "魔法粉", quantity: 1, unit: "勺" }],
      ingredients: [hen],
      inventory: [],
    })
    const lines = await alignRecipeWithAi(payload, { env: {}, fetchFn })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(lines[0]?.needsAi).toBe(true)
    expect(lines[0]?.name).toBe("魔法粉")
  })
})
