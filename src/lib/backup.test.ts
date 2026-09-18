import { describe, expect, test } from "vitest"
import {
  BACKUP_APP,
  BACKUP_SCHEMA_VERSION,
  backupFileName,
  backupStoreCounts,
  buildBackup,
  emptyBackupStores,
  parseBackup,
  serializeBackup,
} from "@/lib/backup"
import type { BackupStores } from "@/lib/backup"

const exportedAt = "2026-09-17T12:00:00.000Z"

function sampleStores(): BackupStores {
  return {
    ingredients: [
      {
        id: "ing-pork",
        name: "五花肉",
        aliases: ["猪肉"],
        category: "meat",
        defaultUnit: "斤",
        stallHint: "meat",
        defaultShelfLifeDays: 4,
        kind: "fresh",
        purchaseUnit: "斤",
      },
    ],
    inventory_items: [
      {
        id: "inv-pork",
        ingredientId: "ing-pork",
        quantity: 1,
        unit: "斤",
        location: "fridge",
        purchasedAt: "2026-09-17",
        expiresAt: "2026-09-21",
        notes: "",
        createdAt: exportedAt,
        updatedAt: exportedAt,
      },
    ],
    recipes: [
      {
        id: "rec-stirfry",
        name: "小白菜炒肉",
        servings: 2,
        approxMinutes: 20,
        steps: ["热锅下肉"],
        createdAt: exportedAt,
        updatedAt: exportedAt,
      },
    ],
    recipe_items: [
      {
        id: "ri-stirfry-pork",
        recipeId: "rec-stirfry",
        ingredientId: "ing-pork",
        rawName: "五花肉",
        quantity: 0.4,
        unit: "斤",
        matchStatus: "linked",
      },
    ],
    plan_entries: [
      {
        id: "plan-today",
        date: "2026-09-17",
        rangeKey: null,
        recipeId: "rec-stirfry",
        servings: 2,
        sortOrder: 0,
        status: "planned",
        cookedAt: null,
        lastDeduct: null,
      },
    ],
    shopping_items: [
      {
        id: "shop-bokchoy",
        ingredientId: "ing-bokchoy",
        name: "小白菜",
        quantityHint: "1",
        unit: "把",
        stallHint: "veg",
        status: "needed",
        shortage: "short",
        fromPlanEntryIds: ["plan-today"],
        checkedAt: null,
        source: "plan",
      },
    ],
  }
}

describe("serialize / parse backup", () => {
  test("六张表往返后内容一致", () => {
    const stores = sampleStores()
    const json = serializeBackup(buildBackup(stores, exportedAt))
    const parsed = parseBackup(json)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.backup.app).toBe(BACKUP_APP)
    expect(parsed.backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(parsed.backup.exportedAt).toBe(exportedAt)
    expect(parsed.backup.stores).toEqual(stores)
  })

  test("空库也能往返", () => {
    const stores = emptyBackupStores()
    const parsed = parseBackup(serializeBackup(buildBackup(stores, exportedAt)))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.backup.stores).toEqual(stores)
    expect(backupStoreCounts(parsed.backup.stores)).toEqual({
      ingredients: 0,
      inventory_items: 0,
      recipes: 0,
      recipe_items: 0,
      plan_entries: 0,
      shopping_items: 0,
    })
  })

  test("保留记录上的额外字段", () => {
    const stores = emptyBackupStores()
    stores.ingredients = [
      { id: "ing-new", name: "姜", futureFlag: true, nested: { a: 1 } },
    ]
    const parsed = parseBackup(serializeBackup(buildBackup(stores, exportedAt)))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.backup.stores.ingredients[0]).toEqual({
      id: "ing-new",
      name: "姜",
      futureFlag: true,
      nested: { a: 1 },
    })
  })

  test("忽略文件里多出来的表", () => {
    const backup = buildBackup(sampleStores(), exportedAt)
    const raw = JSON.parse(serializeBackup(backup)) as Record<string, unknown>
    raw.stores = { ...(raw.stores as object), extra_table: [{ id: "x" }] }
    const parsed = parseBackup(JSON.stringify(raw))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.backup.stores).toEqual(sampleStores())
  })
})

function parseFailReason(raw: string): string {
  const result = parseBackup(raw)
  expect(result.ok).toBe(false)
  return result.ok ? "" : result.reason
}

describe("parseBackup 拒绝坏文件", () => {
  test("不是 JSON", () => {
    expect(parseFailReason("not-json")).toBe("文件不是合法 JSON。")
  })

  test("不是做饭搭子的备份", () => {
    expect(
      parseFailReason(
        JSON.stringify({
          app: "other",
          schemaVersion: 1,
          exportedAt,
          stores: emptyBackupStores(),
        })
      )
    ).toBe("不是做饭搭子的备份。")
  })

  test("不认识的 schema 版本", () => {
    expect(
      parseFailReason(
        JSON.stringify({
          app: BACKUP_APP,
          schemaVersion: 99,
          exportedAt,
          stores: emptyBackupStores(),
        })
      )
    ).toBe("这份备份的版本还不认识。")
  })

  test("缺表或记录没有 id", () => {
    const stores = sampleStores()
    const missing = { ...stores } as Record<string, unknown>
    delete missing.recipes
    expect(
      parseFailReason(
        JSON.stringify({
          app: BACKUP_APP,
          schemaVersion: 1,
          exportedAt,
          stores: missing,
        })
      )
    ).toBe("缺了食谱。")

    const noId = sampleStores()
    noId.inventory_items = [{ name: "五花肉" } as never]
    expect(
      parseFailReason(
        JSON.stringify({
          app: BACKUP_APP,
          schemaVersion: 1,
          exportedAt,
          stores: noId,
        })
      )
    ).toBe("库存里有一条没有 id。")
  })
})

describe("backupFileName", () => {
  test("用导出日期当文件名", () => {
    expect(backupFileName(exportedAt)).toBe("做饭搭子-备份-2026-09-17.json")
    expect(backupFileName("nope")).toBe("做饭搭子-备份-export.json")
  })
})
