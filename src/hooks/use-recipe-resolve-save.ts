import { useRef, useState } from "react"
import { useServerFn } from "@tanstack/react-start"
import { applyConfirmChoice } from "@/lib/ai/resolve-ingredients"
import { resolveIngredients } from "@/lib/ai/resolve-ingredients.functions"
import type {
  ConfirmChoice,
  IngredientResolveResult,
} from "@/lib/ai/resolve-ingredients"
import { ingredientsRepo } from "@/lib/db/repos"
import {
  persistIngredientResolutions,
  resolveAndPersistQuiet,
} from "@/lib/ingredient-resolve-persist"
import { toResolveInputItems } from "@/lib/recipe-draft-items"
import type { EditableRecipeItem } from "@/lib/recipe-draft-items"
import type { Ingredient } from "@/lib/types"

export function useRecipeResolveSave() {
  const resolveOnServer = useServerFn(resolveIngredients)
  const persistRef = useRef<
    ((byRawName: Map<string, Ingredient>) => Promise<void>) | null
  >(null)
  const [pendingResults, setPendingResults] = useState<
    IngredientResolveResult[] | null
  >(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  function resetPending() {
    setPendingResults(null)
    setError("")
  }

  async function finish(
    results: IngredientResolveResult[],
    already?: Map<string, Ingredient>
  ) {
    const persist = persistRef.current
    if (!persist) return
    const currentIngredients = await ingredientsRepo.list()
    const { byRawName } = already
      ? { byRawName: already }
      : await persistIngredientResolutions(results, currentIngredients)
    await persist(byRawName)
  }

  async function save(
    items: EditableRecipeItem[],
    persist: (byRawName: Map<string, Ingredient>) => Promise<void>
  ) {
    persistRef.current = persist
    setSaving(true)
    setError("")
    try {
      const currentIngredients = await ingredientsRepo.list()
      const { results, pending, byRawName } = await resolveAndPersistQuiet(
        toResolveInputItems(items),
        currentIngredients,
        (payload) => resolveOnServer({ data: payload })
      )
      if (pending.length > 0) {
        setPendingResults(results)
        setSaving(false)
        return
      }
      await finish(results, byRawName)
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
      await finish(next)
    } catch (saveError) {
      console.error("保存食谱失败", saveError)
      setError("保存失败，请再试一次。")
      setSaving(false)
    }
  }

  const waitingConfirm = Boolean(
    pendingResults?.some((result) => result.action === "needs_confirm")
  )

  return {
    pendingResults,
    saving,
    error,
    waitingConfirm,
    save,
    handleConfirm,
    resetPending,
  }
}
