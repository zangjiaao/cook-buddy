import { describe, expect, test } from "vitest"
import {
  classifyByRules,
  correctMisfiledVegetable,
  guessCategory,
  patchIngredientCategory,
  placementForName,
} from "@/lib/ingredient-category"
import {
  applyAiCategoryFixes,
  applyRuleCategoryFixes,
  misfiledVegetableCandidates,
} from "@/lib/ingredient-category-migrate"
import type { Ingredient } from "@/lib/types"

function ingredient(
  partial: Pick<Ingredient, "id" | "name" | "category"> & Partial<Ingredient>
): Ingredient {
  return {
    aliases: [],
    defaultUnit: "把",
    stallHint: "veg",
    defaultShelfLifeDays: 3,
    ...partial,
  }
}

describe("classifyByRules", () => {
  test("调料、油、干货、粮油、蛋奶不再落到蔬菜", () => {
    expect(classifyByRules("五香粉")).toBe("seasoning")
    expect(classifyByRules("十三香")).toBe("seasoning")
    expect(classifyByRules("食用油")).toBe("seasoning")
    expect(classifyByRules("花生油")).toBe("seasoning")
    expect(classifyByRules("菜籽油")).toBe("seasoning")
    expect(classifyByRules("生抽")).toBe("seasoning")
    expect(classifyByRules("蒜")).toBe("seasoning")
    expect(classifyByRules("木耳")).toBe("dry")
    expect(classifyByRules("紫菜")).toBe("dry")
    expect(classifyByRules("大米")).toBe("dry")
    expect(classifyByRules("面粉")).toBe("dry")
    expect(classifyByRules("奶粉")).toBe("dry")
    expect(classifyByRules("鸡蛋")).toBe("meat")
    expect(classifyByRules("皮蛋")).toBe("meat")
    expect(classifyByRules("牛奶")).toBe("other")
    expect(classifyByRules("酸奶")).toBe("other")
    expect(classifyByRules("小白菜")).toBe("veg")
    expect(classifyByRules("土豆")).toBe("veg")
    expect(classifyByRules("西兰花")).toBe("veg")
    expect(classifyByRules("油菜")).toBe("veg")
    expect(classifyByRules("蒜苗")).toBe("veg")
    expect(classifyByRules("鸡毛菜")).toBe("veg")
    expect(classifyByRules("木耳菜")).toBe("veg")
    expect(classifyByRules("豆腐")).toBe("veg")
    expect(classifyByRules("豆腐干")).toBe("dry")
    expect(classifyByRules("可乐")).toBeNull()
    expect(guessCategory("可乐")).toBe("other")
    expect(guessCategory("未知菜")).toBe("veg")
  })

  test("鲜奶放冰箱，认不出的其他放柜子", () => {
    expect(placementForName("牛奶", "other")).toEqual({
      location: "fridge",
      shelfLifeDays: 7,
    })
    expect(placementForName("可乐", "other")).toEqual({
      location: "pantry",
      shelfLifeDays: 30,
    })
    expect(placementForName("五香粉", "seasoning").shelfLifeDays).toBe(365)
  })
})

describe("误归蔬菜的修正", () => {
  test("规则能确定的改掉，真蔬菜和认不出的先留着", () => {
    const rows = [
      ingredient({ id: "spice", name: "五香粉", category: "veg" }),
      ingredient({ id: "oil", name: "食用油", category: "veg" }),
      ingredient({ id: "leaf", name: "小白菜", category: "veg" }),
      ingredient({ id: "soda", name: "可乐", category: "veg" }),
      ingredient({
        id: "kept",
        name: "五香粉",
        category: "seasoning",
        defaultShelfLifeDays: 10,
        stallHint: null,
      }),
    ]
    const next = applyRuleCategoryFixes(rows)
    expect(next[0]?.category).toBe("seasoning")
    expect(next[0]?.stallHint).toBeNull()
    expect(next[0]?.defaultShelfLifeDays).toBe(365)
    expect(next[1]?.category).toBe("seasoning")
    expect(next[2]?.category).toBe("veg")
    expect(next[3]?.category).toBe("veg")
    expect(next[4]).toMatchObject({
      category: "seasoning",
      defaultShelfLifeDays: 10,
    })
    expect(misfiledVegetableCandidates(next).map((row) => row.id)).toEqual([
      "soda",
    ])
    expect(applyRuleCategoryFixes(next)).toEqual(next)
  })

  test("有 AI 判断才改规则没覆盖的，AI 说还是蔬菜就不动", () => {
    const rows = [
      ingredient({ id: "soda", name: "可乐", category: "veg" }),
      ingredient({ id: "leaf", name: "小白菜", category: "veg" }),
    ]
    const changed = applyAiCategoryFixes(rows, [
      { name: "可乐", category: "other", source: "ai" },
      { name: "小白菜", category: "seasoning", source: "ai" },
    ])
    expect(changed[0]?.category).toBe("other")
    expect(changed[1]?.category).toBe("veg")

    const noAi = applyAiCategoryFixes(rows, [
      { name: "可乐", category: "other", source: "fallback" },
    ])
    expect(noAi[0]?.category).toBe("veg")
  })

  test("用户改过的保质期在改分类时保留", () => {
    const spice = ingredient({
      id: "spice",
      name: "五香粉",
      category: "veg",
      defaultShelfLifeDays: 12,
    })
    expect(correctMisfiledVegetable(spice).defaultShelfLifeDays).toBe(12)
    expect(
      patchIngredientCategory(
        ingredient({ id: "leaf", name: "小白菜", category: "veg" }),
        "veg"
      ).category
    ).toBe("veg")
  })
})
