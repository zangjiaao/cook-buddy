import { describe, expect, test, vi } from "vitest"
import { parseInventoryUtteranceWithAi } from "@/lib/ai/parse-inventory.server"
import { mergeInventoryAdds } from "@/lib/inventory-add"
import {
  parseChineseNumber,
  parseInventoryUtteranceByRules,
} from "@/lib/inventory-utterance"
import type { InventoryItem } from "@/lib/types"

describe("中文数量", () => {
  test("常见中文数字换成阿拉伯数字", () => {
    expect(parseChineseNumber("两")).toBe(2)
    expect(parseChineseNumber("一")).toBe(1)
    expect(parseChineseNumber("十")).toBe(10)
    expect(parseChineseNumber("十二")).toBe(12)
    expect(parseChineseNumber("二十")).toBe(20)
    expect(parseChineseNumber("二十三")).toBe(23)
    expect(parseChineseNumber("半")).toBe(0.5)
    expect(parseChineseNumber("10")).toBe(10)
    expect(parseChineseNumber("2.5")).toBe(2.5)
  })
})

describe("一句话库存", () => {
  test("没有 AI 时按标点切分，并带上分类和保质期", () => {
    const draft = parseInventoryUtteranceByRules(
      "两斤五花肉、一瓶生抽、五香粉一袋、鸡蛋10个"
    )
    expect(draft.source).toBe("rule")
    expect(draft.items).toEqual([
      expect.objectContaining({
        name: "五花肉",
        quantity: 2,
        unit: "斤",
        category: "meat",
        defaultShelfLifeDays: 3,
        defaultLocation: "fridge",
      }),
      expect.objectContaining({
        name: "生抽",
        quantity: 1,
        unit: "瓶",
        category: "seasoning",
        defaultShelfLifeDays: 365,
        defaultLocation: "pantry",
      }),
      expect.objectContaining({
        name: "五香粉",
        quantity: 1,
        unit: "袋",
        category: "seasoning",
      }),
      expect.objectContaining({
        name: "鸡蛋",
        quantity: 10,
        unit: "个",
        category: "meat",
      }),
    ])
  })

  test("两斤半、半斤和后置数量", () => {
    const draft = parseInventoryUtteranceByRules("两斤半牛肉，半斤虾，生抽一瓶")
    expect(
      draft.items.map((item) => [item.name, item.quantity, item.unit])
    ).toEqual([
      ["牛肉", 2.5, "斤"],
      ["虾", 0.5, "斤"],
      ["生抽", 1, "瓶"],
    ])
  })

  test("没有 key 不打 fetch，AI 把油说成蔬菜时改回调味", async () => {
    const fetchFn = vi.fn()
    const offline = await parseInventoryUtteranceWithAi("一瓶食用油", {
      env: {},
      fetchFn: fetchFn as typeof fetch,
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(offline.items[0]).toMatchObject({
      name: "食用油",
      quantity: 1,
      unit: "瓶",
      category: "seasoning",
    })

    const ai = await parseInventoryUtteranceWithAi("一瓶食用油", {
      env: { DEEPSEEK_API_KEY: "sk-test" },
      fetchFn: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    items: [
                      {
                        name: "食用油",
                        quantity: 1,
                        unit: "瓶",
                        category: "veg",
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      ) as typeof fetch,
    })
    expect(ai.source).toBe("ai")
    expect(ai.items[0]).toMatchObject({
      name: "食用油",
      category: "seasoning",
      defaultLocation: "pantry",
    })
  })
})

describe("同单位合并", () => {
  test("同一批里同食材同单位加在一起，不同单位另起一行", () => {
    const existing: InventoryItem = {
      id: "inv-soy",
      ingredientId: "ing-soy",
      quantity: 1,
      unit: "瓶",
      location: "pantry",
      purchasedAt: "2026-10-01",
      expiresAt: null,
      notes: "",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    }
    const touched = mergeInventoryAdds(
      [existing],
      [
        {
          ingredientId: "ing-soy",
          quantity: 1,
          unit: "瓶",
          location: "pantry",
          expiresAt: null,
        },
        {
          ingredientId: "ing-pork",
          quantity: 2,
          unit: "斤",
          location: "fridge",
          expiresAt: "2026-10-04",
        },
        {
          ingredientId: "ing-pork",
          quantity: 1,
          unit: "斤",
          location: "fridge",
          expiresAt: "2026-10-04",
        },
      ],
      "2026-10-15T00:00:00.000Z",
      (prefix) => `${prefix}-new`
    )
    expect(touched).toEqual([
      expect.objectContaining({ id: "inv-soy", quantity: 2, unit: "瓶" }),
      expect.objectContaining({
        id: "inv-new",
        ingredientId: "ing-pork",
        quantity: 3,
        unit: "斤",
      }),
    ])
  })
})
