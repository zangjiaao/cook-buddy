import { describe, expect, test } from "vitest"
import {
  RECIPE_TAG_HINT,
  applyRecipeFavorite,
  applyRecipeTags,
  filterRecipesByTag,
  isRecipeTag,
  isRecipeTagFilter,
  normalizeRecipe,
  partitionFavoriteRecipes,
  recipeFavoriteFields,
  recipeNeedsMigrate,
  recipeTagFilterLabel,
  recipeTagLabel,
  sanitizeRecipeTags,
  sortRecipesForList,
  toggleRecipeTag,
  visibleRecipeGroups,
} from "@/lib/recipe-organize"
import type { Recipe } from "@/lib/types"

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

describe("recipe tag preset", () => {
  test("固定四类家常标签", () => {
    expect(recipeTagLabel).toEqual({
      hun: "荤菜",
      su: "素菜",
      tang: "汤羹",
      zhushi: "主食",
    })
    expect(RECIPE_TAG_HINT).toContain("可多选")
    expect(recipeTagFilterLabel("all")).toBe("全部")
    expect(recipeTagFilterLabel("tang")).toBe("汤羹")
  })

  test("只认预设标签", () => {
    expect(isRecipeTag("hun")).toBe(true)
    expect(isRecipeTag("川菜")).toBe(false)
    expect(isRecipeTagFilter("all")).toBe(true)
    expect(isRecipeTagFilter("fridge")).toBe(false)
  })

  test("清洗时丢掉未知标签、去重并按预设顺序", () => {
    expect(sanitizeRecipeTags(["zhushi", "川菜", "hun", "hun", "su"])).toEqual([
      "hun",
      "su",
      "zhushi",
    ])
    expect(sanitizeRecipeTags(undefined)).toEqual([])
    expect(sanitizeRecipeTags("荤菜")).toEqual([])
  })

  test("切换标签可多选", () => {
    expect(toggleRecipeTag([], "hun")).toEqual(["hun"])
    expect(toggleRecipeTag(["hun"], "tang")).toEqual(["hun", "tang"])
    expect(toggleRecipeTag(["hun", "tang"], "hun")).toEqual(["tang"])
  })
})

describe("normalizeRecipe / migrate", () => {
  test("缺字段补上常做和空标签", () => {
    expect(normalizeRecipe(recipe({ id: "r1", name: "炒青菜" }))).toMatchObject(
      {
        favorited: false,
        favoritedAt: null,
        tags: [],
      }
    )
  })

  test("已钉但没有钉上时间时用更新时间", () => {
    expect(
      normalizeRecipe(
        recipe({
          id: "r2",
          name: "红烧肉",
          favorited: true,
          updatedAt: "2026-09-18T08:00:00.000Z",
        })
      )
    ).toMatchObject({
      favorited: true,
      favoritedAt: "2026-09-18T08:00:00.000Z",
      tags: [],
    })
  })

  test("取消常做清掉钉上时间，未知标签丢掉", () => {
    expect(
      normalizeRecipe(
        recipe({
          id: "r3",
          name: "番茄蛋汤",
          favorited: false,
          favoritedAt: "2026-09-18T08:00:00.000Z",
          tags: ["tang", "川菜", "su"],
        })
      )
    ).toMatchObject({
      favorited: false,
      favoritedAt: null,
      tags: ["su", "tang"],
    })
  })

  test("旧记录或脏标签需要迁移", () => {
    expect(recipeNeedsMigrate(recipe({ id: "old", name: "旧菜" }))).toBe(true)
    expect(
      recipeNeedsMigrate(
        recipe({
          id: "ok",
          name: "排骨汤",
          favorited: true,
          favoritedAt: "2026-09-18T08:00:00.000Z",
          tags: ["hun", "tang"],
        })
      )
    ).toBe(false)
    expect(
      recipeNeedsMigrate(
        recipe({
          id: "dirty",
          name: "乱标签",
          favorited: false,
          tags: ["hun", "川菜"],
        })
      )
    ).toBe(true)
    expect(
      recipeNeedsMigrate(
        recipe({
          id: "order",
          name: "顺序不对",
          favorited: false,
          tags: ["tang", "hun"],
        })
      )
    ).toBe(true)
  })
})

describe("apply favorite / tags", () => {
  test("第一次钉上记下时间，再钉保持原时间", () => {
    const first = recipeFavoriteFields(true, undefined, "t1")
    expect(first).toEqual({ favorited: true, favoritedAt: "t1" })
    expect(recipeFavoriteFields(true, first, "t2")).toEqual({
      favorited: true,
      favoritedAt: "t1",
    })
    expect(recipeFavoriteFields(false, first, "t2")).toEqual({
      favorited: false,
      favoritedAt: null,
    })
  })

  test("写回食谱时更新 updatedAt", () => {
    const base = recipe({ id: "r", name: "米饭", tags: ["zhushi"] })
    expect(applyRecipeFavorite(base, true, "t-fav")).toMatchObject({
      favorited: true,
      favoritedAt: "t-fav",
      updatedAt: "t-fav",
      tags: ["zhushi"],
    })
    expect(
      applyRecipeTags(base, ["zhushi", "su", "川菜"], "t-tag")
    ).toMatchObject({
      tags: ["su", "zhushi"],
      updatedAt: "t-tag",
      favorited: false,
    })
  })
})

describe("sort / filter helpers", () => {
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

  test("常做在前，新钉的更靠前；其余按最近更新", () => {
    expect(
      sortRecipesForList([greens, rice, stirfry, soup]).map((item) => item.id)
    ).toEqual(["rec-soup", "rec-stirfry", "rec-rice", "rec-greens"])
  })

  test("按标签筛并保持传入顺序", () => {
    const rows = [stirfry, soup, rice, greens]
    expect(filterRecipesByTag(rows, "all").map((item) => item.id)).toEqual(
      rows.map((item) => item.id)
    )
    expect(filterRecipesByTag(rows, "su").map((item) => item.id)).toEqual([
      "rec-soup",
      "rec-greens",
    ])
    expect(filterRecipesByTag(rows, "zhushi").map((item) => item.id)).toEqual([
      "rec-rice",
    ])
    expect(filterRecipesByTag(rows, "hun").map((item) => item.id)).toEqual([
      "rec-stirfry",
      "rec-rice",
    ])
  })

  test("分组后常做和其他分开", () => {
    expect(
      partitionFavoriteRecipes([stirfry, rice]).favorites.map((item) => item.id)
    ).toEqual(["rec-stirfry"])
    expect(
      partitionFavoriteRecipes([stirfry, rice]).rest.map((item) => item.id)
    ).toEqual(["rec-rice"])
  })

  test("可见分组：先筛标签再排序再拆常做", () => {
    const grouped = visibleRecipeGroups([greens, rice, stirfry, soup], "su")
    expect(grouped.favorites.map((item) => item.id)).toEqual(["rec-soup"])
    expect(grouped.rest.map((item) => item.id)).toEqual(["rec-greens"])

    const all = visibleRecipeGroups([greens, rice, stirfry, soup], "all")
    expect(all.favorites.map((item) => item.id)).toEqual([
      "rec-soup",
      "rec-stirfry",
    ])
    expect(all.rest.map((item) => item.id)).toEqual(["rec-rice", "rec-greens"])

    const empty = visibleRecipeGroups([greens], "hun")
    expect(empty.favorites).toEqual([])
    expect(empty.rest).toEqual([])
  })
})
