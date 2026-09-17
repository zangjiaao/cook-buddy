import { describe, expect, test } from "vitest"
import {
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
})
