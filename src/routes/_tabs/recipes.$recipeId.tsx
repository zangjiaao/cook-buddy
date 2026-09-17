import { Outlet, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_tabs/recipes/$recipeId")({
  component: RecipeIdLayout,
})

function RecipeIdLayout() {
  return <Outlet />
}
