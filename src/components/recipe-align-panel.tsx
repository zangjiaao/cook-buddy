import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { alignLineLabel, type AlignResultLine } from "@/lib/recipe-align"

export function RecipeAlignPanel({
  lines,
  aligning,
  onQuantity,
  onConfirm,
  confirmLabel,
  confirming,
}: {
  lines: AlignResultLine[]
  aligning?: boolean
  onQuantity: (key: string, quantity: number) => void
  onConfirm?: () => void
  confirmLabel?: string
  confirming?: boolean
}) {
  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div>
        <p className="text-base font-medium">核对用量</p>
        <p className="text-sm leading-6 text-muted-foreground">
          左边是原文，右边是对到你家食材后的记账数量。约数和没把握的行会标出来。
        </p>
      </div>
      {aligning ? (
        <p className="text-sm leading-6 text-muted-foreground">
          正在按库存对齐…
        </p>
      ) : null}
      {lines.map((line) => (
        <div key={line.key} className="space-y-2 border-t pt-3">
          <p className="text-sm leading-6">
            {line.sourceText}
            <span className="text-muted-foreground"> → </span>
            {alignLineLabel(line)}
          </p>
          {line.confidence === "low" ? (
            <p className="text-sm leading-6 text-amber-700">要对一下</p>
          ) : null}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <Input
              inputMode="decimal"
              aria-label={`${line.rawName}的记账数量`}
              className="h-11 w-24 text-base"
              value={String(line.quantity)}
              onChange={(event) =>
                onQuantity(line.key, Number(event.target.value))
              }
            />
            <span>{line.unit}</span>
          </label>
        </div>
      ))}
      {onConfirm ? (
        <Button
          className="h-11 w-full text-base"
          disabled={aligning || confirming || lines.length === 0}
          onClick={onConfirm}
        >
          {confirming ? "正在保存…" : confirmLabel || "确认保存"}
        </Button>
      ) : null}
    </section>
  )
}
