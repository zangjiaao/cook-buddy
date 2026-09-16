import { describe, expect, test } from "vitest"
import { defaultParser, ruleParse } from "@/lib/ai/parse-recipe"

const SAMPLE = `小白菜炒肉
2人份 约20分钟

食材：
五花肉 0.4 斤
小白菜 1 把

步骤：
1. 肉切片
2. 热锅炒熟`

describe("ruleParse", () => {
  test("抽出名称、份数、食材和步骤", () => {
    const draft = ruleParse(SAMPLE)
    expect(draft.name).toBe("小白菜炒肉")
    expect(draft.servings).toBe(2)
    expect(draft.approxMinutes).toBe(20)
    expect(draft.items).toEqual([
      { rawName: "五花肉", quantity: 0.4, unit: "斤" },
      { rawName: "小白菜", quantity: 1, unit: "把" },
    ])
    expect(draft.steps).toEqual(["肉切片", "热锅炒熟"])
  })
})

describe("defaultParser", () => {
  test("空内容走 mock", async () => {
    const draft = await defaultParser.parse("")
    expect(draft.source).toBe("mock")
    expect(draft.items.length).toBeGreaterThan(0)
  })
})
