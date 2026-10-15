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
        subtitle="勾上要留下的改动。接受后写入这道菜，并按现有规则认食材。"
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
