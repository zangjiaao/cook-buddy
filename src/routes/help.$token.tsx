import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { RecipeHelpForm } from "@/components/recipe-help-form"
import { readRecipeHelp } from "@/lib/recipe-help.functions"
import { formatHelpWhen } from "@/lib/recipe-help"
import type { RecipeHelpSnapshot } from "@/lib/recipe-help"

export const Route = createFileRoute("/help/$token")({
  head: () => ({
    meta: [{ title: "帮改食谱 · 做饭搭子" }],
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
      expiresAt: string
      snapshot: RecipeHelpSnapshot
    }
  | { kind: "thanks"; author: string }

function RecipeHelpPage() {
  const { token } = Route.useParams()
  const readHelp = useServerFn(readRecipeHelp)
  const [view, setView] = useState<HelpView>({ kind: "loading" })

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
          expiresAt: result.expiresAt,
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
      {view.kind === "thanks" ? (
        <>
          <h1 className="text-xl font-semibold">谢谢{view.author}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            原话已经交给对方。对方会看到你写的话，以及整理好的改动。
          </p>
        </>
      ) : null}
      {view.kind === "ready" ? (
        <>
          <header className="mb-3">
            <h1 className="text-xl font-semibold">帮改「{view.name}」</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {view.servings} 人份 · {formatHelpWhen(view.expiresAt)} 失效。
              看完菜谱，用一段话写下想改的地方。点某一步可以单独说一句。
            </p>
          </header>
          <RecipeHelpForm
            token={token}
            snapshot={view.snapshot}
            onSubmitted={(author) => setView({ kind: "thanks", author })}
          />
        </>
      ) : null}
    </main>
  )
}
