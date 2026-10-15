import { describe, expect, test } from "vitest"
import { visibleRecipeGroups } from "@/lib/recipe-organize"
import {
  filterRecipesBySearch,
  recipeIngredientHint,
  recipeSearchQuery,
} from "@/lib/recipe-search"
import type { RecipeSearchItem } from "@/lib/recipe-search"
import type { Ingredient, Recipe } from "@/lib/types"

function recipe(
  partial: Pick<Recipe, "id" | "name"> & Partial<Recipe>
): Recipe {
  return {
    servings: 2,
    approxMinutes: 15,
    steps: [],
    createdAt: "2026-09-16T00:00:00.000Z",
    updatedAt: "2026-09-16T00:00:00.000Z",
    ...partial,
  }
}

function ingredient(
  id: string,
  name: string,
  aliases: string[] = []
): Pick<Ingredient, "id" | "name" | "aliases"> {
  return { id, name, aliases }
}

const stirfry = recipe({
  id: "rec-stirfry",
  name: "小白菜炒肉",
  favorited: true,
  favoritedAt: "2026-09-17T10:00:00.000Z",
  tags: ["hun"],
  updatedAt: "2026-09-17T10:00:00.000Z",
})
const soup = recipe({
  id: "rec-soup",
  name: "豆腐粉丝汤",
  favorited: true,
  favoritedAt: "2026-09-18T08:00:00.000Z",
  tags: ["tang", "su"],
  updatedAt: "2026-09-16T00:00:00.000Z",
})
const rice = recipe({
  id: "rec-rice",
  name: "蛋炒饭",
  tags: ["hun", "zhushi"],
  updatedAt: "2026-09-18T12:00:00.000Z",
})
const greens = recipe({
  id: "rec-greens",
  name: "清炒时蔬",
  tags: ["su"],
  updatedAt: "2026-09-15T00:00:00.000Z",
})
const braise = recipe({
  id: "rec-braise",
  name: "红烧肉",
  tags: ["hun"],
  updatedAt: "2026-09-14T00:00:00.000Z",
})
const eggDrop = recipe({
  id: "rec-eggdrop",
  name: "紫菜蛋花",
  tags: ["tang"],
  updatedAt: "2026-09-13T00:00:00.000Z",
})
const tomato = recipe({
  id: "rec-tomato",
  name: "Tomato Soup",
  tags: [],
  updatedAt: "2026-09-12T00:00:00.000Z",
})

const catalog = new Map(
  [
    ingredient("ing-pork", "五花肉"),
    ingredient("ing-bokchoy", "小白菜"),
    ingredient("ing-salt", "食盐", ["盐"]),
    ingredient("ing-sodium", "Sodium", ["盐"]),
    ingredient("ing-sea", "Sea Salt"),
    ingredient("ing-soy", "生抽"),
    ingredient("ing-garlic", "蒜"),
  ].map((item) => [item.id, item])
)

const items: RecipeSearchItem[] = [
  { recipeId: "rec-stirfry", rawName: "五花肉", ingredientId: "ing-pork" },
  { recipeId: "rec-stirfry", rawName: "小白菜", ingredientId: "ing-bokchoy" },
  { recipeId: "rec-stirfry", rawName: "生抽", ingredientId: "ing-soy" },
  { recipeId: "rec-soup", rawName: "粉丝", ingredientId: null },
  { recipeId: "rec-soup", rawName: "生抽", ingredientId: "ing-soy" },
  { recipeId: "rec-greens", rawName: "蒜", ingredientId: "ing-garlic" },
  { recipeId: "rec-braise", rawName: "五花肉", ingredientId: "ing-pork" },
  { recipeId: "rec-braise", rawName: "调味", ingredientId: "ing-salt" },
  { recipeId: "rec-rice", rawName: "Sodium", ingredientId: "ing-sodium" },
  { recipeId: "rec-eggdrop", rawName: "紫菜", ingredientId: null },
  { recipeId: "rec-eggdrop", rawName: "高汤", ingredientId: null },
  { recipeId: "rec-tomato", rawName: "番茄", ingredientId: "ing-sea" },
]

const recipes = [stirfry, soup, rice, greens, braise, eggDrop, tomato]

function ids(query: string) {
  return filterRecipesBySearch(recipes, items, catalog, query).map(
    (recipe) => recipe.id
  )
}

describe("filterRecipesBySearch", () => {
  test("空查询和纯空白不过滤", () => {
    expect(recipeSearchQuery("  ")).toBe("")
    expect(filterRecipesBySearch(recipes, items, catalog, "")).toBe(recipes)
    expect(filterRecipesBySearch(recipes, items, catalog, "   ")).toBe(recipes)
  })

  test("菜名包含即命中，并忽略空格和大小写", () => {
    expect(ids("白菜")).toEqual(["rec-stirfry"])
    expect(ids(" 小 白 菜 ")).toEqual(["rec-stirfry"])
    expect(ids(" TOMATO ")).toEqual(["rec-tomato"])
    expect(ids("t o m a t o")).toEqual(["rec-tomato"])
  })

  test("标签中文名包含即命中", () => {
    expect(ids("素菜")).toEqual(["rec-soup", "rec-greens"])
    expect(ids("汤")).toContain("rec-eggdrop")
    expect(ids("主食")).toEqual(["rec-rice"])
  })

  test("食材名、rawName 和别名包含即命中", () => {
    expect(ids("盐")).toEqual(["rec-rice", "rec-braise"])
    expect(ids("食盐")).toEqual(["rec-braise"])
    expect(ids("粉丝")).toEqual(["rec-soup"])
    expect(ids(" SALT ")).toEqual(["rec-tomato"])
    expect(ids("蒜")).toEqual(["rec-greens"])
  })

  test("不相关的词不会带上别的菜", () => {
    expect(ids("生菜")).toEqual([])
  })

  test("保持传入顺序", () => {
    expect(ids("生抽")).toEqual(["rec-stirfry", "rec-soup"])
  })

  test("可以和收藏分组、标签筛选叠加，收藏顺序不变", () => {
    const groups = visibleRecipeGroups(recipes, "all")
    expect(
      filterRecipesBySearch(groups.favorites, items, catalog, "生抽").map(
        (recipe) => recipe.id
      )
    ).toEqual(["rec-soup", "rec-stirfry"])
    expect(
      filterRecipesBySearch(groups.rest, items, catalog, "生抽").map(
        (recipe) => recipe.id
      )
    ).toEqual([])

    const su = visibleRecipeGroups(recipes, "su")
    expect(
      filterRecipesBySearch(su.favorites, items, catalog, "生抽").map(
        (recipe) => recipe.id
      )
    ).toEqual(["rec-soup"])
    expect(
      filterRecipesBySearch(su.rest, items, catalog, "生抽").map(
        (recipe) => recipe.id
      )
    ).toEqual([])
    expect(
      filterRecipesBySearch(
        visibleRecipeGroups(recipes, "hun").rest,
        items,
        catalog,
        "盐"
      ).map((recipe) => recipe.id)
    ).toEqual(["rec-rice", "rec-braise"])
  })
})

describe("recipeIngredientHint", () => {
  test("菜名或标签命中时不提示，即使食材也对得上", () => {
    expect(recipeIngredientHint(stirfry, items, catalog, "白菜")).toBeNull()
    expect(recipeIngredientHint(eggDrop, items, catalog, "汤")).toBeNull()
    expect(recipeIngredientHint(soup, items, catalog, "素菜")).toBeNull()
  })

  test("只因食材命中时提示去掉首尾空白的搜索词", () => {
    expect(recipeIngredientHint(braise, items, catalog, "盐")).toBe("盐")
    expect(recipeIngredientHint(braise, items, catalog, " 食盐 ")).toBe("食盐")
    expect(recipeIngredientHint(braise, items, catalog, " 食 盐 ")).toBe(
      "食 盐"
    )
    expect(recipeIngredientHint(rice, items, catalog, "盐")).toBe("盐")
    expect(recipeIngredientHint(soup, items, catalog, "粉丝")).toBeNull()
    expect(recipeIngredientHint(greens, items, catalog, "蒜")).toBe("蒜")
    expect(recipeIngredientHint(tomato, items, catalog, " salt ")).toBe("salt")
  })

  test("没有命中或空查询不提示", () => {
    expect(recipeIngredientHint(stirfry, items, catalog, "")).toBeNull()
    expect(recipeIngredientHint(stirfry, items, catalog, "盐")).toBeNull()
    expect(recipeIngredientHint(braise, items, catalog, "   ")).toBeNull()
  })
})
