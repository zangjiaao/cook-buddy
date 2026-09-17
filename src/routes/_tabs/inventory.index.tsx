import { useMemo, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { InventoryFilterChips } from "@/components/inventory-filter-chips"
import { HeaderMenu } from "@/components/layout/header-menu"
import { PageHeader } from "@/components/layout/page-header"
import { InventoryStatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useDb, useQuery } from "@/hooks/use-db"
import {
  ingredientsRepo,
  inventoryRepo,
  markIngredientRunningLow,
} from "@/lib/db/repos"
import { isStapleIngredient } from "@/lib/ingredient-kind"
import {
  filterInventoryByCategory,
  inventoryCategoryFilterLabel,
} from "@/lib/inventory-filter"
import type { InventoryCategoryFilter } from "@/lib/inventory-filter"
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
  const [notice, setNotice] = useState("")
  const [categoryFilter, setCategoryFilter] =
    useState<InventoryCategoryFilter>("all")
  const byId = useMemo(
    () => new Map(ingredients.map((ingredient) => [ingredient.id, ingredient])),
    [ingredients]
  )
  const sorted = useMemo(() => sortInventoryByExpiry(items), [items])
  const visible = useMemo(
    () => filterInventoryByCategory(sorted, byId, categoryFilter),
    [sorted, byId, categoryFilter]
  )
  const expiredIds = expiredInventoryIds(items)

  async function markLow(ingredientId: string, name: string) {
    setBusy(true)
    try {
      const line = await markIngredientRunningLow(ingredientId)
      if (!line) {
        setNotice("没能记下，请再试一次。")
        return
      }
      setNotice(`已把${name} ${line.quantityHint} ${line.unit}加进清单。`)
      refresh()
    } finally {
      setBusy(false)
    }
  }

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
          <div className="flex items-center gap-1">
            <Button
              nativeButton={false}
              render={<Link to="/inventory/new" />}
              className="h-11 px-4 text-sm"
            >
              新增
            </Button>
            <HeaderMenu label="更多">
              <Link
                to="/inventory/ingredients"
                className="block px-3 py-2.5 text-sm leading-6 text-foreground hover:bg-muted"
              >
                食材档案
              </Link>
            </HeaderMenu>
          </div>
        }
      />
      <div className="flex flex-col gap-3 px-4 pb-8">
        <InventoryFilterChips
          value={categoryFilter}
          onChange={setCategoryFilter}
        />
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
        {notice ? (
          <p className="text-sm leading-6 text-muted-foreground">{notice}</p>
        ) : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">正在读取本地库存…</p>
        ) : null}
        {!loading && visible.length === 0 ? (
          <p className="text-sm leading-6 text-muted-foreground">
            {categoryFilter === "all"
              ? "库存还是空的，先加一点。"
              : `还没有${inventoryCategoryFilterLabel(categoryFilter)}类的存货。`}
          </p>
        ) : null}
        {visible.map((item) => {
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
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-medium">
                      {ingredient?.name ?? "未命名食材"}
                    </p>
                    {ingredient ? (
                      <Badge variant="outline" className="h-6 px-2 text-xs">
                        {categoryLabel[ingredient.category]}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.quantity} {item.unit} · {locationLabel[item.location]}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.expiresAt ? `能放到 ${item.expiresAt}` : "没写保质期"}
                  </p>
                </Link>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <InventoryStatusBadge status={status} />
                  {ingredient && isStapleIngredient(ingredient) ? (
                    <HeaderMenu label="更多">
                      <button
                        type="button"
                        className="block w-full px-3 py-2.5 text-left text-sm leading-6 text-foreground hover:bg-muted disabled:opacity-50"
                        disabled={busy}
                        onClick={() =>
                          void markLow(item.ingredientId, ingredient.name)
                        }
                      >
                        快没了
                      </button>
                    </HeaderMenu>
                  ) : null}
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
