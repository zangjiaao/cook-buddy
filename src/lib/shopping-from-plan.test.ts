import { describe, expect, test } from "vitest"
import {
  buildShoppingFromPlan,
  buyQuantity,
  decideShortage,
  formatQuantityHint,
  isFuzzyQuantity,
  shoppingMatchKey,
  shoppingPrimaryText,
  stallFromCategory,
} from "@/lib/shopping-from-plan"
import type {
  Ingredient,
  InventoryItem,
  PlanEntry,
  Recipe,
  RecipeItem,
  ShoppingItem,
} from "@/lib/types"

function stock(
  rows: Array<Pick<InventoryItem, "ingredientId" | "unit" | "quantity">>
) {
  return rows
}

describe("decideShortage", () => {
  test("同单位库存盖得住为够", () => {
    expect(
      decideShortage({
        ingredientId: "ing-pork",
        needed: 0.4,
        unit: "斤",
        stock: stock([{ ingredientId: "ing-pork", unit: "斤", quantity: 1 }]),
      })
    ).toBe("enough")
  })

  test("同单位库存不够为不够", () => {
    expect(
      decideShortage({
        ingredientId: "ing-tofu",
        needed: 2,
        unit: "盒",
        stock: stock([{ ingredientId: "ing-tofu", unit: "盒", quantity: 1 }]),
      })
    ).toBe("short")
  })

  test("没有库存、份量单位明确为不够", () => {
    expect(
      decideShortage({
        ingredientId: "ing-tofu",
        needed: 1,
        unit: "盒",
        stock: stock([]),
      })
    ).toBe("short")
  })

  test("同单位库存数量为 0 为不够", () => {
    expect(
      decideShortage({
        ingredientId: "ing-tofu",
        needed: 1,
        unit: "盒",
        stock: stock([{ ingredientId: "ing-tofu", unit: "盒", quantity: 0 }]),
      })
    ).toBe("short")
  })

  test("未对齐食材为不确定", () => {
    expect(
      decideShortage({
        ingredientId: null,
        needed: 1,
        unit: "把",
        stock: stock([]),
      })
    ).toBe("unsure")
  })

  test("只有不同单位的库存为不确定", () => {
    expect(
      decideShortage({
        ingredientId: "ing-garlic",
        needed: 3,
        unit: "瓣",
        stock: stock([{ ingredientId: "ing-garlic", unit: "头", quantity: 3 }]),
      })
    ).toBe("unsure")
  })

  test("少许/适量份量为不确定", () => {
    expect(
      decideShortage({
        ingredientId: "ing-soy",
        needed: 1,
        unit: "少许",
        stock: stock([{ ingredientId: "ing-soy", unit: "瓶", quantity: 1 }]),
      })
    ).toBe("unsure")
    expect(isFuzzyQuantity(1, "适量")).toBe(true)
  })

  test("同单位和不同单位并存时只看同单位", () => {
    expect(
      decideShortage({
        ingredientId: "ing-pork",
        needed: 1,
        unit: "斤",
        stock: stock([
          { ingredientId: "ing-pork", unit: "斤", quantity: 1 },
          { ingredientId: "ing-pork", unit: "克", quantity: 50 },
        ]),
      })
    ).toBe("enough")
    expect(
      decideShortage({
        ingredientId: "ing-pork",
        needed: 2,
        unit: "斤",
        stock: stock([
          { ingredientId: "ing-pork", unit: "斤", quantity: 1 },
          { ingredientId: "ing-pork", unit: "克", quantity: 500 },
        ]),
      })
    ).toBe("short")
  })

  test("多条同单位库存要加总", () => {
    expect(
      decideShortage({
        ingredientId: "ing-bokchoy",
        needed: 3,
        unit: "把",
        stock: stock([
          { ingredientId: "ing-bokchoy", unit: "把", quantity: 2 },
          { ingredientId: "ing-bokchoy", unit: "把", quantity: 1 },
        ]),
      })
    ).toBe("enough")
  })
})

describe("stallFromCategory", () => {
  test("肉菜干货入对应摊位，调味归其他", () => {
    expect(stallFromCategory("meat")).toBe("meat")
    expect(stallFromCategory("veg")).toBe("veg")
    expect(stallFromCategory("dry")).toBe("dry")
    expect(stallFromCategory("seasoning")).toBeNull()
  })
})

function ingredient(
  partial: Pick<Ingredient, "id" | "name" | "category"> & Partial<Ingredient>
): Ingredient {
  return {
    aliases: [],
    defaultUnit: "个",
    defaultShelfLifeDays: null,
    ...partial,
    stallHint:
      partial.stallHint ??
      (partial.category === "seasoning" ? null : partial.category),
  }
}

function inventory(
  partial: Pick<InventoryItem, "ingredientId" | "quantity" | "unit">
): InventoryItem {
  return {
    id: `inv-${partial.ingredientId}-${partial.unit}`,
    location: "fridge",
    purchasedAt: "2026-09-16",
    expiresAt: null,
    notes: "",
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    ...partial,
  }
}

function recipe(id: string, servings = 2): Recipe {
  return {
    id,
    name: id,
    servings,
    approxMinutes: 15,
    steps: [],
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
  }
}

function recipeItem(
  partial: Pick<RecipeItem, "recipeId" | "rawName" | "quantity" | "unit"> &
    Partial<RecipeItem>
): RecipeItem {
  return {
    id: `ri-${partial.rawName}`,
    ingredientId: null,
    matchStatus: partial.ingredientId ? "linked" : "unlinked",
    ...partial,
  }
}

function plan(
  partial: Pick<PlanEntry, "id" | "recipeId" | "servings"> & Partial<PlanEntry>
): PlanEntry {
  return {
    date: "2026-09-16",
    rangeKey: null,
    sortOrder: 0,
    status: "planned",
    cookedAt: null,
    lastDeduct: null,
    ...partial,
  }
}

function existingItem(
  partial: Partial<ShoppingItem> & Pick<ShoppingItem, "id" | "name" | "unit">
): ShoppingItem {
  return {
    ingredientId: null,
    quantityHint: "1",
    stallHint: null,
    status: "needed",
    shortage: "short",
    fromPlanEntryIds: [],
    checkedAt: null,
    ...partial,
  }
}

describe("buildShoppingFromPlan", () => {
  const pork = ingredient({
    id: "ing-pork",
    name: "五花肉",
    category: "meat",
  })
  const tofu = ingredient({
    id: "ing-tofu",
    name: "豆腐",
    category: "veg",
  })
  const garlic = ingredient({
    id: "ing-garlic",
    name: "蒜",
    category: "seasoning",
  })
  const soy = ingredient({
    id: "ing-soy",
    name: "生抽",
    category: "seasoning",
  })

  test("按计划份数相对食谱默认份数缩放，并按食材+单位合并", () => {
    const items = buildShoppingFromPlan({
      planEntries: [
        plan({ id: "p1", recipeId: "rec-a", servings: 4 }),
        plan({ id: "p2", recipeId: "rec-b", servings: 2 }),
      ],
      recipes: [recipe("rec-a", 2), recipe("rec-b", 2)],
      recipeItems: [
        recipeItem({
          recipeId: "rec-a",
          ingredientId: "ing-pork",
          rawName: "五花肉",
          quantity: 0.4,
          unit: "斤",
        }),
        recipeItem({
          recipeId: "rec-b",
          ingredientId: "ing-pork",
          rawName: "五花肉",
          quantity: 0.2,
          unit: "斤",
        }),
      ],
      ingredients: [pork],
      inventory: [],
      existing: [],
    })

    expect(items).toHaveLength(1)
    expect(items[0]?.quantityHint).toBe(formatQuantityHint(0.4 * 2 + 0.2))
    expect(items[0]?.fromPlanEntryIds).toEqual(["p1", "p2"])
    expect(items[0]?.shortage).toBe("short")
    expect(items[0]?.stallHint).toBe("meat")
  })

  test("示例闭环：同单位够、零库存不够、错单位不确定", () => {
    const items = buildShoppingFromPlan({
      planEntries: [
        plan({ id: "plan-today", recipeId: "rec-stirfry", servings: 2 }),
        plan({ id: "plan-tomorrow", recipeId: "rec-soup", servings: 2 }),
      ],
      recipes: [recipe("rec-stirfry", 2), recipe("rec-soup", 2)],
      recipeItems: [
        recipeItem({
          id: "ri-pork",
          recipeId: "rec-stirfry",
          ingredientId: "ing-pork",
          rawName: "五花肉",
          quantity: 0.4,
          unit: "斤",
        }),
        recipeItem({
          id: "ri-garlic",
          recipeId: "rec-stirfry",
          ingredientId: "ing-garlic",
          rawName: "蒜",
          quantity: 3,
          unit: "瓣",
        }),
        recipeItem({
          id: "ri-tofu",
          recipeId: "rec-soup",
          ingredientId: "ing-tofu",
          rawName: "豆腐",
          quantity: 1,
          unit: "盒",
        }),
        recipeItem({
          id: "ri-soy",
          recipeId: "rec-soup",
          ingredientId: "ing-soy",
          rawName: "生抽",
          quantity: 1,
          unit: "勺",
        }),
      ],
      ingredients: [pork, tofu, garlic, soy],
      inventory: [
        inventory({ ingredientId: "ing-pork", quantity: 1, unit: "斤" }),
        inventory({ ingredientId: "ing-garlic", quantity: 3, unit: "头" }),
        inventory({ ingredientId: "ing-soy", quantity: 1, unit: "瓶" }),
      ],
      existing: [],
    })

    const find = (name: string) => items.find((item) => item.name === name)
    expect(find("五花肉")?.shortage).toBe("enough")
    expect(find("豆腐")?.shortage).toBe("short")
    expect(find("蒜")?.shortage).toBe("unsure")
    expect(find("生抽")?.shortage).toBe("unsure")
    expect(find("生抽")?.quantityHint).toBe("")
    expect(find("生抽")?.buyQty).toBeNull()
    expect(find("五花肉")?.quantityHint).toBe("0")
    expect(find("五花肉")?.buyQty).toBe(0)
    expect(find("豆腐")?.quantityHint).toBe("1")
    expect(find("豆腐")?.buyQty).toBe(1)
  })

  test("清单数量是差额：家里有 2、计划要 4，还差 2", () => {
    const items = buildShoppingFromPlan({
      planEntries: [plan({ id: "p1", recipeId: "rec-a", servings: 4 })],
      recipes: [recipe("rec-a", 2)],
      recipeItems: [
        recipeItem({
          recipeId: "rec-a",
          ingredientId: "ing-bokchoy",
          rawName: "小白菜",
          quantity: 2,
          unit: "把",
        }),
      ],
      ingredients: [
        ingredient({ id: "ing-bokchoy", name: "小白菜", category: "veg" }),
      ],
      inventory: [
        inventory({ ingredientId: "ing-bokchoy", quantity: 2, unit: "把" }),
      ],
      existing: [],
    })

    expect(buyQuantity(4, 2)).toBe(2)
    expect(items[0]).toMatchObject({
      name: "小白菜",
      shortage: "short",
      neededQty: 4,
      stockQty: 2,
      buyQty: 2,
      quantityHint: "2",
    })
    expect(items[0] && shoppingPrimaryText(items[0])).toBe("还差 2 把")
    expect(items[0]?.contextHint).toBe("计划要 4 把，家里有 2 把")
  })

  test("仍需要的同一食材+单位保留已买勾选", () => {
    const items = buildShoppingFromPlan({
      planEntries: [plan({ id: "p1", recipeId: "rec-soup", servings: 2 })],
      recipes: [recipe("rec-soup", 2)],
      recipeItems: [
        recipeItem({
          recipeId: "rec-soup",
          ingredientId: "ing-tofu",
          rawName: "豆腐",
          quantity: 1,
          unit: "盒",
        }),
      ],
      ingredients: [tofu],
      inventory: [],
      existing: [
        existingItem({
          id: "shop-tofu",
          ingredientId: "ing-tofu",
          name: "豆腐",
          unit: "盒",
          status: "bought",
          checkedAt: "2026-09-16T08:00:00.000Z",
        }),
      ],
    })

    expect(items).toEqual([
      expect.objectContaining({
        id: "shop-tofu",
        status: "bought",
        checkedAt: "2026-09-16T08:00:00.000Z",
        shortage: "short",
        quantityHint: "1",
      }),
    ])
  })

  test("计划里不再需要的勾选行会被丢掉", () => {
    const items = buildShoppingFromPlan({
      planEntries: [plan({ id: "p1", recipeId: "rec-soup", servings: 2 })],
      recipes: [recipe("rec-soup", 2)],
      recipeItems: [
        recipeItem({
          recipeId: "rec-soup",
          ingredientId: "ing-tofu",
          rawName: "豆腐",
          quantity: 1,
          unit: "盒",
        }),
      ],
      ingredients: [tofu],
      inventory: [],
      existing: [
        existingItem({
          id: "shop-old",
          ingredientId: "ing-pork",
          name: "五花肉",
          unit: "斤",
          status: "bought",
          checkedAt: "2026-09-16T08:00:00.000Z",
        }),
      ],
    })

    expect(items.map((item) => item.name)).toEqual(["豆腐"])
    expect(items[0]?.status).toBe("needed")
  })

  test("未对齐食材按名称+单位合并，并标不确定", () => {
    const items = buildShoppingFromPlan({
      planEntries: [
        plan({ id: "p1", recipeId: "rec-a", servings: 2 }),
        plan({ id: "p2", recipeId: "rec-b", servings: 2 }),
      ],
      recipes: [recipe("rec-a", 2), recipe("rec-b", 2)],
      recipeItems: [
        recipeItem({
          id: "ri-1",
          recipeId: "rec-a",
          rawName: "香菜",
          quantity: 1,
          unit: "把",
        }),
        recipeItem({
          id: "ri-2",
          recipeId: "rec-b",
          rawName: "香菜",
          quantity: 1,
          unit: "把",
        }),
      ],
      ingredients: [],
      inventory: [],
      existing: [
        existingItem({
          id: "shop-cilantro",
          name: "香菜",
          unit: "把",
          status: "bought",
          checkedAt: "2026-09-16T09:00:00.000Z",
        }),
      ],
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: "shop-cilantro",
      ingredientId: null,
      quantityHint: "",
      buyQty: null,
      shortage: "unsure",
      status: "bought",
      stallHint: null,
    })
    expect(items[0] && shoppingMatchKey(items[0])).toBe("name:香菜::把")
  })

  test("已做的计划不进清单，撤销后会回来", () => {
    const cooked = plan({
      id: "p1",
      recipeId: "rec-soup",
      servings: 2,
      status: "cooked",
      cookedAt: "2026-09-16T12:00:00.000Z",
    })
    const input = {
      recipes: [recipe("rec-soup", 2)],
      recipeItems: [
        recipeItem({
          recipeId: "rec-soup",
          ingredientId: "ing-tofu",
          rawName: "豆腐",
          quantity: 1,
          unit: "盒",
        }),
      ],
      ingredients: [tofu],
      inventory: [],
      existing: [],
    }

    expect(
      buildShoppingFromPlan({
        ...input,
        planEntries: [cooked],
      })
    ).toEqual([])

    expect(
      buildShoppingFromPlan({
        ...input,
        planEntries: [
          {
            ...cooked,
            status: "planned",
            cookedAt: null,
            lastDeduct: null,
          },
        ],
      }).map((item) => item.name)
    ).toEqual(["豆腐"])
  })

  test("计划为空则清单为空", () => {
    expect(
      buildShoppingFromPlan({
        planEntries: [],
        recipes: [recipe("rec-a", 2)],
        recipeItems: [
          recipeItem({
            recipeId: "rec-a",
            ingredientId: "ing-tofu",
            rawName: "豆腐",
            quantity: 1,
            unit: "盒",
          }),
        ],
        ingredients: [tofu],
        inventory: [],
        existing: [
          existingItem({
            id: "shop-tofu",
            ingredientId: "ing-tofu",
            name: "豆腐",
            unit: "盒",
          }),
        ],
      })
    ).toEqual([])
  })
})
