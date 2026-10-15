import { describe, expect, test } from "vitest"
import {
  filterInventoryByCategory,
  filterInventoryBySearch,
  inventoryCategoryFilterLabel,
  inventorySearchQuery,
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
  test("全部和分类用中文短标签", () => {
    expect(inventoryCategoryFilterLabel("all")).toBe("全部")
    expect(inventoryCategoryFilterLabel("meat")).toBe("肉")
    expect(inventoryCategoryFilterLabel("veg")).toBe("菜")
    expect(inventoryCategoryFilterLabel("dry")).toBe("干货")
    expect(inventoryCategoryFilterLabel("seasoning")).toBe("调味")
    expect(inventoryCategoryFilterLabel("other")).toBe("其他")
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

function named(
  id: string,
  name: string,
  category: Category,
  aliases: string[] = []
): Pick<Ingredient, "id" | "name" | "category" | "aliases"> {
  return { id, name, category, aliases }
}

const catalog = new Map(
  [
    named("ing-salt", "食盐", "seasoning", ["盐"]),
    named("ing-sodium", "Sodium", "seasoning", ["盐"]),
    named("ing-sea", "Sea Salt", "seasoning"),
    named("ing-leaf", "小白菜", "veg"),
    named("ing-pork", "五花肉", "meat"),
  ].map((item) => [item.id, item])
)

const stock = [
  { id: "soon-salt", ingredientId: "ing-salt" },
  { id: "later-salt", ingredientId: "ing-sodium" },
  { id: "sea", ingredientId: "ing-sea" },
  { id: "leaf", ingredientId: "ing-leaf" },
  { id: "pork", ingredientId: "ing-pork" },
]

describe("filterInventoryBySearch", () => {
  test("空查询和纯空白不过滤", () => {
    expect(inventorySearchQuery("  ")).toBe("")
    expect(filterInventoryBySearch(stock, catalog, "")).toBe(stock)
    expect(filterInventoryBySearch(stock, catalog, "   ")).toBe(stock)
  })

  test("食材名包含即命中，盐能匹配食盐，并忽略空格和大小写", () => {
    expect(
      filterInventoryBySearch(stock, catalog, "盐").map((item) => item.id)
    ).toEqual(["soon-salt", "later-salt"])
    expect(
      filterInventoryBySearch(stock, catalog, " 食 盐 ").map((item) => item.id)
    ).toEqual(["soon-salt"])
    expect(
      filterInventoryBySearch(stock, catalog, " SALT ").map((item) => item.id)
    ).toEqual(["sea"])
    expect(
      filterInventoryBySearch(stock, catalog, "s a l t").map((item) => item.id)
    ).toEqual(["sea"])
  })

  test("别名包含也命中，名字不含关键词时仍能搜到", () => {
    expect(
      filterInventoryBySearch(stock, catalog, "盐").map((item) => item.id)
    ).toContain("later-salt")
    expect(
      filterInventoryBySearch(
        [{ id: "only-alias", ingredientId: "ing-sodium" }],
        catalog,
        "盐"
      ).map((item) => item.id)
    ).toEqual(["only-alias"])
  })

  test("保持传入顺序，不把临期项打乱", () => {
    expect(
      filterInventoryBySearch(stock, catalog, "盐").map((item) => item.id)
    ).toEqual(["soon-salt", "later-salt"])
  })

  test("可以和分类筛选叠加", () => {
    const seasoning = filterInventoryByCategory(stock, catalog, "seasoning")
    expect(
      filterInventoryBySearch(seasoning, catalog, "盐").map((item) => item.id)
    ).toEqual(["soon-salt", "later-salt"])
    const veg = filterInventoryByCategory(stock, catalog, "veg")
    expect(filterInventoryBySearch(veg, catalog, "盐")).toEqual([])
    const meat = filterInventoryByCategory(stock, catalog, "meat")
    expect(
      filterInventoryBySearch(meat, catalog, "肉").map((item) => item.id)
    ).toEqual(["pork"])
  })

  test("没有食材档案的行在有关键词时不命中", () => {
    const orphan = { id: "orphan", ingredientId: "ing-unknown" }
    expect(filterInventoryBySearch([orphan], catalog, "")).toEqual([orphan])
    expect(filterInventoryBySearch([orphan], catalog, "盐")).toEqual([])
  })

  test("不相关的名字不会被带上", () => {
    expect(
      filterInventoryBySearch(stock, catalog, "白菜").map((item) => item.id)
    ).toEqual(["leaf"])
  })
})
