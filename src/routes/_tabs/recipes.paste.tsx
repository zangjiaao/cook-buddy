import { useMemo, useState } from "react"
import { Link, useNavigate, createFileRoute } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { IngredientConfirmList } from "@/components/ingredient-confirm"
import { PageHeader } from "@/components/layout/page-header"
import { RecipeEditorFields } from "@/components/recipe-editor-fields"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useDb } from "@/hooks/use-db"
import { useRecipeResolveSave } from "@/hooks/use-recipe-resolve-save"
import { parsePastedRecipe } from "@/lib/ai/parse-recipe.functions"
import { parseRecipeText, recipeDraftSourceLabel } from "@/lib/ai/parse-recipe"
import type { RecipeDraft } from "@/lib/ai/parse-recipe"
import { saveReviewedRecipe } from "@/lib/db/repos"
import {
  editableItemsFromDraftItems,
  toResolvedRecipeItems,
  type EditableRecipeItem,
} from "@/lib/recipe-draft-items"
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

function RecipePastePage() {
  const navigate = useNavigate()
  const { refresh } = useDb()
  const [text, setText] = useState(SAMPLE)
  const [draft, setDraft] = useState<RecipeDraft | null>(null)
  const [name, setName] = useState("")
  const [servings, setServings] = useState("2")
  const [minutes, setMinutes] = useState("")
  const [steps, setSteps] = useState("")
  const [items, setItems] = useState<EditableRecipeItem[]>([])
  const [extracting, setExtracting] = useState(false)
  const parseOnServer = useServerFn(parsePastedRecipe)
  const {
    pendingResults,
    saving,
    error,
    waitingConfirm,
    save,
    handleConfirm,
    resetPending,
  } = useRecipeResolveSave()

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
    setItems(editableItemsFromDraftItems(next.items))
    resetPending()
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

  async function persist(byRawName: Map<string, Ingredient>) {
    const recipe = await saveReviewedRecipe({
      name,
      servings,
      minutes,
      steps,
      items: toResolvedRecipeItems(items, byRawName),
    })
    refresh()
    void navigate({ to: "/recipes/$recipeId", params: { recipeId: recipe.id } })
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
              来源：{sourceLabel}。请核对菜名、分量和步骤，缺的补上，多的去掉。
            </p>
            <RecipeEditorFields
              name={name}
              servings={servings}
              minutes={minutes}
              steps={steps}
              items={items}
              onNameChange={setName}
              onServingsChange={setServings}
              onMinutesChange={setMinutes}
              onStepsChange={setSteps}
              onItemsChange={setItems}
            />
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
              disabled={saving || waitingConfirm}
              onClick={() => void save(items, persist)}
            >
              {saving ? "正在保存…" : "确认入库"}
            </Button>
            <Button
              variant="ghost"
              className="h-11"
              onClick={() => {
                setDraft(null)
                resetPending()
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
