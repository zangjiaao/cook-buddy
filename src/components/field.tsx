import type { ReactNode } from "react"
import { Label } from "@/components/ui/label"
import { cn } from "cn"

export function Field({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn("flex flex-col gap-2", className)}>
      <Label className="text-sm text-muted-foreground">{label}</Label>
      {children}
    </label>
  )
}

export const fieldControlClass =
  "h-12 w-full rounded-md border border-input bg-background px-3 text-base"
