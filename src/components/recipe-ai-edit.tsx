import { useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAccount } from "@/hooks/use-account"
import { HELP_LIMITS, snapshotFromRecipe } from "@/lib/recipe-help"
import { optimizeRecipe } from "@/lib/recipe-help.functions"
import type { Recipe, RecipeItem } from "@/lib/types"

export function RecipeAiEdit({
  recipe,
  items,
}: {
  recipe: Recipe
  items: RecipeItem[]
}) {
  const account = useAccount()
  const navigate = useNavigate()
  const optimize = useServerFn(optimizeRecipe)
  const [comment, setComment] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    setNotice("")
    const text = comment.trim()
    if (!text) {
      setNotice("写下想怎么改。")
      return
    }
    if (!account.user) return
    const snapshot = snapshotFromRecipe(recipe, items)
    if (!snapshot.ok) {
      setNotice(snapshot.reason)
      return
    }
    setBusy(true)
    try {
      const result = await optimize({
        data: {
          recipeId: recipe.id,
          snapshot: snapshot.value,
          comment: text,
        },
      })
      if (!result.ok) {
        setNotice(result.reason)
        return
      }
      await navigate({
        to: "/recipes/$recipeId/suggestions",
        params: { recipeId: recipe.id },
      })
    } catch {
      setNotice("没整理出来，请再试一次。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Input
          className="h-11 text-base md:text-base"
          maxLength={HELP_LIMITS.maxCommentLength}
          placeholder="用一句话让 AI 帮你改"
          aria-label="用一句话让 AI 帮你改"
          value={comment}
          disabled={busy}
          onChange={(event) => setComment(event.target.value)}
        />
        <Button
          type="submit"
          className="h-11 shrink-0 px-4 text-sm"
          disabled={busy || account.loading || !account.user}
        >
          {busy ? "整理中…" : "提交"}
        </Button>
      </form>
      {!account.loading && !account.user ? (
        <p className="text-sm leading-6 text-muted-foreground">
          请先登录，才能让 AI 改这道菜。
          <Link
            to="/inventory/settings"
            className="ml-1 text-primary-foreground"
          >
            去登录
          </Link>
        </p>
      ) : null}
      {notice ? (
        <p className="text-sm leading-6 text-muted-foreground">{notice}</p>
      ) : null}
    </div>
  )
}
