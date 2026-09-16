import { Link, createFileRoute } from "@tanstack/react-router"
import { InventoryForm } from "@/components/inventory-form"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { useQuery } from "@/hooks/use-db"
import { ingredientsRepo } from "@/lib/db/repos"
import type { Ingredient } from "@/lib/types"

export const Route = createFileRoute("/_tabs/inventory/new")({
  component: InventoryNewPage,
})

function InventoryNewPage() {
  const { data: ingredients } = useQuery(
    "ingredients",
    () => ingredientsRepo.list(),
    [] as Ingredient[]
  )

  return (
    <>
      <PageHeader
        title="加入库存"
        subtitle="菜市场单位即可，不做克数换算。"
        action={
          <Button variant="ghost" className="h-11" render={<Link to="/inventory" />}>
            返回
          </Button>
        }
      />
      <InventoryForm ingredients={ingredients} />
    </>
  )
}
