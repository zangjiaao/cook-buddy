import { describe, expect, test } from "vitest"
import {
  createSampleDataset,
  emptySampleSnapshot,
  missingSampleRecords,
  planSampleClearance,
  sampleClearanceCount,
  sampleRecordCount,
} from "@/lib/sample-data"
import type { SampleSnapshot } from "@/lib/sample-data"
import type { Ingredient, Recipe, RecipeItem } from "@/lib/types"

const now = new Date("2026-10-15T08:00:00.000Z")

function clone(snapshot: SampleSnapshot): SampleSnapshot {
  return structuredClone(snapshot)
}

describe("示例数据", () => {
  test("整套示例都标成示例，而且可以整份清掉", () => {
    const dataset = createSampleDataset(now)
    expect(dataset.ingredients.every((row) => row.sample === true)).toBe(true)
    expect(dataset.recipes.every((row) => row.sample === true)).toBe(true)
    expect(
      dataset.shopping.every((row) => row.id.startsWith("shop-seed-"))
    ).toBe(true)
    const clearance = planSampleClearance(dataset, dataset)
    expect(clearance.recipeIds).toEqual(["rec-stirfry", "rec-soup"])
    expect(clearance.inventoryIds).toContain("inv-pork")
    expect(clearance.planIds).toEqual(["plan-today", "plan-tomorrow"])
    expect(clearance.ingredientIds).toEqual(
      dataset.ingredients.map((row) => row.id)
    )
    expect(clearance.shoppingIds.length).toBe(dataset.shopping.length)
    expect(sampleClearanceCount(clearance)).toBe(sampleRecordCount(dataset))
  })

  test("已经有的编号不会再写入", () => {
    const dataset = createSampleDataset(now)
    const current = emptySampleSnapshot()
    current.ingredients = [dataset.ingredients[0]]
    const missing = missingSampleRecords(current, dataset)
    expect(missing.ingredients.map((row) => row.id)).not.toContain("ing-pork")
    expect(missing.inventory.map((row) => row.id)).toContain("inv-pork")
  })

  test("改过数量或保质期的库存留下，没改过的按写入日判断", () => {
    const dataset = createSampleDataset(now)
    const current = clone(dataset)
    const pork = current.inventory.find((row) => row.id === "inv-pork")
    pork!.quantity = 3
    const garlic = current.inventory.find((row) => row.id === "inv-garlic")
    garlic!.expiresAt = "2026-12-01"
    const clearance = planSampleClearance(current, dataset)
    expect(clearance.inventoryIds).not.toContain("inv-pork")
    expect(clearance.inventoryIds).not.toContain("inv-garlic")
    expect(clearance.inventoryIds).toContain("inv-soy")
    expect(clearance.ingredientIds).not.toContain("ing-pork")
    expect(clearance.ingredientIds).not.toContain("ing-garlic")
  })

  test("改过的菜谱整道留下，并保住它用到的食材", () => {
    const dataset = createSampleDataset(now)
    const current = clone(dataset)
    const stirfry = current.recipes.find((row) => row.id === "rec-stirfry")
    stirfry!.name = "我家炒肉"
    const clearance = planSampleClearance(current, dataset)
    expect(clearance.recipeIds).toEqual(["rec-soup"])
    expect(
      clearance.recipeItemIds.some((id) => id.startsWith("ri-stirfry"))
    ).toBe(false)
    expect(clearance.ingredientIds).not.toContain("ing-pork")
    expect(clearance.ingredientIds).not.toContain("ing-bokchoy")
    expect(clearance.ingredientIds).toContain("ing-tofu")
  })

  test("自己的菜谱引用了示例食材时，档案留下", () => {
    const dataset = createSampleDataset(now)
    const current = clone(dataset)
    const recipe: Recipe = {
      id: "rec-user",
      name: "红烧肉",
      servings: 2,
      approxMinutes: 40,
      steps: ["炖"],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
    const item: RecipeItem = {
      id: "ri-user",
      recipeId: "rec-user",
      ingredientId: "ing-pork",
      rawName: "五花肉",
      quantity: 1,
      unit: "斤",
      matchStatus: "linked",
    }
    current.recipes.push(recipe)
    current.recipeItems.push(item)
    const clearance = planSampleClearance(current, dataset)
    expect(clearance.recipeIds).not.toContain("rec-user")
    expect(clearance.ingredientIds).not.toContain("ing-pork")
    expect(clearance.ingredientIds).toContain("ing-scallion")
  })

  test("做过的计划留下，勾过的清单留下", () => {
    const dataset = createSampleDataset(now)
    const current = clone(dataset)
    const today = current.plan.find((row) => row.id === "plan-today")
    if (!today) throw new Error("缺少今天的示例计划")
    today.status = "cooked"
    today.cookedAt = now.toISOString()
    const line = current.shopping[0]
    line.status = "bought"
    const extra = current.shopping.find((row) => row.id !== line.id)
    if (extra) extra.fromPlanEntryIds = ["plan-today", "plan-user"]
    const clearance = planSampleClearance(current, dataset)
    expect(clearance.planIds).toEqual(["plan-tomorrow"])
    expect(clearance.shoppingIds).not.toContain(line.id)
    if (extra) expect(clearance.shoppingIds).not.toContain(extra.id)
  })

  test("改过名字的示例食材不会被清掉", () => {
    const dataset = createSampleDataset(now)
    const current = clone(dataset)
    const soy = current.ingredients.find(
      (row) => row.id === "ing-soy"
    ) as Ingredient
    soy.name = "我家生抽"
    const clearance = planSampleClearance(current, dataset)
    expect(clearance.ingredientIds).not.toContain("ing-soy")
  })
})
