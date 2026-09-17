import { describe, expect, test } from "vitest"
import type { Ingredient, PlanEntry, RecipeItem } from "@/lib/types"
import {
  addEditableRecipeItem,
  compactEditableRecipeItems,
  createEditableRecipeItem,
  editableItemsFromDraftItems,
  editableItemsFromRecipeItems,
  normalizeRecipeFields,
  recipeItemReplacement,
  removeEditableRecipeItem,
  shouldRegenShoppingForRecipe,
  toResolveInputItems,
  toResolvedRecipeItems,
  updateEditableRecipeItem,
} from "@/lib/recipe-draft-items"

const scallion: Ingredient = {
  id: "ing-scallion",
  name: "小葱",
  aliases: ["葱"],
  category: "veg",
  defaultUnit: "把",
  stallHint: "veg",
  defaultShelfLifeDays: 3,
}

function plan(
  partial: Pick<PlanEntry, "id" | "recipeId"> & Partial<PlanEntry>
): PlanEntry {
  return {
    date: "2026-09-17",
    rangeKey: null,
    servings: 2,
    sortOrder: 0,
    status: "planned",
    cookedAt: null,
    lastDeduct: null,
    ...partial,
  }
}

describe("editable recipe items", () => {
  test("从食谱行带上原 id，从草稿另开 key", () => {
    const fromRecipe = editableItemsFromRecipeItems([
      {
        id: "ri-1",
        rawName: "小白菜",
        quantity: 1,
        unit: "把",
      },
    ])
    expect(fromRecipe).toEqual([
      {
        key: "ri-1",
        rawName: "小白菜",
        quantity: "1",
        unit: "把",
      },
    ])

    const fromDraft = editableItemsFromDraftItems([
      { rawName: "蒜", quantity: 3, unit: "瓣" },
    ])
    expect(fromDraft[0]).toMatchObject({
      rawName: "蒜",
      quantity: "3",
      unit: "瓣",
    })
    expect(fromDraft[0]?.key).toMatch(/^eri-/)
  })

  test("按 key 改、加、去掉", () => {
    const first = createEditableRecipeItem({
      key: "a",
      rawName: "五花肉",
      quantity: "0.4",
      unit: "斤",
    })
    const updated = updateEditableRecipeItem([first], "a", {
      quantity: "0.6",
    })
    expect(updated[0]?.quantity).toBe("0.6")

    const added = addEditableRecipeItem(updated)
    expect(added).toHaveLength(2)
    expect(added[1]).toMatchObject({ rawName: "", quantity: "", unit: "" })

    expect(removeEditableRecipeItem(added, "a")).toEqual([added[1]])
  })

  test("空行不送 resolve，有字的用生名", () => {
    const items = [
      createEditableRecipeItem({
        key: "empty",
        rawName: "  ",
        quantity: "",
        unit: "",
      }),
      createEditableRecipeItem({
        key: "pork",
        rawName: " 五花肉 ",
        quantity: "0.4",
        unit: "斤",
      }),
    ]
    expect(compactEditableRecipeItems(items)).toHaveLength(1)
    expect(toResolveInputItems(items)).toEqual([
      { rawName: "五花肉", unit: "斤" },
    ])
  })

  test("保存时按生名挂上已 resolve 的食材", () => {
    const items = [
      createEditableRecipeItem({
        key: "onion",
        rawName: "葱",
        quantity: "1",
        unit: "把",
      }),
    ]
    expect(toResolvedRecipeItems(items, new Map([["葱", scallion]]))).toEqual([
      {
        rawName: "葱",
        quantity: 1,
        unit: "把",
        ingredientId: "ing-scallion",
        matchStatus: "linked",
      },
    ])
  })
})

describe("normalizeRecipeFields", () => {
  test("空名、空步骤和无效数字有默认值", () => {
    expect(
      normalizeRecipeFields({
        name: "  ",
        servings: "abc",
        minutes: "",
        steps: "热锅\n\n下菜\n",
      })
    ).toEqual({
      name: "未命名食谱",
      servings: 1,
      approxMinutes: null,
      steps: ["热锅", "下菜"],
    })
  })

  test("保留有效的基准份数和分钟", () => {
    expect(
      normalizeRecipeFields({
        name: "小白菜炒肉",
        servings: "2",
        minutes: "20",
        steps: ["肉切片", "炒软起锅"],
      })
    ).toEqual({
      name: "小白菜炒肉",
      servings: 2,
      approxMinutes: 20,
      steps: ["肉切片", "炒软起锅"],
    })
  })
})

describe("recipeItemReplacement", () => {
  test("旧行全删，新行另写", () => {
    const existing: Array<Pick<RecipeItem, "id">> = [
      { id: "ri-old" },
      { id: "ri-gone" },
    ]
    const next = recipeItemReplacement(
      "rec-1",
      existing,
      [
        {
          rawName: "蒜",
          quantity: 3,
          unit: "瓣",
          ingredientId: null,
          matchStatus: "unlinked",
        },
      ],
      () => "ri-new"
    )
    expect(next.removeIds).toEqual(["ri-old", "ri-gone"])
    expect(next.writes).toEqual([
      {
        id: "ri-new",
        recipeId: "rec-1",
        rawName: "蒜",
        quantity: 3,
        unit: "瓣",
        ingredientId: null,
        matchStatus: "unlinked",
      },
    ])
  })
})

describe("shouldRegenShoppingForRecipe", () => {
  test("未做的计划里有这道菜才要重算", () => {
    expect(
      shouldRegenShoppingForRecipe("rec-1", [
        plan({ id: "p1", recipeId: "rec-1" }),
      ])
    ).toBe(true)
    expect(
      shouldRegenShoppingForRecipe("rec-1", [
        plan({
          id: "p2",
          recipeId: "rec-1",
          status: "cooked",
          cookedAt: "2026-09-17T08:00:00.000Z",
        }),
      ])
    ).toBe(false)
    expect(
      shouldRegenShoppingForRecipe("rec-1", [
        plan({ id: "p3", recipeId: "rec-other" }),
      ])
    ).toBe(false)
  })
})
