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
import { classifyIngredientCategories } from "@/lib/ai/classify-ingredients.functions"
import { suggestIngredientCleanup } from "@/lib/ai/ingredient-cleanup.functions"
import { formatISODate, localDateIfChanged } from "@/lib/dates"
import { regenerateShoppingFromPlan } from "@/lib/db/repos"
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh"
import {
  migrateIngredientMasterData,
  migratePlanEntries,
  migrateRecipes,
  migrateShoppingSources,
} from "@/lib/db/seed"
import { migrateMisclassifiedVegetables } from "@/lib/ingredient-category-migrate"
import { runCloudSync, syncQueue } from "@/lib/sync/local"
import { getSessionUser, syncUserRecords } from "@/lib/sync/sync.functions"
import { runStoredIngredientCleanup } from "@/lib/ingredient-cleanup-run"
import { shoppingRegen } from "@/lib/shopping-sync"

type DbContextValue = {
  ready: boolean
  revision: number
  refresh: () => void
}

const DbContext = createContext<DbContextValue | null>(null)

export function DbProvider({ children }: { children: ReactNode }) {
  const suggestCleanup = useServerFn(suggestIngredientCleanup)
  const classifyCategories = useServerFn(classifyIngredientCategories)
  const sessionFn = useServerFn(getSessionUser)
  const syncFn = useServerFn(syncUserRecords)
  const [ready, setReady] = useState(false)
  const [revision, setRevision] = useState(0)
  const dayRef = useRef(formatISODate())

  const refresh = useCallback(() => {
    setRevision((value) => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    migratePlanEntries()
      .then(() => migrateIngredientMasterData())
      .then(() =>
        migrateMisclassifiedVegetables({
          classify: (names) => classifyCategories({ data: { names } }),
        })
      )
      .then(() => migrateShoppingSources())
      .then(() => migrateRecipes())
      .then(async () => {
        const session = await sessionFn().catch(() => null)
        if (!session) return
        await syncQueue(() =>
          runCloudSync({
            userId: session.id,
            push: (records) => syncFn({ data: { records } }),
          })
        ).catch((error) => {
          console.error("同步失败", error)
        })
      })
      .then(() =>
        runStoredIngredientCleanup({
          suggest: (ingredients) => suggestCleanup({ data: { ingredients } }),
        })
      )
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

  useForegroundRefresh(() => {
    const next = localDateIfChanged(dayRef.current)
    if (!next) return
    dayRef.current = next
    refresh()
    void shoppingRegen.force()
  })

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

  const loadedKey = useRef<string | null>(null)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    // A later revision only swaps in fresh rows. Turning loading back on
    // would unmount editors (inventory) and flash the shopping list while
    // someone is checking items or confirming a check-in. Cook timers and
    // the shopping confirm form live in component state, so they stay.
    const refreshOnly = loadedKey.current === key
    if (!refreshOnly) setLoading(true)
    loaderRef.current().then((value) => {
      if (cancelled) return
      loadedKey.current = key
      setData(value)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [key, ready, revision])

  return { data, loading: !ready || loading }
}
