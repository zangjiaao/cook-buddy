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
import { regenerateShoppingFromPlan } from "@/lib/db/repos"
import { ensureSeed } from "@/lib/db/seed"
import { shoppingRegen } from "@/lib/shopping-sync"

type DbContextValue = {
  ready: boolean
  revision: number
  refresh: () => void
}

const DbContext = createContext<DbContextValue | null>(null)

export function DbProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [revision, setRevision] = useState(0)

  const refresh = useCallback(() => {
    setRevision((value) => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    ensureSeed()
      .then(() => regenerateShoppingFromPlan())
      .catch((error) => {
        console.error("初始化清单失败", error)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    shoppingRegen.setOnSettled(refresh)
    return () => shoppingRegen.setOnSettled(null)
  }, [refresh])

  return createElement(
    DbContext.Provider,
    { value: { ready, revision, refresh } },
    children
  )
}

export function useDb(): DbContextValue {
  const value = useContext(DbContext)
  if (!value) {
    throw new Error("useDb 必须放在 DbProvider 内")
  }
  return value
}

export function useQuery<T>(
  key: string,
  loader: () => Promise<T>,
  initial: T
): { data: T; loading: boolean } {
  const { ready, revision } = useDb()
  const [data, setData] = useState(initial)
  const [loading, setLoading] = useState(true)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setLoading(true)
    loaderRef.current().then((value) => {
      if (!cancelled) {
        setData(value)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [key, ready, revision])

  return { data, loading: !ready || loading }
}
