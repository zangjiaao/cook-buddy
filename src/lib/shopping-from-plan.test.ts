import { describe, expect, test } from "vitest"
import { normalizeIngredient } from "@/lib/ingredient-kind"
import {
  buildShoppingFromPlan,
  buyQuantity,
  decideShortage,
  formatQuantityHint,
  isFuzzyQuantity,
  shoppingContextHint,
  shoppingMatchKey,
  shoppingPrimaryText,
  shoppingQtyLabel,
  stallFromCategory,
} from "@/lib/shopping-from-plan"
import { groupShoppingForAisle, shoppingListSection } from "@/lib/shopping-list"
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

  test("单位不同时提示家里是哪种单位", () => {
    expect(
      shoppingContextHint({
        shortage: "unsure",
        needed: 3,
        stockQty: 0,
        unit: "瓣",
        ingredientId: "ing-garlic",
        fuzzy: false,
        otherUnits: ["头"],
      })
    ).toBe("有货，但单位是头不是瓣")
  })

  test("常备有货不当不够，也不用勺去买", () => {
    expect(
      decideShortage({
        ingredientId: "ing-soy",
        needed: 1,
        unit: "勺",
        stock: stock([{ ingredientId: "ing-soy", unit: "瓶", quantity: 1 }]),
        kind: "staple",
        purchaseUnit: "瓶",
      })
    ).toBe("enough")
    expect(
      decideShortage({
        ingredientId: "ing-oil",
        needed: 1,
        unit: "勺",
        stock: stock([]),
        kind: "staple",
        purchaseUnit: "瓶",
      })
    ).toBe("unsure")
  })

  test("库存只在购买单位、用量单位不同，也不按勺去买", () => {
    expect(
      decideShortage({
        ingredientId: "ing-soy",
        needed: 2,
        unit: "勺",
        stock: stock([{ ingredientId: "ing-soy", unit: "瓶", quantity: 1 }]),
        purchaseUnit: "瓶",
      })
    ).toBe("enough")
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

  test("少许/适量有货就算够，没货才不确定", () => {
    expect(isFuzzyQuantity(1, "适量")).toBe(true)
    expect(
      decideShortage({
        ingredientId: "ing-soy",
        needed: 1,
        unit: "少许",
        stock: stock([{ ingredientId: "ing-soy", unit: "瓶", quantity: 1 }]),
        kind: "staple",
        purchaseUnit: "瓶",
      })
    ).toBe("enough")
    expect(
      decideShortage({
        ingredientId: "ing-salt",
        needed: 1,
        unit: "适量",
        stock: stock([]),
        kind: "staple",
        purchaseUnit: "袋",
      })
    ).toBe("unsure")
    expect(
      decideShortage({
        ingredientId: "ing-salt",
        needed: 1,
        unit: "少许",
        stock: stock([{ ingredientId: "ing-salt", unit: "袋", quantity: 0 }]),
        kind: "staple",
        purchaseUnit: "袋",
      })
    ).toBe("unsure")
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
  return normalizeIngredient({
    aliases: [],
    defaultUnit:
      partial.defaultUnit ?? (partial.category === "seasoning" ? "瓶" : "个"),
    defaultShelfLifeDays: null,
    ...partial,
    stallHint: partial.stallHint ?? stallFromCategory(partial.category),
  })
}

function inventory(
  partial: Pick<InventoryItem, "ingredientId" | "quantity" | "unit"> &
    Partial<InventoryItem>
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
    defaultUnit: "头",
    purchaseUnit: "头",
    kind: "staple",
  })
  const soy = ingredient({
    id: "ing-soy",
    name: "生抽",
    category: "seasoning",
    defaultUnit: "瓶",
    purchaseUnit: "瓶",
    kind: "staple",
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
    expect(find("蒜")?.shortage).toBe("enough")
    expect(find("蒜")?.unit).toBe("头")
    expect(find("蒜")?.contextHint).toBe("家里有货（头），按需标记快没了")
    expect(find("生抽")?.shortage).toBe("enough")
    expect(find("生抽")?.unit).toBe("瓶")
    expect(find("生抽")?.quantityHint).toBe("0")
    expect(find("生抽")?.buyQty).toBe(0)
    expect(find("生抽")?.contextHint).toBe("家里有货（瓶），按需标记快没了")
    expect(find("生抽") && shoppingPrimaryText(find("生抽")!)).not.toContain(
      "勺"
    )
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
    expect(items[0] && shoppingQtyLabel(items[0])).toBe("2 把")
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

  test("拉长视窗后，更远日期的未做计划会进清单，已做的仍排除", () => {
    const farUncooked = plan({
      id: "p-far",
      date: "2026-09-22",
      recipeId: "rec-soup",
      servings: 2,
    })
    const farCooked = plan({
      id: "p-far-cooked",
      date: "2026-09-21",
      recipeId: "rec-stirfry",
      servings: 2,
      status: "cooked",
      cookedAt: "2026-09-16T12:00:00.000Z",
    })
    const items = buildShoppingFromPlan({
      planEntries: [farUncooked, farCooked],
      recipes: [recipe("rec-soup", 2), recipe("rec-stirfry", 2)],
      recipeItems: [
        recipeItem({
          recipeId: "rec-soup",
          ingredientId: "ing-tofu",
          rawName: "豆腐",
          quantity: 1,
          unit: "盒",
        }),
        recipeItem({
          recipeId: "rec-stirfry",
          ingredientId: "ing-pork",
          rawName: "五花肉",
          quantity: 0.4,
          unit: "斤",
        }),
      ],
      ingredients: [tofu, pork],
      inventory: [],
      existing: [],
    })

    expect(items.map((item) => item.name)).toEqual(["豆腐"])
    expect(items[0]?.fromPlanEntryIds).toEqual(["p-far"])
  })

  test("改食用料后，下次按计划重算会跟上", () => {
    const planned = plan({ id: "p1", recipeId: "rec-a", servings: 2 })
    const base = {
      planEntries: [planned],
      recipes: [recipe("rec-a", 2)],
      ingredients: [tofu, garlic],
      inventory: [] as InventoryItem[],
      existing: [] as ShoppingItem[],
    }

    const afterEdit = buildShoppingFromPlan({
      ...base,
      recipeItems: [
        recipeItem({
          recipeId: "rec-a",
          ingredientId: "ing-tofu",
          rawName: "豆腐",
          quantity: 2,
          unit: "盒",
        }),
        recipeItem({
          recipeId: "rec-a",
          ingredientId: "ing-garlic",
          rawName: "蒜",
          quantity: 3,
          unit: "瓣",
        }),
      ],
    })

    expect(
      afterEdit.map((item) => [item.name, item.neededQty, item.unit])
    ).toEqual([
      ["豆腐", 2, "盒"],
      ["蒜", null, "头"],
    ])

    const afterRemove = buildShoppingFromPlan({
      ...base,
      recipeItems: [
        recipeItem({
          recipeId: "rec-a",
          ingredientId: "ing-garlic",
          rawName: "蒜",
          quantity: 3,
          unit: "瓣",
        }),
      ],
    })
    expect(afterRemove.map((item) => item.name)).toEqual(["蒜"])
  })

  test("计划为空则丢掉计划行，但手加和快没了还在", () => {
    const items = buildShoppingFromPlan({
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
          source: "plan",
        }),
        existingItem({
          id: "shop-soy",
          ingredientId: "ing-soy",
          name: "生抽",
          unit: "瓶",
          quantityHint: "1",
          buyQty: 1,
          source: "running_low",
        }),
      ],
    })
    expect(items.map((item) => item.id)).toEqual(["shop-soy"])
    expect(items[0]?.source).toBe("running_low")
  })

  test("食盐已有一袋仍被标成不确定时，重算后从清单消失", () => {
    const saltId = "ing-3fd093b3"
    const salt = ingredient({
      id: saltId,
      name: "食盐",
      aliases: ["盐"],
      category: "seasoning",
      defaultUnit: "袋",
      purchaseUnit: "袋",
      kind: "staple",
    })
    const staleSalt = ingredient({
      id: "ing-ba20a836",
      name: "盐",
      category: "seasoning",
      defaultUnit: "袋",
      purchaseUnit: "袋",
      kind: "staple",
    })
    const pantryBag = inventory({
      ingredientId: saltId,
      quantity: 1,
      unit: "袋",
      location: "pantry",
      notes: "清单里记成家里有",
    })
    const staleUnsure = existingItem({
      id: "shop-salt",
      ingredientId: saltId,
      name: "食盐",
      unit: "袋",
      status: "needed",
      shortage: "unsure",
      neededQty: null,
      stockQty: 1,
      buyQty: null,
      quantityHint: "",
      source: "plan",
      contextHint: "常备（袋），按需标记快没了",
    })
    const items = buildShoppingFromPlan({
      planEntries: [
        plan({ id: "p-a", recipeId: "rec-a", servings: 2 }),
        plan({ id: "p-b", recipeId: "rec-b", servings: 2 }),
      ],
      recipes: [recipe("rec-a", 2), recipe("rec-b", 2)],
      recipeItems: [
        recipeItem({
          id: "ri-salt-a",
          recipeId: "rec-a",
          ingredientId: saltId,
          rawName: "盐",
          quantity: 1,
          unit: "少许",
          matchStatus: "linked",
        }),
        recipeItem({
          id: "ri-salt-b",
          recipeId: "rec-b",
          ingredientId: saltId,
          rawName: "盐",
          quantity: 1,
          unit: "适量",
          matchStatus: "linked",
        }),
      ],
      ingredients: [salt, staleSalt],
      inventory: [pantryBag],
      existing: [staleUnsure],
    })

    expect(items.some((item) => item.shortage === "unsure")).toBe(false)
    expect(items.find((item) => item.id === "shop-salt")).toMatchObject({
      name: "食盐",
      unit: "袋",
      ingredientId: saltId,
      shortage: "enough",
      stockQty: 1,
      source: "plan",
    })
    const visible = groupShoppingForAisle(items, [salt, staleSalt])
    expect(visible.unsure).toEqual([])
    expect(
      visible.buy.flatMap((group) => group.items).map((item) => item.name)
    ).not.toContain("食盐")
    expect(
      shoppingListSection(items.find((item) => item.id === "shop-salt")!)
    ).toBe("hidden")
  })

  test("食盐标了快没了时，有货仍留在要买里", () => {
    const saltId = "ing-3fd093b3"
    const salt = ingredient({
      id: saltId,
      name: "食盐",
      category: "seasoning",
      defaultUnit: "袋",
      purchaseUnit: "袋",
      kind: "staple",
    })
    const items = buildShoppingFromPlan({
      planEntries: [plan({ id: "p-a", recipeId: "rec-a", servings: 2 })],
      recipes: [recipe("rec-a", 2)],
      recipeItems: [
        recipeItem({
          recipeId: "rec-a",
          ingredientId: saltId,
          rawName: "盐",
          quantity: 1,
          unit: "少许",
          matchStatus: "linked",
        }),
      ],
      ingredients: [salt],
      inventory: [inventory({ ingredientId: saltId, quantity: 1, unit: "袋" })],
      existing: [
        existingItem({
          id: "shop-salt-low",
          ingredientId: saltId,
          name: "食盐",
          unit: "袋",
          quantityHint: "1",
          buyQty: 1,
          shortage: "short",
          source: "running_low",
        }),
      ],
    })
    expect(items.map((item) => item.id)).toEqual(["shop-salt-low"])
    expect(shoppingListSection(items[0]!)).toBe("buy")
  })

  test("常备有瓶装存货时，计划重算不会写出买 1 勺", () => {
    const items = buildShoppingFromPlan({
      planEntries: [plan({ id: "p1", recipeId: "rec-soup", servings: 2 })],
      recipes: [recipe("rec-soup", 2)],
      recipeItems: [
        recipeItem({
          recipeId: "rec-soup",
          ingredientId: "ing-soy",
          rawName: "生抽",
          quantity: 1,
          unit: "勺",
        }),
      ],
      ingredients: [
        ingredient({
          id: "ing-soy",
          name: "生抽",
          category: "seasoning",
          defaultUnit: "瓶",
          kind: "staple",
          purchaseUnit: "瓶",
        }),
      ],
      inventory: [
        inventory({ ingredientId: "ing-soy", quantity: 1, unit: "瓶" }),
      ],
      existing: [],
    })
    expect(items).toEqual([
      expect.objectContaining({
        name: "生抽",
        unit: "瓶",
        shortage: "enough",
        buyQty: 0,
        source: "plan",
      }),
    ])
    expect(items[0] && shoppingPrimaryText(items[0])).toBe("不用买")
    expect(items[0]?.contextHint).toBe("家里有货（瓶），按需标记快没了")
  })

  test("快没了的常备行在按计划重算后还在，不会被改成勺", () => {
    const items = buildShoppingFromPlan({
      planEntries: [plan({ id: "p1", recipeId: "rec-soup", servings: 2 })],
      recipes: [recipe("rec-soup", 2)],
      recipeItems: [
        recipeItem({
          recipeId: "rec-soup",
          ingredientId: "ing-soy",
          rawName: "生抽",
          quantity: 1,
          unit: "勺",
        }),
      ],
      ingredients: [
        ingredient({
          id: "ing-soy",
          name: "生抽",
          category: "seasoning",
          defaultUnit: "瓶",
          kind: "staple",
          purchaseUnit: "瓶",
        }),
      ],
      inventory: [
        inventory({ ingredientId: "ing-soy", quantity: 1, unit: "瓶" }),
      ],
      existing: [
        existingItem({
          id: "shop-soy",
          ingredientId: "ing-soy",
          name: "生抽",
          unit: "瓶",
          quantityHint: "1",
          buyQty: 1,
          shortage: "short",
          source: "running_low",
          contextHint: "快没了，补 1 瓶",
        }),
      ],
    })
    expect(items).toEqual([
      expect.objectContaining({
        id: "shop-soy",
        unit: "瓶",
        buyQty: 1,
        quantityHint: "1",
        shortage: "short",
        source: "running_low",
        fromPlanEntryIds: ["p1"],
      }),
    ])
    expect(items[0] && shoppingPrimaryText(items[0])).toBe("还差 1 瓶")
  })

  test("手加一味在计划不再需要该食材时也留着", () => {
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
          id: "shop-manual",
          ingredientId: "ing-pork",
          name: "五花肉",
          unit: "斤",
          source: "manual",
          buyQty: 1,
          quantityHint: "1",
        }),
      ],
    })
    expect(items.map((item) => [item.name, item.source])).toEqual([
      ["豆腐", "plan"],
      ["五花肉", "manual"],
    ])
  })

  test("重算保留要买判断和手改的购买数量，不改匹配用的单位", () => {
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
          presenceChoice: "buy",
          pickedQty: 3,
          pickedUnit: "盒",
        }),
      ],
    })

    expect(items[0]).toMatchObject({
      id: "shop-tofu",
      status: "bought",
      unit: "盒",
      presenceChoice: "buy",
      pickedQty: 3,
      pickedUnit: "盒",
      buyQty: 1,
    })
    expect(items[0] && shoppingPrimaryText(items[0])).toBe("买 3 盒")
    expect(items[0] && shoppingQtyLabel(items[0])).toBe("3 盒")
  })

  test("不确定点了有，重算后还记着", () => {
    const items = buildShoppingFromPlan({
      planEntries: [plan({ id: "p1", recipeId: "rec-a", servings: 2 })],
      recipes: [recipe("rec-a", 2)],
      recipeItems: [
        recipeItem({
          recipeId: "rec-a",
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
          shortage: "unsure",
          presenceChoice: "have",
        }),
      ],
    })
    expect(items[0]).toMatchObject({
      id: "shop-cilantro",
      shortage: "unsure",
      presenceChoice: "have",
    })
  })

  test("挂了基准库的食材把斤和克收成一行，换不了的单位单独标注", () => {
    const linked = ingredient({
      id: "ing-pork",
      name: "五花肉",
      category: "meat",
      catalogId: "cat-belly",
      defaultUnit: "g",
      purchaseUnit: "斤",
      quantityMode: "amount",
    })
    const items = buildShoppingFromPlan({
      planEntries: [
        plan({ id: "p1", recipeId: "rec-a", servings: 2 }),
        plan({ id: "p2", recipeId: "rec-b", servings: 2 }),
      ],
      recipes: [recipe("rec-a", 2), recipe("rec-b", 2)],
      recipeItems: [
        recipeItem({
          id: "ri-jin",
          recipeId: "rec-a",
          ingredientId: "ing-pork",
          rawName: "五花肉",
          quantity: 0.4,
          unit: "斤",
        }),
        recipeItem({
          id: "ri-g",
          recipeId: "rec-b",
          ingredientId: "ing-pork",
          rawName: "五花肉",
          quantity: 200,
          unit: "g",
        }),
        recipeItem({
          id: "ri-piece",
          recipeId: "rec-b",
          ingredientId: "ing-pork",
          rawName: "五花肉",
          quantity: 2,
          unit: "块",
        }),
      ],
      ingredients: [linked],
      inventory: [],
      existing: [],
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      unit: "g",
      neededQty: 400,
      buyQty: 400,
      catalogTracked: true,
      purchaseHint: "约 0.8 斤",
    })
    expect(items[0]?.contextHint).toContain("2 块")
    expect(items[0]?.contextHint).toContain("未能换算")
    expect(shoppingPrimaryText(items[0]!)).toBe("还差 400 g（约 0.8 斤）")
  })

  test("换不成记账单位时，采购单位的库存不算够", () => {
    const garlic = ingredient({
      id: "ing-garlic",
      name: "蒜",
      category: "seasoning",
      catalogId: "cat-garlic",
      defaultUnit: "头",
      purchaseUnit: "头",
      quantityMode: "amount",
    })
    const items = buildShoppingFromPlan({
      planEntries: [plan({ id: "p1", recipeId: "rec-a", servings: 2 })],
      recipes: [recipe("rec-a", 2)],
      recipeItems: [
        recipeItem({
          recipeId: "rec-a",
          ingredientId: "ing-garlic",
          rawName: "蒜",
          quantity: 3,
          unit: "瓣",
        }),
      ],
      ingredients: [garlic],
      inventory: [
        inventory({ ingredientId: "ing-garlic", quantity: 3, unit: "头" }),
      ],
      existing: [],
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      name: "蒜",
      unit: "瓣",
      shortage: "unsure",
      unitUnconverted: true,
    })
    expect(shoppingPrimaryText(items[0]!)).toBe("单位未换算")
  })
})
