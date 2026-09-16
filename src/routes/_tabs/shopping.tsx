import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { CheckInConfirm } from "@/components/check-in-confirm"
import type { CheckInFormRow } from "@/components/check-in-confirm"
import { PageHeader } from "@/components/layout/page-header"
import { ShortageBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { useDb, useQuery } from "@/hooks/use-db"
import { nowIso } from "@/lib/dates"
import {
  defaultCheckInQuantity,
  draftsFromEdits,
  validateCheckInEdits,
} from "@/lib/check-in"
import { checkInBoughtItems, shoppingRepo } from "@/lib/db/repos"
import { stallText } from "@/lib/labels"
import {
  shoppingPrimaryText,
  shoppingSecondaryText,
} from "@/lib/shopping-from-plan"
import { shoppingRegen } from "@/lib/shopping-sync"
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
  const [confirmRows, setConfirmRows] = useState<CheckInFormRow[] | null>(null)
  const [confirmError, setConfirmError] = useState("")

  useEffect(() => {
    void shoppingRegen.flush()
  }, [])

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
      await shoppingRegen.force()
      const next = await shoppingRepo.list()
      if (next.length === 0) {
        setNotice("计划里还没有菜，清单已清空。先去计划页加一道再生成。")
        return
      }
      setNotice(
        `已按当前计划重算 ${next.length} 项。已买勾选按同一食材和单位保留。`
      )
    } catch (error) {
      console.error("重算清单失败", error)
      setNotice("重算失败，请再试一次。")
    } finally {
      setBusy(false)
    }
  }

  function openConfirm() {
    const bought = items.filter((item) => item.status === "bought")
    if (bought.length === 0) {
      setNotice("先勾买到的，再一键入库。")
      return
    }
    setConfirmError("")
    setNotice("")
    setConfirmRows(
      bought.map((item) => ({
        item,
        quantity: defaultCheckInQuantity(item),
        unit: item.unit,
        location: "fridge",
        expiresAt: "",
      }))
    )
  }

  function patchConfirm(index: number, patch: Partial<CheckInFormRow>) {
    setConfirmRows((current) => {
      if (!current) return current
      return current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      )
    })
  }

  async function confirmCheckIn() {
    if (!confirmRows) return
    const error = validateCheckInEdits(
      confirmRows.map((row) => ({
        name: row.item.name,
        shortage: row.item.shortage,
        quantity: row.quantity,
      }))
    )
    if (error) {
      setConfirmError(error)
      return
    }
    const drafts = draftsFromEdits(confirmRows)
    if (drafts.length === 0) {
      setConfirmError("这次没有要入库的数量。够的可以不用入。")
      return
    }
    setBusy(true)
    try {
      const written = await checkInBoughtItems(drafts)
      setConfirmRows(null)
      refresh()
      setNotice(`已按填写数量入库 ${written.length} 条，同单位会加到原库存。`)
    } catch (checkInError) {
      console.error("入库失败", checkInError)
      setConfirmError("入库失败，请再试一次。")
    } finally {
      setBusy(false)
    }
  }

  async function shareList() {
    const lines = [
      "做饭搭子 · 菜市场清单",
      ...items.map((item) => {
        const mark = item.status === "bought" ? "☑" : "☐"
        const badge =
          item.shortage === "enough"
            ? "够"
            : item.shortage === "short"
              ? "不够"
              : "不确定"
        const extra = shoppingSecondaryText(item)
        return `${mark} ${item.name} ${shoppingPrimaryText(item)}${extra ? `（${extra}）` : ""} · ${badge}`
      }),
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
        subtitle="数量是还差多少。差额只看同单位，入库前可改。"
      />
      {confirmRows ? (
        <CheckInConfirm
          rows={confirmRows}
          error={confirmError}
          busy={busy}
          onChange={patchConfirm}
          onCancel={() => {
            setConfirmRows(null)
            setConfirmError("")
          }}
          onConfirm={() => void confirmCheckIn()}
        />
      ) : (
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
                        {shoppingPrimaryText(item)}
                      </p>
                      {shoppingSecondaryText(item) ? (
                        <p className="text-sm text-muted-foreground">
                          {shoppingSecondaryText(item)}
                        </p>
                      ) : null}
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
            {busy ? "正在重算…" : "立即重算"}
          </Button>
          <Button
            variant="outline"
            className="h-12 text-base"
            disabled={busy}
            onClick={() => openConfirm()}
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
      )}
    </>
  )
}
