import { Link, createFileRoute } from "@tanstack/react-router"
import { InventoryForm } from "@/components/inventory-form"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { useQuery } from "@/hooks/use-db"
import { ingredientsRepo, inventoryRepo } from "@/lib/db/repos"
import type { Ingredient, InventoryItem } from "@/lib/types"

export const Route = createFileRoute("/_tabs/inventory/$itemId")({
  component: InventoryEditPage,
})

function InventoryEditPage() {
  const { itemId } = Route.useParams()
  const { data: ingredients } = useQuery(
    "ingredients",
    () => ingredientsRepo.list(),
    [] as Ingredient[]
  )
  const { data: item, loading } = useQuery(
    `inventory:${itemId}`,
    () => inventoryRepo.get(itemId),
    undefined as InventoryItem | undefined
  )

  return (
    <>
      <PageHeader
        title="改库存"
        action={
          <Button variant="ghost" className="h-11" render={<Link to="/inventory" />}>
            返回
          </Button>
        }
      />
      {loading ? (
        <p className="px-4 text-sm text-muted-foreground">读取中…</p>
      ) : item ? (
        <InventoryForm ingredients={ingredients} item={item} />
      ) : (
        <p className="px-4 text-sm text-muted-foreground">这条库存不在了。</p>
      )}
    </>
  )
}
