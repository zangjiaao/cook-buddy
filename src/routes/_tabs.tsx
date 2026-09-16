import { Outlet, createFileRoute } from "@tanstack/react-router"
import { AppShell } from "@/components/layout/app-shell"

export const Route = createFileRoute("/_tabs")({
  component: TabsLayout,
})

function TabsLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
