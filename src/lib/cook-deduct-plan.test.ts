import { describe, expect, test } from "vitest"
import {
  applyCookDeductionEdits,
  compileCookDeduction,
  planCookDeduction,
} from "@/lib/cook-deduct-plan"
import type { Ingredient, InventoryItem, RecipeItem } from "@/lib/types"

function ingredient(
  partial: Partial<Ingredient> & Pick<Ingredient, "id" | "name">
): Ingredient {
  return {
    aliases: [],
    category: "meat",
    defaultUnit: "g",
    stallHint: "meat",
    defaultShelfLifeDays: 2,
    ...partial,
  }
}

function lot(
  partial: Pick<InventoryItem, "id" | "ingredientId" | "quantity" | "unit"> &
    Partial<InventoryItem>
): InventoryItem {
  return {
    location: "fridge",
    purchasedAt: "2026-10-15",
    expiresAt: partial.expiresAt ?? "2026-10-20",
    notes: "",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    ...partial,
  }
}

function line(
  partial: Pick<RecipeItem, "id" | "rawName" | "quantity" | "unit"> &
    Partial<RecipeItem>
): RecipeItem {
  return {
    recipeId: "rec",
    ingredientId: null,
    matchStatus: "linked",
    ...partial,
  }
}

describe("做完扣库存预览", () => {
  const pork = ingredient({
    id: "ing-pork",
    name: "五花肉",
    catalogId: "cat-belly",
    purchaseUnit: "斤",
    quantityMode: "amount",
  })
  const soy = ingredient({
    id: "ing-soy",
    name: "生抽",
    category: "seasoning",
    defaultUnit: "瓶",
    stallHint: null,
    catalogId: "cat-light-soy",
    purchaseUnit: "瓶",
    quantityMode: "presence",
    kind: "staple",
  })
  const brisket = ingredient({
    id: "ing-brisket",
    name: "牛腩",
    catalogId: "cat-brisket",
    quantityMode: "amount",
  })

  test("按记账单位列出可改数量，常备不扣量，替代品扣替代品", () => {
    const lines = planCookDeduction({
      factor: 1,
      ingredients: [pork, soy, brisket],
      inventory: [
        lot({
          id: "inv-pork",
          ingredientId: "ing-pork",
          quantity: 1,
          unit: "斤",
        }),
        lot({
          id: "inv-brisket",
          ingredientId: "ing-brisket",
          quantity: 300,
          unit: "g",
          expiresAt: "2026-10-16",
        }),
        lot({
          id: "inv-soy",
          ingredientId: "ing-soy",
          quantity: 1,
          unit: "瓶",
        }),
      ],
      items: [
        line({
          id: "ri-pork",
          ingredientId: "ing-pork",
          rawName: "五花肉",
          quantity: 0.4,
          unit: "斤",
        }),
        line({
          id: "ri-soy",
          ingredientId: "ing-soy",
          rawName: "生抽",
          quantity: 1,
          unit: "勺",
        }),
        line({
          id: "ri-sub",
          ingredientId: "ing-pork",
          rawName: "五花肉",
          quantity: 0.2,
          unit: "斤",
          substitution: {
            choice: "use",
            substituteIngredientId: "ing-brisket",
          },
        }),
      ],
    })

    const belly = lines.find((row) => row.ingredientId === "ing-pork")
    const sauce = lines.find((row) => row.ingredientId === "ing-soy")
    const sub = lines.find((row) => row.usingSubstitute)
    expect(belly).toMatchObject({
      quantity: 200,
      unit: "g",
      stockQty: 500,
      skip: false,
    })
    expect(sauce).toMatchObject({
      quantityMode: "presence",
      quantity: 0,
      runningLow: false,
    })
    expect(sub).toMatchObject({
      ingredientId: "ing-brisket",
      quantity: 100,
      unit: "g",
      name: "牛腩（替代 五花肉）",
    })

    const edited = applyCookDeductionEdits(lines, [
      { key: belly?.key ?? "", quantity: 100, skip: false },
      { key: sauce?.key ?? "", runningLow: true },
      { key: sub?.key ?? "", skip: true },
    ])
    const compiled = compileCookDeduction({
      lines: edited,
      inventory: [
        lot({
          id: "inv-pork",
          ingredientId: "ing-pork",
          quantity: 1,
          unit: "斤",
        }),
        lot({
          id: "inv-brisket",
          ingredientId: "ing-brisket",
          quantity: 300,
          unit: "g",
        }),
      ],
      ingredients: [pork, soy, brisket],
    })
    expect(compiled.runningLowIngredientIds).toEqual(["ing-soy"])
    expect(compiled.changes).toEqual([
      {
        inventoryItemId: "inv-pork",
        previousQuantity: 500,
        nextQuantity: 400,
        previousUnit: "斤",
        nextUnit: "g",
      },
    ])
  })

  test("换不了的单位不拿别的单位硬扣", () => {
    const garlic = ingredient({
      id: "ing-garlic",
      name: "蒜",
      category: "seasoning",
      defaultUnit: "头",
      stallHint: null,
      catalogId: "cat-garlic",
      quantityMode: "amount",
    })
    const lines = planCookDeduction({
      factor: 1,
      ingredients: [garlic],
      inventory: [
        lot({
          id: "inv-garlic",
          ingredientId: "ing-garlic",
          quantity: 5,
          unit: "头",
        }),
      ],
      items: [
        line({
          id: "ri-garlic",
          ingredientId: "ing-garlic",
          rawName: "蒜",
          quantity: 3,
          unit: "瓣",
        }),
      ],
    })
    expect(lines[0]?.converted).toBe(false)
    expect(lines[0]?.note).toContain("未能换算")
    const compiled = compileCookDeduction({
      lines,
      inventory: [
        lot({
          id: "inv-garlic",
          ingredientId: "ing-garlic",
          quantity: 5,
          unit: "头",
        }),
      ],
      ingredients: [garlic],
    })
    expect(compiled.changes).toEqual([])
  })
})
