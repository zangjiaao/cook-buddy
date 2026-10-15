import { useEffect, useMemo, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { PageHeader } from "@/components/layout/page-header"
import { RecipeFavoriteButton } from "@/components/recipe-favorite-button"
import { RecipeTagFilterChips } from "@/components/recipe-tag-chips"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useAccount } from "@/hooks/use-account"
import { useDb, useQuery } from "@/hooks/use-db"
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh"
import { listRecipePendingCounts } from "@/lib/recipe-help.functions"
import {
  ingredientsRepo,
  recipeItemsRepo,
  recipesRepo,
  setRecipeFavorite,
} from "@/lib/db/repos"
import {
  recipeTagFilterLabel,
  recipeTagLabel,
  sanitizeRecipeTags,
  visibleRecipeGroups,
} from "@/lib/recipe-organize"
import type { RecipeTagFilter } from "@/lib/recipe-organize"
import {
  filterRecipesBySearch,
  recipeIngredientHint,
  recipeSearchQuery,
} from "@/lib/recipe-search"
import type { Ingredient, Recipe, RecipeItem } from "@/lib/types"

export const Route = createFileRoute("/_tabs/recipes/")({
  component: RecipesPage,
})

function RecipesPage() {
  const { refresh, revision } = useDb()
  const account = useAccount()
  const loadPending = useServerFn(listRecipePendingCounts)
  const [pendingByRecipe, setPendingByRecipe] = useState<
    Record<string, number>
  >({})
  const { data: recipes, loading } = useQuery(
    "recipes",
    () => recipesRepo.list(),
    [] as Recipe[]
  )
  const { data: recipeItems, loading: itemsLoading } = useQuery(
    "recipe-items",
    () => recipeItemsRepo.list(),
    [] as RecipeItem[]
  )
  const { data: ingredients, loading: ingredientsLoading } = useQuery(
    "ingredients",
    () => ingredientsRepo.list(),
    [] as Ingredient[]
  )
  const [tagFilter, setTagFilter] = useState<RecipeTagFilter>("all")
  const [query, setQuery] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const ingredientsById = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])),
    [ingredients]
  )
  const searchNeedle = recipeSearchQuery(query)
  const searchLabel = query.trim()
  const groups = useMemo(() => {
    const grouped = visibleRecipeGroups(recipes, tagFilter)
    return {
      favorites: filterRecipesBySearch(
        grouped.favorites,
        recipeItems,
        ingredientsById,
        query
      ),
      rest: filterRecipesBySearch(
        grouped.rest,
        recipeItems,
        ingredientsById,
        query
      ),
    }
  }, [recipes, tagFilter, recipeItems, ingredientsById, query])
  const visibleCount = groups.favorites.length + groups.rest.length
  const listLoading =
    loading || (Boolean(searchNeedle) && (itemsLoading || ingredientsLoading))

  useEffect(() => {
    if (!account.user) {
      setPendingByRecipe({})
      return
    }
    let cancelled = false
    loadPending()
      .then((result) => {
        if (cancelled || !result.ok) return
        setPendingByRecipe(countsByRecipe(result.counts))
      })
      .catch(() => {
        if (!cancelled) setPendingByRecipe({})
      })
    return () => {
      cancelled = true
    }
  }, [account.user, account.lastSyncAt, loadPending, revision])

  useForegroundRefresh(() => {
    if (!account.user) return
    void loadPending()
      .then((result) => {
        if (!result.ok) return
        setPendingByRecipe(countsByRecipe(result.counts))
      })
      .catch(() => {})
  }, Boolean(account.user))

  async function toggleFavorite(recipe: Recipe) {
    setBusyId(recipe.id)
    try {
      await setRecipeFavorite(recipe.id, !recipe.favorited)
      refresh()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="食谱"
        subtitle="常做的钉在上面。粘贴文本抽出草稿，校对后才入库。"
        action={
          <Button
            nativeButton={false}
            render={<Link to="/recipes/paste" />}
            className="h-11 px-4 text-sm"
          >
            粘贴录入
          </Button>
        }
      />
      <div className="flex flex-col gap-3 px-4 pb-8">
        <RecipeSearch value={query} onChange={setQuery} />
        <RecipeTagFilterChips value={tagFilter} onChange={setTagFilter} />
        {listLoading ? (
          <p className="text-sm text-muted-foreground">正在读取食谱…</p>
        ) : null}
        {!listLoading && recipes.length === 0 && !searchNeedle ? (
          <p className="text-sm leading-6 text-muted-foreground">
            还没有食谱。点右上角「粘贴录入」，贴上一道菜。
          </p>
        ) : null}
        {!listLoading &&
        visibleCount === 0 &&
        (recipes.length > 0 || searchNeedle) ? (
          <p className="text-sm leading-6 text-muted-foreground">
            {searchNeedle
              ? `食谱里没有 ${searchLabel}`
              : `还没有${recipeTagFilterLabel(tagFilter)}这标签的菜。`}
          </p>
        ) : null}
        {groups.favorites.length > 0 ? (
          <RecipeListSection
            title="常做"
            recipes={groups.favorites}
            items={recipeItems}
            ingredientsById={ingredientsById}
            query={query}
            busyId={busyId}
            pendingByRecipe={pendingByRecipe}
            onToggleFavorite={(recipe) => void toggleFavorite(recipe)}
          />
        ) : null}
        {groups.rest.length > 0 ? (
          <RecipeListSection
            title={groups.favorites.length > 0 ? "其他" : undefined}
            recipes={groups.rest}
            items={recipeItems}
            ingredientsById={ingredientsById}
            query={query}
            busyId={busyId}
            pendingByRecipe={pendingByRecipe}
            onToggleFavorite={(recipe) => void toggleFavorite(recipe)}
          />
        ) : null}
      </div>
    </>
  )
}

function RecipeListSection({
  title,
  recipes,
  items,
  ingredientsById,
  query,
  busyId,
  pendingByRecipe,
  onToggleFavorite,
}: {
  title?: string
  recipes: Recipe[]
  items: RecipeItem[]
  ingredientsById: ReadonlyMap<string, Ingredient>
  query: string
  busyId: string | null
  pendingByRecipe: Record<string, number>
  onToggleFavorite: (recipe: Recipe) => void
}) {
  return (
    <section className="flex flex-col gap-3">
      {title ? <h2 className="text-lg font-medium">{title}</h2> : null}
      {recipes.map((recipe) => (
        <RecipeListCard
          key={recipe.id}
          recipe={recipe}
          ingredientHint={recipeIngredientHint(
            recipe,
            items,
            ingredientsById,
            query
          )}
          pendingCount={pendingByRecipe[recipe.id] ?? 0}
          busy={busyId === recipe.id}
          onToggleFavorite={() => onToggleFavorite(recipe)}
        />
      ))}
    </section>
  )
}

function countsByRecipe(
  counts: { recipeId: string; count: number }[]
): Record<string, number> {
  return Object.fromEntries(counts.map((row) => [row.recipeId, row.count]))
}

function RecipeSearch({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="搜菜、标签或食材"
        aria-label="搜索食谱"
        autoComplete="off"
        className={`h-11 px-3 text-base md:text-base ${value ? "pr-16" : ""}`}
      />
      {value ? (
        <button
          type="button"
          className="absolute inset-y-0 right-0 inline-flex items-center px-3 text-sm font-medium text-muted-foreground"
          onClick={() => onChange("")}
        >
          清空
        </button>
      ) : null}
    </div>
  )
}

function RecipeListCard({
  recipe,
  ingredientHint,
  pendingCount,
  busy,
  onToggleFavorite,
}: {
  recipe: Recipe
  ingredientHint: string | null
  pendingCount: number
  busy: boolean
  onToggleFavorite: () => void
}) {
  const tags = sanitizeRecipeTags(recipe.tags)
  return (
    <Card>
      <CardContent className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to="/recipes/$recipeId"
            params={{ recipeId: recipe.id }}
            className="block"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-medium">{recipe.name}</p>
              {tags.map((tag) => (
                <Badge key={tag} variant="outline" className="h-6 px-2 text-xs">
                  {recipeTagLabel[tag]}
                </Badge>
              ))}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {recipe.servings} 人份
              {recipe.approxMinutes ? ` · 约 ${recipe.approxMinutes} 分钟` : ""}
              {` · ${recipe.steps.length} 步`}
            </p>
            {recipe.sourceLabel ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {recipe.sourceLabel}
              </p>
            ) : null}
            {ingredientHint ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                含 {ingredientHint}
              </p>
            ) : null}
          </Link>
          {pendingCount > 0 ? (
            <Link
              to="/recipes/$recipeId/suggestions"
              params={{ recipeId: recipe.id }}
              className="mt-1 block text-xs leading-5 text-primary-foreground"
            >
              有 {pendingCount} 条建议
            </Link>
          ) : null}
        </div>
        <RecipeFavoriteButton
          favorited={Boolean(recipe.favorited)}
          disabled={busy}
          compact
          onToggle={onToggleFavorite}
          className="h-11 shrink-0 px-3 text-sm"
        />
      </CardContent>
    </Card>
  )
}
