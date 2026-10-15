import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { RiCheckLine } from "@remixicon/react"
import { cn } from "cn"
import { CheckInConfirm } from "@/components/check-in-confirm"
import type { CheckInFormRow } from "@/components/check-in-confirm"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useDb, useQuery } from "@/hooks/use-db"
import { nowIso } from "@/lib/dates"
import {
  defaultCheckInQuantity,
  defaultCheckInUnit,
  draftsFromEdits,
  parseCheckInQuantity,
  suggestedCheckInExpiresAt,
  validateCheckInEdits,
} from "@/lib/check-in"
import { resolveIngredients } from "@/lib/ai/resolve-ingredients.functions"
import {
  addManualShoppingIngredient,
  checkInBoughtItems,
  ingredientsRepo,
  setRecipeSubstitutions,
  shoppingRepo,
} from "@/lib/db/repos"
import { resolveAndPersistQuiet } from "@/lib/ingredient-resolve-persist"
import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import {
  formatQuantityHint,
  roundQty,
  shoppingPrimaryText,
  shoppingPurchaseQty,
  shoppingPurchaseUnit,
  shoppingSecondaryText,
  withPickedPurchase,
} from "@/lib/shopping-from-plan"
import {
  UNSURE_GROUP_TITLE,
  boughtInAisle,
  checkInBoughtLabel,
  formatShoppingShareText,
  groupShoppingForAisle,
  shoppingUnitOptions,
} from "@/lib/shopping-list"
import { shoppingRegen } from "@/lib/shopping-sync"
import type { Ingredient, ShoppingItem, SubstituteCandidate } from "@/lib/types"

export const Route = createFileRoute("/_tabs/shopping")({
  component: ShoppingPage,
})

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

  const aisle = useMemo(
    () => groupShoppingForAisle(items, ingredients),
    [items, ingredients]
  )
  const boughtItems = useMemo(() => boughtInAisle(aisle.buy), [aisle.buy])

  async function toggle(item: ShoppingItem) {
    const current = (await shoppingRepo.get(item.id)) ?? item
    const bought = current.status !== "bought"
    await shoppingRepo.put({
      ...current,
      status: bought ? "bought" : "needed",
      checkedAt: bought ? nowIso() : null,
    })
    refresh()
  }

  async function savePicked(
    item: ShoppingItem,
    quantity: number,
    unit: string
  ) {
    const current = (await shoppingRepo.get(item.id)) ?? item
    await shoppingRepo.put(withPickedPurchase(current, quantity, unit))
    refresh()
  }

  async function choosePresence(item: ShoppingItem, choice: "have" | "buy") {
    const current = (await shoppingRepo.get(item.id)) ?? item
    await shoppingRepo.put({ ...current, presenceChoice: choice })
    refresh()
    setNotice(
      choice === "buy"
        ? `${item.name}改为要买，已放到上面。`
        : `已记成家里有${item.name}，这次不买。`
    )
  }

  async function chooseSubstitute(
    item: ShoppingItem,
    choice: "use" | "buy",
    candidate: SubstituteCandidate
  ) {
    const offer = item.substituteOffer
    if (!offer) return
    setBusy(true)
    try {
      await setRecipeSubstitutions(offer.recipeItemIds, {
        choice,
        substituteIngredientId: candidate.ingredientId,
      })
      refresh()
      setNotice(
        choice === "use"
          ? `这道菜改用${candidate.name}，不再单买${item.name}。`
          : `${item.name}还是买，这道菜不再提示替代。`
      )
    } finally {
      setBusy(false)
    }
  }

  async function regenerate() {
    setBusy(true)
    try {
      await shoppingRegen.force()
      const next = await shoppingRepo.list()
      const visible = groupShoppingForAisle(next, await ingredientsRepo.list())
      const buyCount = visible.buy.reduce(
        (sum, group) => sum + group.items.length,
        0
      )
      if (next.length === 0) {
        setNotice("计划里还没有菜，清单已清空。先去计划页加一道再生成。")
        return
      }
      setNotice(
        `已重算。这次要买 ${buyCount} 样，够的不列出来。手加和快没了会留着。`
      )
    } catch (error) {
      console.error("重算清单失败", error)
      setNotice("重算失败，请再试一次。")
    } finally {
      setBusy(false)
    }
  }

  function openConfirm() {
    if (boughtItems.length === 0) {
      setNotice("先勾买到的，再入库。")
      return
    }
    setConfirmError("")
    setNotice("")
    setConfirmRows(
      boughtItems.map((item) => {
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
      setNotice(
        `已入库 ${written.length} 样，同单位加到原库存。买够的会从清单消失。`
      )
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
    const text = formatShoppingShareText(aisle.buy)
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "采购清单", text })
        return
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
    }
    try {
      await navigator.clipboard.writeText(text)
      setNotice("清单已复制，发给家人即可。")
    } catch (error) {
      console.error("分享清单失败", error)
      setNotice("没能分享，请再试一次。")
    }
  }

  return (
    <>
      <PageHeader
        title="清单"
        subtitle="只列要买的，按库存分类排。勾上就划掉，买完一次入库。"
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
        <>
          <div className="flex flex-col gap-4 px-4 pb-36">
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
            {!loading && aisle.buy.length === 0 ? (
              <p className="text-sm leading-6 text-muted-foreground">
                要买的都齐了。够的不列在这里。
              </p>
            ) : null}
            {aisle.buy.map((group) => (
              <section key={group.category} className="space-y-3">
                <h2 className="text-lg font-medium">{group.label}</h2>
                {group.items.map((item) => (
                  <BuyRow
                    key={item.id}
                    item={item}
                    busy={busy}
                    onToggle={() => void toggle(item)}
                    onPicked={(quantity, unit) =>
                      void savePicked(item, quantity, unit)
                    }
                    onSubstitute={(choice, candidate) =>
                      void chooseSubstitute(item, choice, candidate)
                    }
                  />
                ))}
              </section>
            ))}
            {aisle.unsure.length > 0 ? (
              <details className="rounded-lg border">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 text-base font-medium">
                  <span>{UNSURE_GROUP_TITLE}</span>
                  <span className="text-sm text-muted-foreground">
                    {aisle.unsure.length}
                  </span>
                </summary>
                <div className="flex flex-col gap-3 px-3 pb-3">
                  {aisle.unsure.map((item) => (
                    <UnsureRow
                      key={item.id}
                      item={item}
                      busy={busy}
                      onPresence={(choice) => void choosePresence(item, choice)}
                      onSubstitute={(choice, candidate) =>
                        void chooseSubstitute(item, choice, candidate)
                      }
                    />
                  ))}
                </div>
              </details>
            ) : null}
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
              onClick={() => void shareList()}
            >
              导出 / 分享
            </Button>
            {notice ? (
              <p className="text-sm leading-6 text-muted-foreground">
                {notice}
              </p>
            ) : null}
          </div>
          <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 mx-auto w-full max-w-lg px-4 pb-2">
            <Button
              className="h-14 w-full text-lg shadow-md"
              disabled={busy || boughtItems.length === 0}
              onClick={() => openConfirm()}
            >
              {checkInBoughtLabel(boughtItems.length)}
            </Button>
          </div>
        </>
      )}
    </>
  )
}

function BuyRow({
  item,
  busy,
  onToggle,
  onPicked,
  onSubstitute,
}: {
  item: ShoppingItem
  busy: boolean
  onToggle: () => void
  onPicked: (quantity: number, unit: string) => void
  onSubstitute: (choice: "use" | "buy", candidate: SubstituteCandidate) => void
}) {
  const bought = item.status === "bought"
  const offer = item.substituteOffer
  return (
    <Card className={cn(bought && "opacity-70")}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-pressed={bought}
            aria-label={
              bought ? `取消已买 ${item.name}` : `标成已买 ${item.name}`
            }
            className={cn(
              "flex size-14 shrink-0 items-center justify-center rounded-xl border-2",
              bought
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background"
            )}
            onClick={onToggle}
          >
            {bought ? <RiCheckLine className="size-8" /> : null}
          </button>
          <button
            type="button"
            className="min-h-12 flex-1 text-left"
            onClick={onToggle}
          >
            <p
              className={cn(
                "text-lg font-medium",
                bought && "text-muted-foreground line-through"
              )}
            >
              {item.name}
            </p>
            <p
              className={cn(
                "text-sm text-muted-foreground",
                bought && "line-through"
              )}
            >
              {shoppingPrimaryText(item)}
            </p>
            {shoppingSecondaryText(item) ? (
              <p className="text-sm text-muted-foreground">
                {shoppingSecondaryText(item)}
              </p>
            ) : null}
          </button>
        </div>
        <PurchaseEditor
          key={`${item.id}:${shoppingPurchaseQty(item) ?? ""}:${shoppingPurchaseUnit(item)}`}
          item={item}
          onCommit={onPicked}
        />
        {offer && offer.candidates.length > 0 ? (
          <SubstituteActions
            candidates={offer.candidates}
            busy={busy}
            onChoose={onSubstitute}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

function UnsureRow({
  item,
  busy,
  onPresence,
  onSubstitute,
}: {
  item: ShoppingItem
  busy: boolean
  onPresence: (choice: "have" | "buy") => void
  onSubstitute: (choice: "use" | "buy", candidate: SubstituteCandidate) => void
}) {
  const offer = item.substituteOffer
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div>
          <p className="text-lg font-medium">{item.name}</p>
          <p className="text-sm text-muted-foreground">
            {shoppingPrimaryText(item)}
          </p>
          {shoppingSecondaryText(item) ? (
            <p className="text-sm text-muted-foreground">
              {shoppingSecondaryText(item)}
            </p>
          ) : null}
        </div>
        {offer && offer.candidates.length > 0 ? (
          <SubstituteActions
            candidates={offer.candidates}
            busy={busy}
            onChoose={onSubstitute}
          />
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-12 text-base"
            onClick={() => onPresence("have")}
          >
            有
          </Button>
          <Button
            type="button"
            className="h-12 text-base"
            onClick={() => onPresence("buy")}
          >
            要买
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function SubstituteActions({
  candidates,
  busy,
  onChoose,
}: {
  candidates: SubstituteCandidate[]
  busy: boolean
  onChoose: (choice: "use" | "buy", candidate: SubstituteCandidate) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {candidates.map((candidate) => (
        <Button
          key={candidate.ingredientId}
          type="button"
          className="h-12 text-base"
          disabled={busy}
          onClick={() => onChoose("use", candidate)}
        >
          用{candidate.name}
        </Button>
      ))}
      <Button
        type="button"
        variant="outline"
        className="h-12 text-base"
        disabled={busy}
        onClick={() => {
          const candidate = candidates[0]
          if (candidate) onChoose("buy", candidate)
        }}
      >
        还是买
      </Button>
    </div>
  )
}

function PurchaseEditor({
  item,
  onCommit,
}: {
  item: ShoppingItem
  onCommit: (quantity: number, unit: string) => void
}) {
  const shown = shoppingPurchaseQty(item)
  const unit = shoppingPurchaseUnit(item)
  const [text, setText] = useState(
    shown == null ? "" : formatQuantityHint(shown)
  )
  const [draftUnit, setDraftUnit] = useState(unit)

  function commit(nextText: string, nextUnit: string) {
    const quantity = parseCheckInQuantity(nextText)
    if (quantity == null) return
    const current = shoppingPurchaseQty(item)
    const sameQty = current != null && roundQty(current) === quantity
    const sameUnit = shoppingPurchaseUnit(item) === nextUnit
    if (sameQty && sameUnit) return
    onCommit(quantity, nextUnit)
  }

  function bump(direction: -1 | 1) {
    const current = parseCheckInQuantity(text) ?? 0
    const step = Number.isInteger(current) ? 1 : 0.1
    const next = Math.max(0, roundQty(current + direction * step))
    const formatted = formatQuantityHint(next)
    setText(formatted)
    commit(formatted, draftUnit)
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        className="size-14 shrink-0 text-2xl"
        aria-label={`减少 ${item.name}`}
        onClick={() => bump(-1)}
      >
        −
      </Button>
      <Input
        inputMode="decimal"
        aria-label={`${item.name}的购买数量`}
        className="h-14 w-20 shrink-0 text-center text-lg"
        placeholder="数量"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => commit(text, draftUnit)}
      />
      <Button
        type="button"
        variant="outline"
        className="size-14 shrink-0 text-2xl"
        aria-label={`增加 ${item.name}`}
        onClick={() => bump(1)}
      >
        +
      </Button>
      <select
        aria-label={`${item.name}的单位`}
        className="h-14 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base"
        value={draftUnit}
        onChange={(event) => {
          const nextUnit = event.target.value
          setDraftUnit(nextUnit)
          commit(text, nextUnit)
        }}
      >
        {shoppingUnitOptions({ ...item, pickedUnit: draftUnit }).map(
          (option) => (
            <option key={option} value={option}>
              {option}
            </option>
          )
        )}
      </select>
    </div>
  )
}
