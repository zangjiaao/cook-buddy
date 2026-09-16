import { Outlet, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_tabs/inventory")({
  component: InventoryLayout,
})

function InventoryLayout() {
  return <Outlet />
}
