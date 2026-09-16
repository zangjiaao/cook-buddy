import { Link, createFileRoute } from "@tanstack/react-router"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useQuery } from "@/hooks/use-db"
import { ingredientsRepo, recipeItemsRepo, recipesRepo } from "@/lib/db/repos"
import { matchStatusLabel } from "@/lib/labels"
import type { Ingredient, Recipe, RecipeItem } from "@/lib/types"

export const Route = createFileRoute("/_tabs/recipes/$recipeId")({
  component: RecipeDetailPage,
})

function RecipeDetailPage() {
  const { recipeId } = Route.useParams()
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
  const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))

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
        {loading ? <p className="text-sm text-muted-foreground">读取中…</p> : null}
        <Card>
          <CardContent className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">食材</p>
            {items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 text-base">
                <span>
                  {item.rawName}
                  {item.ingredientId && byId.get(item.ingredientId)
                    ? ` → ${byId.get(item.ingredientId)!.name}`
                    : ""}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {item.quantity} {item.unit} · {matchStatusLabel[item.matchStatus]}
                </span>
              </div>
            ))}
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
