import { useState } from "react"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, fieldControlClass } from "@/components/field"
import { submitRecipeSuggestion } from "@/lib/recipe-help.functions"
import { HELP_LIMITS, formatHelpIngredient } from "@/lib/recipe-help"
import type { RecipeHelpSnapshot } from "@/lib/recipe-help"

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
  const [comment, setComment] = useState("")
  const [author, setAuthor] = useState("")
  const [openStep, setOpenStep] = useState<string | null>(null)
  const [stepNotes, setStepNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function onSubmit() {
    setError("")
    const name = author.trim()
    if (!name) {
      setError("写下署名，例如妈妈。")
      return
    }
    const text = comment.trim()
    const notes = snapshot.steps
      .map((step) => ({
        stepId: step.id,
        text: (stepNotes[step.id] ?? "").trim(),
      }))
      .filter((note) => note.text)
    if (!text && notes.length === 0) {
      setError("写下想改的地方。")
      return
    }
    setBusy(true)
    try {
      const result = await submit({
        data: {
          token,
          body: { author: name, comment: text, stepNotes: notes },
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
      <section className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">食材</p>
        <ul className="space-y-0.5 text-sm leading-6">
          {snapshot.ingredients.map((item) => (
            <li key={item.id}>{formatHelpIngredient(item)}</li>
          ))}
        </ul>
      </section>
      <section className="space-y-1.5">
        <p className="text-sm font-medium text-muted-foreground">步骤</p>
        {snapshot.steps.map((step, index) => {
          const note = stepNotes[step.id] ?? ""
          const open = openStep === step.id || note.trim().length > 0
          return (
            <div key={step.id} className="rounded-md border px-2 py-1.5">
              <button
                type="button"
                className="w-full text-left text-sm leading-6"
                onClick={() =>
                  setOpenStep((current) =>
                    current === step.id ? null : step.id
                  )
                }
              >
                <span className="text-muted-foreground">{index + 1}. </span>
                {step.text}
                {step.tip ? (
                  <span className="mt-0.5 block text-muted-foreground">
                    贴士：{step.tip}
                  </span>
                ) : null}
              </button>
              {open ? (
                <Input
                  className="mt-1.5 h-10 text-sm"
                  maxLength={HELP_LIMITS.maxStepNoteLength}
                  aria-label={`第 ${index + 1} 步的意见`}
                  placeholder="对这一步说一句，可空"
                  value={note}
                  onChange={(event) =>
                    setStepNotes((current) => ({
                      ...current,
                      [step.id]: event.target.value,
                    }))
                  }
                />
              ) : null}
            </div>
          )
        })}
      </section>
      <Field label="想怎么改">
        <Textarea
          className="min-h-28 text-sm"
          maxLength={HELP_LIMITS.maxCommentLength}
          placeholder="例如：五花肉改成 400 克，少放糖，焯水时冷水下锅。"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </Field>
      <Field label="署名">
        <Input
          className={fieldControlClass}
          maxLength={HELP_LIMITS.maxAuthorLength}
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
        {busy ? "正在提交…" : "提交修改意见"}
      </Button>
    </div>
  )
}
