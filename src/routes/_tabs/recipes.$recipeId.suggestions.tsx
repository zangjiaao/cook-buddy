import { Link, createFileRoute } from "@tanstack/react-router"
import { PageHeader } from "@/components/layout/page-header"
import { RecipeSuggestionList } from "@/components/recipe-suggestion-list"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/_tabs/recipes/$recipeId/suggestions")({
  component: SuggestionsPage,
})

function SuggestionsPage() {
  const { recipeId } = Route.useParams()
  return (
    <>
      <PageHeader
        title="修改建议"
        subtitle="上面是原话，下面是整理出的改动。勾上要留下的，接受后写入这道菜。"
        action={
          <Button
            nativeButton={false}
            variant="ghost"
            className="h-11"
            render={<Link to="/recipes/$recipeId" params={{ recipeId }} />}
          >
            返回
          </Button>
        }
      />
      <div className="px-4 pb-8">
        <RecipeSuggestionList recipeId={recipeId} />
      </div>
    </>
  )
}
