import { useState } from "react"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, fieldControlClass } from "@/components/field"
import { createId } from "@/lib/id"
import { submitRecipeSuggestion } from "@/lib/recipe-help.functions"
import type {
  HelpIngredient,
  HelpStep,
  RecipeHelpSnapshot,
} from "@/lib/recipe-help"

type DraftIngredient = {
  id: string
  rawName: string
  quantity: string
  unit: string
}

export function RecipeHelpForm({
  token,
  snapshot,
  onSubmitted,
}: {
  token: string
  snapshot: RecipeHelpSnapshot
  onSubmitted: (author: string) => void
}) {
  const submit = useServerFn(submitRecipeSuggestion)
  const [ingredients, setIngredients] = useState<DraftIngredient[]>(
    snapshot.ingredients.map((item) => ({
      id: item.id,
      rawName: item.rawName,
      quantity: String(item.quantity),
      unit: item.unit,
    }))
  )
  const [steps, setSteps] = useState<HelpStep[]>(snapshot.steps)
  const [author, setAuthor] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  function patchIngredient(id: string, patch: Partial<DraftIngredient>) {
    setIngredients((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    )
  }

  function patchStep(id: string, patch: Partial<HelpStep>) {
    setSteps((current) =>
      current.map((step) => (step.id === id ? { ...step, ...patch } : step))
    )
  }

  function moveStep(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= steps.length) return
    setSteps((current) => {
      const next = current.slice()
      const [row] = next.splice(index, 1)
      next.splice(target, 0, row)
      return next
    })
  }

  async function onSubmit() {
    setError("")
    const name = author.trim()
    if (!name) {
      setError("写下署名，例如妈妈。")
      return
    }
    const parsedIngredients: HelpIngredient[] = []
    for (const item of ingredients) {
      if (!item.rawName.trim() && !item.quantity.trim() && !item.unit.trim()) {
        continue
      }
      const quantity = Number(item.quantity.trim())
      if (!item.rawName.trim()) {
        setError("食材名空了。")
        return
      }
      if (!Number.isFinite(quantity)) {
        setError("数量要填数字。")
        return
      }
      parsedIngredients.push({
        id: item.id,
        rawName: item.rawName.trim(),
        quantity,
        unit: item.unit.trim(),
      })
    }
    setBusy(true)
    try {
      const result = await submit({
        data: {
          token,
          body: {
            author: name,
            ingredients: parsedIngredients,
            steps: steps.map((step) => ({
              id: step.id,
              text: step.text.trim(),
              tip: step.tip.trim(),
            })),
          },
        },
      })
      if (!result.ok) {
        setError(result.reason)
        return
      }
      onSubmitted(name)
    } catch {
      setError("没提交上，请再试一次。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">食材</p>
        {ingredients.map((item, index) => (
          <div key={item.id} className="space-y-1.5 rounded-md border p-2">
            <Input
              className="h-10 text-sm"
              aria-label={`食材 ${index + 1} 名称`}
              placeholder="名称"
              value={item.rawName}
              onChange={(event) =>
                patchIngredient(item.id, { rawName: event.target.value })
              }
            />
            <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
              <Input
                className="h-10 text-sm"
                inputMode="decimal"
                aria-label={`食材 ${index + 1} 数量`}
                placeholder="数量"
                value={item.quantity}
                onChange={(event) =>
                  patchIngredient(item.id, { quantity: event.target.value })
                }
              />
              <Input
                className="h-10 text-sm"
                aria-label={`食材 ${index + 1} 单位`}
                placeholder="单位"
                value={item.unit}
                onChange={(event) =>
                  patchIngredient(item.id, { unit: event.target.value })
                }
              />
              <Button
                type="button"
                variant="ghost"
                className="h-10 px-2 text-sm"
                onClick={() =>
                  setIngredients((current) =>
                    current.filter((row) => row.id !== item.id)
                  )
                }
              >
                去掉
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full text-sm"
          onClick={() =>
            setIngredients((current) => [
              ...current,
              { id: createId("ing"), rawName: "", quantity: "", unit: "" },
            ])
          }
        >
          加上一味
        </Button>
      </section>
      <section className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">步骤</p>
        {steps.map((step, index) => (
          <div key={step.id} className="space-y-1.5 rounded-md border p-2">
            <Input
              className="h-10 text-sm"
              aria-label={`第 ${index + 1} 步`}
              placeholder="这一步做什么"
              value={step.text}
              onChange={(event) =>
                patchStep(step.id, { text: event.target.value })
              }
            />
            <Input
              className="h-10 text-sm"
              aria-label={`第 ${index + 1} 步贴士`}
              placeholder="小贴士，可空"
              value={step.tip}
              onChange={(event) =>
                patchStep(step.id, { tip: event.target.value })
              }
            />
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                type="button"
                variant="ghost"
                className="h-9 text-sm"
                disabled={index === 0}
                onClick={() => moveStep(index, -1)}
              >
                上移
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-9 text-sm"
                disabled={index === steps.length - 1}
                onClick={() => moveStep(index, 1)}
              >
                下移
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-9 text-sm"
                onClick={() =>
                  setSteps((current) =>
                    current.filter((row) => row.id !== step.id)
                  )
                }
              >
                去掉
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full text-sm"
          onClick={() =>
            setSteps((current) => [
              ...current,
              { id: createId("stp"), text: "", tip: "" },
            ])
          }
        >
          加一步
        </Button>
      </section>
      <Field label="署名">
        <Input
          className={fieldControlClass}
          placeholder="例如妈妈"
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
        />
      </Field>
      {error ? (
        <p className="text-sm leading-6 text-destructive">{error}</p>
      ) : null}
      <Button
        type="button"
        className="h-11 w-full text-sm"
        disabled={busy}
        onClick={() => void onSubmit()}
      >
        {busy ? "正在提交…" : "提交修改"}
      </Button>
    </div>
  )
}
