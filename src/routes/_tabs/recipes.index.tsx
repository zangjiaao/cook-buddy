import { useMemo, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { PageHeader } from "@/components/layout/page-header"
import { RecipeFavoriteButton } from "@/components/recipe-favorite-button"
import { RecipeTagFilterChips } from "@/components/recipe-tag-chips"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useDb, useQuery } from "@/hooks/use-db"
import { recipesRepo, setRecipeFavorite } from "@/lib/db/repos"
import {
  recipeTagFilterLabel,
  recipeTagLabel,
  sanitizeRecipeTags,
  visibleRecipeGroups,
} from "@/lib/recipe-organize"
import type { RecipeTagFilter } from "@/lib/recipe-organize"
import type { Recipe } from "@/lib/types"

export const Route = createFileRoute("/_tabs/recipes/")({
  component: RecipesPage,
})

function RecipesPage() {
  const { refresh } = useDb()
  const { data: recipes, loading } = useQuery(
    "recipes",
    () => recipesRepo.list(),
    [] as Recipe[]
  )
  const [tagFilter, setTagFilter] = useState<RecipeTagFilter>("all")
  const [busyId, setBusyId] = useState<string | null>(null)
  const groups = useMemo(
    () => visibleRecipeGroups(recipes, tagFilter),
    [recipes, tagFilter]
  )
  const visibleCount = groups.favorites.length + groups.rest.length

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
        <RecipeTagFilterChips value={tagFilter} onChange={setTagFilter} />
        {loading ? (
          <p className="text-sm text-muted-foreground">正在读取食谱…</p>
        ) : null}
        {!loading && recipes.length === 0 ? (
          <p className="text-sm leading-6 text-muted-foreground">
            还没有食谱，先粘贴一道菜。
          </p>
        ) : null}
        {!loading && recipes.length > 0 && visibleCount === 0 ? (
          <p className="text-sm leading-6 text-muted-foreground">
            还没有{recipeTagFilterLabel(tagFilter)}这标签的菜。
          </p>
        ) : null}
        {groups.favorites.length > 0 ? (
          <RecipeListSection
            title="常做"
            recipes={groups.favorites}
            busyId={busyId}
            onToggleFavorite={(recipe) => void toggleFavorite(recipe)}
          />
        ) : null}
        {groups.rest.length > 0 ? (
          <RecipeListSection
            title={groups.favorites.length > 0 ? "其他" : undefined}
            recipes={groups.rest}
            busyId={busyId}
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
  busyId,
  onToggleFavorite,
}: {
  title?: string
  recipes: Recipe[]
  busyId: string | null
  onToggleFavorite: (recipe: Recipe) => void
}) {
  return (
    <section className="flex flex-col gap-3">
      {title ? <h2 className="text-lg font-medium">{title}</h2> : null}
      {recipes.map((recipe) => (
        <RecipeListCard
          key={recipe.id}
          recipe={recipe}
          busy={busyId === recipe.id}
          onToggleFavorite={() => onToggleFavorite(recipe)}
        />
      ))}
    </section>
  )
}

function RecipeListCard({
  recipe,
  busy,
  onToggleFavorite,
}: {
  recipe: Recipe
  busy: boolean
  onToggleFavorite: () => void
}) {
  const tags = sanitizeRecipeTags(recipe.tags)
  return (
    <Card>
      <CardContent className="flex items-start gap-3">
        <Link
          to="/recipes/$recipeId"
          params={{ recipeId: recipe.id }}
          className="min-w-0 flex-1"
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
        </Link>
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
