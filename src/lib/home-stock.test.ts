import { describe, expect, test } from "vitest"
import { mergeInventoryAdds } from "@/lib/inventory-add"
import { normalizeIngredient } from "@/lib/ingredient-kind"
import {
  homeStockDefaults,
  homeStockQuantity,
  homeStockUnit,
} from "@/lib/home-stock"
import {
  buildShoppingFromPlan,
  stallFromCategory,
} from "@/lib/shopping-from-plan"
import { boughtInAisle, groupShoppingForAisle } from "@/lib/shopping-list"
import type {
  Ingredient,
  InventoryItem,
  PlanEntry,
  Recipe,
  RecipeItem,
  ShoppingItem,
} from "@/lib/types"

function ingredient(
  partial: Pick<Ingredient, "id" | "name" | "category"> & Partial<Ingredient>
): Ingredient {
  return normalizeIngredient({
    aliases: [],
    defaultUnit: partial.category === "seasoning" ? "瓶" : "把",
    defaultShelfLifeDays: null,
    ...partial,
    stallHint: partial.stallHint ?? stallFromCategory(partial.category),
  })
}

function inventory(
  partial: Pick<InventoryItem, "ingredientId" | "quantity" | "unit"> &
    Partial<InventoryItem>
): InventoryItem {
  return {
    id: `inv-${partial.ingredientId}-${partial.unit}`,
    location: "fridge",
    purchasedAt: "2026-10-15",
    expiresAt: null,
    notes: "",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    ...partial,
  }
}

function recipe(id: string): Recipe {
  return {
    id,
    name: id,
    servings: 2,
    approxMinutes: 15,
    steps: [],
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
  }
}

function recipeItem(
  partial: Pick<RecipeItem, "recipeId" | "rawName" | "quantity" | "unit"> &
    Partial<RecipeItem>
): RecipeItem {
  return {
    id: `ri-${partial.rawName}`,
    ingredientId: null,
    matchStatus: partial.ingredientId ? "linked" : "unlinked",
    ...partial,
  }
}

function plan(recipeId: string): PlanEntry {
  return {
    id: "p1",
    date: "2026-10-15",
    rangeKey: null,
    recipeId,
    servings: 2,
    sortOrder: 0,
    status: "planned",
    cookedAt: null,
    lastDeduct: null,
  }
}

function unsureItem(
  partial: Partial<ShoppingItem> & Pick<ShoppingItem, "id" | "name">
): ShoppingItem {
  return {
    ingredientId: null,
    quantityHint: "",
    unit: "把",
    stallHint: "veg",
    status: "needed",
    shortage: "unsure",
    fromPlanEntryIds: ["p1"],
    checkedAt: null,
    buyQty: null,
    neededQty: 2,
    source: "plan",
    ...partial,
  }
}

describe("家里有的默认补录", () => {
  const leaf = ingredient({
    id: "ing-leaf",
    name: "小白菜",
    category: "veg",
    defaultUnit: "把",
    purchaseUnit: "把",
    defaultShelfLifeDays: 3,
  })
  const soy = ingredient({
    id: "ing-soy",
    name: "生抽",
    category: "seasoning",
    defaultUnit: "勺",
    purchaseUnit: "瓶",
    kind: "staple",
    defaultShelfLifeDays: 365,
  })

  test("数量用计划需要的量，单位用采购单位", () => {
    const item = unsureItem({
      id: "s-leaf",
      name: "小白菜",
      ingredientId: "ing-leaf",
      unit: "把",
      neededQty: 2,
    })
    expect(homeStockQuantity(item)).toBe("2")
    expect(homeStockUnit(item, leaf)).toBe("把")
    expect(
      homeStockDefaults({
        item,
        ingredient: leaf,
        purchasedAt: "2026-10-15",
      })
    ).toEqual({
      quantity: "2",
      unit: "把",
      location: "fridge",
      expiresAt: "2026-10-18",
    })
  })

  test("调味按瓶和常温，没有计划量时先填 1", () => {
    const item = unsureItem({
      id: "s-soy",
      name: "生抽",
      ingredientId: "ing-soy",
      unit: "瓶",
      stallHint: null,
      neededQty: null,
      quantityHint: "",
    })
    expect(
      homeStockDefaults({
        item,
        ingredient: soy,
        purchasedAt: "2026-10-15",
      })
    ).toMatchObject({
      quantity: "1",
      unit: "瓶",
      location: "pantry",
      expiresAt: "2027-10-15",
    })
  })

  test("已有同单位库存时沿用那一行的位置", () => {
    const item = unsureItem({
      id: "s-soy",
      name: "生抽",
      ingredientId: "ing-soy",
      unit: "瓶",
      stallHint: null,
      neededQty: null,
    })
    const defaults = homeStockDefaults({
      item,
      ingredient: soy,
      inventory: [
        inventory({
          ingredientId: "ing-soy",
          quantity: 1,
          unit: "瓶",
          location: "pantry",
        }),
      ],
      purchasedAt: "2026-10-15",
    })
    expect(defaults.location).toBe("pantry")
    const touched = mergeInventoryAdds(
      [
        inventory({
          ingredientId: "ing-soy",
          quantity: 1,
          unit: "瓶",
          location: "pantry",
        }),
      ],
      [
        {
          ingredientId: "ing-soy",
          quantity: 1,
          unit: defaults.unit,
          location: defaults.location,
          expiresAt: defaults.expiresAt,
        },
      ],
      "2026-10-15T12:00:00.000Z",
      () => "inv-new"
    )
    expect(touched).toEqual([
      expect.objectContaining({
        id: "inv-ing-soy-瓶",
        quantity: 2,
        unit: "瓶",
        location: "pantry",
      }),
    ])
  })
})

describe("记下家里有之后重算", () => {
  test("补上计划量后不再留在不确定分组，也不进待买", () => {
    const leaf = ingredient({
      id: "ing-leaf",
      name: "小白菜",
      category: "veg",
      purchaseUnit: "把",
    })
    const input = {
      planEntries: [plan("rec-a")],
      recipes: [recipe("rec-a")],
      recipeItems: [
        recipeItem({
          recipeId: "rec-a",
          ingredientId: "ing-leaf",
          rawName: "小白菜",
          quantity: 2,
          unit: "把",
        }),
      ],
      ingredients: [leaf],
      existing: [] as ShoppingItem[],
    }
    const before = buildShoppingFromPlan({
      ...input,
      inventory: [
        inventory({
          ingredientId: "ing-leaf",
          quantity: 1,
          unit: "斤",
        }),
      ],
    })
    expect(before.map((item) => item.name)).toEqual(["小白菜"])
    expect(before[0]?.shortage).toBe("unsure")
    const draft = homeStockDefaults({
      item: before[0]!,
      ingredient: leaf,
      inventory: [
        inventory({ ingredientId: "ing-leaf", quantity: 1, unit: "斤" }),
      ],
      purchasedAt: "2026-10-15",
    })
    expect(draft).toMatchObject({ quantity: "2", unit: "把", location: "fridge" })
    const added = mergeInventoryAdds(
      [inventory({ ingredientId: "ing-leaf", quantity: 1, unit: "斤" })],
      [
        {
          ingredientId: "ing-leaf",
          quantity: Number(draft.quantity),
          unit: draft.unit,
          location: draft.location,
          expiresAt: draft.expiresAt,
        },
      ],
      "2026-10-15T12:00:00.000Z",
      () => "inv-new"
    )
    const after = buildShoppingFromPlan({
      ...input,
      inventory: [
        inventory({ ingredientId: "ing-leaf", quantity: 1, unit: "斤" }),
        ...added,
      ],
    })
    const grouped = groupShoppingForAisle(after, [leaf])
    expect(grouped.unsure).toEqual([])
    expect(boughtInAisle(grouped.buy)).toEqual([])
    expect(grouped.buy.flatMap((group) => group.items)).toEqual([])
  })

  test("没点的不确定项留在底部，不算已买", () => {
    const item = unsureItem({ id: "s-leaf", name: "小白菜" })
    const grouped = groupShoppingForAisle([item], [])
    expect(grouped.unsure.map((row) => row.name)).toEqual(["小白菜"])
    expect(boughtInAisle(grouped.buy)).toEqual([])
  })
})
