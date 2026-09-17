import { useEffect, useMemo, useState } from "react"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useDb, useQuery } from "@/hooks/use-db"
import {
  canDeduct,
  canUndoDeduct,
  isPlanEntryCooked,
} from "@/lib/cook-complete"
import {
  deductForCook,
  ingredientsRepo,
  inventoryRepo,
  planRepo,
  recipeItemsRepo,
  recipesRepo,
  undoDeduct,
} from "@/lib/db/repos"
import { deriveInventoryStatus } from "@/lib/inventory-status"
import type {
  Ingredient,
  InventoryItem,
  PlanEntry,
  Recipe,
  RecipeItem,
} from "@/lib/types"

export const Route = createFileRoute("/cook/$entryId")({
  component: CookPage,
})

type Timer = {
  id: string
  label: string
  remaining: number
  running: boolean
}

function extractMinutes(step: string): number | null {
  const match = step.match(/(\d+)\s*分钟/)
  return match ? Number(match[1]) : null
}

function formatClock(total: number): string {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function CookPage() {
  const { entryId } = Route.useParams()
  const navigate = useNavigate()
  const { refresh } = useDb()
  const { data: entry } = useQuery(
    `plan:${entryId}`,
    () => planRepo.get(entryId),
    undefined as PlanEntry | undefined
  )
  const recipeId = entry?.recipeId ?? ""
  const { data: recipe } = useQuery(
    `recipe:${recipeId}`,
    () => (recipeId ? recipesRepo.get(recipeId) : Promise.resolve(undefined)),
    undefined as Recipe | undefined
  )
  const { data: items } = useQuery(
    `recipe-items:${recipeId}`,
    () => (recipeId ? recipeItemsRepo.byRecipe(recipeId) : Promise.resolve([])),
    [] as RecipeItem[]
  )
  const { data: ingredients } = useQuery(
    "ingredients",
    () => ingredientsRepo.list(),
    [] as Ingredient[]
  )
  const { data: inventory } = useQuery(
    "inventory",
    () => inventoryRepo.list(),
    [] as InventoryItem[]
  )

  const [timers, setTimers] = useState<Timer[]>([])
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState("")
  const cooked = isPlanEntryCooked(entry)
  const snapshot = entry?.lastDeduct ?? null
  const allowDeduct = canDeduct(entry) && !pending
  const allowUndo = canUndoDeduct(entry, snapshot) && !pending

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTimers((current) =>
        current.map((timer) => {
          if (!timer.running || timer.remaining <= 0) return timer
          return { ...timer, remaining: timer.remaining - 1 }
        })
      )
    }, 1000)
    return () => window.clearInterval(interval)
  }, [])

  const ingredientById = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])),
    [ingredients]
  )

  function availability(item: RecipeItem): string {
    if (!item.ingredientId) return "未对齐，不确定"
    const stock = inventory.filter(
      (row) => row.ingredientId === item.ingredientId
    )
    if (stock.length === 0) return "家里没有"
    const sameUnit = stock.find((row) => row.unit === item.unit)
    if (!sameUnit) return "有，但单位对不上 · 不确定"
    const status = deriveInventoryStatus(sameUnit)
    if (status === "soon")
      return `临期 · 还有 ${sameUnit.quantity}${sameUnit.unit}`
    return `已有 ${sameUnit.quantity}${sameUnit.unit}`
  }

  function addTimer(label: string, minutes: number) {
    setTimers((current) => [
      ...current,
      {
        id: `${label}-${current.length}`,
        label,
        remaining: minutes * 60,
        running: true,
      },
    ])
  }

  async function finish() {
    if (!entry || pending || !canDeduct(entry)) return
    setPending(true)
    try {
      const outcome = await deductForCook(entry.id)
      refresh()
      if (!outcome.ok) {
        setNotice(
          outcome.reason === "already_cooked"
            ? "已扣过；要改请先撤销"
            : "这次没扣成，请稍后再试。"
        )
        return
      }
      await navigate({ to: "/plan" })
    } finally {
      setPending(false)
    }
  }

  async function undo() {
    if (!snapshot || pending || !canUndoDeduct(entry, snapshot)) return
    setPending(true)
    try {
      const undone = await undoDeduct(snapshot)
      refresh()
      setNotice(undone ? "已撤销扣库存。可以再做一次。" : "已经撤过了。")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col bg-background">
      <header className="flex items-center justify-between px-4 pt-5 pb-3">
        <Button
          nativeButton={false}
          variant="ghost"
          className="h-11"
          render={<Link to="/plan" />}
        >
          回计划
        </Button>
        <p className="text-sm text-muted-foreground">
          {cooked ? "已做完 · 只看步骤" : "厨房页 · 大字单手点"}
        </p>
      </header>
      <main className="flex flex-1 flex-col gap-4 px-4 pb-8">
        <h1 className="text-3xl font-semibold">{recipe?.name ?? "做菜"}</h1>
        <p className="text-base text-muted-foreground">
          {entry ? `${entry.servings} 人份` : ""}
          {recipe?.approxMinutes ? ` · 大约 ${recipe.approxMinutes} 分钟` : ""}
        </p>
        {cooked ? (
          <p className="rounded-xl bg-muted/60 px-4 py-3 text-base leading-7">
            这道已经做过，库存已扣过。步骤和计时还能看，要改库存请先撤销。
          </p>
        ) : null}
        <Card>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">
              家里有没有
            </p>
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 text-lg"
              >
                <span>
                  {ingredientById.get(item.ingredientId ?? "")?.name ??
                    item.rawName}{" "}
                  {item.quantity}
                  {item.unit}
                </span>
                <span className="shrink-0 text-right text-sm leading-7 text-muted-foreground">
                  {availability(item)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
        <ol className="space-y-4">
          {recipe?.steps.map((step, index) => {
            const minutes = extractMinutes(step)
            return (
              <li key={step} className="rounded-xl bg-muted/60 p-4">
                <p className="text-sm text-muted-foreground">
                  第 {index + 1} 步
                </p>
                <p className="mt-1 text-xl leading-8">{step}</p>
                {minutes ? (
                  <Button
                    variant="outline"
                    className="mt-3 h-12 text-base"
                    onClick={() => addTimer(`第${index + 1}步`, minutes)}
                  >
                    计时 {minutes} 分钟
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ol>
        {timers.length > 0 ? (
          <div className="space-y-2">
            {timers.map((timer) => (
              <div
                key={timer.id}
                className="flex items-center justify-between rounded-xl border px-4 py-3"
              >
                <div>
                  <p className="text-sm text-muted-foreground">{timer.label}</p>
                  <p className="font-mono text-3xl">
                    {formatClock(timer.remaining)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="h-12 px-4 text-base"
                  onClick={() =>
                    setTimers((current) =>
                      current.map((row) =>
                        row.id === timer.id
                          ? { ...row, running: !row.running }
                          : row
                      )
                    )
                  }
                >
                  {timer.running ? "暂停" : "继续"}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <Button
            variant="outline"
            className="h-12 text-base"
            onClick={() => addTimer("备用", 5)}
          >
            加一个 5 分钟计时
          </Button>
        )}
        {cooked ? (
          <Button className="h-14 text-lg" disabled>
            已扣过；要改请先撤销
          </Button>
        ) : (
          <Button
            className="h-14 text-lg"
            disabled={!allowDeduct}
            onClick={() => void finish()}
          >
            {pending ? "正在扣库存…" : "做完了，扣库存"}
          </Button>
        )}
        {allowUndo || (cooked && snapshot) ? (
          <Button
            variant="secondary"
            className="h-12 text-base"
            disabled={!allowUndo}
            onClick={() => void undo()}
          >
            撤销刚才的扣除
          </Button>
        ) : null}
        {notice ? (
          <p className="text-base leading-7 text-muted-foreground">{notice}</p>
        ) : null}
      </main>
    </div>
  )
}
