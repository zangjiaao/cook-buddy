import { useCallback, useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { IngredientConfirmList } from "@/components/ingredient-confirm"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useAccount } from "@/hooks/use-account"
import { useDb } from "@/hooks/use-db"
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh"
import { applyConfirmChoice } from "@/lib/ai/resolve-ingredients"
import { resolveIngredients } from "@/lib/ai/resolve-ingredients.functions"
import type { IngredientResolveResult } from "@/lib/ai/resolve-ingredients"
import { cn } from "cn"
import { ingredientsRepo, recipeItemsRepo } from "@/lib/db/repos"
import { normalizeIngredientName } from "@/lib/ai/match-ingredient"
import { commitHelpWrite } from "@/lib/recipe-help-apply"
import {
  listOwnedRecipeSuggestions,
  reorganizeOwnedSuggestion,
  settleRecipeSuggestion,
} from "@/lib/recipe-help.functions"
import {
  applyAcceptedHelp,
  formatHelpWhen,
  helpChanges,
  planRecipeItemWrites,
  recipeStepsFromHelp,
} from "@/lib/recipe-help"
import type {
  HelpChange,
  HelpNote,
  RecipeHelpSnapshot,
} from "@/lib/recipe-help"
import type { SuggestionRecord } from "@/lib/recipe-help-store"
import {
  persistIngredientResolutions,
  resolveAndPersistQuiet,
} from "@/lib/ingredient-resolve-persist"
import type { Ingredient, RecipeItem } from "@/lib/types"

const GROUP_LABEL = {
  ingredient: "食材",
  step: "步骤",
  tip: "贴士",
  order: "顺序",
} as const

type Hold = {
  suggestionId: string
  removeIds: string[]
  writes: RecipeItem[]
  steps: string[]
  stepTips?: string[]
  results: IngredientResolveResult[]
}

export function RecipeSuggestionList({ recipeId }: { recipeId: string }) {
  const account = useAccount()
  const { refresh } = useDb()
  const loadSuggestions = useServerFn(listOwnedRecipeSuggestions)
  const settle = useServerFn(settleRecipeSuggestion)
  const reorganize = useServerFn(reorganizeOwnedSuggestion)
  const resolveOnServer = useServerFn(resolveIngredients)
  const [rows, setRows] = useState<SuggestionRecord[]>([])
  const [picks, setPicks] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState("")
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [hold, setHold] = useState<Hold | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const result = await loadSuggestions({ data: { recipeId } })
    if (!result.ok) {
      setError(result.reason)
      return
    }
    setRows(result.suggestions)
  }, [loadSuggestions, recipeId])

  useForegroundRefresh(() => {
    if (!account.user) return
    void reload()
  }, Boolean(account.user))

  useEffect(() => {
    if (!account.user) {
      setLoading(false)
      return
    }
    let cancelled = false
    loadSuggestions({ data: { recipeId } })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setError(result.reason)
          return
        }
        setRows(result.suggestions)
      })
      .catch(() => {
        if (!cancelled) setError("建议没读出来。")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [account.user, loadSuggestions, recipeId])

  async function finish(
    suggestionId: string,
    plan: { removeIds: string[]; writes: RecipeItem[] },
    fields: { steps: string[]; stepTips?: string[] }
  ) {
    const written = await commitHelpWrite({
      recipeId,
      steps: fields.steps,
      stepTips: fields.stepTips,
      removeIds: plan.removeIds,
      writes: plan.writes,
    })
    if (!written.ok) {
      setError(written.reason)
      return
    }
    const settled = await settle({
      data: { suggestionId, decision: "accepted" },
    })
    setHold(null)
    setNotice(
      settled.ok
        ? "已写入这道菜。"
        : "已经写入这道菜，但状态没标上。再点一次接受即可。"
    )
    refresh()
    await reload()
  }

  async function organize(id: string) {
    setBusy(id)
    setError("")
    setNotice("")
    try {
      const result = await reorganize({ data: { suggestionId: id } })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      setNotice("已整理成逐项改动。")
      await reload()
    } catch {
      setError("没整理出来，请再试一次。")
    } finally {
      setBusy("")
    }
  }

  async function accept(record: SuggestionRecord, ids: string[]) {
    if (!record.proposal) return
    setBusy(record.id)
    setError("")
    setNotice("")
    try {
      const applied = applyAcceptedHelp(record.snapshot, record.proposal, ids)
      const current = await recipeItemsRepo.byRecipe(recipeId)
      const plan = planRecipeItemWrites(
        recipeId,
        current,
        record.snapshot.ingredients,
        applied.ingredients
      )
      const fields = recipeStepsFromHelp(applied.steps)
      const unlinked = plan.writes.filter((item) => !item.ingredientId)
      let writes = plan.writes
      if (unlinked.length > 0) {
        const ingredients = await ingredientsRepo.list()
        const resolved = await resolveAndPersistQuiet(
          unlinked.map((item) => ({
            rawName: item.rawName,
            unit: item.unit,
          })),
          ingredients,
          (payload) => resolveOnServer({ data: payload })
        )
        if (resolved.pending.length > 0) {
          setHold({
            suggestionId: record.id,
            removeIds: plan.removeIds,
            writes,
            steps: fields.steps,
            stepTips: fields.stepTips,
            results: resolved.results,
          })
          return
        }
        writes = linkWrites(writes, resolved.byRawName)
      }
      await finish(record.id, { removeIds: plan.removeIds, writes }, fields)
    } catch (acceptError) {
      console.error("接受修改建议失败", acceptError)
      setError("没写进去，请再试一次。")
    } finally {
      setBusy("")
    }
  }

  async function choose(
    rawName: string,
    choice: Parameters<typeof applyConfirmChoice>[1]
  ) {
    if (!hold) return
    const results = hold.results.map((result) =>
      result.rawName === rawName ? applyConfirmChoice(result, choice) : result
    )
    if (results.some((result) => result.action === "needs_confirm")) {
      setHold({ ...hold, results })
      return
    }
    setBusy(hold.suggestionId)
    try {
      const ingredients = await ingredientsRepo.list()
      const persisted = await persistIngredientResolutions(results, ingredients)
      await finish(
        hold.suggestionId,
        {
          removeIds: hold.removeIds,
          writes: linkWrites(hold.writes, persisted.byRawName),
        },
        { steps: hold.steps, stepTips: hold.stepTips }
      )
    } catch (confirmError) {
      console.error("确认食材失败", confirmError)
      setError("没写进去，请再试一次。")
    } finally {
      setBusy("")
    }
  }

  async function ignore(id: string) {
    setBusy(id)
    setError("")
    setNotice("")
    try {
      const result = await settle({
        data: { suggestionId: id, decision: "ignored" },
      })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      setNotice("已忽略。")
      await reload()
    } catch {
      setError("没忽略掉，请再试一次。")
    } finally {
      setBusy("")
    }
  }

  if (account.loading || loading) {
    return <p className="text-sm text-muted-foreground">读取中…</p>
  }
  if (!account.user) {
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        请先登录才能看修改建议。
        <Link to="/inventory/settings" className="ml-1 text-primary-foreground">
          去登录
        </Link>
      </p>
    )
  }

  const pending = rows.filter((row) => row.status === "pending")
  const done = rows.filter((row) => row.status !== "pending")

  return (
    <div className="space-y-4">
      {pending.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">
          还没有待处理的修改建议。
        </p>
      ) : null}
      {pending.map((record) => {
        const changes = record.proposal
          ? helpChanges(record.snapshot, record.proposal)
          : []
        const selected = picks[record.id] ?? changes.map((change) => change.id)
        return (
          <section key={record.id} className="space-y-2 rounded-lg border p-3">
            <p className="text-sm leading-6">
              <span className="font-medium">{record.author}</span>
              <span className="text-muted-foreground">
                {" "}
                · {formatHelpWhen(record.createdAt)}
              </span>
            </p>
            <OriginalWords snapshot={record.snapshot} note={record.note} />
            {changes.length > 0 ? (
              <>
                <p className="text-xs text-muted-foreground">整理出的改动</p>
                <ChangeGroups
                  changes={changes}
                  selected={selected}
                  onToggle={(id) => {
                    const next = selected.includes(id)
                      ? selected.filter((item) => item !== id)
                      : [...selected, id]
                    setPicks((current) => ({ ...current, [record.id]: next }))
                  }}
                />
                {hold?.suggestionId === record.id ? (
                  <IngredientConfirmList
                    results={hold.results}
                    onChoose={(rawName, choice) => void choose(rawName, choice)}
                  />
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    className="h-10 text-sm"
                    disabled={
                      busy === record.id ||
                      selected.length === 0 ||
                      hold?.suggestionId === record.id
                    }
                    onClick={() => void accept(record, selected)}
                  >
                    接受勾选
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 text-sm"
                    disabled={
                      busy === record.id || hold?.suggestionId === record.id
                    }
                    onClick={() =>
                      void accept(
                        record,
                        changes.map((change) => change.id)
                      )
                    }
                  >
                    全部接受
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm leading-6 text-muted-foreground">
                  还没整理成逐项改动。
                </p>
                <Button
                  type="button"
                  className="h-10 w-full text-sm"
                  disabled={busy === record.id}
                  onClick={() => void organize(record.id)}
                >
                  {busy === record.id ? "正在整理…" : "重新整理"}
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              className="h-10 w-full text-sm text-muted-foreground"
              disabled={busy === record.id || hold?.suggestionId === record.id}
              onClick={() => void ignore(record.id)}
            >
              忽略
            </Button>
          </section>
        )
      })}
      {done.length > 0 ? (
        <section className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">已处理</p>
          {done.map((record) => (
            <p
              key={record.id}
              className="text-sm leading-6 text-muted-foreground"
            >
              {record.author} · {formatHelpWhen(record.createdAt)} ·{" "}
              {record.status === "accepted" ? "已接受" : "已忽略"}
            </p>
          ))}
        </section>
      ) : null}
      {notice ? (
        <p className="text-sm leading-6 text-muted-foreground">{notice}</p>
      ) : null}
      {error ? (
        <p className="text-sm leading-6 text-destructive">{error}</p>
      ) : null}
    </div>
  )
}

function OriginalWords({
  snapshot,
  note,
}: {
  snapshot: RecipeHelpSnapshot
  note: HelpNote
}) {
  const index = new Map(
    snapshot.steps.map((step, position) => [step.id, position + 1])
  )
  return (
    <div className="space-y-1 rounded-md bg-muted/50 px-2 py-2 text-sm leading-6">
      {note.comment ? <p>{note.comment}</p> : null}
      {note.stepNotes.map((item) => (
        <p key={item.stepId} className="text-muted-foreground">
          第{index.get(item.stepId) ?? "?"}步：{item.text}
        </p>
      ))}
    </div>
  )
}

function ChangeGroups({
  changes,
  selected,
  onToggle,
}: {
  changes: HelpChange[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  const groups = (["ingredient", "step", "tip", "order"] as const).filter(
    (group) => changes.some((change) => change.group === group)
  )
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <div key={group} className="space-y-1">
          <p className="text-xs text-muted-foreground">{GROUP_LABEL[group]}</p>
          {changes
            .filter((change) => change.group === group)
            .map((change) => (
              <ChangeRow
                key={change.id}
                change={change}
                checked={selected.includes(change.id)}
                onToggle={() => onToggle(change.id)}
              />
            ))}
        </div>
      ))}
    </div>
  )
}

function ChangeRow({
  change,
  checked,
  onToggle,
}: {
  change: HelpChange
  checked: boolean
  onToggle: () => void
}) {
  const tone =
    change.kind === "add"
      ? "border-primary bg-primary/15"
      : change.kind === "remove"
        ? "border-destructive bg-destructive/10"
        : "border-foreground/30 bg-muted/60"
  const mark = { add: "增", remove: "删", change: "改", move: "序" }[
    change.kind
  ]
  const beforeMuted = change.kind === "remove" || change.kind === "change"
  return (
    <label
      className={cn(
        "flex items-start gap-2 rounded-md border-l-2 px-2 py-1.5",
        tone
      )}
    >
      <Checkbox
        checked={checked}
        className="mt-0.5 size-5"
        onCheckedChange={() => onToggle()}
      />
      <span className="min-w-0 text-sm leading-5">
        <span className="text-muted-foreground">{mark} </span>
        <span className="font-medium">{change.label}</span>
        <span className="mt-0.5 block">
          {change.before ? (
            <span
              className={
                beforeMuted ? "text-muted-foreground line-through" : ""
              }
            >
              {change.before}
            </span>
          ) : null}
          {change.before && change.after ? " → " : null}
          {change.after ? (
            <span className="text-primary-foreground">{change.after}</span>
          ) : null}
        </span>
      </span>
    </label>
  )
}

function linkWrites(
  writes: RecipeItem[],
  byRawName: Map<string, Ingredient>
): RecipeItem[] {
  return writes.map((item) => {
    if (item.ingredientId) return item
    const ingredient = byRawName.get(normalizeIngredientName(item.rawName))
    if (!ingredient) return item
    return {
      ...item,
      ingredientId: ingredient.id,
      matchStatus: "linked",
    }
  })
}
