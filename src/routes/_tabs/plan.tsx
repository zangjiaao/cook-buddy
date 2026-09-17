import { Link, createFileRoute } from "@tanstack/react-router"
import { PageHeader } from "@/components/layout/page-header"
import { QuantityStepper } from "@/components/quantity-stepper"
import { PlanEntryStatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { fieldControlClass } from "@/components/field"
import { useDb, useQuery } from "@/hooks/use-db"
import { isPlanEntryCooked, normalizePlanEntry } from "@/lib/cook-complete"
import { addDays, formatISODate, prettyDate } from "@/lib/dates"
import {
  planRepo,
  recipeItemsRepo,
  recipesRepo,
  inventoryRepo,
} from "@/lib/db/repos"
import { deriveInventoryStatus } from "@/lib/inventory-status"
import { createId } from "@/lib/id"
import type { InventoryItem, PlanEntry, Recipe, RecipeItem } from "@/lib/types"
import { useMemo, useState } from "react"

export const Route = createFileRoute("/_tabs/plan")({
  component: PlanPage,
})

function nextDays(count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    formatISODate(addDays(new Date(), index))
  )
}

function PlanPage() {
  const { refresh } = useDb()
  const days = useMemo(() => nextDays(3), [])
  const { data: entries } = useQuery(
    "plan",
    () => planRepo.list(),
    [] as PlanEntry[]
  )
  const { data: recipes } = useQuery(
    "recipes",
    () => recipesRepo.list(),
    [] as Recipe[]
  )
  const { data: recipeItems } = useQuery(
    "recipe-items",
    () => recipeItemsRepo.list(),
    [] as RecipeItem[]
  )
  const { data: inventory } = useQuery(
    "inventory",
    () => inventoryRepo.list(),
    [] as InventoryItem[]
  )
  const [pickingDay, setPickingDay] = useState<string | null>(null)
  const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]))
  const soonIngredientIds = new Set(
    inventory
      .filter((item) => deriveInventoryStatus(item) === "soon")
      .map((item) => item.ingredientId)
  )

  async function changeServings(entry: PlanEntry, servings: number) {
    await planRepo.put({ ...entry, servings })
    refresh()
  }

  async function addRecipe(date: string, recipeId: string) {
    const recipe = recipeById.get(recipeId)
    const existing = entries.filter((entry) => entry.date === date)
    await planRepo.put(
      normalizePlanEntry({
        id: createId("plan"),
        date,
        rangeKey: null,
        recipeId,
        servings: recipe?.servings ?? 2,
        sortOrder: existing.length,
      })
    )
    setPickingDay(null)
    refresh()
  }

  async function removeEntry(id: string) {
    await planRepo.remove(id)
    refresh()
  }

  return (
    <>
      <PageHeader title="计划" subtitle="先定这几天吃什么，再去菜市场。" />
      <div className="flex flex-col gap-5 px-4 pb-8">
        {days.map((date) => {
          const dayEntries = entries
            .filter((entry) => entry.date === date)
            .sort((a, b) => a.sortOrder - b.sortOrder)
          return (
            <section key={date} className="space-y-3">
              <h2 className="text-lg font-medium">{prettyDate(date)}</h2>
              {dayEntries.map((entry) => {
                const recipe = recipeById.get(entry.recipeId)
                const usesSoon = recipeItems.some(
                  (item) =>
                    item.recipeId === entry.recipeId &&
                    item.ingredientId &&
                    soonIngredientIds.has(item.ingredientId)
                )
                const cooked = isPlanEntryCooked(entry)
                return (
                  <Card key={entry.id}>
                    <CardContent className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p
                              className={
                                cooked
                                  ? "text-lg font-medium text-muted-foreground"
                                  : "text-lg font-medium"
                              }
                            >
                              {recipe?.name ?? "未知菜"}
                            </p>
                            {cooked ? (
                              <PlanEntryStatusBadge status="cooked" />
                            ) : null}
                          </div>
                          {cooked ? (
                            <p className="mt-1 text-sm text-muted-foreground">
                              做过了，库存已扣过
                            </p>
                          ) : usesSoon ? (
                            <p className="mt-1 text-sm text-primary-foreground/80">
                              含临期食材，优先消化
                            </p>
                          ) : null}
                        </div>
                        <Button
                          variant="ghost"
                          className="h-10"
                          onClick={() => void removeEntry(entry.id)}
                        >
                          去掉
                        </Button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          份数
                        </span>
                        <QuantityStepper
                          value={entry.servings}
                          disabled={cooked}
                          onChange={(value) =>
                            void changeServings(entry, value)
                          }
                        />
                      </div>
                      <Button
                        nativeButton={false}
                        variant={cooked ? "outline" : "default"}
                        className="h-12 w-full text-base"
                        render={
                          <Link
                            to="/cook/$entryId"
                            params={{ entryId: entry.id }}
                          />
                        }
                      >
                        {cooked ? "再看步骤" : "去做这道"}
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}
              {pickingDay === date ? (
                <select
                  className={fieldControlClass}
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value)
                      void addRecipe(date, event.target.value)
                  }}
                >
                  <option value="">选一道菜</option>
                  {recipes.map((recipe) => (
                    <option key={recipe.id} value={recipe.id}>
                      {recipe.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Button
                  variant="outline"
                  className="h-12 w-full text-base"
                  onClick={() => setPickingDay(date)}
                >
                  加一道菜
                </Button>
              )}
            </section>
          )
        })}
      </div>
    </>
  )
}
