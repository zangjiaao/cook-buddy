import { useEffect, useState } from "react"
import { Link, useNavigate, createFileRoute } from "@tanstack/react-router"
import { IngredientConfirmList } from "@/components/ingredient-confirm"
import { PageHeader } from "@/components/layout/page-header"
import { RecipeEditorFields } from "@/components/recipe-editor-fields"
import { Button } from "@/components/ui/button"
import { useDb, useQuery } from "@/hooks/use-db"
import { useRecipeResolveSave } from "@/hooks/use-recipe-resolve-save"
import {
  deleteRecipe,
  recipeItemsRepo,
  recipesRepo,
  updateReviewedRecipe,
} from "@/lib/db/repos"
import {
  editableItemsFromRecipeItems,
  toResolvedRecipeItems,
} from "@/lib/recipe-draft-items"
import type { EditableRecipeItem } from "@/lib/recipe-draft-items"
import { sanitizeRecipeTags } from "@/lib/recipe-organize"
import type { RecipeTag } from "@/lib/recipe-organize"
import type { Ingredient, Recipe, RecipeItem } from "@/lib/types"

export const Route = createFileRoute("/_tabs/recipes/$recipeId/edit")({
  component: RecipeEditPage,
})

function RecipeEditPage() {
  const { recipeId } = Route.useParams()
  const navigate = useNavigate()
  const { refresh } = useDb()
  const { data: recipe, loading } = useQuery(
    `recipe:${recipeId}`,
    () => recipesRepo.get(recipeId),
    undefined as Recipe | undefined
  )
  const { data: recipeItems, loading: itemsLoading } = useQuery(
    `recipe-items:${recipeId}`,
    () => recipeItemsRepo.byRecipe(recipeId),
    [] as RecipeItem[]
  )
  const [name, setName] = useState("")
  const [servings, setServings] = useState("2")
  const [minutes, setMinutes] = useState("")
  const [steps, setSteps] = useState("")
  const [items, setItems] = useState<EditableRecipeItem[]>([])
  const [favorited, setFavorited] = useState(false)
  const [tags, setTags] = useState<RecipeTag[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { pendingResults, saving, error, waitingConfirm, save, handleConfirm } =
    useRecipeResolveSave()

  useEffect(() => {
    if (hydrated || !recipe || itemsLoading) return
    setName(recipe.name)
    setServings(String(recipe.servings))
    setMinutes(recipe.approxMinutes ? String(recipe.approxMinutes) : "")
    setSteps(recipe.steps.join("\n"))
    setItems(editableItemsFromRecipeItems(recipeItems))
    setFavorited(Boolean(recipe.favorited))
    setTags(sanitizeRecipeTags(recipe.tags))
    setHydrated(true)
  }, [hydrated, recipe, recipeItems, itemsLoading])

  async function persist(byRawName: Map<string, Ingredient>) {
    await updateReviewedRecipe(recipeId, {
      name,
      servings,
      minutes,
      steps,
      items: toResolvedRecipeItems(items, byRawName),
      favorited,
      tags,
    })
    refresh()
    void navigate({
      to: "/recipes/$recipeId",
      params: { recipeId },
    })
  }

  async function onDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      await deleteRecipe(recipeId)
      refresh()
      void navigate({ to: "/recipes" })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="改食谱"
        subtitle="改名字、份数、步骤或用料。保存后会自动认食材。"
        action={
          <Button
            nativeButton={false}
            variant="ghost"
            className="h-11"
            render={<Link to="/recipes/$recipeId" params={{ recipeId }} />}
          >
            返回
          </Button>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-8">
        {loading ? (
          <p className="text-sm text-muted-foreground">读取中…</p>
        ) : null}
        {!loading && !recipe ? (
          <p className="text-sm text-muted-foreground">这道菜不在了。</p>
        ) : null}
        {hydrated && recipe ? (
          <>
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
            <Button
              className="h-12 text-base"
              disabled={saving || waitingConfirm || deleting}
              onClick={() => void save(items, persist)}
            >
              {saving ? "正在保存…" : "保存"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-12 text-base"
              disabled={saving || deleting}
              onClick={() => void onDelete()}
            >
              {deleting
                ? "正在删…"
                : confirmDelete
                  ? "确认删掉这道菜"
                  : "删掉这道菜"}
            </Button>
          </>
        ) : null}
      </div>
    </>
  )
}
