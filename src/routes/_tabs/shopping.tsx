import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { RiCheckLine } from "@remixicon/react"
import { cn } from "cn"
import { CheckInConfirm } from "@/components/check-in-confirm"
import type { CheckInFormRow } from "@/components/check-in-confirm"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDb, useQuery } from "@/hooks/use-db"
import { nowIso } from "@/lib/dates"
import {
  defaultCheckInPlacement,
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
  inventoryRepo,
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
  shoppingQtyLabel,
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
import type {
  Ingredient,
  InventoryItem,
  ShoppingItem,
  SubstituteCandidate,
} from "@/lib/types"

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
  const { data: inventory } = useQuery(
    "inventory",
    () => inventoryRepo.list(),
    [] as InventoryItem[]
  )
  const resolveOnServer = useServerFn(resolveIngredients)
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const [manualName, setManualName] = useState("")
  const [confirmRows, setConfirmRows] = useState<CheckInFormRow[] | null>(null)
  const [confirmError, setConfirmError] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    void shoppingRegen.flush()
  }, [])

  const aisle = useMemo(
    () => groupShoppingForAisle(items, ingredients),
    [items, ingredients]
  )
  const boughtItems = useMemo(() => boughtInAisle(aisle.buy), [aisle.buy])
  const checkInCategory =
    aisle.buy.find((group) =>
      group.items.some((item) => item.status === "bought")
    )?.category ?? null

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
        const unit = defaultCheckInUnit(item, ingredient)
        const placement = defaultCheckInPlacement(
          { ...item, pickedUnit: unit },
          ingredients,
          inventory
        )
        return {
          item,
          quantity: defaultCheckInQuantity(item),
          unit,
          location: placement.location,
          locationTouched: false,
          expiresAt: placement.expiresAt,
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
        if (patch.location) next.locationTouched = true
        if (patch.unit && !row.locationTouched && !patch.location) {
          const placement = defaultCheckInPlacement(
            { ...next.item, pickedUnit: next.unit },
            ingredients,
            inventory
          )
          next.location = placement.location
          if (!next.expiresTouched) next.expiresAt = placement.expiresAt
          return next
        }
        if ((patch.location || patch.unit) && !next.expiresTouched) {
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
        <div className="flex flex-col px-4 pb-6">
          <div className="flex gap-2">
            <Input
              className="h-11 flex-1 text-base"
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
              className="h-11 shrink-0 px-4 text-base"
              disabled={busy}
              onClick={() => void addManualLine()}
            >
              加上
            </Button>
          </div>
          {loading ? (
            <p className="mt-3 text-sm text-muted-foreground">正在读取清单…</p>
          ) : null}
          {!loading && aisle.buy.length === 0 ? (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              要买的都齐了。够的不列在这里。
            </p>
          ) : null}
          {aisle.buy.map((group) => {
            const pending = group.items.filter(
              (item) => item.status !== "bought"
            )
            const bought = group.items.filter(
              (item) => item.status === "bought"
            )
            const showCheckIn =
              bought.length > 0 && group.category === checkInCategory
            return (
              <section key={group.category}>
                <h2 className="px-1 pb-1 pt-4 text-sm font-medium text-muted-foreground">
                  {group.label}
                </h2>
                <ul className="border-t border-border">
                  {pending.map((item) => (
                    <BuyRow
                      key={item.id}
                      item={item}
                      busy={busy}
                      editing={editingId === item.id}
                      onToggle={() => void toggle(item)}
                      onEdit={() =>
                        setEditingId((current) =>
                          current === item.id ? null : item.id
                        )
                      }
                      onPicked={(quantity, unit) =>
                        void savePicked(item, quantity, unit)
                      }
                      onSubstitute={(choice, candidate) =>
                        void chooseSubstitute(item, choice, candidate)
                      }
                    />
                  ))}
                  {showCheckIn ? (
                    <li className="border-b border-border px-1 py-2">
                      <Button
                        type="button"
                        className="h-11 w-full text-base"
                        disabled={busy}
                        onClick={() => openConfirm()}
                      >
                        {checkInBoughtLabel(boughtItems.length)}
                      </Button>
                    </li>
                  ) : null}
                  {bought.map((item) => (
                    <BuyRow
                      key={item.id}
                      item={item}
                      busy={busy}
                      editing={editingId === item.id}
                      onToggle={() => void toggle(item)}
                      onEdit={() =>
                        setEditingId((current) =>
                          current === item.id ? null : item.id
                        )
                      }
                      onPicked={(quantity, unit) =>
                        void savePicked(item, quantity, unit)
                      }
                      onSubstitute={(choice, candidate) =>
                        void chooseSubstitute(item, choice, candidate)
                      }
                    />
                  ))}
                </ul>
              </section>
            )
          })}
          {aisle.unsure.length > 0 ? (
            <details className="mt-4 border-t border-border">
              <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-1 text-sm font-medium">
                <span>{UNSURE_GROUP_TITLE}</span>
                <span className="text-sm text-muted-foreground">
                  {aisle.unsure.length}
                </span>
              </summary>
              <ul className="border-t border-border">
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
              </ul>
            </details>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button
              className="h-11 flex-1 text-base"
              disabled={busy}
              onClick={() => void regenerate()}
            >
              {busy ? "正在重算…" : "立即重算"}
            </Button>
            <Button
              variant="outline"
              className="h-11 flex-1 text-base"
              disabled={busy}
              onClick={() => void shareList()}
            >
              导出 / 分享
            </Button>
          </div>
          {notice ? (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {notice}
            </p>
          ) : null}
        </div>
      )}
    </>
  )
}

function rowDetail(item: ShoppingItem): string {
  const offer = item.substituteOffer
  if (offer && offer.candidates.length > 0) return shoppingPrimaryText(item)
  return shoppingSecondaryText(item)
}

function BuyRow({
  item,
  busy,
  editing,
  onToggle,
  onEdit,
  onPicked,
  onSubstitute,
}: {
  item: ShoppingItem
  busy: boolean
  editing: boolean
  onToggle: () => void
  onEdit: () => void
  onPicked: (quantity: number, unit: string) => void
  onSubstitute: (choice: "use" | "buy", candidate: SubstituteCandidate) => void
}) {
  const bought = item.status === "bought"
  const offer = item.substituteOffer
  const detail = rowDetail(item)
  return (
    <li className="border-b border-border">
      <div className="flex h-14 items-stretch">
        <button
          type="button"
          aria-pressed={bought}
          aria-label={
            bought ? `取消已买 ${item.name}` : `标成已买 ${item.name}`
          }
          className="flex min-w-0 flex-1 items-center gap-3 pl-1 text-left"
          onClick={onToggle}
        >
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md border-2",
              bought
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background"
            )}
          >
            {bought ? <RiCheckLine className="size-4" /> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-base",
                bought && "text-muted-foreground line-through"
              )}
            >
              {item.name}
            </span>
            {detail ? (
              <span
                className={cn(
                  "block truncate text-xs text-muted-foreground",
                  bought && "line-through"
                )}
              >
                {detail}
              </span>
            ) : null}
          </span>
        </button>
        <button
          type="button"
          aria-expanded={editing}
          aria-label={`修改 ${item.name} 的数量`}
          className={cn(
            "flex shrink-0 items-center px-3 text-sm tabular-nums",
            bought && "text-muted-foreground line-through"
          )}
          onClick={onEdit}
        >
          {shoppingQtyLabel(item)}
        </button>
      </div>
      {editing ? (
        <PurchaseEditor
          key={`${item.id}:${shoppingPurchaseQty(item) ?? ""}:${shoppingPurchaseUnit(item)}`}
          item={item}
          onCommit={onPicked}
        />
      ) : null}
      {offer && offer.candidates.length > 0 ? (
        <div className="px-1 pb-2">
          <SubstituteActions
            candidates={offer.candidates}
            busy={busy}
            onChoose={onSubstitute}
          />
        </div>
      ) : null}
    </li>
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
  const detail = rowDetail(item)
  return (
    <li className="border-b border-border">
      <div className="flex h-14 items-center gap-2 pl-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base">{item.name}</p>
          {detail ? (
            <p className="truncate text-xs text-muted-foreground">{detail}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-10 px-3 text-sm"
          onClick={() => onPresence("have")}
        >
          有
        </Button>
        <Button
          type="button"
          className="h-10 px-3 text-sm"
          onClick={() => onPresence("buy")}
        >
          要买
        </Button>
      </div>
      {offer && offer.candidates.length > 0 ? (
        <div className="px-1 pb-2">
          <SubstituteActions
            candidates={offer.candidates}
            busy={busy}
            onChoose={onSubstitute}
          />
        </div>
      ) : null}
    </li>
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
          className="h-10 text-sm"
          disabled={busy}
          onClick={() => onChoose("use", candidate)}
        >
          用{candidate.name}
        </Button>
      ))}
      <Button
        type="button"
        variant="outline"
        className="h-10 text-sm"
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
    <div className="flex items-center gap-2 px-1 pb-2">
      <Button
        type="button"
        variant="outline"
        className="size-11 shrink-0 text-xl"
        aria-label={`减少 ${item.name}`}
        onClick={() => bump(-1)}
      >
        −
      </Button>
      <Input
        inputMode="decimal"
        aria-label={`${item.name}的购买数量`}
        className="h-11 w-16 shrink-0 text-center text-base"
        placeholder="数量"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => commit(text, draftUnit)}
      />
      <Button
        type="button"
        variant="outline"
        className="size-11 shrink-0 text-xl"
        aria-label={`增加 ${item.name}`}
        onClick={() => bump(1)}
      >
        +
      </Button>
      <select
        aria-label={`${item.name}的单位`}
        className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base"
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
