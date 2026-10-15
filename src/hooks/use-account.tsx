import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import type { ReactNode } from "react"
import { useServerFn } from "@tanstack/react-start"
import { useDb } from "@/hooks/use-db"
import { createAuthClient } from "better-auth/client"
import { regenerateShoppingFromPlan } from "@/lib/db/repos"
import {
  lastSyncStartedAtMs,
  readLastSyncAt,
  runCloudSync,
  syncBusy,
  syncQueue,
} from "@/lib/sync/local"
import {
  createSyncPump,
  FOREGROUND_SYNC_EVENTS,
  SYNC_EDIT_DELAY_MS,
} from "@/lib/sync/schedule"
import type { SyncPump } from "@/lib/sync/schedule"
import { syncUserRecords } from "@/lib/sync/sync.functions"

const authClient = createAuthClient()

export type AccountUser = {
  id: string
  email: string
  name: string
}

type AccountContextValue = {
  user: AccountUser | null
  loading: boolean
  syncing: boolean
  lastSyncAt: string | null
  notice: string
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (input: {
    email: string
    password: string
    name: string
  }) => Promise<string | null>
  signOut: () => Promise<void>
  syncNow: () => Promise<void>
}

const AccountContext = createContext<AccountContextValue | null>(null)

function authErrorMessage(
  error: {
    code?: string
    message?: string
  } | null
): string {
  const code = error?.code ?? ""
  if (
    code === "USER_ALREADY_EXISTS" ||
    code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
  ) {
    return "这个邮箱已经注册过了。"
  }
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "邮箱或密码不对。"
  if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") {
    return "密码至少 8 位。"
  }
  if (code === "INVALID_EMAIL") return "邮箱格式不对。"
  return "没成功，请再试一次。"
}

function toAccountUser(user: {
  id: string
  email: string
  name: string
}): AccountUser {
  return { id: user.id, email: user.email, name: user.name }
}

function userFromAuthResult(result: {
  data?: {
    user?: { id: string; email: string; name?: string | null } | null
  } | null
}): AccountUser | null {
  const user = result.data?.user
  if (!user?.id || !user.email) return null
  return toAccountUser({
    id: user.id,
    email: user.email,
    name: user.name ?? "",
  })
}

async function readClientSession(): Promise<AccountUser | null> {
  const session = await authClient.getSession()
  const next = session.data?.user
  return next ? toAccountUser(next) : null
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const { ready, revision, refresh } = useDb()
  const syncFn = useServerFn(syncUserRecords)
  const syncFnRef = useRef(syncFn)
  syncFnRef.current = syncFn
  const [user, setUser] = useState<AccountUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [notice, setNotice] = useState("")

  const syncUser = useCallback(
    async (userId: string, announce: boolean) => {
      if (announce) setSyncing(true)
      try {
        const result = await syncQueue(() =>
          runCloudSync({
            userId,
            push: (records) => syncFnRef.current({ data: { records } }),
          })
        )
        if (!result.ok) {
          if (announce) setNotice(result.reason)
          return result
        }
        setLastSyncAt(result.at)
        if (result.changed) {
          await regenerateShoppingFromPlan()
          refresh()
        }
        if (announce) setNotice("同步好了。")
        return result
      } catch {
        if (announce) setNotice("同步没成功，请再试一次。")
        return { ok: false as const, reason: "同步没成功，请再试一次。" }
      } finally {
        if (announce) setSyncing(false)
      }
    },
    [refresh]
  )

  useEffect(() => {
    let cancelled = false
    setLastSyncAt(readLastSyncAt())
    authClient
      .getSession()
      .then((result) => {
        if (cancelled) return
        const next = result.data?.user
        setUser(next ? toAccountUser(next) : null)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const pumpRef = useRef<SyncPump | null>(null)
  const skipEditSync = useRef(true)

  useEffect(() => {
    if (!ready || !user || typeof document === "undefined") return
    const userId = user.id
    const pump = createSyncPump({
      run: () => syncUser(userId, false),
      isForeground: () => document.visibilityState !== "hidden",
      isOnline: () => navigator.onLine,
      busy: syncBusy,
      lastStartedAt: lastSyncStartedAtMs,
    })
    pumpRef.current = pump

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        pump.noteHidden()
        return
      }
      pump.request("foreground")
    }
    const onForeground = () => pump.request("foreground")
    const onOnline = () => pump.request("online")
    for (const eventName of FOREGROUND_SYNC_EVENTS) {
      if (eventName === "visibilitychange") {
        document.addEventListener(eventName, onVisibility)
      } else {
        window.addEventListener(eventName, onForeground)
      }
    }
    window.addEventListener("online", onOnline)
    pump.request("open")

    return () => {
      for (const eventName of FOREGROUND_SYNC_EVENTS) {
        if (eventName === "visibilitychange") {
          document.removeEventListener(eventName, onVisibility)
        } else {
          window.removeEventListener(eventName, onForeground)
        }
      }
      window.removeEventListener("online", onOnline)
      pump.dispose()
      if (pumpRef.current === pump) pumpRef.current = null
    }
  }, [ready, syncUser, user])

  useEffect(() => {
    if (!ready || !user) return
    if (skipEditSync.current) {
      skipEditSync.current = false
      return
    }
    const timer = window.setTimeout(() => {
      pumpRef.current?.request("edit")
    }, SYNC_EDIT_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [ready, revision, user])

  const signIn = useCallback(
    async (email: string, password: string) => {
      setNotice("")
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
      })
      if (result.error) return authErrorMessage(result.error)
      const account = userFromAuthResult(result) ?? (await readClientSession())
      if (!account) return "登录没有完成。"
      setUser(account)
      const synced = await syncUser(account.id, false)
      setNotice(synced.ok ? "登录了，数据已按更新时间合并。" : synced.reason)
      return null
    },
    [syncUser]
  )

  const signUp = useCallback(
    async (input: { email: string; password: string; name: string }) => {
      setNotice("")
      const email = input.email.trim()
      const result = await authClient.signUp.email({
        email,
        password: input.password,
        name: input.name.trim() || email.split("@")[0] || "做饭的人",
      })
      if (result.error) return authErrorMessage(result.error)
      const account = userFromAuthResult(result) ?? (await readClientSession())
      if (!account) return "注册没有完成。"
      setUser(account)
      const synced = await syncUser(account.id, false)
      setNotice(
        synced.ok ? "注册好了。这台设备上的数据会和云端合并。" : synced.reason
      )
      return null
    },
    [syncUser]
  )

  const signOut = useCallback(async () => {
    setNotice("")
    await authClient.signOut()
    setUser(null)
    setNotice("已退出。这台设备上的数据还在，下次登录同一账号会再同步。")
  }, [])

  const syncNow = useCallback(async () => {
    if (!user) return
    await syncUser(user.id, true)
  }, [syncUser, user])

  return createElement(
    AccountContext.Provider,
    {
      value: {
        user,
        loading,
        syncing,
        lastSyncAt,
        notice,
        signIn,
        signUp,
        signOut,
        syncNow,
      },
    },
    children
  )
}

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext)
  if (!value) throw new Error("useAccount 必须放在 AccountProvider 内")
  return value
}
