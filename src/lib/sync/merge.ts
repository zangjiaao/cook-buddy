import { STORE_NAMES } from "@/lib/types"
import type { StoreName } from "@/lib/types"

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type JsonRecord = { [key: string]: JsonValue }

export type SyncRow = {
  store: StoreName
  id: string
  updatedAt: string
  deletedAt: string | null
  payload: JsonRecord
}

export const SYNC_ROW_LIMIT = 2000
export const SYNC_PAYLOAD_LIMIT = 100_000
const UPDATED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

export function isStoreName(value: string): value is StoreName {
  return (STORE_NAMES as readonly string[]).includes(value)
}

export function chooseWinner(
  localUpdatedAt: string | null,
  remoteUpdatedAt: string | null
): "local" | "remote" | "tie" {
  if (localUpdatedAt == null && remoteUpdatedAt == null) return "tie"
  if (localUpdatedAt == null) return "remote"
  if (remoteUpdatedAt == null) return "local"
  if (remoteUpdatedAt > localUpdatedAt) return "remote"
  if (localUpdatedAt > remoteUpdatedAt) return "local"
  return "tie"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asJsonRecord(value: unknown): JsonRecord | null {
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    return null
  }
  if (!encoded || encoded === "undefined") return null
  const parsed: unknown = JSON.parse(encoded)
  if (!isRecord(parsed)) return null
  return parsed as JsonRecord
}

export function parseSyncRows(
  input: unknown
): { ok: true; records: SyncRow[] } | { ok: false; reason: string } {
  if (!Array.isArray(input)) {
    return { ok: false, reason: "同步数据格式不对。" }
  }
  if (input.length > SYNC_ROW_LIMIT) {
    return { ok: false, reason: "一次同步的条数太多了。" }
  }
  const records: SyncRow[] = []
  for (const item of input) {
    if (!isRecord(item)) return { ok: false, reason: "同步数据格式不对。" }
    const store = item.store
    const id = item.id
    const updatedAt = item.updatedAt
    if (typeof store !== "string" || !isStoreName(store)) {
      return { ok: false, reason: "同步里有不认识的表。" }
    }
    if (typeof id !== "string" || id.length === 0 || id.length > 80) {
      return { ok: false, reason: "同步里有一条缺少 id。" }
    }
    if (
      typeof updatedAt !== "string" ||
      updatedAt.length > 40 ||
      !UPDATED_AT_RE.test(updatedAt)
    ) {
      return { ok: false, reason: "同步里有一条时间不对。" }
    }
    const deletedAt =
      item.deletedAt == null
        ? null
        : typeof item.deletedAt === "string" &&
            item.deletedAt.length > 0 &&
            item.deletedAt.length <= 40
          ? item.deletedAt
          : undefined
    if (deletedAt === undefined) {
      return { ok: false, reason: "同步里有一条删除时间不对。" }
    }
    const payload = asJsonRecord({
      ...(isRecord(item.payload) ? item.payload : null),
      id,
      updatedAt,
      deletedAt,
    })
    if (!payload) {
      return { ok: false, reason: "同步里有一条内容不对。" }
    }
    const encoded = JSON.stringify(payload)
    if (encoded.length > SYNC_PAYLOAD_LIMIT) {
      return { ok: false, reason: "同步里有一条内容太大。" }
    }
    records.push({ store, id, updatedAt, deletedAt, payload })
  }
  return { ok: true, records }
}

export function rowFromStored(
  store: StoreName,
  record: { id: string } & Record<string, unknown>
): SyncRow {
  const updatedAt =
    typeof record.updatedAt === "string" && UPDATED_AT_RE.test(record.updatedAt)
      ? record.updatedAt
      : "1970-01-01T00:00:00.000Z"
  const deletedAt =
    typeof record.deletedAt === "string" && record.deletedAt.length > 0
      ? record.deletedAt
      : null
  const payload = asJsonRecord({
    ...record,
    id: record.id,
    updatedAt,
    deletedAt,
  })
  return {
    store,
    id: record.id,
    updatedAt,
    deletedAt,
    payload: payload ?? { id: record.id, updatedAt, deletedAt },
  }
}
