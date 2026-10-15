import { describe, expect, test } from "vitest"
import { createSampleDataset } from "@/lib/sample-data"
import { selectSyncRows } from "@/lib/sync/local"
import type { StoreName } from "@/lib/types"

function groupedFromDataset(
  dataset: ReturnType<typeof createSampleDataset>,
  extra: Partial<
    Record<StoreName, Array<{ id: string } & Record<string, unknown>>>
  > = {}
) {
  const grouped = new Map<
    StoreName,
    Array<{ id: string } & Record<string, unknown>>
  >()
  grouped.set("ingredients", [
    ...dataset.ingredients,
    ...(extra.ingredients ?? []),
  ])
  grouped.set("inventory_items", [
    ...dataset.inventory,
    ...(extra.inventory_items ?? []),
  ])
  grouped.set("recipes", [...dataset.recipes, ...(extra.recipes ?? [])])
  grouped.set("recipe_items", [
    ...dataset.recipeItems,
    ...(extra.recipe_items ?? []),
  ])
  grouped.set("plan_entries", [...dataset.plan, ...(extra.plan_entries ?? [])])
  grouped.set("shopping_items", [
    ...dataset.shopping,
    ...(extra.shopping_items ?? []),
  ])
  return grouped
}

describe("示例数据不同步上传", () => {
  test("没改过的示例编号不会进入上传列表", () => {
    const rows = selectSyncRows(
      groupedFromDataset(
        createSampleDataset(new Date("2026-10-15T00:00:00.000Z"))
      )
    )
    const ids = rows.map((row) => row.id)
    expect(ids).not.toContain("ing-pork")
    expect(ids).not.toContain("inv-bokchoy")
    expect(ids).not.toContain("rec-stirfry")
    expect(ids).not.toContain("ri-stirfry-pork")
    expect(ids).not.toContain("plan-today")
    expect(ids.some((id) => id.startsWith("shop-seed-"))).toBe(false)
  })

  test("改过的示例食材会上传，并带上分类和大类", () => {
    const dataset = createSampleDataset(new Date("2026-10-15T00:00:00.000Z"))
    const pork = dataset.ingredients.find((item) => item.id === "ing-pork")
    if (!pork) throw new Error("missing sample pork")
    dataset.ingredients = dataset.ingredients.map((item) =>
      item.id === "ing-pork"
        ? {
            ...item,
            name: "五花肉（家里的）",
            category: "meat",
            family: "猪肉",
            buyable: true,
            kind: "fresh",
            purchaseUnit: "斤",
            updatedAt: "2026-10-15T01:00:00.000Z",
          }
        : item
    )
    const rows = selectSyncRows(
      groupedFromDataset(dataset, {
        ingredients: [
          {
            id: "ing-user-soy",
            name: "生抽",
            aliases: [],
            category: "seasoning",
            defaultUnit: "瓶",
            stallHint: null,
            defaultShelfLifeDays: 365,
            kind: "staple",
            purchaseUnit: "瓶",
            family: "酱油",
            buyable: true,
            updatedAt: "2026-10-15T02:00:00.000Z",
          },
        ],
      })
    )
    const changed = rows.find((row) => row.id === "ing-pork")
    const user = rows.find((row) => row.id === "ing-user-soy")
    expect(changed?.payload).toMatchObject({
      name: "五花肉（家里的）",
      category: "meat",
      family: "猪肉",
      buyable: true,
    })
    expect(user?.payload).toMatchObject({
      category: "seasoning",
      family: "酱油",
      kind: "staple",
      purchaseUnit: "瓶",
      buyable: true,
    })
  })

  test("清除示例后的软删除会上传，避免云端再拉回来", () => {
    const dataset = createSampleDataset(new Date("2026-10-15T00:00:00.000Z"))
    const pork = dataset.ingredients.find((item) => item.id === "ing-pork")
    if (!pork) throw new Error("missing sample pork")
    dataset.ingredients = dataset.ingredients.filter(
      (item) => item.id !== "ing-pork"
    )
    const rows = selectSyncRows(
      groupedFromDataset(dataset, {
        ingredients: [
          {
            ...pork,
            deletedAt: "2026-10-15T03:00:00.000Z",
            updatedAt: "2026-10-15T03:00:00.000Z",
          },
        ],
      })
    )
    const tombstone = rows.find((row) => row.id === "ing-pork")
    expect(tombstone?.deletedAt).toBe("2026-10-15T03:00:00.000Z")
    expect(rows.some((row) => row.id === "ing-bokchoy")).toBe(false)
  })
})
