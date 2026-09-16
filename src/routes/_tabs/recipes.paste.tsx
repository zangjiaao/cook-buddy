import { useMemo, useState } from "react"
import { Link, useNavigate, createFileRoute } from "@tanstack/react-router"
import { PageHeader } from "@/components/layout/page-header"
import { Field, fieldControlClass } from "@/components/field"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useDb, useQuery } from "@/hooks/use-db"
import { matchIngredient } from "@/lib/ai/match-ingredient"
import { parseRecipeText } from "@/lib/ai/parse-recipe"
import type { RecipeDraft } from "@/lib/ai/parse-recipe"
import { ingredientsRepo, saveReviewedRecipe } from "@/lib/db/repos"
import type { Ingredient, MatchStatus } from "@/lib/types"
import { matchStatusLabel } from "@/lib/labels"

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
  ingredientId: string
  matchStatus: MatchStatus
}

function toReviewItems(draft: RecipeDraft, ingredients: Ingredient[]): ReviewItem[] {
  return draft.items.map((item) => {
    const match = matchIngredient(item.rawName, ingredients)
    return {
      rawName: item.rawName,
      quantity: String(item.quantity),
      unit: item.unit,
      ingredientId: match.ingredientId ?? "",
      matchStatus: match.matchStatus,
    }
  })
}

function RecipePastePage() {
  const navigate = useNavigate()
  const { refresh } = useDb()
  const { data: ingredients } = useQuery(
    "ingredients",
    () => ingredientsRepo.list(),
    [] as Ingredient[]
  )
  const [text, setText] = useState(SAMPLE)
  const [draft, setDraft] = useState<RecipeDraft | null>(null)
  const [name, setName] = useState("")
  const [servings, setServings] = useState("2")
  const [minutes, setMinutes] = useState("")
  const [steps, setSteps] = useState("")
  const [items, setItems] = useState<ReviewItem[]>([])
  const [saving, setSaving] = useState(false)

  const sourceLabel = useMemo(() => {
    if (!draft) return ""
    return draft.source === "rule" ? "规则抽出" : "本地 mock 草稿"
  }, [draft])

  async function extract() {
    const next = await parseRecipeText(text)
    setDraft(next)
    setName(next.name)
    setServings(String(next.servings))
    setMinutes(next.approxMinutes ? String(next.approxMinutes) : "")
    setSteps(next.steps.join("\n"))
    setItems(toReviewItems(next, ingredients))
  }

  function updateItem(index: number, patch: Partial<ReviewItem>) {
    setItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        const next = { ...item, ...patch }
        if (patch.ingredientId !== undefined) {
          next.matchStatus = patch.ingredientId ? "linked" : "unlinked"
        }
        return next
      })
    )
  }

  async function save() {
    setSaving(true)
    const recipe = await saveReviewedRecipe({
      name,
      servings: Number(servings) || 1,
      approxMinutes: minutes ? Number(minutes) : null,
      steps: steps.split(/\r?\n/),
      items: items.map((item) => ({
        rawName: item.rawName,
        quantity: Number(item.quantity) || 0,
        unit: item.unit,
        ingredientId: item.ingredientId || null,
        matchStatus: item.matchStatus,
      })),
    })
    refresh()
    setSaving(false)
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
            <Button className="h-12 text-base" onClick={() => void extract()}>
              抽出草稿
            </Button>
            <p className="text-sm leading-6 text-muted-foreground">
              没有云端 key 时用规则/mock 解析层；接口形状保持可替换。
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">来源：{sourceLabel}。请人工校对。</p>
            <Field label="名称">
              <Input className="h-12 text-base" value={name} onChange={(event) => setName(event.target.value)} />
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
              <p className="text-sm font-medium text-muted-foreground">食材对齐库存主数据</p>
              {items.map((item, index) => (
                <div key={`${item.rawName}-${index}`} className="rounded-lg border p-3">
                  <div className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-2">
                    <Input
                      className="h-11 text-base"
                      value={item.rawName}
                      onChange={(event) => updateItem(index, { rawName: event.target.value })}
                    />
                    <Input
                      className="h-11 text-base"
                      value={item.quantity}
                      onChange={(event) => updateItem(index, { quantity: event.target.value })}
                    />
                    <Input
                      className="h-11 text-base"
                      value={item.unit}
                      onChange={(event) => updateItem(index, { unit: event.target.value })}
                    />
                  </div>
                  <select
                    className={`${fieldControlClass} mt-2`}
                    value={item.ingredientId}
                    onChange={(event) => updateItem(index, { ingredientId: event.target.value })}
                  >
                    <option value="">未对齐 · {matchStatusLabel[item.matchStatus]}</option>
                    {ingredients.map((ingredient) => (
                      <option key={ingredient.id} value={ingredient.id}>
                        就是这个：{ingredient.name}
                      </option>
                    ))}
                  </select>
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
            <Button className="h-12 text-base" disabled={saving} onClick={() => void save()}>
              确认入库
            </Button>
            <Button variant="ghost" className="h-11" onClick={() => setDraft(null)}>
              返回重贴
            </Button>
          </>
        )}
      </div>
    </>
  )
}
