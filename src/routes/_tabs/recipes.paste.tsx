import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, createFileRoute } from "@tanstack/react-router"
import { IngredientConfirmList } from "@/components/ingredient-confirm"
import { PageHeader } from "@/components/layout/page-header"
import { RecipeEditorFields } from "@/components/recipe-editor-fields"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { RecipeAlignPanel } from "@/components/recipe-align-panel"
import { useDb, useQuery } from "@/hooks/use-db"
import { useRecipeAlign } from "@/hooks/use-recipe-align"
import { useRecipeResolveSave } from "@/hooks/use-recipe-resolve-save"
import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { parseRecipeText, recipeDraftSourceLabel } from "@/lib/ai/parse-recipe"
import type { RecipeDraft } from "@/lib/ai/parse-recipe"
import { requestRecipeParse } from "@/lib/ai/recipe-parse-stream"
import {
  initialParseStatus,
  looksLikeFullRecipe,
  recipeParseFailureMessage,
} from "@/lib/ai/recipe-input"
import {
  ingredientsRepo,
  inventoryRepo,
  saveReviewedRecipe,
} from "@/lib/db/repos"
import { alignItemWrites, ingredientUpdatesFromAlign } from "@/lib/recipe-align"
import { sourceUrlHost } from "@/lib/source-url"
import {
  compactEditableSteps,
  editableItemsFromDraftItems,
  editableStepsFromRecipe,
  toResolvedRecipeItems,
} from "@/lib/recipe-draft-items"
import type {
  EditableRecipeItem,
  EditableRecipeStep,
} from "@/lib/recipe-draft-items"
import type { RecipeTag } from "@/lib/recipe-organize"
import type { Ingredient, InventoryItem } from "@/lib/types"

export const Route = createFileRoute("/_tabs/recipes/paste")({
  component: RecipePastePage,
})

const PLACEHOLDER = `贴食谱链接、分享文案，或直接说菜名，例如「帮我找个红烧肉的做法」。
完整做法也可以直接贴进来。`

function RecipePastePage() {
  const navigate = useNavigate()
  const { refresh } = useDb()
  const [text, setText] = useState("")
  const [draft, setDraft] = useState<RecipeDraft | null>(null)
  const [name, setName] = useState("")
  const [servings, setServings] = useState("2")
  const [minutes, setMinutes] = useState("")
  const [steps, setSteps] = useState<EditableRecipeStep[]>([])
  const [items, setItems] = useState<EditableRecipeItem[]>([])
  const [favorited, setFavorited] = useState(false)
  const [tags, setTags] = useState<RecipeTag[]>([])
  const [extracting, setExtracting] = useState(false)
  const [status, setStatus] = useState("")
  const [extractError, setExtractError] = useState("")
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
  const align = useRecipeAlign()
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
    setSteps(editableStepsFromRecipe(next.steps))
    setItems(editableItemsFromDraftItems(next.items))
    setFavorited(false)
    setTags([])
    resetPending()
    align.clear()
  }

  async function extract() {
    const trimmed = text.trim()
    if (!trimmed) return
    setExtracting(true)
    setExtractError("")
    setStatus(initialParseStatus(trimmed))
    try {
      const outcome = await requestRecipeParse(trimmed, setStatus)
      if (!outcome.ok) {
        setExtractError(outcome.message)
        return
      }
      applyDraft(outcome.draft)
    } catch {
      if (looksLikeFullRecipe(trimmed)) {
        applyDraft(await parseRecipeText(trimmed))
        return
      }
      setExtractError(recipeParseFailureMessage(trimmed))
    } finally {
      setExtracting(false)
    }
  }

  const itemSignature = items
    .map((item) => `${item.rawName}|${item.quantity}|${item.unit}`)
    .join("\n")
  const stockSignature = `${ingredients.map((item) => item.id).join(",")}|${inventory
    .map((item) => `${item.ingredientId}:${item.unit}:${item.quantity}`)
    .join(",")}`

  useEffect(() => {
    if (!draft) return
    void align.run({
      sourceText: text,
      lines: items.map((item) => ({
        key: item.key,
        rawName: item.rawName,
        quantity: Number(item.quantity) || 0,
        unit: item.unit,
      })),
      ingredients,
      inventory,
    })
    // 只在草稿或库存变化时重算，避免改确认数量时被盖掉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, itemSignature, stockSignature])

  async function persist(byRawName: Map<string, Ingredient>) {
    const packed = compactEditableSteps(steps)
    const aligned = align.lines
    const writes = aligned
      ? alignItemWrites(aligned, byRawName)
      : toResolvedRecipeItems(items, byRawName)
    if (aligned) {
      const linked = aligned.map((line) => ({
        ...line,
        ingredientId:
          line.ingredientId ??
          byRawName.get(normalizeIngredientName(line.rawName))?.id ??
          byRawName.get(normalizeIngredientName(line.name))?.id ??
          null,
      }))
      const known = [...ingredients]
      for (const ingredient of byRawName.values()) {
        if (!known.some((row) => row.id === ingredient.id))
          known.push(ingredient)
      }
      for (const ingredient of ingredientUpdatesFromAlign(linked, known)) {
        await ingredientsRepo.put(ingredient)
      }
    }
    const recipe = await saveReviewedRecipe({
      name,
      servings,
      minutes,
      steps: packed.steps,
      stepTips: packed.stepTips,
      items: writes,
      favorited,
      tags,
      sourceUrl: draft?.sourceUrl,
      sourceText: text,
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
              placeholder={PLACEHOLDER}
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                setExtractError("")
              }}
            />
            <Button
              className="h-12 text-base"
              disabled={extracting || text.trim().length === 0}
              onClick={() => void extract()}
            >
              {extracting ? "正在抽出…" : "抽出草稿"}
            </Button>
            {extracting ? (
              <p
                className="text-sm leading-6 text-muted-foreground"
                aria-live="polite"
              >
                {status}
              </p>
            ) : null}
            {extractError ? (
              <p className="text-sm leading-6 text-destructive" role="alert">
                {extractError}
              </p>
            ) : null}
            <p className="text-sm leading-6 text-muted-foreground">
              链接、菜名或整段做法都可以。确认后才入库。读不到页面时，把文字直接贴进来。
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              来源：{sourceLabel}
              {draft.sourceUrl
                ? ` · 页面 ${sourceUrlHost(draft.sourceUrl)}`
                : ""}
              。请核对菜名、分量和步骤，缺的补上，多的去掉。
            </p>
            <RecipeEditorFields
              name={name}
              servings={servings}
              minutes={minutes}
              steps={steps}
              items={items}
              favorited={favorited}
              tags={tags}
              onNameChange={setName}
              onServingsChange={setServings}
              onMinutesChange={setMinutes}
              onStepsChange={setSteps}
              onItemsChange={setItems}
              onFavoritedChange={setFavorited}
              onTagsChange={setTags}
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
            {align.lines ? (
              <RecipeAlignPanel
                lines={align.lines}
                aligning={align.aligning}
                onQuantity={align.changeQuantity}
                onConfirm={
                  waitingConfirm ? undefined : () => void save(items, persist)
                }
                confirmLabel="确认入库"
                confirming={saving}
              />
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">
                正在按家里的库存对齐用量…
              </p>
            )}
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
