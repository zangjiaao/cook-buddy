import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { migrateCatalogData } from "@/lib/catalog-migrate"
import type { CatalogMigrationInput } from "@/lib/catalog-migrate"

const NOW = "2026-10-16T00:00:00.000Z"
const SALT = "ing-ba20a836-fba9-4595-aecf-2bcdf009d291"
const TABLE_SALT = "ing-3fd093b3-70f5-4b33-ac3d-2f27e5eda580"

function loadExport(): CatalogMigrationInput {
  const backup = JSON.parse(
    readFileSync(
      new URL("./fixtures/user-export-2026-10-15.json", import.meta.url),
      "utf8"
    )
  ) as { stores: Record<string, unknown[]> }
  return {
    ingredients: backup.stores
      .ingredients as CatalogMigrationInput["ingredients"],
    inventory: backup.stores
      .inventory_items as CatalogMigrationInput["inventory"],
    recipeItems: backup.stores
      .recipe_items as CatalogMigrationInput["recipeItems"],
    shopping: backup.stores.shopping_items as CatalogMigrationInput["shopping"],
    plan: backup.stores.plan_entries as CatalogMigrationInput["plan"],
    now: NOW,
  }
}

function alive<T extends { deletedAt?: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => !row.deletedAt)
}

describe("基准库迁移", () => {
  test("盐和食盐合并到统一名，引用改过去，斤收成克，再跑一次不变", () => {
    const first = migrateCatalogData(loadExport())
    expect(first.changed).toBe(true)

    const salts = alive(first.ingredients).filter(
      (row) =>
        row.catalogId === "cat-salt" || row.name === "盐" || row.name === "食盐"
    )
    expect(salts.map((row) => row.id)).toEqual([SALT])
    expect(salts[0]).toMatchObject({
      name: "盐",
      catalogId: "cat-salt",
      quantityMode: "presence",
    })
    expect(salts[0]?.aliases).toContain("食盐")

    const removed = first.ingredients.find((row) => row.id === TABLE_SALT)
    expect(removed?.deletedAt).toBe(NOW)
    expect(removed?.mergedInto).toBe(SALT)

    const pointsAtRemoved = [
      ...first.inventory,
      ...first.recipeItems,
      ...first.shopping,
    ].filter((row) => "ingredientId" in row && row.ingredientId === TABLE_SALT)
    expect(pointsAtRemoved).toEqual([])
    expect(first.recipeItems.some((row) => row.ingredientId === SALT)).toBe(
      true
    )

    const belly = first.inventory.find(
      (row) => row.id === "inv-4da11300-b22b-40f1-b508-aaa30bf7f6c3"
    )
    expect(belly).toMatchObject({
      quantity: 500,
      unit: "g",
      sourceQuantity: 1,
      sourceUnit: "斤",
    })

    const garlic = first.inventory.find(
      (row) => row.id === "inv-bb86a8a3-0c9e-4835-816d-695b9c700fdb"
    )
    expect(garlic).toMatchObject({ quantity: 5, unit: "头" })

    const second = migrateCatalogData({
      ...first,
      now: "2026-10-17T00:00:00.000Z",
    })
    expect(second.changed).toBe(false)
    expect(second.ingredients).toEqual(first.ingredients)
    expect(second.inventory).toEqual(first.inventory)
    expect(second.recipeItems).toEqual(first.recipeItems)
    expect(second.shopping).toEqual(first.shopping)
    expect(second.plan).toEqual(first.plan)
  })
})
