import { Outlet, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_tabs/plan")({
  component: PlanLayout,
})

function PlanLayout() {
  return <Outlet />
}
