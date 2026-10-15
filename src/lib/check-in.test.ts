import { describe, expect, test } from "vitest"
import {
  applyCheckInStock,
  defaultCheckInPlacement,
  defaultCheckInQuantity,
  defaultCheckInUnit,
  draftsFromEdits,
  findSameUnitStock,
  mergeCheckInQuantity,
  parseCheckInQuantity,
  resolveCheckInIngredientId,
  suggestedCheckInExpiresAt,
  validateCheckInEdits,
} from "@/lib/check-in"
import type { Ingredient, InventoryItem, ShoppingItem } from "@/lib/types"

function shopping(
  partial: Partial<ShoppingItem> & Pick<ShoppingItem, "id" | "name">
): ShoppingItem {
  return {
    ingredientId: "ing-bokchoy",
    quantityHint: "2",
    unit: "把",
    stallHint: "veg",
    status: "bought",
    shortage: "short",
    fromPlanEntryIds: ["p1"],
    checkedAt: "2026-09-16T08:00:00.000Z",
    neededQty: 4,
    stockQty: 2,
    buyQty: 2,
    contextHint: "计划要 4 把，家里有 2 把",
    ...partial,
  }
}

describe("差额默认入库量", () => {
  test("不够默认用差额，不用计划全量", () => {
    expect(
      defaultCheckInQuantity(
        shopping({
          id: "s1",
          name: "小白菜",
          neededQty: 4,
          stockQty: 2,
          buyQty: 2,
          quantityHint: "2",
          shortage: "short",
        })
      )
    ).toBe("2")
  })

  test("够默认 0", () => {
    expect(
      defaultCheckInQuantity(
        shopping({
          id: "s2",
          name: "五花肉",
          shortage: "enough",
          buyQty: 0,
          quantityHint: "0",
        })
      )
    ).toBe("0")
  })

  test("快没了的常备行按购买单位入库", () => {
    const soy: Ingredient = {
      id: "ing-soy",
      name: "生抽",
      aliases: [],
      category: "seasoning",
      defaultUnit: "瓶",
      stallHint: null,
      defaultShelfLifeDays: 180,
      kind: "staple",
      purchaseUnit: "瓶",
    }
    const item = shopping({
      id: "s-soy",
      name: "生抽",
      ingredientId: "ing-soy",
      unit: "瓶",
      buyQty: 1,
      quantityHint: "1",
      shortage: "short",
      source: "running_low",
    })
    expect(defaultCheckInQuantity(item)).toBe("1")
    expect(defaultCheckInUnit(item, soy)).toBe("瓶")
    expect(
      defaultCheckInUnit({ ...item, unit: "勺", source: "plan" }, soy)
    ).toBe("瓶")
  })

  test("清单上改过的数量和单位优先于差额", () => {
    const item = shopping({
      id: "s-picked",
      name: "小白菜",
      buyQty: 2,
      quantityHint: "2",
      unit: "把",
      pickedQty: 3,
      pickedUnit: "斤",
    })
    expect(defaultCheckInQuantity(item)).toBe("3")
    expect(defaultCheckInUnit(item)).toBe("斤")
  })

  test("不确定但已经填了买到的数量，入库就用这个数", () => {
    const item = shopping({
      id: "s-unsure-picked",
      name: "蒜",
      shortage: "unsure",
      buyQty: null,
      quantityHint: "",
      unit: "瓣",
      pickedQty: 2,
      pickedUnit: "头",
    })
    expect(defaultCheckInQuantity(item)).toBe("2")
    expect(defaultCheckInUnit(item)).toBe("头")
  })

  test("不确定默认空，逼用户手填", () => {
    expect(
      defaultCheckInQuantity(
        shopping({
          id: "s3",
          name: "蒜",
          shortage: "unsure",
          buyQty: null,
          quantityHint: "",
          unit: "瓣",
        })
      )
    ).toBe("")
  })
})

describe("确认页必须用用户改过的数量", () => {
  test("不确定空着不能过", () => {
    expect(
      validateCheckInEdits([{ name: "蒜", shortage: "unsure", quantity: "" }])
    ).toBe("蒜 还不确定，请填这次买到的数量")
  })

  test("草稿用编辑值 3，不是清单差额 2 或计划 4", () => {
    const item = shopping({
      id: "s1",
      name: "小白菜",
      buyQty: 2,
      neededQty: 4,
      quantityHint: "2",
    })
    expect(
      validateCheckInEdits([
        { name: item.name, shortage: "short", quantity: "3" },
      ])
    ).toBeNull()
    const drafts = draftsFromEdits([
      {
        item,
        quantity: "3",
        unit: "把",
        location: "fridge",
        expiresAt: "",
      },
    ])
    expect(drafts).toEqual([
      expect.objectContaining({
        shoppingItemId: "s1",
        quantity: 3,
        unit: "把",
      }),
    ])
    expect(drafts[0]?.quantity).not.toBe(item.neededQty)
    expect(drafts[0]?.quantity).not.toBe(item.buyQty)
  })

  test("够且填 0 的行会跳过，不写库存", () => {
    expect(parseCheckInQuantity("0")).toBe(0)
    expect(
      draftsFromEdits([
        {
          item: shopping({
            id: "s2",
            name: "五花肉",
            shortage: "enough",
            buyQty: 0,
            quantityHint: "0",
          }),
          quantity: "0",
          unit: "斤",
          location: "fridge",
          expiresAt: "",
        },
      ])
    ).toEqual([])
  })
})

describe("入库保质期建议", () => {
  const leafy: Ingredient = {
    id: "ing-bokchoy",
    name: "小白菜",
    aliases: [],
    category: "veg",
    defaultUnit: "把",
    stallHint: "veg",
    defaultShelfLifeDays: 3,
  }

  test("叶菜冷藏按购入日加 3 天", () => {
    expect(
      suggestedCheckInExpiresAt(
        shopping({ id: "s1", name: "小白菜" }),
        [leafy],
        "fridge",
        "2026-09-16"
      )
    ).toBe("2026-09-19")
  })
})

describe("入库对齐已有食材", () => {
  const scallion: Ingredient = {
    id: "ing-scallion",
    name: "小葱",
    aliases: ["青葱"],
    category: "veg",
    defaultUnit: "把",
    stallHint: "veg",
    defaultShelfLifeDays: 3,
  }

  test("已有 ingredientId 不改", () => {
    expect(resolveCheckInIngredientId("葱", "ing-bokchoy", [scallion])).toBe(
      "ing-bokchoy"
    )
  })

  test("没有 id 时把葱对齐到小葱", () => {
    expect(resolveCheckInIngredientId("葱", null, [scallion])).toBe(
      "ing-scallion"
    )
  })
})

describe("清单入库默认位置", () => {
  const soy: Ingredient = {
    id: "ing-soy",
    name: "老抽",
    aliases: [],
    category: "seasoning",
    defaultUnit: "瓶",
    stallHint: null,
    defaultShelfLifeDays: 365,
    kind: "staple",
    purchaseUnit: "瓶",
  }
  const rice: Ingredient = {
    id: "ing-rice",
    name: "大米",
    aliases: [],
    category: "dry",
    defaultUnit: "袋",
    stallHint: "dry",
    defaultShelfLifeDays: 180,
  }
  const pork: Ingredient = {
    id: "ing-pork",
    name: "五花肉",
    aliases: [],
    category: "meat",
    defaultUnit: "斤",
    stallHint: "meat",
    defaultShelfLifeDays: 3,
  }
  const leafy: Ingredient = {
    id: "ing-bokchoy",
    name: "小白菜",
    aliases: [],
    category: "veg",
    defaultUnit: "把",
    stallHint: "veg",
    defaultShelfLifeDays: 3,
  }

  test("调味、干货常温，肉和菜冷藏，保质期跟着位置", () => {
    expect(
      defaultCheckInPlacement(
        shopping({
          id: "s-soy",
          name: "老抽",
          ingredientId: "ing-soy",
          unit: "瓶",
          stallHint: null,
        }),
        [soy],
        [],
        "2026-10-15"
      )
    ).toEqual({ location: "pantry", expiresAt: "2027-10-15" })
    expect(
      defaultCheckInPlacement(
        shopping({
          id: "s-rice",
          name: "大米",
          ingredientId: "ing-rice",
          unit: "袋",
          stallHint: "dry",
        }),
        [rice],
        [],
        "2026-10-15"
      ).location
    ).toBe("pantry")
    expect(
      defaultCheckInPlacement(
        shopping({
          id: "s-pork",
          name: "五花肉",
          ingredientId: "ing-pork",
          unit: "斤",
          stallHint: "meat",
        }),
        [pork],
        [],
        "2026-10-15"
      )
    ).toEqual({ location: "fridge", expiresAt: "2026-10-18" })
    expect(
      defaultCheckInPlacement(
        shopping({ id: "s-leaf", name: "小白菜" }),
        [leafy],
        [],
        "2026-10-15"
      ).location
    ).toBe("fridge")
  })

  test("已有同单位库存时默认沿用那一行的位置", () => {
    const pantrySoy: InventoryItem = {
      id: "inv-soy",
      ingredientId: "ing-soy",
      quantity: 1,
      unit: "瓶",
      location: "pantry",
      purchasedAt: "2026-01-01",
      expiresAt: "2027-01-01",
      notes: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
    const fridgeSoy: InventoryItem = {
      ...pantrySoy,
      id: "inv-soy-fridge",
      location: "fridge",
    }
    expect(
      defaultCheckInPlacement(
        shopping({
          id: "s-soy",
          name: "老抽",
          ingredientId: "ing-soy",
          unit: "瓶",
          stallHint: null,
        }),
        [soy],
        [fridgeSoy, pantrySoy],
        "2026-10-15"
      ).location
    ).toBe("pantry")
    expect(
      defaultCheckInPlacement(
        shopping({
          id: "s-soy",
          name: "老抽",
          ingredientId: "ing-soy",
          unit: "瓶",
          stallHint: null,
        }),
        [soy],
        [{ ...pantrySoy, location: "freezer" }],
        "2026-10-15"
      ).location
    ).toBe("freezer")
  })
})

describe("同单位库存合并", () => {
  const existing: InventoryItem = {
    id: "inv-bokchoy",
    ingredientId: "ing-bokchoy",
    quantity: 2,
    unit: "把",
    location: "fridge",
    purchasedAt: "2026-09-16",
    expiresAt: null,
    notes: "",
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
  }

  test("有同食材同单位则加到原行", () => {
    expect(findSameUnitStock([existing], "ing-bokchoy", "把")?.id).toBe(
      "inv-bokchoy"
    )
    expect(
      mergeCheckInQuantity(existing, 2, "2026-09-16T12:00:00.000Z")
    ).toEqual(expect.objectContaining({ id: "inv-bokchoy", quantity: 4 }))
    expect(
      mergeCheckInQuantity(existing, 3, "2026-09-16T12:00:00.000Z")
    ).toEqual(expect.objectContaining({ id: "inv-bokchoy", quantity: 5 }))
  })

  test("没有同单位库存则找不到可合并行", () => {
    expect(findSameUnitStock([existing], "ing-bokchoy", "斤")).toBeUndefined()
    expect(findSameUnitStock([existing], "ing-tofu", "把")).toBeUndefined()
    expect(findSameUnitStock([], "ing-bokchoy", "把")).toBeUndefined()
  })

  test("同食材有多行时优先合入位置相符的那一行", () => {
    const pantry: InventoryItem = {
      ...existing,
      id: "inv-pantry",
      location: "pantry",
    }
    expect(
      findSameUnitStock([existing, pantry], "ing-bokchoy", "把", "pantry")?.id
    ).toBe("inv-pantry")
  })

  test("没改位置就沿用已有行，不按默认冰箱另开一行", () => {
    const pantry: InventoryItem = {
      ...existing,
      id: "inv-soy",
      ingredientId: "ing-soy",
      unit: "瓶",
      location: "pantry",
      quantity: 1,
    }
    const merged = applyCheckInStock(
      {
        shoppingItemId: "s-soy",
        ingredientId: "ing-soy",
        name: "老抽",
        quantity: 1,
        unit: "瓶",
        location: "fridge",
        locationTouched: false,
        expiresAt: "2027-10-15",
        stallHint: null,
      },
      [pantry],
      "2026-10-15T12:00:00.000Z",
      "inv-new"
    )
    expect(merged).toEqual(
      expect.objectContaining({
        id: "inv-soy",
        quantity: 2,
        location: "pantry",
      })
    )
  })

  test("确认页改了位置就写到合并后的行上", () => {
    const moved = applyCheckInStock(
      {
        shoppingItemId: "s1",
        ingredientId: "ing-bokchoy",
        name: "小白菜",
        quantity: 1,
        unit: "把",
        location: "freezer",
        locationTouched: true,
        expiresAt: null,
        stallHint: "veg",
      },
      [existing],
      "2026-10-15T12:00:00.000Z",
      "inv-new"
    )
    expect(moved).toEqual(
      expect.objectContaining({
        id: "inv-bokchoy",
        quantity: 3,
        location: "freezer",
      })
    )
  })

  test("没有同单位库存时按确认的位置新建", () => {
    const created = applyCheckInStock(
      {
        shoppingItemId: "s-soy",
        ingredientId: "ing-soy",
        name: "老抽",
        quantity: 1,
        unit: "瓶",
        location: "pantry",
        expiresAt: "2027-10-15",
        stallHint: null,
      },
      [],
      "2026-10-15T12:00:00.000Z",
      "inv-new"
    )
    expect(created).toEqual(
      expect.objectContaining({
        id: "inv-new",
        ingredientId: "ing-soy",
        quantity: 1,
        unit: "瓶",
        location: "pantry",
        expiresAt: "2027-10-15",
      })
    )
  })
})
