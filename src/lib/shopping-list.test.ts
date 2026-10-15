import { describe, expect, test } from "vitest"
import {
  UNSURE_GROUP_TITLE,
  boughtInAisle,
  checkInBoughtLabel,
  formatShoppingShareText,
  groupShoppingForAisle,
  shoppingListSection,
} from "@/lib/shopping-list"
import type { Category, Ingredient, ShoppingItem } from "@/lib/types"

function ingredient(
  id: string,
  category: Category,
  name = id
): Pick<Ingredient, "id" | "category" | "name"> {
  return { id, category, name }
}

function item(
  partial: Partial<ShoppingItem> & Pick<ShoppingItem, "id" | "name">
): ShoppingItem {
  return {
    ingredientId: null,
    quantityHint: "1",
    unit: "个",
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

describe("采购清单只列要买的", () => {
  test("不够、快没了、手加要买；够的隐藏；不确定单独一组", () => {
    expect(shoppingListSection(item({ id: "a", name: "豆腐" }))).toBe("buy")
    expect(
      shoppingListSection(
        item({
          id: "b",
          name: "生抽",
          shortage: "enough",
          source: "running_low",
        })
      )
    ).toBe("buy")
    expect(
      shoppingListSection(
        item({ id: "c", name: "盐", shortage: "enough", source: "manual" })
      )
    ).toBe("buy")
    expect(
      shoppingListSection(
        item({ id: "d", name: "五花肉", shortage: "enough", source: "plan" })
      )
    ).toBe("hidden")
    expect(
      shoppingListSection(
        item({ id: "e", name: "香菜", shortage: "unsure", buyQty: null })
      )
    ).toBe("unsure")
  })

  test("不确定点要买就进主清单，点有就藏起来", () => {
    const unsure = item({
      id: "e",
      name: "香菜",
      shortage: "unsure",
      buyQty: null,
      quantityHint: "",
    })
    expect(shoppingListSection({ ...unsure, presenceChoice: "buy" })).toBe(
      "buy"
    )
    expect(shoppingListSection({ ...unsure, presenceChoice: "have" })).toBe(
      "hidden"
    )
  })

  test("不够不会被「有」藏住", () => {
    expect(
      shoppingListSection(
        item({ id: "a", name: "豆腐", presenceChoice: "have" })
      )
    ).toBe("buy")
  })
})

describe("按库存分类分组", () => {
  const ingredients = [
    ingredient("ing-beef", "meat", "牛肉"),
    ingredient("ing-pork", "meat", "猪肉"),
    ingredient("ing-tofu", "veg", "豆腐"),
    ingredient("ing-garlic", "seasoning", "蒜"),
    ingredient("ing-soy", "seasoning", "生抽"),
    ingredient("ing-milk", "other", "牛奶"),
  ]

  const rows = [
    item({
      id: "beef",
      name: "牛肉",
      ingredientId: "ing-beef",
      stallHint: "meat",
    }),
    item({
      id: "pork",
      name: "猪肉",
      ingredientId: "ing-pork",
      status: "bought",
      stallHint: "meat",
    }),
    item({
      id: "tofu",
      name: "豆腐",
      ingredientId: "ing-tofu",
      stallHint: "veg",
    }),
    item({
      id: "soy",
      name: "生抽",
      ingredientId: "ing-soy",
      shortage: "enough",
      buyQty: 0,
      quantityHint: "0",
    }),
    item({
      id: "garlic",
      name: "蒜",
      ingredientId: "ing-garlic",
      shortage: "unsure",
      presenceChoice: "buy",
      buyQty: null,
      quantityHint: "",
    }),
    item({
      id: "cilantro",
      name: "香菜",
      shortage: "unsure",
      buyQty: null,
      quantityHint: "",
      stallHint: "veg",
    }),
    item({
      id: "salt",
      name: "盐",
      shortage: "unsure",
      presenceChoice: "have",
      buyQty: null,
    }),
    item({
      id: "milk",
      name: "牛奶",
      ingredientId: "ing-milk",
      source: "manual",
    }),
  ]

  test("空组不显示，已买沉到组底，不确定在底部", () => {
    const grouped = groupShoppingForAisle(rows, ingredients)
    expect(grouped.buy.map((group) => group.label)).toEqual([
      "肉",
      "菜",
      "调味",
      "其他",
    ])
    expect(grouped.buy.map((group) => group.category)).not.toContain("dry")
    expect(grouped.buy[0]?.items.map((row) => row.name)).toEqual([
      "牛肉",
      "猪肉",
    ])
    expect(grouped.buy[0]?.items[1]?.status).toBe("bought")
    expect(grouped.buy[2]?.items.map((row) => row.name)).toEqual(["蒜"])
    expect(grouped.unsure.map((row) => row.name)).toEqual(["香菜"])
    expect(UNSURE_GROUP_TITLE).toBe("不确定家里还有没有")
    expect(boughtInAisle(grouped.buy).map((row) => row.name)).toEqual(["猪肉"])
    expect(checkInBoughtLabel(1)).toBe("入库已买的 1 样")
  })

  test("没关联食材时用摊位提示，对不上就归其他", () => {
    const grouped = groupShoppingForAisle(
      [
        item({ id: "leaf", name: "青菜", stallHint: "veg" }),
        item({ id: "misc", name: "一次性手套", stallHint: null }),
      ],
      []
    )
    expect(
      grouped.buy.map((group) => [group.label, group.items[0]?.name])
    ).toEqual([
      ["菜", "青菜"],
      ["其他", "一次性手套"],
    ])
  })
})

describe("分享只含要买的项", () => {
  test("按分类写出，够的和还没决定的不确定不出现", () => {
    const grouped = groupShoppingForAisle(
      [
        item({
          id: "beef",
          name: "牛肉",
          ingredientId: "ing-beef",
          buyQty: 1,
          unit: "斤",
          quantityHint: "1",
          contextHint: "计划要 1 斤，家里有 0 斤",
        }),
        item({
          id: "pork",
          name: "猪肉",
          ingredientId: "ing-pork",
          status: "bought",
          unit: "斤",
          pickedQty: 1.5,
          pickedUnit: "斤",
        }),
        item({
          id: "soy",
          name: "生抽",
          ingredientId: "ing-soy",
          shortage: "enough",
        }),
        item({
          id: "herb",
          name: "香菜",
          shortage: "unsure",
          buyQty: null,
        }),
      ],
      [
        ingredient("ing-beef", "meat"),
        ingredient("ing-pork", "meat"),
        ingredient("ing-soy", "seasoning"),
      ]
    )
    const text = formatShoppingShareText(grouped.buy)
    expect(text).toContain("【肉】")
    expect(text).toContain("☐ 牛肉 还差 1 斤")
    expect(text).toContain("☑ 猪肉 买 1.5 斤")
    expect(text).not.toContain("生抽")
    expect(text).not.toContain("香菜")
    expect(text).not.toContain("【调味】")
    expect(text).not.toContain("【干货】")
  })

  test("没有要买的就说明白", () => {
    expect(formatShoppingShareText([])).toBe(
      "做饭搭子 · 采购清单\n这次没有要买的。"
    )
  })
})
