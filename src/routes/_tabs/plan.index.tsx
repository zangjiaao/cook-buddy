import { Link, createFileRoute } from "@tanstack/react-router"
import { AiPlanHeaderButton } from "@/components/ai-plan-draft-panel"
import { PageHeader } from "@/components/layout/page-header"
import { QuantityStepper } from "@/components/quantity-stepper"
import { PlanEntryStatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { fieldControlClass } from "@/components/field"
import { useDb, useQuery } from "@/hooks/use-db"
import { isPlanEntryCooked, normalizePlanEntry } from "@/lib/cook-complete"
import { formatISODate, prettyDate } from "@/lib/dates"
import {
  planRepo,
  recipeItemsRepo,
  recipesRepo,
  inventoryRepo,
} from "@/lib/db/repos"
import { deriveInventoryStatus } from "@/lib/inventory-status"
import { createId } from "@/lib/id"
import {
  addPlanHorizonDay,
  canCollapsePlanHorizon,
  canExtendPlanHorizon,
  collapsePlanHorizonEnd,
  planHorizonStorage,
  readHorizonEnd,
  resolvePlanHorizon,
  writeHorizonEnd,
} from "@/lib/plan-horizon"
import { sortRecipesForList } from "@/lib/recipe-organize"
import type { InventoryItem, PlanEntry, Recipe, RecipeItem } from "@/lib/types"
import { useEffect, useMemo, useState } from "react"

export const Route = createFileRoute("/_tabs/plan/")({
  component: PlanPage,
})

function persistHorizonEnd(end: string) {
  const storage = planHorizonStorage()
  if (storage) writeHorizonEnd(storage, end)
}

function PlanPage() {
  const { refresh } = useDb()
  const today = formatISODate()
  const [preferredEnd, setPreferredEnd] = useState<string | null>(null)
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

  useEffect(() => {
    const storage = planHorizonStorage()
    if (storage) setPreferredEnd(readHorizonEnd(storage))
  }, [])

  const entryDates = useMemo(
    () => entries.map((entry) => entry.date),
    [entries]
  )
  const horizon = useMemo(
    () => resolvePlanHorizon({ today, preferredEnd, entryDates }),
    [today, preferredEnd, entryDates]
  )
  const canAddDay = canExtendPlanHorizon({ today, end: horizon.end })
  const canRemoveEmptyDays = canCollapsePlanHorizon({
    today,
    currentEnd: horizon.end,
    entryDates,
  })

  const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]))
  const pickerRecipes = useMemo(() => sortRecipesForList(recipes), [recipes])
  const soonIngredientIds = new Set(
    inventory
      .filter((item) => deriveInventoryStatus(item) === "soon")
      .map((item) => item.ingredientId)
  )

  function setHorizonEnd(end: string) {
    persistHorizonEnd(end)
    setPreferredEnd(end)
  }

  function addDay() {
    if (!canAddDay) return
    setHorizonEnd(addPlanHorizonDay(horizon.end))
  }

  function removeEmptyDays() {
    if (!canRemoveEmptyDays) return
    setHorizonEnd(
      collapsePlanHorizonEnd({
        today,
        currentEnd: horizon.end,
        entryDates,
      })
    )
  }

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
      <PageHeader
        title="计划"
        subtitle="先定这几天吃什么，再去菜市场。不够就往后再加一天。"
        action={<AiPlanHeaderButton />}
      />
      <div className="flex flex-col gap-5 px-4 pb-8">
        {horizon.days.map((date) => {
          const dayEntries = entries
            .filter((entry) => entry.date === date)
            .sort((a, b) => a.sortOrder - b.sortOrder)
          return (
            <section key={date} className="space-y-3">
              <h2 className="text-lg font-medium">{prettyDate(date, today)}</h2>
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
                  {pickerRecipes.map((recipe) => (
                    <option key={recipe.id} value={recipe.id}>
                      {recipe.favorited ? `常做 · ${recipe.name}` : recipe.name}
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
        <div className="space-y-3 pt-1">
          <Button
            variant="outline"
            className="h-12 w-full text-base"
            disabled={!canAddDay}
            onClick={addDay}
          >
            加一天
          </Button>
          {canRemoveEmptyDays ? (
            <Button
              variant="ghost"
              className="h-12 w-full text-base"
              onClick={removeEmptyDays}
            >
              收掉空天
            </Button>
          ) : null}
          <p className="text-sm leading-6 text-muted-foreground">
            {canAddDay
              ? `现在排到${prettyDate(horizon.end, today)}。后面有菜的日子会自动露出来。`
              : `已经排到${prettyDate(horizon.end, today)}，先做到这些。`}
          </p>
        </div>
      </div>
    </>
  )
}
