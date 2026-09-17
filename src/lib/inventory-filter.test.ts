import { describe, expect, test } from "vitest"
import {
  filterInventoryByCategory,
  inventoryCategoryFilterLabel,
  isInventoryCategoryFilter,
} from "@/lib/inventory-filter"
import type { Category, Ingredient } from "@/lib/types"

function ingredient(
  id: string,
  category: Category
): Pick<Ingredient, "id" | "category"> {
  return { id, category }
}

const byId = new Map(
  [
    ingredient("ing-pork", "meat"),
    ingredient("ing-bokchoy", "veg"),
    ingredient("ing-cilantro", "veg"),
    ingredient("ing-garlic", "seasoning"),
    ingredient("ing-vermicelli", "dry"),
  ].map((item) => [item.id, item])
)

describe("inventoryCategoryFilterLabel", () => {
  test("全部和四个分类用中文短标签", () => {
    expect(inventoryCategoryFilterLabel("all")).toBe("全部")
    expect(inventoryCategoryFilterLabel("meat")).toBe("肉")
    expect(inventoryCategoryFilterLabel("veg")).toBe("菜")
    expect(inventoryCategoryFilterLabel("dry")).toBe("干货")
    expect(inventoryCategoryFilterLabel("seasoning")).toBe("调味")
  })
})

describe("isInventoryCategoryFilter", () => {
  test("只认全部和已知分类", () => {
    expect(isInventoryCategoryFilter("all")).toBe(true)
    expect(isInventoryCategoryFilter("meat")).toBe(true)
    expect(isInventoryCategoryFilter("fridge")).toBe(false)
    expect(isInventoryCategoryFilter("")).toBe(false)
  })
})

describe("filterInventoryByCategory", () => {
  const items = [
    { id: "expired-veg", ingredientId: "ing-bokchoy" },
    { id: "soon-meat", ingredientId: "ing-pork" },
    { id: "fresh-veg", ingredientId: "ing-cilantro" },
    { id: "pantry-seasoning", ingredientId: "ing-garlic" },
    { id: "dry-missing-in-stock-map", ingredientId: "ing-vermicelli" },
  ]

  test("全部不过滤，保持传入顺序", () => {
    expect(
      filterInventoryByCategory(items, byId, "all").map((item) => item.id)
    ).toEqual(items.map((item) => item.id))
  })

  test("按食材分类筛，并保持临期优先的传入顺序", () => {
    expect(
      filterInventoryByCategory(items, byId, "veg").map((item) => item.id)
    ).toEqual(["expired-veg", "fresh-veg"])
    expect(
      filterInventoryByCategory(items, byId, "meat").map((item) => item.id)
    ).toEqual(["soon-meat"])
    expect(
      filterInventoryByCategory(items, byId, "seasoning").map((item) => item.id)
    ).toEqual(["pantry-seasoning"])
    expect(
      filterInventoryByCategory(items, byId, "dry").map((item) => item.id)
    ).toEqual(["dry-missing-in-stock-map"])
  })

  test("找不到食材档案的行只出现在全部里", () => {
    const orphan = { id: "orphan", ingredientId: "ing-unknown" }
    expect(filterInventoryByCategory([orphan], byId, "all")).toEqual([orphan])
    expect(filterInventoryByCategory([orphan], byId, "veg")).toEqual([])
  })
})
