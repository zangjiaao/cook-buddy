import { useMemo, useState } from "react"
import { Link, useNavigate, createFileRoute } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { IngredientConfirmList } from "@/components/ingredient-confirm"
import { PageHeader } from "@/components/layout/page-header"
import { Field } from "@/components/field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useDb } from "@/hooks/use-db"
import { parsePastedRecipe } from "@/lib/ai/parse-recipe.functions"
import { parseRecipeText, recipeDraftSourceLabel } from "@/lib/ai/parse-recipe"
import type { RecipeDraft } from "@/lib/ai/parse-recipe"
import { resolveIngredients } from "@/lib/ai/resolve-ingredients.functions"
import { applyConfirmChoice } from "@/lib/ai/resolve-ingredients"
import type {
  ConfirmChoice,
  IngredientResolveResult,
} from "@/lib/ai/resolve-ingredients"
import { ingredientsRepo, saveReviewedRecipe } from "@/lib/db/repos"
import { recipeItemsFromResolved } from "@/lib/ingredient-resolve-apply"
import {
  persistIngredientResolutions,
  resolveAndPersistQuiet,
} from "@/lib/ingredient-resolve-persist"
import type { Ingredient } from "@/lib/types"

export const Route = createFileRoute("/_tabs/recipes/paste")({
  component: RecipePastePage,
})

const SAMPLE = `小白菜炒肉
2人份 约20分钟

食材：
五花肉 0.4 斤
小白菜 1 把
蒜 3 瓣
生抽 2 勺

步骤：
1. 肉切片，生抽腌 10 分钟
2. 热锅炒肉出油
3. 下小白菜炒软起锅`

type ReviewItem = {
  rawName: string
  quantity: string
  unit: string
}

function toReviewItems(draft: RecipeDraft): ReviewItem[] {
  return draft.items.map((item) => ({
    rawName: item.rawName,
    quantity: String(item.quantity),
    unit: item.unit,
  }))
}

function RecipePastePage() {
  const navigate = useNavigate()
  const { refresh } = useDb()
  const [text, setText] = useState(SAMPLE)
  const [draft, setDraft] = useState<RecipeDraft | null>(null)
  const [name, setName] = useState("")
  const [servings, setServings] = useState("2")
  const [minutes, setMinutes] = useState("")
  const [steps, setSteps] = useState("")
  const [items, setItems] = useState<ReviewItem[]>([])
  const [saving, setSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [pendingResults, setPendingResults] = useState<
    IngredientResolveResult[] | null
  >(null)
  const [error, setError] = useState("")
  const parseOnServer = useServerFn(parsePastedRecipe)
  const resolveOnServer = useServerFn(resolveIngredients)

  const sourceLabel = useMemo(() => {
    if (!draft) return ""
    return recipeDraftSourceLabel(draft.source)
  }, [draft])

  function applyDraft(next: RecipeDraft) {
    setDraft(next)
    setName(next.name)
    setServings(String(next.servings))
    setMinutes(next.approxMinutes ? String(next.approxMinutes) : "")
    setSteps(next.steps.join("\n"))
    setItems(toReviewItems(next))
    setPendingResults(null)
    setError("")
  }

  async function extract() {
    setExtracting(true)
    try {
      try {
        applyDraft(await parseOnServer({ data: { text } }))
      } catch {
        applyDraft(await parseRecipeText(text))
      }
    } finally {
      setExtracting(false)
    }
  }

  function updateItem(index: number, patch: Partial<ReviewItem>) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    )
  }

  async function finishSave(
    results: IngredientResolveResult[],
    already?: Map<string, Ingredient>
  ) {
    const currentIngredients = await ingredientsRepo.list()
    const { byRawName } = already
      ? { byRawName: already }
      : await persistIngredientResolutions(results, currentIngredients)
    const recipe = await saveReviewedRecipe({
      name,
      servings: Number(servings) || 1,
      approxMinutes: minutes ? Number(minutes) : null,
      steps: steps.split(/\r?\n/),
      items: recipeItemsFromResolved(
        items.map((item) => ({
          rawName: item.rawName.trim() || "未命名食材",
          quantity: Number(item.quantity) || 0,
          unit: item.unit,
        })),
        byRawName
      ),
    })
    refresh()
    setSaving(false)
    void navigate({ to: "/recipes/$recipeId", params: { recipeId: recipe.id } })
  }

  async function save() {
    setSaving(true)
    setError("")
    try {
      const currentIngredients = await ingredientsRepo.list()
      const { results, pending, byRawName } = await resolveAndPersistQuiet(
        items.map((item) => ({
          rawName: item.rawName.trim() || "未命名食材",
          unit: item.unit,
        })),
        currentIngredients,
        (payload) => resolveOnServer({ data: payload })
      )
      if (pending.length > 0) {
        setPendingResults(results)
        setSaving(false)
        return
      }
      await finishSave(results, byRawName)
    } catch (saveError) {
      console.error("保存食谱失败", saveError)
      setError("保存失败，请再试一次。")
      setSaving(false)
    }
  }

  async function handleConfirm(rawName: string, choice: ConfirmChoice) {
    if (!pendingResults) return
    const next = pendingResults.map((result) =>
      result.rawName === rawName ? applyConfirmChoice(result, choice) : result
    )
    setPendingResults(next)
    if (next.some((result) => result.action === "needs_confirm")) return
    setSaving(true)
    try {
      await finishSave(next)
    } catch (saveError) {
      console.error("保存食谱失败", saveError)
      setError("保存失败，请再试一次。")
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="粘贴录入"
        subtitle="AI 只出草稿，确认后才写入食谱。"
        action={
          <Button
            nativeButton={false}
            variant="ghost"
            className="h-11"
            render={<Link to="/recipes" />}
          >
            返回
          </Button>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-8">
        {!draft ? (
          <>
            <Textarea
              className="min-h-56 text-base leading-7"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <Button
              className="h-12 text-base"
              disabled={extracting}
              onClick={() => void extract()}
            >
              {extracting ? "正在抽出…" : "抽出草稿"}
            </Button>
            <p className="text-sm leading-6 text-muted-foreground">
              服务端有 DeepSeek key 时走 AI 抽出；没有 key、超时或 JSON
              无效则退回规则/mock。确认后才入库。
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              来源：{sourceLabel}。请核对菜名、分量和步骤。
            </p>
            <Field label="名称">
              <Input
                className="h-12 text-base"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="份数">
                <Input
                  className="h-12 text-base"
                  inputMode="numeric"
                  value={servings}
                  onChange={(event) => setServings(event.target.value)}
                />
              </Field>
              <Field label="大约分钟">
                <Input
                  className="h-12 text-base"
                  inputMode="numeric"
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                />
              </Field>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">食材</p>
              {items.map((item, index) => (
                <div
                  key={`${item.rawName}-${index}`}
                  className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-2 rounded-lg border p-3"
                >
                  <Input
                    className="h-11 text-base"
                    value={item.rawName}
                    onChange={(event) =>
                      updateItem(index, { rawName: event.target.value })
                    }
                  />
                  <Input
                    className="h-11 text-base"
                    value={item.quantity}
                    onChange={(event) =>
                      updateItem(index, { quantity: event.target.value })
                    }
                  />
                  <Input
                    className="h-11 text-base"
                    value={item.unit}
                    onChange={(event) =>
                      updateItem(index, { unit: event.target.value })
                    }
                  />
                </div>
              ))}
            </div>
            <Field label="步骤（一行一步）">
              <Textarea
                className="min-h-40 text-base leading-7"
                value={steps}
                onChange={(event) => setSteps(event.target.value)}
              />
            </Field>
            {pendingResults ? (
              <IngredientConfirmList
                results={pendingResults}
                onChoose={(rawName, choice) =>
                  void handleConfirm(rawName, choice)
                }
              />
            ) : null}
            {error ? (
              <p className="text-sm leading-6 text-destructive">{error}</p>
            ) : null}
            <Button
              className="h-12 text-base"
              disabled={
                saving ||
                Boolean(
                  pendingResults?.some(
                    (result) => result.action === "needs_confirm"
                  )
                )
              }
              onClick={() => void save()}
            >
              {saving ? "正在保存…" : "确认入库"}
            </Button>
            <Button
              variant="ghost"
              className="h-11"
              onClick={() => {
                setDraft(null)
                setPendingResults(null)
              }}
            >
              返回重贴
            </Button>
          </>
        )}
      </div>
    </>
  )
}
