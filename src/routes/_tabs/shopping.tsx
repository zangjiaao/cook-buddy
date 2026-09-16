import { useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { PageHeader } from "@/components/layout/page-header"
import { ShortageBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { useDb, useQuery } from "@/hooks/use-db"
import { nowIso } from "@/lib/dates"
import {
  checkInBoughtItems,
  regenerateShoppingFromPlan,
  shoppingRepo,
} from "@/lib/db/repos"
import { stallText } from "@/lib/labels"
import type { ShoppingItem, StallHint } from "@/lib/types"

export const Route = createFileRoute("/_tabs/shopping")({
  component: ShoppingPage,
})

const STALL_ORDER: StallHint[] = ["meat", "veg", "dry", null]

function ShoppingPage() {
  const { refresh } = useDb()
  const { data: items, loading } = useQuery(
    "shopping",
    () => shoppingRepo.list(),
    [] as ShoppingItem[]
  )
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)

  const grouped = useMemo(() => {
    return STALL_ORDER.map((stall) => ({
      stall,
      items: items.filter((item) => item.stallHint === stall),
    })).filter((group) => group.items.length > 0)
  }, [items])

  async function toggle(item: ShoppingItem) {
    const bought = item.status !== "bought"
    await shoppingRepo.put({
      ...item,
      status: bought ? "bought" : "needed",
      checkedAt: bought ? nowIso() : null,
    })
    refresh()
  }

  async function regenerate() {
    setBusy(true)
    try {
      const next = await regenerateShoppingFromPlan()
      refresh()
      if (next.length === 0) {
        setNotice("计划里还没有菜，清单已清空。先去计划页加一道再生成。")
        return
      }
      setNotice(
        `已按当前计划生成 ${next.length} 项。已买勾选按同一食材和单位保留。`
      )
    } catch (error) {
      console.error("按计划生成清单失败", error)
      setNotice("生成失败，请再试一次。")
    } finally {
      setBusy(false)
    }
  }

  async function checkIn() {
    const boughtIds = items
      .filter((item) => item.status === "bought")
      .map((item) => item.id)
    if (boughtIds.length === 0) {
      setNotice("先勾买到的，再一键入库。")
      return
    }
    const created = await checkInBoughtItems(boughtIds)
    refresh()
    setNotice(`已入库 ${created.length} 条，保质期可回库存手填。`)
  }

  async function shareList() {
    const lines = [
      "做饭搭子 · 菜市场清单",
      ...items.map(
        (item) =>
          `${item.status === "bought" ? "☑" : "☐"} ${item.name} ${item.quantityHint} ${item.unit}（${item.shortage === "enough" ? "够" : item.shortage === "short" ? "不够" : "不确定"}）`
      ),
    ]
    const text = lines.join("\n")
    if (typeof navigator.share === "function") {
      await navigator.share({ title: "菜市场清单", text })
      return
    }
    await navigator.clipboard.writeText(text)
    setNotice("清单已复制，发给家人即可。")
  }

  return (
    <>
      <PageHeader
        title="清单"
        subtitle="差额只用够 / 不够 / 不确定，不做单位换算。"
      />
      <div className="flex flex-col gap-4 px-4 pb-8">
        {loading ? (
          <p className="text-sm text-muted-foreground">正在读取清单…</p>
        ) : null}
        {grouped.map((group) => (
          <section key={String(group.stall)} className="space-y-3">
            <h2 className="text-lg font-medium">{stallText(group.stall)}</h2>
            {group.items.map((item) => (
              <Card key={item.id}>
                <CardContent className="flex items-center gap-3">
                  <Checkbox
                    checked={item.status === "bought"}
                    className="size-6"
                    onCheckedChange={() => void toggle(item)}
                  />
                  <button
                    type="button"
                    className="min-h-12 flex-1 text-left"
                    onClick={() => void toggle(item)}
                  >
                    <p className="text-lg font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.quantityHint} {item.unit}
                    </p>
                  </button>
                  <ShortageBadge shortage={item.shortage} />
                </CardContent>
              </Card>
            ))}
          </section>
        ))}
        <Button
          className="h-12 text-base"
          disabled={busy}
          onClick={() => void regenerate()}
        >
          {busy ? "正在按计划生成…" : "按计划生成清单"}
        </Button>
        <Button
          variant="outline"
          className="h-12 text-base"
          disabled={busy}
          onClick={() => void checkIn()}
        >
          勾过的一键入库
        </Button>
        <Button
          variant="outline"
          className="h-12 text-base"
          disabled={busy}
          onClick={() => void shareList()}
        >
          导出 / 分享
        </Button>
        {notice ? (
          <p className="text-sm leading-6 text-muted-foreground">{notice}</p>
        ) : null}
      </div>
    </>
  )
}
