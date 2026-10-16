import { useEffect, useRef, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { RecipeHelpForm } from "@/components/recipe-help-form"
import { Button } from "@/components/ui/button"
import { useAccount } from "@/hooks/use-account"
import { resolveIngredients } from "@/lib/ai/resolve-ingredients.functions"
import {
  formatHelpIngredient,
  formatHelpWhen,
  helpReturnPath,
} from "@/lib/recipe-help"
import { readRecipeHelp, saveSharedRecipe } from "@/lib/recipe-help.functions"
import { materializeSharedRecipe } from "@/lib/recipe-share-save"
import type { RecipeHelpSnapshot } from "@/lib/recipe-help"

export const Route = createFileRoute("/help/$token")({
  head: () => ({
    meta: [{ title: "分享食谱 · 做饭搭子" }],
  }),
  component: RecipeHelpPage,
})

type HelpView =
  | { kind: "loading" }
  | { kind: "error"; reason: string }
  | {
      kind: "ready"
      name: string
      servings: number
      ownerName: string
      sourceLabel: string
      suggestionsOpen: boolean
      helpExpiresAt: string | null
      snapshot: RecipeHelpSnapshot
    }

function RecipeHelpPage() {
  const { token } = Route.useParams()
  const account = useAccount()
  const navigate = useNavigate()
  const readHelp = useServerFn(readRecipeHelp)
  const saveShare = useServerFn(saveSharedRecipe)
  const resolveOnServer = useServerFn(resolveIngredients)
  const [view, setView] = useState<HelpView>({ kind: "loading" })
  const [showForm, setShowForm] = useState(false)
  const [thanks, setThanks] = useState("")
  const [notice, setNotice] = useState("")
  const [busy, setBusy] = useState(false)
  const saveOnce = useRef(false)

  useEffect(() => {
    let cancelled = false
    readHelp({ data: { token } })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setView({ kind: "error", reason: result.reason })
          return
        }
        setView({
          kind: "ready",
          name: result.name,
          servings: result.servings,
          ownerName: result.ownerName,
          sourceLabel: result.sourceLabel,
          suggestionsOpen: result.suggestionsOpen,
          helpExpiresAt: result.helpExpiresAt,
          snapshot: result.snapshot,
        })
      })
      .catch(() => {
        if (!cancelled) {
          setView({ kind: "error", reason: "没读出来，请再打开一次。" })
        }
      })
    return () => {
      cancelled = true
    }
  }, [readHelp, token])

  async function saveRecipe() {
    if (view.kind !== "ready") return
    if (!account.user) {
      const back = helpReturnPath(`/help/${token}`)
      window.location.assign(
        `/inventory/settings?returnTo=${encodeURIComponent(back ?? "")}&save=1`
      )
      return
    }
    setBusy(true)
    setNotice("")
    try {
      const result = await saveShare({ data: { token } })
      if (!result.ok) {
        if ("needAuth" in result && result.needAuth) {
          const back = helpReturnPath(`/help/${token}`)
          window.location.assign(
            `/inventory/settings?returnTo=${encodeURIComponent(back ?? "")}&save=1`
          )
          return
        }
        setNotice(result.reason)
        return
      }
      await materializeSharedRecipe(
        {
          recipeId: result.recipeId,
          snapshot: result.snapshot,
          sourceLabel: result.sourceLabel,
        },
        (payload) => resolveOnServer({ data: payload })
      )
      void account.syncNow()
      if (result.already) {
        setNotice("已经存过这道菜了。")
        return
      }
      await navigate({
        to: "/recipes/$recipeId",
        params: { recipeId: result.recipeId },
      })
    } catch {
      setNotice("没存上，请再试一次。")
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (view.kind !== "ready" || !account.user || saveOnce.current) return
    if (typeof window === "undefined") return
    const save = new URLSearchParams(window.location.search).get("save")
    if (save !== "1") return
    saveOnce.current = true
    window.history.replaceState(null, "", `/help/${token}`)
    void saveRecipe()
  }, [account.user, token, view.kind])

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col px-4 pt-4 pb-8">
      {view.kind === "loading" ? (
        <p className="text-sm text-muted-foreground">读取中…</p>
      ) : null}
      {view.kind === "error" ? (
        <>
          <h1 className="text-xl font-semibold">链接用不了</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {view.reason}
          </p>
        </>
      ) : null}
      {view.kind === "ready" ? (
        <>
          <header className="mb-3">
            <h1 className="text-xl font-semibold">{view.name}</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {view.servings} 人份 · {view.sourceLabel}
              {view.suggestionsOpen && view.helpExpiresAt
                ? ` · 意见收到 ${formatHelpWhen(view.helpExpiresAt)}`
                : ""}
            </p>
          </header>
          <section className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">食材</p>
            <ul className="space-y-0.5 text-sm leading-6">
              {view.snapshot.ingredients.map((item) => (
                <li key={item.id}>{formatHelpIngredient(item)}</li>
              ))}
            </ul>
          </section>
          <section className="mt-3 space-y-1.5">
            <p className="text-sm font-medium text-muted-foreground">步骤</p>
            {view.snapshot.steps.map((step, index) => (
              <p key={step.id} className="text-sm leading-6">
                <span className="text-muted-foreground">{index + 1}. </span>
                {step.text}
                {step.tip ? (
                  <span className="mt-0.5 block text-muted-foreground">
                    贴士：{step.tip}
                  </span>
                ) : null}
              </p>
            ))}
          </section>
          <div
            className={`mt-4 grid gap-2 ${view.suggestionsOpen ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {view.suggestionsOpen ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 text-sm"
                onClick={() => setShowForm((current) => !current)}
              >
                提修改意见
              </Button>
            ) : null}
            <Button
              type="button"
              className="h-11 text-sm"
              disabled={busy}
              onClick={() => void saveRecipe()}
            >
              {busy ? "正在保存…" : "存到我的食谱"}
            </Button>
          </div>
          {thanks ? (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              谢谢{thanks}。原话已经交给对方。
            </p>
          ) : null}
          {showForm && view.suggestionsOpen && !thanks ? (
            <div className="mt-4">
              <RecipeHelpForm
                token={token}
                snapshot={view.snapshot}
                onSubmitted={(author) => {
                  setThanks(author)
                  setShowForm(false)
                }}
              />
            </div>
          ) : null}
          {notice ? (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {!account.user && !account.loading ? (
            <p className="mt-6 text-xs leading-5 text-muted-foreground">
              做饭搭子把菜谱、家里的库存和要买的菜放在一起。
            </p>
          ) : null}
        </>
      ) : null}
    </main>
  )
}
