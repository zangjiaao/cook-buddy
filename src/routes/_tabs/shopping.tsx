import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { CheckInConfirm } from "@/components/check-in-confirm"
import type { CheckInFormRow } from "@/components/check-in-confirm"
import { PageHeader } from "@/components/layout/page-header"
import { ShortageBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { useDb, useQuery } from "@/hooks/use-db"
import { nowIso } from "@/lib/dates"
import {
  defaultCheckInQuantity,
  defaultCheckInUnit,
  draftsFromEdits,
  suggestedCheckInExpiresAt,
  validateCheckInEdits,
} from "@/lib/check-in"
import { resolveIngredients } from "@/lib/ai/resolve-ingredients.functions"
import {
  addManualShoppingIngredient,
  checkInBoughtItems,
  ingredientsRepo,
  shoppingRepo,
} from "@/lib/db/repos"
import { resolveAndPersistQuiet } from "@/lib/ingredient-resolve-persist"
import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { stallText } from "@/lib/labels"
import {
  shoppingPrimaryText,
  shoppingSecondaryText,
} from "@/lib/shopping-from-plan"
import { shoppingRegen } from "@/lib/shopping-sync"
import type { Ingredient, ShoppingItem, StallHint } from "@/lib/types"

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
  const { data: ingredients } = useQuery(
    "ingredients",
    () => ingredientsRepo.list(),
    [] as Ingredient[]
  )
  const resolveOnServer = useServerFn(resolveIngredients)
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [manualName, setManualName] = useState("")
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
        `已按当前计划重算 ${next.length} 项。手加和快没了会留着，已买勾选按同一食材和单位保留。`
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
      bought.map((item) => {
        const ingredient = item.ingredientId
          ? ingredients.find((row) => row.id === item.ingredientId)
          : undefined
        return {
          item,
          quantity: defaultCheckInQuantity(item),
          unit: defaultCheckInUnit(item, ingredient),
          location: "fridge",
          expiresAt: suggestedCheckInExpiresAt(item, ingredients, "fridge"),
          expiresTouched: false,
        }
      })
    )
  }

  function patchConfirm(index: number, patch: Partial<CheckInFormRow>) {
    setConfirmRows((current) => {
      if (!current) return current
      return current.map((row, rowIndex) => {
        if (rowIndex !== index) return row
        const next = { ...row, ...patch }
        if (patch.location && !next.expiresTouched) {
          next.expiresAt = suggestedCheckInExpiresAt(
            next.item,
            ingredients,
            next.location
          )
        }
        return next
      })
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
      const currentIngredients = await ingredientsRepo.list()
      const { byRawName } = await resolveAndPersistQuiet(
        drafts.map((draft) => ({
          rawName: draft.name,
          unit: draft.unit,
          ingredientId: draft.ingredientId,
        })),
        currentIngredients,
        (payload) => resolveOnServer({ data: payload }),
        { treatConfirmAsCreate: true }
      )
      const linkedDrafts = drafts.map((draft) => ({
        ...draft,
        ingredientId:
          byRawName.get(normalizeIngredientName(draft.name))?.id ??
          draft.ingredientId,
      }))
      const written = await checkInBoughtItems(linkedDrafts)
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

  async function addManualLine() {
    const name = manualName.trim()
    if (!name) {
      setNotice("先写要加的食材名。")
      return
    }
    setBusy(true)
    try {
      const currentIngredients = await ingredientsRepo.list()
      const { byRawName } = await resolveAndPersistQuiet(
        [{ rawName: name }],
        currentIngredients,
        (payload) => resolveOnServer({ data: payload }),
        { treatConfirmAsCreate: true }
      )
      const ingredient = byRawName.get(normalizeIngredientName(name))
      if (!ingredient) {
        setNotice("没能记下这个食材，请再试一次。")
        return
      }
      const line = await addManualShoppingIngredient(ingredient)
      setManualName("")
      refresh()
      setNotice(`已手加 ${line.name} ${line.quantityHint} ${line.unit}。`)
    } catch (error) {
      console.error("手加清单失败", error)
      setNotice("没能加上，请再试一次。")
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
        subtitle="鲜货按同单位算还差多少。油和调料按瓶/袋补货，不会让你买一勺。"
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
          <div className="flex gap-2">
            <Input
              className="h-12 flex-1 text-base"
              placeholder="手加一味，例如 生抽"
              value={manualName}
              onChange={(event) => setManualName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void addManualLine()
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="h-12 shrink-0 px-4 text-base"
              disabled={busy}
              onClick={() => void addManualLine()}
            >
              加上
            </Button>
          </div>
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
