import { describe, expect, test } from "vitest"
import { matchIngredient } from "@/lib/ai/match-ingredient"
import type { Ingredient } from "@/lib/types"

const ingredients: Ingredient[] = [
  {
    id: "ing-pork",
    name: "五花肉",
    aliases: ["猪肉"],
    category: "meat",
    defaultUnit: "斤",
    stallHint: "meat",
    defaultShelfLifeDays: 4,
  },
]

describe("matchIngredient", () => {
  test("精确名或别名视为已对齐", () => {
    expect(matchIngredient("五花肉", ingredients).matchStatus).toBe("linked")
    expect(matchIngredient("猪肉", ingredients).ingredientId).toBe("ing-pork")
  })

  test("包含关系视为模糊", () => {
    expect(matchIngredient("五花肉片", ingredients).matchStatus).toBe("fuzzy")
  })

  test("对不上则未对齐", () => {
    expect(matchIngredient("未知菜", ingredients)).toEqual({
      ingredientId: null,
      matchStatus: "unlinked",
    })
  })
})
