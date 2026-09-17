import { describe, expect, test } from "vitest"
import type { Ingredient } from "@/lib/types"
import {
  inventoryNameAlreadyLinked,
  inventoryStockDefaults,
} from "@/lib/inventory-form-defaults"

const scallion: Ingredient = {
  id: "ing-scallion",
  name: "小葱",
  aliases: ["葱", "青葱"],
  category: "veg",
  defaultUnit: "把",
  stallHint: "veg",
  defaultShelfLifeDays: 3,
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

const soy: Ingredient = {
  id: "ing-soy",
  name: "生抽",
  aliases: [],
  category: "seasoning",
  defaultUnit: "瓶",
  stallHint: null,
  defaultShelfLifeDays: 365,
}

describe("inventoryNameAlreadyLinked", () => {
  test("已有档案且名字对得上就不用再 resolve", () => {
    expect(inventoryNameAlreadyLinked("小葱", scallion.id, scallion)).toBe(true)
    expect(inventoryNameAlreadyLinked("葱", scallion.id, scallion)).toBe(true)
    expect(inventoryNameAlreadyLinked("", scallion.id, scallion)).toBe(true)
  })

  test("改了名字或还没挂上档案就要 resolve", () => {
    expect(inventoryNameAlreadyLinked("香菜", scallion.id, scallion)).toBe(
      false
    )
    expect(inventoryNameAlreadyLinked("小葱", "", scallion)).toBe(false)
    expect(inventoryNameAlreadyLinked("小葱", scallion.id, null)).toBe(false)
  })
})

describe("inventoryStockDefaults", () => {
  test("叶菜按档案填把、冰箱和保质期", () => {
    expect(
      inventoryStockDefaults({
        ingredient: scallion,
        purchasedAt: "2026-09-17",
      })
    ).toEqual({
      unit: "把",
      location: "fridge",
      expiresAt: "2026-09-20",
    })
  })

  test("肉和调味分别用档案单位和默认位置", () => {
    expect(
      inventoryStockDefaults({
        ingredient: pork,
        purchasedAt: "2026-09-17",
      })
    ).toMatchObject({ unit: "斤", location: "fridge", expiresAt: "2026-09-21" })
    expect(
      inventoryStockDefaults({
        ingredient: soy,
        purchasedAt: "2026-09-17",
      })
    ).toMatchObject({
      unit: "瓶",
      location: "pantry",
      expiresAt: "2027-09-17",
    })
  })

  test("用户改过的单位、位置、过期日不覆盖", () => {
    expect(
      inventoryStockDefaults({
        ingredient: pork,
        purchasedAt: "2026-09-17",
        currentUnit: "袋",
        currentLocation: "freezer",
        currentExpiresAt: "2026-10-01",
        unitTouched: true,
        locationTouched: true,
        expiresTouched: true,
      })
    ).toEqual({
      unit: "袋",
      location: "freezer",
      expiresAt: "2026-10-01",
    })
  })

  test("解析给出的位置提示可以覆盖分类默认", () => {
    expect(
      inventoryStockDefaults({
        ingredient: pork,
        purchasedAt: "2026-09-17",
        locationHint: "freezer",
      })
    ).toMatchObject({ location: "freezer", expiresAt: "2026-10-17" })
  })
})
