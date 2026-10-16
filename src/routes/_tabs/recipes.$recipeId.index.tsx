import { useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { IngredientConfirmList } from "@/components/ingredient-confirm"
import { PageHeader } from "@/components/layout/page-header"
import { RecipeFavoriteButton } from "@/components/recipe-favorite-button"
import { RecipeHelpCard } from "@/components/recipe-help-card"
import { RecipeTagPicker } from "@/components/recipe-tag-chips"
import { Button } from "@/components/ui/button"
import { useDb, useQuery } from "@/hooks/use-db"
import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { applyConfirmChoice } from "@/lib/ai/resolve-ingredients"
import { resolveIngredients } from "@/lib/ai/resolve-ingredients.functions"
import type {
  ConfirmChoice,
  IngredientResolveResult,
} from "@/lib/ai/resolve-ingredients"
import {
  ingredientsRepo,
  recipeItemsRepo,
  recipesRepo,
  setRecipeFavorite,
  setRecipeTags,
} from "@/lib/db/repos"
import { sanitizeRecipeTags } from "@/lib/recipe-organize"
import type { RecipeTag } from "@/lib/recipe-organize"
import {
  persistIngredientResolutions,
  resolveAndPersistQuiet,
} from "@/lib/ingredient-resolve-persist"
import { sourceUrlHost } from "@/lib/source-url"
import type { Ingredient, Recipe, RecipeItem } from "@/lib/types"

export const Route = createFileRoute("/_tabs/recipes/$recipeId/")({
  component: RecipeDetailPage,
})

function RecipeDetailPage() {
  const { recipeId } = Route.useParams()
  const { refresh } = useDb()
  const [showShare, setShowShare] = useState(false)
  const [pendingSuggestions, setPendingSuggestions] = useState(0)
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
  const [metaBusy, setMetaBusy] = useState(false)
  const [notice, setNotice] = useState("")

  async function toggleFavorite() {
    if (!recipe) return
    setMetaBusy(true)
    try {
      await setRecipeFavorite(recipeId, !recipe.favorited)
      refresh()
    } finally {
      setMetaBusy(false)
    }
  }

  async function changeTags(tags: RecipeTag[]) {
    setMetaBusy(true)
    try {
      await setRecipeTags(recipeId, tags)
      refresh()
    } finally {
      setMetaBusy(false)
    }
  }

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
            ? `${recipe.servings} 人份${recipe.approxMinutes ? ` · 约 ${recipe.approxMinutes} 分钟` : ""}${recipe.sourceLabel ? ` · ${recipe.sourceLabel}` : ""}`
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
      <div className="flex flex-col px-4 pb-8">
        {recipe?.sourceUrl ? (
          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 flex min-h-11 items-center px-1 text-xs text-muted-foreground underline underline-offset-2"
          >
            来源 {sourceUrlHost(recipe.sourceUrl)}
          </a>
        ) : null}
        {loading ? (
          <p className="mt-2 text-sm text-muted-foreground">读取中…</p>
        ) : null}
        {recipe ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <RecipeTagPicker
              compact
              className="min-w-0 flex-1"
              value={sanitizeRecipeTags(recipe.tags)}
              disabled={metaBusy}
              showHint={false}
              onChange={(tags) => void changeTags(tags)}
            />
            <RecipeFavoriteButton
              favorited={Boolean(recipe.favorited)}
              disabled={metaBusy}
              iconOnly
              onToggle={() => void toggleFavorite()}
              className="ml-auto size-10 shrink-0 p-0"
            />
          </div>
        ) : null}
        {recipe && pendingSuggestions > 0 ? (
          <Link
            to="/recipes/$recipeId/suggestions"
            params={{ recipeId }}
            className="mt-2 flex min-h-11 items-center px-1 text-sm font-medium text-primary-foreground"
          >
            {pendingSuggestions} 条修改意见待确认
          </Link>
        ) : null}
        <section className="mt-2">
          <h2 className="px-1 pb-2 text-sm font-medium text-muted-foreground">
            食材
          </h2>
          <ul className="border-t border-border">
            {items.map((item) => {
              const linked = item.ingredientId
                ? byId.get(item.ingredientId)
                : undefined
              return (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-3 border-b border-border py-3 text-base leading-6"
                >
                  <span>
                    {item.rawName}
                    {linked && linked.name !== item.rawName
                      ? ` → ${linked.name}`
                      : ""}
                  </span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {item.quantity} {item.unit}
                    {!item.ingredientId ? " · 待确认" : ""}
                  </span>
                </li>
              )
            })}
          </ul>
          {unlinked.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              className="mt-3 h-11 w-full text-sm"
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
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {notice}
            </p>
          ) : null}
        </section>
        <section className="mt-6">
          <h2 className="px-1 pb-2 text-sm font-medium text-muted-foreground">
            步骤
          </h2>
          <ol className="list-decimal space-y-4 border-t border-border py-3 pl-5 text-base leading-7">
            {recipe?.steps.map((step, index) => (
              <li key={`${index}-${step}`}>
                {step}
                {recipe.stepTips?.[index] ? (
                  <p className="text-sm leading-6 text-muted-foreground">
                    贴士：{recipe.stepTips[index]}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
        {recipe ? (
          <div className="mt-6 grid grid-cols-2 gap-2">
            <Button
              nativeButton={false}
              className="h-11 text-sm"
              render={
                <Link to="/recipes/$recipeId/edit" params={{ recipeId }} />
              }
            >
              改食谱
            </Button>
            <Button
              type="button"
              variant={showShare ? "secondary" : "outline"}
              className="h-11 text-sm"
              aria-expanded={showShare}
              onClick={() => setShowShare((current) => !current)}
            >
              分享
            </Button>
          </div>
        ) : null}
        {recipe ? (
          <RecipeHelpCard
            recipe={recipe}
            items={items}
            choosing={showShare}
            onPendingCount={setPendingSuggestions}
          />
        ) : null}
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          做菜从「计划」打开，计时和扣库存都在做菜页。
        </p>
      </div>
    </>
  )
}
