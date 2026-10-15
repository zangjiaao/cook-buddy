import type { AppD1Database } from "@/lib/db/d1"
import { parseSyncRows } from "@/lib/sync/merge"
import type { SyncRow } from "@/lib/sync/merge"
import { STORE_NAMES } from "@/lib/types"
import type { StoreName } from "@/lib/types"

const UPSERT = (table: string) =>
  `insert into ${table} (user_id, id, updated_at, deleted_at, payload)
   values (?, ?, ?, ?, ?)
   on conflict (user_id, id) do update set
     updated_at = excluded.updated_at,
     deleted_at = excluded.deleted_at,
     payload = excluded.payload
   where excluded.updated_at > ${table}.updated_at`

const SELECT_ALL = (table: string) =>
  `select id, updated_at, deleted_at, payload from ${table} where user_id = ?`

function tableName(store: StoreName): string {
  if (!(STORE_NAMES as readonly string[]).includes(store)) {
    throw new Error("不认识的数据表")
  }
  return store
}

type StoredRow = {
  id: string
  updated_at: string
  deleted_at: string | null
  payload: string
}

function toSyncRow(store: StoreName, row: StoredRow): SyncRow | null {
  if (typeof row.id !== "string" || typeof row.payload !== "string") return null
  let parsed: unknown
  try {
    parsed = JSON.parse(row.payload)
  } catch {
    return null
  }
  const updatedAt =
    typeof row.updated_at === "string"
      ? row.updated_at
      : "1970-01-01T00:00:00.000Z"
  const deletedAt =
    typeof row.deleted_at === "string" && row.deleted_at.length > 0
      ? row.deleted_at
      : null
  const parsedRows = parseSyncRows([
    {
      store,
      id: row.id,
      updatedAt,
      deletedAt,
      payload: parsed,
    },
  ])
  if (!parsedRows.ok) return null
  return parsedRows.records[0] ?? null
}

export async function listUserRecords(
  db: AppD1Database,
  userId: string
): Promise<SyncRow[]> {
  const rows: SyncRow[] = []
  for (const store of STORE_NAMES) {
    const result = await db
      .prepare(SELECT_ALL(tableName(store)))
      .bind(userId)
      .all<StoredRow>()
    for (const row of result.results) {
      const syncRow = toSyncRow(store, row)
      if (syncRow) rows.push(syncRow)
    }
  }
  return rows
}

export async function applyUserSync(
  db: AppD1Database,
  userId: string,
  incoming: SyncRow[]
): Promise<SyncRow[]> {
  const parsed = parseSyncRows(incoming)
  if (!parsed.ok) throw new Error(parsed.reason)
  const chunkSize = 50
  for (let index = 0; index < parsed.records.length; index += chunkSize) {
    const chunk = parsed.records.slice(index, index + chunkSize)
    const statements = chunk.map((row) =>
      db
        .prepare(UPSERT(tableName(row.store)))
        .bind(
          userId,
          row.id,
          row.updatedAt,
          row.deletedAt,
          JSON.stringify(row.payload)
        )
    )
    if (statements.length > 0) await db.batch(statements)
  }
  return listUserRecords(db, userId)
}
