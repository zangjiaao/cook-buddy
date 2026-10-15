import { createServerFn } from "@tanstack/react-start"
import { readSession, requireDb, workerBindings } from "@/lib/auth/auth.server"
import { applyUserSync } from "@/lib/sync/engine"
import { parseSyncRows } from "@/lib/sync/merge"

export type SessionUser = {
  id: string
  email: string
  name: string
}

export const getSessionUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionUser | null> => {
    const session = await readSession()
    if (!session?.user) return null
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    }
  }
)

export const syncUserRecords = createServerFn({ method: "POST" })
  .validator((data: { records?: unknown }) => data)
  .handler(async ({ data }) => {
    const session = await readSession()
    if (!session?.user) return { ok: false as const, reason: "未登录" }
    const parsed = parseSyncRows(data.records)
    if (!parsed.ok) return parsed
    const records = await applyUserSync(
      requireDb(workerBindings()),
      session.user.id,
      parsed.records
    )
    return { ok: true as const, records }
  })
