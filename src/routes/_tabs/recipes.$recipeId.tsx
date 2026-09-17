import { useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { IngredientConfirmList } from "@/components/ingredient-confirm"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useDb, useQuery } from "@/hooks/use-db"
import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { applyConfirmChoice } from "@/lib/ai/resolve-ingredients"
import { resolveIngredients } from "@/lib/ai/resolve-ingredients.functions"
import type {
  ConfirmChoice,
  IngredientResolveResult,
} from "@/lib/ai/resolve-ingredients"
import { ingredientsRepo, recipeItemsRepo, recipesRepo } from "@/lib/db/repos"
import {
  persistIngredientResolutions,
  resolveAndPersistQuiet,
} from "@/lib/ingredient-resolve-persist"
import type { Ingredient, Recipe, RecipeItem } from "@/lib/types"

export const Route = createFileRoute("/_tabs/recipes/$recipeId")({
  component: RecipeDetailPage,
})

function RecipeDetailPage() {
  const { recipeId } = Route.useParams()
  const { refresh } = useDb()
  const resolveOnServer = useServerFn(resolveIngredients)
  const { data: recipe, loading } = useQuery(
    `recipe:${recipeId}`,
    () => recipesRepo.get(recipeId),
    undefined as Recipe | undefined
  )
  const { data: items } = useQuery(
    `recipe-items:${recipeId}`,
    () => recipeItemsRepo.byRecipe(recipeId),
    [] as RecipeItem[]
  )
  const { data: ingredients } = useQuery(
    "ingredients",
    () => ingredientsRepo.list(),
    [] as Ingredient[]
  )
  const byId = new Map(
    ingredients.map((ingredient) => [ingredient.id, ingredient])
  )
  const unlinked = items.filter((item) => !item.ingredientId)
  const [pendingResults, setPendingResults] = useState<
    IngredientResolveResult[] | null
  >(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")

  async function applyResolved(
    results: IngredientResolveResult[],
    already?: Map<string, Ingredient>
  ) {
    const currentIngredients = await ingredientsRepo.list()
    const byRawName =
      already ??
      (await persistIngredientResolutions(results, currentIngredients))
        .byRawName
    const currentItems = await recipeItemsRepo.byRecipe(recipeId)
    await Promise.all(
      currentItems.map((item) => {
        if (item.ingredientId) return Promise.resolve()
        const ingredient = byRawName.get(normalizeIngredientName(item.rawName))
        if (!ingredient) return Promise.resolve()
        return recipeItemsRepo.put({
          ...item,
          ingredientId: ingredient.id,
          matchStatus: "linked",
        })
      })
    )
    setPendingResults(null)
    refresh()
    setNotice("食材已记下。")
  }

  async function confirmIngredients() {
    setBusy(true)
    setNotice("")
    try {
      const currentIngredients = await ingredientsRepo.list()
      const { results, pending, byRawName } = await resolveAndPersistQuiet(
        unlinked.map((item) => ({
          rawName: item.rawName,
          unit: item.unit,
        })),
        currentIngredients,
        (payload) => resolveOnServer({ data: payload })
      )
      if (pending.length > 0) {
        setPendingResults(results)
        return
      }
      await applyResolved(results, byRawName)
    } catch (error) {
      console.error("确认食材失败", error)
      setNotice("没能记下，请再试一次。")
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirm(rawName: string, choice: ConfirmChoice) {
    if (!pendingResults) return
    const next = pendingResults.map((result) =>
      result.rawName === rawName ? applyConfirmChoice(result, choice) : result
    )
    setPendingResults(next)
    if (next.some((result) => result.action === "needs_confirm")) return
    setBusy(true)
    try {
      await applyResolved(next)
    } catch (error) {
      console.error("确认食材失败", error)
      setNotice("没能记下，请再试一次。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title={recipe?.name ?? "食谱"}
        subtitle={
          recipe
            ? `${recipe.servings} 人份${recipe.approxMinutes ? ` · 约 ${recipe.approxMinutes} 分钟` : ""}`
            : undefined
        }
        action={
          <Button
            nativeButton={false}
            variant="ghost"
            className="h-11"
            render={<Link to="/recipes" />}
          >
            返回
          </Button>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-8">
        {loading ? (
          <p className="text-sm text-muted-foreground">读取中…</p>
        ) : null}
        <Card>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">食材</p>
            {items.map((item) => {
              const linked = item.ingredientId
                ? byId.get(item.ingredientId)
                : undefined
              return (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 text-base"
                >
                  <span>
                    {item.rawName}
                    {linked && linked.name !== item.rawName
                      ? ` → ${linked.name}`
                      : ""}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {item.quantity} {item.unit}
                    {!item.ingredientId ? " · 待确认" : ""}
                  </span>
                </div>
              )
            })}
            {unlinked.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full text-sm"
                disabled={busy}
                onClick={() => void confirmIngredients()}
              >
                {busy ? "正在确认…" : "确认食材"}
              </Button>
            ) : null}
            {pendingResults ? (
              <IngredientConfirmList
                results={pendingResults}
                onChoose={(rawName, choice) =>
                  void handleConfirm(rawName, choice)
                }
              />
            ) : null}
            {notice ? (
              <p className="text-sm leading-6 text-muted-foreground">
                {notice}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">步骤</p>
            <ol className="list-decimal space-y-3 pl-5 text-base leading-7">
              {recipe?.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground">
          做菜从「计划」打开，计时和扣库存都在做菜页。
        </p>
      </div>
    </>
  )
}
