import { useEffect, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { PageHeader } from "@/components/layout/page-header"
import { RecipeAlignPanel } from "@/components/recipe-align-panel"
import { Button } from "@/components/ui/button"
import { useDb, useQuery } from "@/hooks/use-db"
import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { alignPayload } from "@/lib/ai/align-recipe"
import { alignRecipe } from "@/lib/ai/align-recipe.functions"
import {
  ingredientsRepo,
  inventoryRepo,
  recipeItemsRepo,
  recipesRepo,
  updateReviewedRecipe,
} from "@/lib/db/repos"
import {
  alignItemWrites,
  editAlignQuantity,
  ingredientUpdatesFromAlign,
  suggestRecipeAlignments,
  type AlignResultLine,
  type AlignSuggestion,
} from "@/lib/recipe-align"
import type { Ingredient, InventoryItem, Recipe, RecipeItem } from "@/lib/types"

export const Route = createFileRoute("/_tabs/recipes/align")({
  component: RecipeAlignPage,
})

function RecipeAlignPage() {
  const { refresh } = useDb()
  const alignOnServer = useServerFn(alignRecipe)
  const { data: recipes, loading } = useQuery(
    "recipes",
    () => recipesRepo.list(),
    [] as Recipe[]
  )
  const { data: items, loading: itemsLoading } = useQuery(
    "recipe-items",
    () => recipeItemsRepo.list(),
    [] as RecipeItem[]
  )
  const { data: ingredients, loading: ingredientsLoading } = useQuery(
    "ingredients",
    () => ingredientsRepo.list(),
    [] as Ingredient[]
  )
  const { data: inventory, loading: inventoryLoading } = useQuery(
    "inventory",
    () => inventoryRepo.list(),
    [] as InventoryItem[]
  )
  const [groups, setGroups] = useState<AlignSuggestion[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")
  const ready =
    !loading && !itemsLoading && !ingredientsLoading && !inventoryLoading

  useEffect(() => {
    if (!ready || groups) return
    const local = suggestRecipeAlignments({
      recipes,
      items,
      ingredients,
      inventory,
    })
    setGroups(local)
    const pending = local.flatMap((group) =>
      group.lines.filter((line) => line.needsAi)
    )
    if (pending.length === 0) return
    let cancelled = false
    alignOnServer({
      data: alignPayload({
        lines: pending,
        ingredients,
        inventory,
      }),
    })
      .then((aligned) => {
        if (cancelled) return
        const byKey = new Map(aligned.map((line) => [line.key, line]))
        setGroups((current) =>
          (current ?? local).map((group) => ({
            ...group,
            lines: group.lines.map((line) => byKey.get(line.key) ?? line),
          }))
        )
      })
      .catch(() => {
        // 没有密钥或请求失败时，保留本地规则的结果。
      })
    return () => {
      cancelled = true
    }
  }, [ready, groups, recipes, items, ingredients, inventory, alignOnServer])

  function changeQuantity(key: string, quantity: number) {
    setGroups(
      (current) =>
        current?.map((group) => ({
          ...group,
          lines: editAlignQuantity(group.lines, key, quantity),
        })) ?? current
    )
  }

  async function confirm() {
    if (!groups || saving) return
    setSaving(true)
    setNotice("")
    try {
      const byName = new Map(
        ingredients.map((ingredient) => [
          normalizeIngredientName(ingredient.name),
          ingredient,
        ])
      )
      const touched: AlignResultLine[] = []
      for (const group of groups) {
        const recipe = recipes.find((row) => row.id === group.recipeId)
        if (!recipe) continue
        const existing = items.filter(
          (item) => item.recipeId === group.recipeId
        )
        const writes = existing.map((item) => {
          const line = group.lines.find((row) => row.recipeItemId === item.id)
          if (!line) {
            return {
              ingredientId: item.ingredientId,
              rawName: item.rawName,
              quantity: item.quantity,
              unit: item.unit,
              matchStatus: item.matchStatus,
              ...(item.sourceQuantity != null
                ? { sourceQuantity: item.sourceQuantity }
                : {}),
              ...(item.sourceUnit ? { sourceUnit: item.sourceUnit } : {}),
              ...(item.approximate ? { approximate: true as const } : {}),
              ...(item.catalogId ? { catalogId: item.catalogId } : {}),
            }
          }
          touched.push(line)
          return alignItemWrites([line], byName)[0]
        })
        await updateReviewedRecipe(recipe.id, {
          name: recipe.name,
          servings: recipe.servings,
          minutes: recipe.approxMinutes,
          steps: recipe.steps,
          stepTips: recipe.stepTips,
          items: writes,
          favorited: recipe.favorited,
          tags: recipe.tags,
          sourceText: recipe.sourceText,
        })
      }
      for (const ingredient of ingredientUpdatesFromAlign(
        touched,
        ingredients
      )) {
        await ingredientsRepo.put(ingredient)
      }
      refresh()
      setNotice("已按确认的用量更新菜谱。")
      setGroups([])
    } catch {
      setNotice("没保存上，请再试一次。")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title="AI 对齐建议"
        subtitle="把已有菜谱按现在的库存收成记账单位。没有 AI 时用本地规则。"
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
        {!ready || !groups ? (
          <p className="text-sm leading-6 text-muted-foreground">
            正在核对已有菜谱…
          </p>
        ) : null}
        {groups && groups.length === 0 ? (
          <p className="text-sm leading-6 text-muted-foreground">
            现有用量已经对上记账单位。
          </p>
        ) : null}
        {groups?.map((group) => (
          <div key={group.recipeId} className="space-y-2">
            <p className="text-base font-medium">{group.recipeName}</p>
            <RecipeAlignPanel lines={group.lines} onQuantity={changeQuantity} />
          </div>
        ))}
        {groups && groups.length > 0 ? (
          <Button
            className="h-11 text-base"
            disabled={saving}
            onClick={() => void confirm()}
          >
            {saving ? "正在保存…" : "确认这些修改"}
          </Button>
        ) : null}
        {notice ? (
          <p className="text-sm leading-6 text-muted-foreground">{notice}</p>
        ) : null}
      </div>
    </>
  )
}
