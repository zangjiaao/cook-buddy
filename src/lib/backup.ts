import { isISODate } from "@/lib/dates"
import { STORE_NAMES } from "@/lib/types"
import type { StoreName } from "@/lib/types"

export const BACKUP_APP = "cookbuddy"
export const BACKUP_SCHEMA_VERSION = 1

export const storeLabel: Record<StoreName, string> = {
  ingredients: "食材档案",
  inventory_items: "库存",
  recipes: "食谱",
  recipe_items: "食谱用料",
  plan_entries: "计划",
  shopping_items: "购买清单",
}

export type BackupRecord = { id: string } & Record<string, unknown>

export type BackupStores = Record<StoreName, BackupRecord[]>

export type BackupFile = {
  app: typeof BACKUP_APP
  schemaVersion: number
  exportedAt: string
  stores: BackupStores
}

export type ParseBackupResult =
  { ok: true; backup: BackupFile } | { ok: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBackupRecord(value: unknown): value is BackupRecord {
  if (!isRecord(value)) return false
  return typeof value.id === "string" && value.id.length > 0
}

function emptyStores(): BackupStores {
  return {
    ingredients: [],
    inventory_items: [],
    recipes: [],
    recipe_items: [],
    plan_entries: [],
    shopping_items: [],
  }
}

export function emptyBackupStores(): BackupStores {
  return emptyStores()
}

export function buildBackup(
  stores: BackupStores,
  exportedAt: string
): BackupFile {
  return {
    app: BACKUP_APP,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    stores: {
      ingredients: stores.ingredients,
      inventory_items: stores.inventory_items,
      recipes: stores.recipes,
      recipe_items: stores.recipe_items,
      plan_entries: stores.plan_entries,
      shopping_items: stores.shopping_items,
    },
  }
}

export function serializeBackup(backup: BackupFile): string {
  return `${JSON.stringify(backup, null, 2)}\n`
}

export function parseBackup(raw: string): ParseBackupResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: "文件不是合法 JSON。" }
  }

  if (!isRecord(parsed)) {
    return { ok: false, reason: "备份格式不对。" }
  }
  if (parsed.app !== BACKUP_APP) {
    return { ok: false, reason: "不是做饭搭子的备份。" }
  }
  if (parsed.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    return { ok: false, reason: "这份备份的版本还不认识。" }
  }
  if (typeof parsed.exportedAt !== "string" || parsed.exportedAt.length === 0) {
    return { ok: false, reason: "备份缺导出时间。" }
  }
  if (!isRecord(parsed.stores)) {
    return { ok: false, reason: "备份里没有数据表。" }
  }

  const stores = emptyStores()
  for (const name of STORE_NAMES) {
    const rows = parsed.stores[name]
    if (!Array.isArray(rows)) {
      return { ok: false, reason: `缺了${storeLabel[name]}。` }
    }
    const records: BackupRecord[] = []
    for (const row of rows) {
      if (!isBackupRecord(row)) {
        return { ok: false, reason: `${storeLabel[name]}里有一条没有 id。` }
      }
      records.push(row)
    }
    stores[name] = records
  }

  return {
    ok: true,
    backup: {
      app: BACKUP_APP,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: parsed.exportedAt,
      stores,
    },
  }
}

export function backupFileName(exportedAt: string): string {
  const day = exportedAt.slice(0, 10)
  return `做饭搭子-备份-${isISODate(day) ? day : "export"}.json`
}

export function backupStoreCounts(
  stores: BackupStores
): Record<StoreName, number> {
  return {
    ingredients: stores.ingredients.length,
    inventory_items: stores.inventory_items.length,
    recipes: stores.recipes.length,
    recipe_items: stores.recipe_items.length,
    plan_entries: stores.plan_entries.length,
    shopping_items: stores.shopping_items.length,
  }
}

export function triggerJsonDownload(filename: string, json: string): void {
  const blob = new Blob([json], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
