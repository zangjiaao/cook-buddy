import { describe, expect, test } from "vitest"
import {
  closeMatchesForCreate,
  matchIngredient,
  pickAutoLink,
  rankIngredients,
  searchIngredients,
  withTypedAlias,
} from "@/lib/ai/match-ingredient"
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
  {
    id: "ing-scallion",
    name: "小葱",
    aliases: ["青葱"],
    category: "veg",
    defaultUnit: "把",
    stallHint: "veg",
    defaultShelfLifeDays: 3,
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

  test("小葱与葱能对上", () => {
    const match = matchIngredient("葱", ingredients)
    expect(match.ingredientId).toBe("ing-scallion")
    expect(match.matchStatus).toBe("fuzzy")
  })

  test("对不上则未对齐", () => {
    expect(matchIngredient("未知菜", ingredients)).toEqual({
      ingredientId: null,
      matchStatus: "unlinked",
    })
  })
})

describe("rank / search / create prompt", () => {
  test("搜葱时小葱排在前面", () => {
    const ranked = rankIngredients("葱", ingredients)
    expect(ranked[0]?.ingredient.id).toBe("ing-scallion")
    expect(searchIngredients("葱", ingredients)[0]?.ingredient.name).toBe(
      "小葱"
    )
  })

  test("新建葱之前要提示已有小葱", () => {
    const close = closeMatchesForCreate("葱", ingredients)
    expect(close.map((row) => row.ingredient.name)).toContain("小葱")
    expect(pickAutoLink("葱", ingredients)?.ingredient.id).toBe("ing-scallion")
  })

  test("完全无关的名字不提示对齐", () => {
    expect(closeMatchesForCreate("未知菜", ingredients)).toEqual([])
    expect(pickAutoLink("未知菜", ingredients)).toBeUndefined()
  })

  test("就是这个时把输入收成别名", () => {
    const scallion = ingredients[1]
    const next = withTypedAlias(scallion, "葱")
    expect(next.aliases).toContain("葱")
    expect(
      withTypedAlias(next, "葱").aliases.filter((alias) => alias === "葱")
    ).toHaveLength(1)
  })
})
