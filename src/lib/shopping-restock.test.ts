import { describe, expect, test } from "vitest"
import { mergeProtectedShoppingLines } from "@/lib/shopping-from-plan"
import {
  RESTOCK_ON_LIST_LABEL,
  findRestockLine,
  restockAlreadyListed,
  restockShoppingLine,
  shoppingItemAfterCheckIn,
  upsertRestockShoppingLine,
} from "@/lib/shopping-restock"
import type { Ingredient, ShoppingItem } from "@/lib/types"

const soy: Ingredient = {
  id: "ing-soy",
  name: "生抽",
  aliases: ["酱油"],
  category: "seasoning",
  defaultUnit: "瓶",
  stallHint: null,
  defaultShelfLifeDays: 180,
  kind: "staple",
  purchaseUnit: "瓶",
}

function shopping(
  partial: Partial<ShoppingItem> & Pick<ShoppingItem, "id" | "name">
): ShoppingItem {
  return {
    ingredientId: soy.id,
    quantityHint: "1",
    unit: "瓶",
    stallHint: null,
    status: "needed",
    shortage: "short",
    fromPlanEntryIds: [],
    checkedAt: null,
    buyQty: 1,
    source: "plan",
    ...partial,
  }
}

describe("快没了 / 手加一味", () => {
  test("清单里还没有这味时可以标记，有了就显示在清单里", () => {
    expect(restockAlreadyListed([], soy)).toBe(false)
    expect(
      restockAlreadyListed([shopping({ id: "shop-soy", name: "生抽" })], soy)
    ).toBe(true)
    expect(RESTOCK_ON_LIST_LABEL).toBe("在清单里")
  })

  test("够的计划行不显示在清单上，还可以再标记快没了", () => {
    expect(
      restockAlreadyListed(
        [
          shopping({
            id: "shop-soy",
            name: "生抽",
            shortage: "enough",
            source: "plan",
            buyQty: 0,
            quantityHint: "0",
          }),
        ],
        soy
      )
    ).toBe(false)
  })

  test("入库后清掉已买、手改数量和要买判断", () => {
    const next = shoppingItemAfterCheckIn(
      shopping({
        id: "shop-soy",
        name: "生抽",
        source: "running_low",
        status: "bought",
        checkedAt: "2026-10-15T08:00:00.000Z",
        presenceChoice: "buy",
        pickedQty: 2,
        pickedUnit: "瓶",
      }),
      "ing-soy"
    )
    expect(next).toMatchObject({
      ingredientId: "ing-soy",
      source: "plan",
      status: "needed",
      checkedAt: null,
      pickedQty: null,
      pickedUnit: null,
      presenceChoice: null,
    })
  })

  test("常备默认补 1 个购买单位，状态是要买", () => {
    const line = restockShoppingLine({
      ingredient: soy,
      source: "running_low",
      createItemId: () => "shop-soy",
    })
    expect(line).toMatchObject({
      id: "shop-soy",
      ingredientId: "ing-soy",
      unit: "瓶",
      buyQty: 1,
      quantityHint: "1",
      shortage: "short",
      status: "needed",
      source: "running_low",
    })
    expect(line.unit).not.toBe("勺")
  })

  test("已有同一食材行则更新，不另开一行", () => {
    const existing = [
      shopping({
        id: "shop-soy",
        name: "生抽",
        unit: "勺",
        source: "plan",
        shortage: "enough",
        buyQty: 0,
        quantityHint: "0",
      }),
    ]
    const { line, items, created } = upsertRestockShoppingLine({
      existing,
      ingredient: soy,
      source: "running_low",
    })
    expect(created).toBe(false)
    expect(items).toHaveLength(1)
    expect(line).toMatchObject({
      id: "shop-soy",
      unit: "瓶",
      buyQty: 1,
      source: "running_low",
      shortage: "short",
    })
  })

  test("手加一味按购买单位新建一行", () => {
    const { line, created } = upsertRestockShoppingLine({
      existing: [],
      ingredient: soy,
      source: "manual",
      createItemId: () => "shop-manual",
    })
    expect(created).toBe(true)
    expect(findRestockLine([line], soy, "瓶")?.id).toBe("shop-manual")
    expect(line.source).toBe("manual")
    expect(line.unit).toBe("瓶")
  })
})

describe("重算合并手加/快没了", () => {
  test("计划 enough 行不会盖掉快没了的 1 瓶", () => {
    const merged = mergeProtectedShoppingLines(
      [
        shopping({
          id: "shop-plan",
          name: "生抽",
          shortage: "enough",
          buyQty: 0,
          quantityHint: "0",
          source: "plan",
          fromPlanEntryIds: ["p1"],
        }),
      ],
      [
        shopping({
          id: "shop-low",
          name: "生抽",
          source: "running_low",
          buyQty: 1,
          quantityHint: "1",
        }),
      ]
    )
    expect(merged).toEqual([
      expect.objectContaining({
        id: "shop-low",
        source: "running_low",
        buyQty: 1,
        fromPlanEntryIds: ["p1"],
      }),
    ])
  })
})
