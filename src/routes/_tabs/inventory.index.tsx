import { Link, createFileRoute } from "@tanstack/react-router"
import { PageHeader } from "@/components/layout/page-header"
import { InventoryStatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useQuery } from "@/hooks/use-db"
import { ingredientsRepo, inventoryRepo } from "@/lib/db/repos"
import { deriveInventoryStatus, sortInventoryByExpiry } from "@/lib/inventory-status"
import { categoryLabel, locationLabel } from "@/lib/labels"
import type { Ingredient, InventoryItem } from "@/lib/types"

export const Route = createFileRoute("/_tabs/inventory/")({
  component: InventoryPage,
})

function InventoryPage() {
  const { data: items, loading } = useQuery(
    "inventory",
    () => inventoryRepo.list(),
    [] as InventoryItem[]
  )
  const { data: ingredients } = useQuery(
    "ingredients",
    () => ingredientsRepo.list(),
    [] as Ingredient[]
  )
  const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))
  const sorted = sortInventoryByExpiry(items)

  return (
    <>
      <PageHeader
        title="库存"
        subtitle="先过期的在上面。临期的，计划里会提醒优先消化。"
        action={
          <Button render={<Link to="/inventory/new" />} className="h-11 px-4 text-sm">
            新增
          </Button>
        }
      />
      <div className="flex flex-col gap-3 px-4">
        {loading ? <p className="text-sm text-muted-foreground">正在读取本地库存…</p> : null}
        {sorted.map((item) => {
          const ingredient = byId.get(item.ingredientId)
          const status = deriveInventoryStatus(item)
          return (
            <Link key={item.id} to="/inventory/$itemId" params={{ itemId: item.id }}>
              <Card>
                <CardContent className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-medium">
                      {ingredient?.name ?? "未命名食材"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.quantity} {item.unit} · {locationLabel[item.location]}
                      {ingredient ? ` · ${categoryLabel[ingredient.category]}` : ""}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.expiresAt ? `能放到 ${item.expiresAt}` : "没写保质期"}
                    </p>
                  </div>
                  <InventoryStatusBadge status={status} />
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </>
  )
}
