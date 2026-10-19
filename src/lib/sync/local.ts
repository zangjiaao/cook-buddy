import {
  listRecordsIncludingDeleted,
  putRawRecord,
  replaceAllStores,
} from "@/lib/db/database"
import { migrateStoredCatalog } from "@/lib/db/seed"
import { unmodifiedSampleIds } from "@/lib/sample-data"
import type { SampleSnapshot } from "@/lib/sample-data"
import { chooseWinner, rowFromStored } from "@/lib/sync/merge"
import type { SyncRow } from "@/lib/sync/merge"
import { STORE_NAMES } from "@/lib/types"
import type { StoreName } from "@/lib/types"

export const SYNC_OWNER_KEY = "cookbuddy.sync.userId"
export const SYNC_AT_KEY = "cookbuddy.sync.lastAt"

let syncChain: Promise<unknown> = Promise.resolve()
let syncDepth = 0
let lastSyncStartedAt = 0

/** True while a queued sync is inside its task. */
export function syncBusy(): boolean {
  return syncDepth > 0
}

/** When the current or latest queued sync began. Used to coalesce open/foreground bursts. */
export function lastSyncStartedAtMs(): number {
  return lastSyncStartedAt
}

/** Run syncs one after another so login, startup, and foreground pulls don't interleave. */
export function syncQueue<T>(run: () => Promise<T>): Promise<T> {
  const next = syncChain.then(
    () => runQueued(run),
    () => runQueued(run)
  )
  syncChain = next.then(
    () => undefined,
    () => undefined
  )
  return next
}

async function runQueued<T>(run: () => Promise<T>): Promise<T> {
  syncDepth += 1
  lastSyncStartedAt = Date.now()
  try {
    return await run()
  } finally {
    syncDepth -= 1
  }
}

type Stored = { id: string } & Record<string, unknown>

export type SyncPushResult =
  { ok: true; records: SyncRow[] } | { ok: false; reason: string }

export function readSyncOwner(): string | null {
  if (typeof localStorage === "undefined") return null
  return localStorage.getItem(SYNC_OWNER_KEY)
}

export function readLastSyncAt(): string | null {
  if (typeof localStorage === "undefined") return null
  return localStorage.getItem(SYNC_AT_KEY)
}

function remember(key: string, value: string): void {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(key, value)
}

async function recordsByStore(): Promise<Map<StoreName, Stored[]>> {
  const entries = await Promise.all(
    STORE_NAMES.map(async (store) => {
      const rows = await listRecordsIncludingDeleted<Stored>(store)
      return [store, rows] as const
    })
  )
  return new Map(entries)
}

function isTombstone(record: Record<string, unknown>): boolean {
  return typeof record.deletedAt === "string" && record.deletedAt.length > 0
}

function snapshotForSampleFilter(
  grouped: Map<StoreName, Stored[]>
): SampleSnapshot {
  const visible = (store: StoreName) =>
    (grouped.get(store) ?? []).filter((record) => !isTombstone(record))
  return {
    ingredients: visible("ingredients") as SampleSnapshot["ingredients"],
    inventory: visible("inventory_items") as SampleSnapshot["inventory"],
    recipes: visible("recipes") as SampleSnapshot["recipes"],
    recipeItems: visible("recipe_items") as SampleSnapshot["recipeItems"],
    plan: visible("plan_entries") as SampleSnapshot["plan"],
    shopping: visible("shopping_items") as SampleSnapshot["shopping"],
  }
}

/** Unmodified sample rows stay on this device. Soft-deleted sample rows are tombstones and do upload. */
export function selectSyncRows(grouped: Map<StoreName, Stored[]>): SyncRow[] {
  const skipped = unmodifiedSampleIds(snapshotForSampleFilter(grouped))
  const rows: SyncRow[] = []
  for (const store of STORE_NAMES) {
    for (const record of grouped.get(store) ?? []) {
      if (typeof record.id !== "string" || record.id.length === 0) continue
      if (!isTombstone(record) && skipped.has(record.id)) continue
      rows.push(rowFromStored(store, record))
    }
  }
  return rows
}

export async function readLocalSyncRows(): Promise<SyncRow[]> {
  return selectSyncRows(await recordsByStore())
}

export async function applyRemoteRows(remote: SyncRow[]): Promise<boolean> {
  const grouped = await recordsByStore()
  const updatedAt = new Map<StoreName, Map<string, string | null>>()
  for (const store of STORE_NAMES) {
    const map = new Map<string, string | null>()
    for (const record of grouped.get(store) ?? []) {
      map.set(record.id, rowFromStored(store, record).updatedAt)
    }
    updatedAt.set(store, map)
  }

  let changed = false
  for (const row of remote) {
    const localAt = updatedAt.get(row.store)?.get(row.id) ?? null
    if (chooseWinner(localAt, row.updatedAt) !== "remote") continue
    await putRawRecord(row.store, {
      ...row.payload,
      id: row.id,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    })
    changed = true
  }
  return changed
}

async function clearLocalStores(): Promise<void> {
  const stores = Object.fromEntries(
    STORE_NAMES.map((name) => [name, [] as Array<{ id: string }>])
  ) as Record<StoreName, Array<{ id: string }>>
  await replaceAllStores(stores)
}

export async function runCloudSync(input: {
  userId: string
  push: (records: SyncRow[]) => Promise<SyncPushResult>
}): Promise<
  { ok: true; changed: boolean; at: string } | { ok: false; reason: string }
> {
  const owner = readSyncOwner()
  if (owner && owner !== input.userId) await clearLocalStores()
  remember(SYNC_OWNER_KEY, input.userId)
  await migrateStoredCatalog()
  const result = await input.push(await readLocalSyncRows())
  if (!result.ok) return result
  let changed = await applyRemoteRows(result.records)
  if (await migrateStoredCatalog()) {
    const again = await input.push(await readLocalSyncRows())
    if (!again.ok) return again
    changed = (await applyRemoteRows(again.records)) || changed
    await migrateStoredCatalog()
  }
  const at = new Date().toISOString()
  remember(SYNC_AT_KEY, at)
  return { ok: true, changed, at }
}
