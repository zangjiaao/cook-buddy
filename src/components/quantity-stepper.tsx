import { Button } from "@/components/ui/button"

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  step = 1,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  step?: number
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        className="size-11 text-lg"
        onClick={() => onChange(Math.max(min, Number((value - step).toFixed(2))))}
        aria-label="减少"
      >
        −
      </Button>
      <span className="min-w-8 text-center text-base font-medium">{value}</span>
      <Button
        type="button"
        variant="outline"
        className="size-11 text-lg"
        onClick={() => onChange(Number((value + step).toFixed(2)))}
        aria-label="增加"
      >
        +
      </Button>
    </div>
  )
}
