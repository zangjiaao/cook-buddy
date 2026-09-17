import { describe, expect, test } from "vitest"
import {
  guessIngredientKind,
  guessPurchaseUnit,
  ingredientNeedsMigrate,
  ingredientPurchaseUnit,
  isStapleIngredient,
  normalizeIngredient,
} from "@/lib/ingredient-kind"
import type { Ingredient } from "@/lib/types"

function ingredient(
  partial: Pick<Ingredient, "id" | "name" | "category"> & Partial<Ingredient>
): Ingredient {
  return {
    aliases: [],
    defaultUnit: "个",
    stallHint: null,
    defaultShelfLifeDays: null,
    ...partial,
  }
}

describe("guessIngredientKind / guessPurchaseUnit", () => {
  test("油和酱油是常备，购买单位是瓶，不用勺", () => {
    expect(guessIngredientKind("食用油", "seasoning")).toBe("staple")
    expect(guessIngredientKind("生抽")).toBe("staple")
    expect(
      guessPurchaseUnit({
        name: "生抽",
        category: "seasoning",
        unitHint: "勺",
      })
    ).toBe("瓶")
    expect(
      guessPurchaseUnit({
        name: "食用油",
        category: "seasoning",
        defaultUnit: "勺",
      })
    ).toBe("瓶")
  })

  test("蔬菜是鲜货，购买单位跟食谱单位走", () => {
    expect(guessIngredientKind("小白菜", "veg")).toBe("fresh")
    expect(
      guessPurchaseUnit({
        name: "小白菜",
        category: "veg",
        unitHint: "把",
      })
    ).toBe("把")
  })

  test("已有购买单位的档案原样保留", () => {
    const soy = ingredient({
      id: "ing-soy",
      name: "生抽",
      category: "seasoning",
      defaultUnit: "瓶",
      purchaseUnit: "瓶",
      kind: "staple",
    })
    expect(isStapleIngredient(soy)).toBe(true)
    expect(ingredientPurchaseUnit(soy)).toBe("瓶")
    expect(ingredientNeedsMigrate(soy)).toBe(false)
  })

  test("鲜货不能当快没了入口", () => {
    expect(
      isStapleIngredient(
        ingredient({
          id: "ing-veg",
          name: "小白菜",
          category: "veg",
          kind: "fresh",
        })
      )
    ).toBe(false)
    expect(isStapleIngredient(undefined)).toBe(false)
  })

  test("旧档案缺字段时能补上常备+瓶", () => {
    const raw = ingredient({
      id: "ing-soy",
      name: "生抽",
      category: "seasoning",
      defaultUnit: "瓶",
    })
    expect(ingredientNeedsMigrate(raw)).toBe(true)
    expect(normalizeIngredient(raw)).toMatchObject({
      kind: "staple",
      purchaseUnit: "瓶",
    })
  })
})
