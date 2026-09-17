import { Button } from "@/components/ui/button"
import type {
  ConfirmChoice,
  IngredientResolveResult,
} from "@/lib/ai/resolve-ingredients"

export function IngredientConfirmList({
  results,
  onChoose,
}: {
  results: IngredientResolveResult[]
  onChoose: (rawName: string, choice: ConfirmChoice) => void
}) {
  const pending = results.filter((result) => result.action === "needs_confirm")
  if (pending.length === 0) return null

  return (
    <div className="space-y-3">
      <p className="text-sm leading-6 text-muted-foreground">
        这几样和已有食材有点像，点一下就行。
      </p>
      {pending.map((result) => (
        <IngredientConfirmCard
          key={result.rawName}
          result={result}
          onChoose={(choice) => onChoose(result.rawName, choice)}
        />
      ))}
    </div>
  )
}

export function IngredientConfirmCard({
  result,
  onChoose,
}: {
  result: IngredientResolveResult
  onChoose: (choice: ConfirmChoice) => void
}) {
  const draftName = result.createDraft?.name || result.rawName
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-sm leading-6">
        「{result.rawName}」是下面这一种，还是单独记？
      </p>
      {(result.candidates ?? []).map((candidate) => (
        <Button
          key={candidate.ingredientId}
          type="button"
          className="h-11 w-full text-sm"
          onClick={() =>
            onChoose({ action: "link", ingredientId: candidate.ingredientId })
          }
        >
          就是「{candidate.name}」
          {candidate.reason ? ` · ${candidate.reason}` : ""}
        </Button>
      ))}
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full text-sm"
        onClick={() => onChoose({ action: "create" })}
      >
        单独记成「{draftName}」
      </Button>
    </div>
  )
}
