import { describe, expect, test } from "vitest"
import { resolve } from "node:path"
import { createAuth } from "@/lib/auth/create-auth"
import { applyMigrationFiles, createMemoryD1 } from "@/lib/db/memory-d1"
import { applyUserSync } from "@/lib/sync/engine"
import { chooseWinner, parseSyncRows } from "@/lib/sync/merge"
import type { SyncRow } from "@/lib/sync/merge"

const migrations = [
  resolve("migrations/0001_better_auth.sql"),
  resolve("migrations/0002_user_records.sql"),
]

const secret = "test-secret-test-secret-test-secret-xx"
const baseURL = "http://localhost:3000"

function row(
  partial: Pick<SyncRow, "store" | "id" | "updatedAt"> & {
    deletedAt?: string | null
    name?: string
  }
): SyncRow {
  const deletedAt = partial.deletedAt ?? null
  return {
    store: partial.store,
    id: partial.id,
    updatedAt: partial.updatedAt,
    deletedAt,
    payload: {
      id: partial.id,
      name: partial.name ?? partial.id,
      updatedAt: partial.updatedAt,
      deletedAt,
    },
  }
}

describe("同步合并", () => {
  test("更新时间更晚的一边胜出，相等则不动", () => {
    expect(
      chooseWinner("2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z")
    ).toBe("remote")
    expect(
      chooseWinner("2026-10-02T00:00:00.000Z", "2026-10-01T00:00:00.000Z")
    ).toBe("local")
    expect(
      chooseWinner("2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z")
    ).toBe("tie")
    expect(chooseWinner(null, "2026-10-01T00:00:00.000Z")).toBe("remote")
  })

  test("拒绝别的表名", () => {
    const parsed = parseSyncRows([
      {
        store: "users",
        id: "a",
        updatedAt: "2026-10-01T00:00:00.000Z",
        deletedAt: null,
        payload: { id: "a" },
      },
    ])
    expect(parsed.ok).toBe(false)
  })

  test("两人数据隔离，晚写入和软删除胜出，旧写入不覆盖", async () => {
    const db = createMemoryD1()
    await applyMigrationFiles(db, migrations)

    const first = await applyUserSync(db, "user-a", [
      row({
        store: "recipes",
        id: "recipe-1",
        updatedAt: "2026-10-01T00:00:00.000Z",
        name: "红烧肉",
      }),
    ])
    expect(first.map((item) => item.id)).toEqual(["recipe-1"])

    const other = await applyUserSync(db, "user-b", [])
    expect(other).toEqual([])

    const older = await applyUserSync(db, "user-a", [
      row({
        store: "recipes",
        id: "recipe-1",
        updatedAt: "2026-09-01T00:00:00.000Z",
        name: "不该盖掉",
      }),
    ])
    expect(older[0]?.payload.name).toBe("红烧肉")

    const newer = await applyUserSync(db, "user-a", [
      row({
        store: "recipes",
        id: "recipe-1",
        updatedAt: "2026-10-03T00:00:00.000Z",
        name: "红烧肉改",
      }),
      row({
        store: "ingredients",
        id: "ing-1",
        updatedAt: "2026-10-03T00:00:00.000Z",
        deletedAt: "2026-10-03T00:00:00.000Z",
        name: "蒜",
      }),
    ])
    const recipe = newer.find((item) => item.id === "recipe-1")
    const ingredient = newer.find((item) => item.id === "ing-1")
    expect(recipe?.payload.name).toBe("红烧肉改")
    expect(ingredient?.deletedAt).toBe("2026-10-03T00:00:00.000Z")

    const stillPrivate = await applyUserSync(db, "user-b", [])
    expect(stillPrivate).toEqual([])
  })

  test("食材分类、大类和购买单位按更新时间合并", async () => {
    const db = createMemoryD1()
    await applyMigrationFiles(db, migrations)
    const earlier = "2026-10-01T00:00:00.000Z"
    const later = "2026-10-02T00:00:00.000Z"
    const saved = await applyUserSync(db, "user-a", [
      {
        store: "ingredients",
        id: "ing-soy",
        updatedAt: earlier,
        deletedAt: null,
        payload: {
          id: "ing-soy",
          name: "生抽",
          category: "other",
          family: "酱油",
          kind: "staple",
          purchaseUnit: "瓶",
          buyable: true,
          updatedAt: earlier,
          deletedAt: null,
        },
      },
    ])
    expect(saved[0]?.payload).toMatchObject({
      category: "other",
      family: "酱油",
      purchaseUnit: "瓶",
    })

    const stale = await applyUserSync(db, "user-a", [
      {
        store: "ingredients",
        id: "ing-soy",
        updatedAt: "2026-09-01T00:00:00.000Z",
        deletedAt: null,
        payload: {
          id: "ing-soy",
          name: "生抽",
          category: "veg",
          family: "不该盖掉",
          updatedAt: "2026-09-01T00:00:00.000Z",
          deletedAt: null,
        },
      },
    ])
    expect(stale[0]?.payload.category).toBe("other")
    expect(stale[0]?.payload.family).toBe("酱油")

    const reclassified = await applyUserSync(db, "user-a", [
      {
        store: "ingredients",
        id: "ing-soy",
        updatedAt: later,
        deletedAt: null,
        payload: {
          id: "ing-soy",
          name: "生抽",
          category: "seasoning",
          family: "酱油",
          kind: "staple",
          purchaseUnit: "瓶",
          buyable: true,
          updatedAt: later,
          deletedAt: null,
        },
      },
    ])
    expect(reclassified[0]?.payload).toMatchObject({
      category: "seasoning",
      family: "酱油",
      kind: "staple",
      purchaseUnit: "瓶",
      buyable: true,
    })
  })
})

describe("邮箱密码", () => {
  test("注册后 cookie 能读到自己的 session，没有 cookie 就不算登录", async () => {
    const db = createMemoryD1()
    await applyMigrationFiles(db, migrations)
    const auth = createAuth({
      db,
      secret,
      baseURL,
      cookies: false,
      rateLimit: false,
    })
    const headers = new Headers({ origin: baseURL })
    const signUp = await auth.api.signUpEmail({
      body: {
        email: "cook@example.com",
        password: "kitchen-secret",
        name: "做饭的人",
      },
      headers,
      asResponse: true,
    })
    expect(signUp.ok).toBe(true)
    const setCookie = signUp.headers.getSetCookie()
    const cookie = setCookie.map((item) => item.split(";")[0]).join("; ")
    expect(cookie).toContain("=")

    const session = await auth.api.getSession({
      headers: new Headers({ cookie, origin: baseURL }),
    })
    expect(session?.user.email).toBe("cook@example.com")

    const anonymous = await auth.api.getSession({
      headers: new Headers({ origin: baseURL }),
    })
    expect(anonymous).toBeNull()

    const signIn = await auth.api.signInEmail({
      body: { email: "cook@example.com", password: "kitchen-secret" },
      headers,
    })
    expect(signIn.user.email).toBe("cook@example.com")
  })
})
