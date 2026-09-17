import { describe, expect, test } from "vitest"
import { fallbackCreateDraft } from "@/lib/ai/resolve-ingredients"
import {
  backfillRecipeItems,
  backfillShoppingItems,
  matchesIngredientName,
  recipeItemsFromResolved,
} from "@/lib/ingredient-resolve-apply"
import type { Ingredient, RecipeItem, ShoppingItem } from "@/lib/types"

const scallion: Ingredient = {
  id: "ing-scallion",
  name: "小葱",
  aliases: ["葱", "青葱"],
  category: "veg",
  defaultUnit: "把",
  stallHint: "veg",
  defaultShelfLifeDays: 3,
}

function recipeItem(
  partial: Pick<RecipeItem, "id" | "rawName"> & Partial<RecipeItem>
): RecipeItem {
  return {
    recipeId: "rec-1",
    ingredientId: null,
    quantity: 1,
    unit: "把",
    matchStatus: "unlinked",
    ...partial,
  }
}

function shoppingItem(
  partial: Pick<ShoppingItem, "id" | "name"> & Partial<ShoppingItem>
): ShoppingItem {
  return {
    ingredientId: null,
    quantityHint: "1",
    unit: "把",
    stallHint: "veg",
    status: "needed",
    shortage: "unsure",
    fromPlanEntryIds: [],
    checkedAt: null,
    ...partial,
  }
}

describe("matchesIngredientName", () => {
  test("认主名和别名", () => {
    expect(matchesIngredientName("小葱", scallion)).toBe(true)
    expect(matchesIngredientName("葱", scallion)).toBe(true)
    expect(matchesIngredientName("香菜", scallion)).toBe(false)
  })
})

describe("入库写回 recipe_items / shopping", () => {
  test("只回填 ingredientId 为空且生名对得上的行", () => {
    const items = [
      recipeItem({ id: "ri-1", rawName: "葱" }),
      recipeItem({
        id: "ri-2",
        rawName: "葱",
        ingredientId: "ing-other",
        matchStatus: "linked",
      }),
      recipeItem({ id: "ri-3", rawName: "香菜" }),
    ]
    const next = backfillRecipeItems(items, scallion)
    expect(next[0]).toMatchObject({
      id: "ri-1",
      ingredientId: "ing-scallion",
      matchStatus: "linked",
    })
    expect(next[1]?.ingredientId).toBe("ing-other")
    expect(next[2]?.ingredientId).toBeNull()
  })

  test("清单未关联行也补上 ingredientId", () => {
    const items = [
      shoppingItem({ id: "s1", name: "葱" }),
      shoppingItem({ id: "s2", name: "香菜" }),
    ]
    expect(backfillShoppingItems(items, scallion)[0]?.ingredientId).toBe(
      "ing-scallion"
    )
    expect(backfillShoppingItems(items, scallion)[1]?.ingredientId).toBeNull()
  })
})

describe("recipeItemsFromResolved", () => {
  test("按生名填 ingredientId", () => {
    const byRawName = new Map([["葱", scallion]])
    expect(
      recipeItemsFromResolved(
        [{ rawName: "葱", quantity: 1, unit: "把" }],
        byRawName
      )
    ).toEqual([
      {
        rawName: "葱",
        quantity: 1,
        unit: "把",
        ingredientId: "ing-scallion",
        matchStatus: "linked",
      },
    ])
    expect(fallbackCreateDraft("葱").name).toBe("葱")
  })
})
