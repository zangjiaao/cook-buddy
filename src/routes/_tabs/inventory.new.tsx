import { useMemo, useState } from "react"
import { Link, useNavigate, createFileRoute } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { IngredientConfirmList } from "@/components/ingredient-confirm"
import { InventoryEntryRows } from "@/components/inventory-entry-rows"
import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useDb, useQuery } from "@/hooks/use-db"
import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { parseInventoryUtterance } from "@/lib/ai/parse-inventory.functions"
import { applyConfirmChoice } from "@/lib/ai/resolve-ingredients"
import type {
  ConfirmChoice,
  IngredientResolveResult,
} from "@/lib/ai/resolve-ingredients"
import { resolveIngredients } from "@/lib/ai/resolve-ingredients.functions"
import { nowIso } from "@/lib/dates"
import { ingredientsRepo, inventoryRepo } from "@/lib/db/repos"
import { mergeInventoryAdds } from "@/lib/inventory-add"
import type { InventoryAddLine } from "@/lib/inventory-add"
import {
  createInventoryEntryLine,
  inventoryAddedNoticeStorage,
  inventoryEntryError,
  inventoryEntryLineForName,
  inventoryEntryLinesFromUtterance,
  inventoryEntryMergeNote,
  inventoryEntrySourceLabel,
  inventoryPrefillName,
  writeInventoryAddedNotice,
} from "@/lib/inventory-entry"
import type {
  InventoryEntryLine,
  InventoryEntrySource,
} from "@/lib/inventory-entry"
import { patchIngredientCategory } from "@/lib/ingredient-category"
import {
  persistIngredientResolutions,
  resolveAndPersistQuiet,
} from "@/lib/ingredient-resolve-persist"
import { parseInventoryUtteranceByRules } from "@/lib/inventory-utterance"
import type { Ingredient, InventoryItem } from "@/lib/types"

export const Route = createFileRoute("/_tabs/inventory/new")({
  validateSearch: (search: Record<string, unknown>): { name?: string } => {
    const name = inventoryPrefillName(search.name)
    return name ? { name } : {}
  },
  component: InventoryNewPage,
})

type Review = {
  source: InventoryEntrySource
  lines: InventoryEntryLine[]
}

function InventoryNewPage() {
  const navigate = useNavigate()
  const { refresh } = useDb()
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
  const parseOnServer = useServerFn(parseInventoryUtterance)
  const resolveOnServer = useServerFn(resolveIngredients)
  const prefill = inventoryPrefillName(Route.useSearch().name)
  const [text, setText] = useState("")
  const [review, setReview] = useState<Review | null>(() =>
    prefill
      ? { source: "manual", lines: [inventoryEntryLineForName(prefill)] }
      : null
  )
  const [recognizing, setRecognizing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [pendingResults, setPendingResults] = useState<
    IngredientResolveResult[] | null
  >(null)

  const notes = useMemo(() => {
    const next: Record<string, string> = {}
    if (!review) return next
    for (const line of review.lines) {
      const note = inventoryEntryMergeNote(line, ingredients, inventory)
      if (note) next[line.key] = note
    }
    return next
  }, [ingredients, inventory, review])

  const waitingConfirm = Boolean(
    pendingResults?.some((result) => result.action === "needs_confirm")
  )

  function showLines(
    source: InventoryEntrySource,
    lines: InventoryEntryLine[]
  ) {
    setReview({ source, lines })
    setPendingResults(null)
    setError("")
  }

  function changeLines(lines: InventoryEntryLine[]) {
    setReview((current) => (current ? { ...current, lines } : current))
    setPendingResults(null)
    setError("")
  }

  async function recognize() {
    const trimmed = text.trim()
    if (!trimmed) {
      setError("先写一句，比如两斤五花肉、一瓶生抽。")
      return
    }
    setRecognizing(true)
    setError("")
    setPendingResults(null)
    try {
      let draft = parseInventoryUtteranceByRules(trimmed)
      try {
        draft = await parseOnServer({ data: { text: trimmed } })
      } catch (parseError) {
        console.error("一句话识别失败", parseError)
      }
      if (draft.items.length === 0) {
        setError("没认出食材，用顿号或逗号分开试试。")
        return
      }
      showLines(
        draft.source,
        inventoryEntryLinesFromUtterance(draft.items, ingredients)
      )
    } finally {
      setRecognizing(false)
    }
  }

  async function writeResolved(
    results: IngredientResolveResult[],
    draftLines: InventoryEntryLine[]
  ) {
    const currentIngredients = await ingredientsRepo.list()
    const { byRawName } = await persistIngredientResolutions(
      results,
      currentIngredients
    )
    const prepared: InventoryAddLine[] = []
    for (const line of draftLines) {
      const quantity = Number(line.quantity)
      if (!line.name.trim() || !Number.isFinite(quantity) || quantity <= 0) {
        continue
      }
      const key = normalizeIngredientName(line.name)
      let ingredient = byRawName.get(key)
      if (!ingredient) continue
      if (ingredient.category !== line.category) {
        ingredient = patchIngredientCategory(ingredient, line.category)
        await ingredientsRepo.put(ingredient)
        byRawName.set(key, ingredient)
      }
      prepared.push({
        ingredientId: ingredient.id,
        quantity,
        unit: line.unit,
        location: line.location,
        expiresAt: line.expiresAt || null,
      })
    }
    if (prepared.length === 0) {
      setError("没有可以写入的食材。")
      return
    }
    const currentInventory = await inventoryRepo.list()
    const touched = mergeInventoryAdds(currentInventory, prepared, nowIso())
    for (const row of touched) {
      await inventoryRepo.put(row)
    }
    refresh()
    writeInventoryAddedNotice(
      inventoryAddedNoticeStorage(),
      `已加入 ${prepared.length} 样。同单位的已有库存会加在一起。`
    )
    void navigate({ to: "/inventory" })
  }

  async function confirm() {
    if (!review) return
    const message = inventoryEntryError(review.lines)
    if (message) {
      setError(message)
      return
    }
    const usable = review.lines.filter((line) => line.name.trim())
    setSaving(true)
    setError("")
    try {
      const currentIngredients = await ingredientsRepo.list()
      const { results, pending } = await resolveAndPersistQuiet(
        usable.map((line) => ({ rawName: line.name.trim(), unit: line.unit })),
        currentIngredients,
        (payload) => resolveOnServer({ data: payload })
      )
      if (pending.length > 0) {
        setPendingResults(results)
        return
      }
      await writeResolved(results, usable)
    } catch (confirmError) {
      console.error("加入库存失败", confirmError)
      setError("没能写入，请再试一次。")
    } finally {
      setSaving(false)
    }
  }

  async function handleChoice(rawName: string, choice: ConfirmChoice) {
    if (!pendingResults || !review) return
    const next = pendingResults.map((result) =>
      result.rawName === rawName ? applyConfirmChoice(result, choice) : result
    )
    setPendingResults(next)
    if (next.some((result) => result.action === "needs_confirm")) return
    setSaving(true)
    try {
      await writeResolved(
        next,
        review.lines.filter((line) => line.name.trim())
      )
    } catch (choiceError) {
      console.error("加入库存失败", choiceError)
      setError("没能写入，请再试一次。")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="加入库存"
        subtitle="写下一句买了什么，确认后才写入。"
        action={
          <Button
            nativeButton={false}
            variant="ghost"
            className="h-11"
            render={<Link to="/inventory" />}
          >
            返回
          </Button>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-8">
        {!review ? (
          <>
            <Textarea
              className="min-h-40 text-base leading-7"
              placeholder="例如：两斤五花肉、一瓶生抽、五香粉一袋、鸡蛋10个"
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                setError("")
              }}
            />
            <Button
              className="h-12 text-base"
              disabled={recognizing}
              onClick={() => void recognize()}
            >
              {recognizing ? "正在识别…" : "识别"}
            </Button>
            <Button
              variant="ghost"
              className="h-11"
              onClick={() => showLines("manual", [createInventoryEntryLine()])}
            >
              直接加一行
            </Button>
            {error ? (
              <p className="text-sm leading-6 text-destructive">{error}</p>
            ) : null}
            <p className="text-sm leading-6 text-muted-foreground">
              服务端有 DeepSeek key 时走 AI 识别；没有
              key、超时或格式不对则按标点拆开。想逐项加的，直接加一行，再在列表里补。
            </p>
          </>
        ) : (
          <>
            <p className="text-sm leading-6 text-muted-foreground">
              {inventoryEntrySourceLabel(review.source)}
            </p>
            <InventoryEntryRows
              lines={review.lines}
              notes={notes}
              onChange={changeLines}
            />
            {pendingResults ? (
              <IngredientConfirmList
                results={pendingResults}
                onChoose={(rawName, choice) =>
                  void handleChoice(rawName, choice)
                }
              />
            ) : null}
            {error ? (
              <p className="text-sm leading-6 text-destructive">{error}</p>
            ) : null}
            <Button
              className="h-12 text-base"
              disabled={saving || waitingConfirm}
              onClick={() => void confirm()}
            >
              {saving ? "正在保存…" : "确认入库"}
            </Button>
            <Button
              variant="ghost"
              className="h-11"
              onClick={() => {
                setReview(null)
                setPendingResults(null)
                setError("")
              }}
            >
              返回重写
            </Button>
          </>
        )}
      </div>
    </>
  )
}
