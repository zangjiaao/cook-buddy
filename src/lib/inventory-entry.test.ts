import { describe, expect, test } from "vitest"
import {
  addInventoryEntryLine,
  applyInventoryEntryPatch,
  createInventoryEntryLine,
  inventoryEntryError,
  inventoryEntryLineFromUtterance,
  inventoryEntryMergeNote,
  INVENTORY_ADDED_NOTICE_KEY,
  readInventoryAddedNotice,
  removeInventoryEntryLine,
  writeInventoryAddedNotice,
} from "@/lib/inventory-entry"
import type { Ingredient, InventoryItem } from "@/lib/types"

const today = "2026-10-15"

function ingredient(
  partial: Pick<Ingredient, "id" | "name" | "category"> & Partial<Ingredient>
): Ingredient {
  return {
    aliases: [],
    defaultUnit: "个",
    stallHint: null,
    defaultShelfLifeDays: null,
    ...partial,
  }
}

describe("库存录入行", () => {
  test("空白行默认是其他，不是蔬菜", () => {
    const line = createInventoryEntryLine({}, today)
    expect(line.category).toBe("other")
    expect(line.quantity).toBe("1")
    expect(line.unit).toBe("个")
    expect(line.location).toBe("pantry")
    expect(line.expiresAt).toBe("2026-11-14")
  })

  test("写下名字后按规则补分类、单位和保质期", () => {
    const blank = createInventoryEntryLine({ key: "a" }, today)
    const spice = applyInventoryEntryPatch(blank, { name: "五香粉" }, today)
    expect(spice.category).toBe("seasoning")
    expect(spice.unit).toBe("袋")
    expect(spice.location).toBe("pantry")
    expect(spice.expiresAt).toBe("2027-10-15")

    const oil = applyInventoryEntryPatch(
      createInventoryEntryLine({ key: "b" }, today),
      { name: "食用油" },
      today
    )
    expect(oil.category).toBe("seasoning")
    expect(oil.unit).toBe("瓶")

    const leaf = applyInventoryEntryPatch(spice, { name: "小白菜" }, today)
    expect(leaf.category).toBe("veg")
    expect(leaf.location).toBe("fridge")
    expect(leaf.unit).toBe("把")
  })

  test("手改过的分类、单位和日期不会被名字盖掉", () => {
    const line = applyInventoryEntryPatch(
      createInventoryEntryLine({ key: "a" }, today),
      {
        name: "五香粉",
        category: "other",
        unit: "罐",
        expiresAt: "2026-12-01",
      },
      today
    )
    const renamed = applyInventoryEntryPatch(line, { name: "盐" }, today)
    expect(renamed.category).toBe("other")
    expect(renamed.unit).toBe("罐")
    expect(renamed.expiresAt).toBe("2026-12-01")
  })

  test("可删可加", () => {
    const first = createInventoryEntryLine({ key: "a", name: "盐" }, today)
    const added = addInventoryEntryLine([first], today)
    expect(added).toHaveLength(2)
    expect(added[1]?.name).toBe("")
    expect(removeInventoryEntryLine(added, "a")).toEqual([added[1]])
  })

  test("空行和坏数量给中文提示", () => {
    const blank = createInventoryEntryLine({ key: "a" }, today)
    expect(inventoryEntryError([blank])).toBe("先写上食材名，或加上一条。")
    const bad = applyInventoryEntryPatch(
      blank,
      { name: "盐", quantity: "0" },
      today
    )
    expect(inventoryEntryError([bad])).toBe("数量要是大于 0 的数字。")
    expect(
      inventoryEntryError([
        applyInventoryEntryPatch(blank, { name: "盐", quantity: "1" }, today),
      ])
    ).toBeNull()
  })

  test("解析结果带上档案里的分类，并提示同单位合并", () => {
    const soy = ingredient({
      id: "ing-soy",
      name: "生抽",
      category: "seasoning",
      defaultUnit: "瓶",
      defaultShelfLifeDays: 180,
    })
    const line = inventoryEntryLineFromUtterance(
      {
        name: "生抽",
        quantity: 1,
        unit: "瓶",
        category: "other",
        defaultShelfLifeDays: 30,
        defaultLocation: "pantry",
      },
      [soy],
      today
    )
    expect(line.category).toBe("seasoning")
    expect(line.unit).toBe("瓶")
    const stock: InventoryItem = {
      id: "inv-soy",
      ingredientId: "ing-soy",
      quantity: 1,
      unit: "瓶",
      location: "pantry",
      purchasedAt: today,
      expiresAt: null,
      notes: "",
      createdAt: today,
      updatedAt: today,
    }
    expect(inventoryEntryMergeNote(line, [soy], [stock])).toBe(
      "已有 生抽 1 瓶，确认后会加在一起"
    )
    expect(
      inventoryEntryMergeNote({ ...line, unit: "勺" }, [soy], [stock])
    ).toBeNull()
  })
})

describe("入库提示", () => {
  test("读一次就清掉", () => {
    const data: Record<string, string> = {}
    const storage = {
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value
      },
      removeItem: (key: string) => {
        delete data[key]
      },
    }
    writeInventoryAddedNotice(storage, "已加入 2 样。")
    expect(data[INVENTORY_ADDED_NOTICE_KEY]).toBe("已加入 2 样。")
    expect(readInventoryAddedNotice(storage)).toBe("已加入 2 样。")
    expect(readInventoryAddedNotice(storage)).toBe("")
  })
})
