import {
  listRecordsIncludingDeleted,
  putRawRecord,
  replaceAllStores,
} from "@/lib/db/database"
import { chooseWinner, rowFromStored } from "@/lib/sync/merge"
import type { SyncRow } from "@/lib/sync/merge"
import { STORE_NAMES } from "@/lib/types"
import type { StoreName } from "@/lib/types"

export const SYNC_OWNER_KEY = "cookbuddy.sync.userId"
export const SYNC_AT_KEY = "cookbuddy.sync.lastAt"

let syncChain: Promise<unknown> = Promise.resolve()

/** Run syncs one after another so login and startup don't interleave. */
export function syncQueue<T>(run: () => Promise<T>): Promise<T> {
  const next = syncChain.then(run, run)
  syncChain = next.then(
    () => undefined,
    () => undefined
  )
  return next
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

export async function readLocalSyncRows(): Promise<SyncRow[]> {
  const grouped = await recordsByStore()
  const rows: SyncRow[] = []
  for (const store of STORE_NAMES) {
    for (const record of grouped.get(store) ?? []) {
      if (typeof record.id !== "string" || record.id.length === 0) continue
      rows.push(rowFromStored(store, record))
    }
  }
  return rows
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
  const result = await input.push(await readLocalSyncRows())
  if (!result.ok) return result
  const changed = await applyRemoteRows(result.records)
  const at = new Date().toISOString()
  remember(SYNC_AT_KEY, at)
  return { ok: true, changed, at }
}
