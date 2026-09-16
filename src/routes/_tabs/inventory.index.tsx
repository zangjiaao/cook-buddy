import { useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { PageHeader } from "@/components/layout/page-header"
import { InventoryStatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useDb, useQuery } from "@/hooks/use-db"
import { ingredientsRepo, inventoryRepo } from "@/lib/db/repos"
import {
  deriveInventoryStatus,
  expiredInventoryIds,
  sortInventoryByExpiry,
} from "@/lib/inventory-status"
import { categoryLabel, locationLabel } from "@/lib/labels"
import type { Ingredient, InventoryItem } from "@/lib/types"

export const Route = createFileRoute("/_tabs/inventory/")({
  component: InventoryPage,
})

function InventoryPage() {
  const { refresh } = useDb()
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
  const [busy, setBusy] = useState(false)
  const [confirmBulk, setConfirmBulk] = useState(false)
  const byId = new Map(
    ingredients.map((ingredient) => [ingredient.id, ingredient])
  )
  const sorted = sortInventoryByExpiry(items)
  const expiredIds = expiredInventoryIds(items)

  async function clearOne(id: string) {
    setBusy(true)
    try {
      await inventoryRepo.remove(id)
      refresh()
    } finally {
      setBusy(false)
    }
  }

  async function clearExpired() {
    if (!confirmBulk) {
      setConfirmBulk(true)
      return
    }
    setBusy(true)
    try {
      await inventoryRepo.removeMany(expiredIds)
      setConfirmBulk(false)
      refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="库存"
        subtitle="先过期的在上面。临期的，计划里会提醒优先消化。"
        action={
          <div className="flex gap-2">
            <Button
              nativeButton={false}
              variant="ghost"
              className="h-11 px-3 text-sm"
              render={<Link to="/inventory/ingredients" />}
            >
              主数据
            </Button>
            <Button
              nativeButton={false}
              render={<Link to="/inventory/new" />}
              className="h-11 px-4 text-sm"
            >
              新增
            </Button>
          </div>
        }
      />
      <div className="flex flex-col gap-3 px-4 pb-8">
        {expiredIds.length > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3">
            <p className="text-sm leading-6">{expiredIds.length} 条已经过期</p>
            <Button
              type="button"
              variant="destructive"
              className="h-10 px-3 text-sm"
              disabled={busy}
              onClick={() => void clearExpired()}
            >
              {confirmBulk
                ? `确认清掉 ${expiredIds.length} 条`
                : "过期的全清掉"}
            </Button>
          </div>
        ) : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">正在读取本地库存…</p>
        ) : null}
        {sorted.map((item) => {
          const ingredient = byId.get(item.ingredientId)
          const status = deriveInventoryStatus(item)
          return (
            <Card key={item.id}>
              <CardContent className="flex items-start justify-between gap-3">
                <Link
                  to="/inventory/$itemId"
                  params={{ itemId: item.id }}
                  className="min-w-0 flex-1"
                >
                  <p className="text-lg font-medium">
                    {ingredient?.name ?? "未命名食材"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.quantity} {item.unit} · {locationLabel[item.location]}
                    {ingredient
                      ? ` · ${categoryLabel[ingredient.category]}`
                      : ""}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.expiresAt ? `能放到 ${item.expiresAt}` : "没写保质期"}
                  </p>
                </Link>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <InventoryStatusBadge status={status} />
                  {status === "expired" ? (
                    <Button
                      type="button"
                      variant="destructive"
                      className="h-9 px-3 text-sm"
                      disabled={busy}
                      onClick={() => void clearOne(item.id)}
                    >
                      清掉
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </>
  )
}
