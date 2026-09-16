import { describe, expect, test } from "vitest"
import type { Ingredient } from "@/lib/types"
import {
  CATEGORY_SHELF_LIFE_DAYS,
  defaultShelfLifeDays,
  suggestExpiresAt,
} from "@/lib/shelf-life"

const leafy: Ingredient = {
  id: "ing-leaf",
  name: "叶菜",
  aliases: [],
  category: "veg",
  defaultUnit: "把",
  stallHint: "veg",
  defaultShelfLifeDays: null,
}

const pork: Ingredient = {
  id: "ing-pork",
  name: "五花肉",
  aliases: [],
  category: "meat",
  defaultUnit: "斤",
  stallHint: "meat",
  defaultShelfLifeDays: 4,
}

describe("defaultShelfLifeDays", () => {
  test("叶菜冷藏默认约 3 天", () => {
    expect(CATEGORY_SHELF_LIFE_DAYS.veg).toBe(3)
    expect(
      defaultShelfLifeDays({ ingredient: leafy, location: "fridge" })
    ).toBe(3)
    expect(defaultShelfLifeDays({ category: "veg", location: "fridge" })).toBe(
      3
    )
  })

  test("冻肉默认约一个月", () => {
    expect(
      defaultShelfLifeDays({ category: "meat", location: "freezer" })
    ).toBe(30)
    expect(
      defaultShelfLifeDays({ ingredient: pork, location: "freezer" })
    ).toBe(30)
  })

  test("干货更长、调味从宽", () => {
    expect(defaultShelfLifeDays({ category: "dry" })).toBe(180)
    expect(defaultShelfLifeDays({ category: "seasoning" })).toBe(365)
  })

  test("食材自己的默认天数覆盖分类（冷藏）", () => {
    expect(defaultShelfLifeDays({ ingredient: pork, location: "fridge" })).toBe(
      4
    )
  })
})

describe("suggestExpiresAt", () => {
  test("购入日加默认天数，不要求生产日期", () => {
    expect(suggestExpiresAt("2026-09-16", 3)).toBe("2026-09-19")
    expect(suggestExpiresAt("2026-09-16", 30)).toBe("2026-10-16")
  })

  test("没有天数就不建议", () => {
    expect(suggestExpiresAt("2026-09-16", null)).toBeNull()
    expect(suggestExpiresAt("", 3)).toBeNull()
  })
})
