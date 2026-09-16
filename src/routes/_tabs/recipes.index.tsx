import { Link, createFileRoute } from "@tanstack/react-router"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useQuery } from "@/hooks/use-db"
import { recipesRepo } from "@/lib/db/repos"
import type { Recipe } from "@/lib/types"

export const Route = createFileRoute("/_tabs/recipes/")({
  component: RecipesPage,
})

function RecipesPage() {
  const { data: recipes, loading } = useQuery(
    "recipes",
    () => recipesRepo.list(),
    [] as Recipe[]
  )

  return (
    <>
      <PageHeader
        title="食谱"
        subtitle="粘贴文本抽出草稿，校对后才入库。"
        action={
          <Button render={<Link to="/recipes/paste" />} className="h-11 px-4 text-sm">
            粘贴录入
          </Button>
        }
      />
      <div className="flex flex-col gap-3 px-4">
        {loading ? <p className="text-sm text-muted-foreground">正在读取食谱…</p> : null}
        {recipes.map((recipe) => (
          <Link
            key={recipe.id}
            to="/recipes/$recipeId"
            params={{ recipeId: recipe.id }}
          >
            <Card>
              <CardContent>
                <p className="text-lg font-medium">{recipe.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {recipe.servings} 人份
                  {recipe.approxMinutes ? ` · 约 ${recipe.approxMinutes} 分钟` : ""}
                  {` · ${recipe.steps.length} 步`}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  )
}
